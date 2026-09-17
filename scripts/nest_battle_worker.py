"""JSON-only, stdlib-only battle worker. Never loads Flask or player databases."""
import contextlib
import json
import math
from pathlib import Path
import random
import sys
from datetime import datetime
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.attributes.attribute import Attribute, AttributeType
from src.characters.character import Character
from src.classes.profession import ProfessionType, get_profession
from src.versions.version import GameVersion
from src.dungeons.dungeon import Dungeon, DungeonType
from src.dungeons.dungeon_battle import DungeonBattleFlow, DungeonBattleState
from src.combat.battle import BattleState

CHARACTER_NAMES = {row['id']: row['name'] for row in json.loads((ROOT / 'data/content/characters.json').read_text(encoding='utf-8-sig'))['characters']}


class DiscardOutput:
    def write(self, text):
        return len(text)

    def flush(self):
        pass


def character_from_snapshot(row):
    character = Character(row['id'], CHARACTER_NAMES.get(row.get('characterConfigId'), row.get('characterConfigId', row['id'])),
                          get_profession(ProfessionType[row['professionType']]),
                          Attribute(AttributeType[row['attributeType']]),
                          GameVersion('online', 'Online', 'Online', 0, datetime(2026, 1, 1)),
                          level=int(row['level']))
    character.saved_skill_slots = row.get('skillSlots') or None
    character.character_config_id = row.get('characterConfigId', row['id'])
    equipment = row.get('equipment') or {}
    seen = set()

    def visit(value):
        if not isinstance(value, dict):
            return
        item_id = value.get('itemId') or value.get('item_id')
        if item_id:
            if item_id in seen:
                return
            seen.add(item_id)
            payload = value.get('itemData') or value.get('item_data') or value
            for name, amount in (payload.get('stats') or {}).items():
                key = name.removesuffix('_bonus')
                if key in {'hp', 'attack', 'defense', 'magic_attack', 'magic_defense'} and isinstance(amount, (int, float)) and math.isfinite(amount):
                    setattr(character, key, getattr(character, key) + max(0, int(amount)))
            special = payload.get('specialSkill') or payload.get('special_skill')
            if special and value.get('itemType', value.get('item_type')) == 'weapon':
                character.exclusive_weapon = SimpleNamespace(weapon_id=item_id, name=payload.get('name', 'Exclusive'), special_skill=special, attack_bonus=0, magic_attack_bonus=0)
            return
        for child in value.values():
            visit(child)
    visit(equipment)
    return character


def simulate(request):
    random.seed(request['seed'])
    spec = request['dungeon']
    kind = DungeonType[spec['dungeonType']]
    duration = int(spec['duration'])
    if duration < 1 or duration > 300 or not 1 <= len(request['characters']) <= 20:
        raise ValueError('invalid battle bounds')
    dungeon = Dungeon(spec['dungeonId'], spec['name'], AttributeType[spec['attributeType']], kind,
                      duration=duration, monster_config={'allowed_monster_types': ['SINGLE', 'GROUP_5'],
                      'spawn_interval': 3, 'spawn_wave_count': 20,
                      'stat_multiplier': {'normal': 1, 'hard': 1.6, 'nightmare': 2.4}[spec['difficulty']]})
    party = [character_from_snapshot(row) for row in request['characters']]
    flow = DungeonBattleFlow(dungeon, party)
    # Rewards are exclusively owned by Nest's transaction, never by this worker.
    flow._calculate_rewards = lambda: None
    flow._start_actual_battle()
    battle = flow.battle
    battle.monster_runtime.rng = random.Random(request['seed'])
    metadata, frames = {}, []
    frame_interval = max(1, math.ceil(duration / 30))
    events = []

    def log(message, event_type='info', payload=None):
        if event_type in {'boss_skill', 'boss_mechanic', 'death', 'skill', 'exclusive_weapon_skill'}:
            events.append({'time': battle.current_time, 'event_type': event_type, 'message': message, 'payload': payload or {}})
            if len(events) > 512:
                del events[0]
    battle._log = log

    def frame():
        units = battle.player_units + battle.enemy_units
        for unit in units:
            metadata.setdefault(unit.character.character_id, {'id': unit.character.character_id, 'name': unit.character.name,
                'isPlayer': unit.is_player, 'maxHealth': unit.max_health,
                'definition': getattr(unit, 'authored_monster', None)})
        frames.append({'time': round(battle.current_time, 2), 'units': [
            [u.character.character_id, round(u.current_health, 2),
             round(sum(s.get('amount', 0) for s in getattr(u, 'cast_effects', []) if s['kind'] == 'shield'), 2),
             getattr(u, 'authored_phase', 0), bool(getattr(u, 'mechanic_inactive', False)),
             u.character.name, u.max_health,
             [s['name'] for s in u.authored_monster['phases'][u.authored_phase]] if hasattr(u, 'authored_monster') else [],
             bool(getattr(u, 'authored_group', {}).get('pool')), getattr(u, 'spawn_category', None) == 'boss']
            for u in units if u.is_alive() or u.is_player]})

    frame()
    for tick in range(1, duration * 4 + 1):
        flow.update(.25)
        # Experience battles always run the full minute unless the character dies.
        if kind == DungeonType.SINGLE and flow.is_successful and battle.current_time < duration:
            flow.state = DungeonBattleState.IN_BATTLE
            battle.state = BattleState.IN_PROGRESS
            flow.is_successful = False
        done = flow.state in {DungeonBattleState.REWARD, DungeonBattleState.FAILED, DungeonBattleState.FINISHED}
        if tick % (frame_interval * 4) == 0 or done:
            frame()
        if done:
            break
    alive = any(u.is_alive() for u in battle.player_units)
    success = flow.is_successful and alive
    return {'engineVersion': 'authored-python-v1', 'duration': round(battle.current_time, 2),
        'success': success, 'survived': alive, 'singleMonstersKilled': flow.single_monsters_killed,
        'groupMonstersKilled': flow.group_monsters_killed,
        'damageScore': int(sum(row['total_damage'] for row in battle.damage_stats.values())),
        'units': metadata, 'frames': frames, 'events': events}


if __name__ == '__main__':
    request = json.loads(sys.stdin.buffer.read(1_000_001))
    with contextlib.redirect_stdout(DiscardOutput()):
        result = simulate(request)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
