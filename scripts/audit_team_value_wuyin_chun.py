"""Paired 5-player and 20-player boss simulations for Wuyin and Chun Yujue."""
import contextlib
import io
import json
import random
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.nest_battle_worker import character_from_snapshot
from src.attributes.attribute import AttributeType
from src.combat.authored_monsters import modifiers, states
from src.combat.battle import Battle, BattleState
from src.combat.battle_unit import BattleUnit
from src.enemies.authored_catalog import encounters
from src.enemies.enemy import Enemy
from src.skills.characters import dps_second


SEEDS = 30
TICK = 0.5
CATALOG = json.loads((ROOT / 'data/content/characters.json').read_text(encoding='utf-8-sig'))
CHARACTERS = {row['id']: row for row in CATALOG['characters']}

WUYIN = 'char_044_wood_magic_melee_dps'
WUYIN_PEER = 'char_046_wood_magic_ranged_dps'
CHUN = 'char_027_wind_physical_melee_dps'
CHUN_PEER = 'char_029_wind_physical_ranged_dps'


def config_id(attribute, number, role):
    return f'char_{number:03d}_{attribute}_{role}'


def five_roster(focus, attribute):
    numbers = {
        'wood': (41, 47, 48, 43),
        'wind': (25, 31, 32, 30),
    }[attribute]
    tank, healer, support, anchor = numbers
    role_by_number = {
        25: 'physical_tank', 31: 'healer', 32: 'support', 30: 'magic_ranged_dps',
        41: 'physical_tank', 47: 'healer', 48: 'support', 43: 'physical_melee_dps',
    }
    return [config_id(attribute, value, role_by_number[value]) for value in (tank, healer, support, anchor)] + [focus]


def twenty_roster(focus, attribute):
    if attribute == 'wood':
        squads = [
            ['char_041_wood_physical_tank', 'char_047_wood_healer', 'char_048_wood_support', 'char_043_wood_physical_melee_dps', focus],
            ['char_042_wood_magic_tank', 'char_047_wood_healer', 'char_048_wood_support', 'char_045_wood_physical_ranged_dps', 'char_046_wood_magic_ranged_dps'],
            ['char_041_wood_physical_tank', 'char_047_wood_healer', 'char_048_wood_support', 'char_043_wood_physical_melee_dps', 'char_045_wood_physical_ranged_dps'],
            ['char_042_wood_magic_tank', 'char_047_wood_healer', 'char_043_wood_physical_melee_dps', 'char_045_wood_physical_ranged_dps', 'char_046_wood_magic_ranged_dps'],
        ]
    else:
        squads = [
            ['char_025_wind_physical_tank', 'char_031_wind_healer', 'char_032_wind_support', 'char_030_wind_magic_ranged_dps', focus],
            ['char_026_wind_magic_tank', 'char_031_wind_healer', 'char_032_wind_support', 'char_028_wind_magic_melee_dps', 'char_029_wind_physical_ranged_dps'],
            ['char_025_wind_physical_tank', 'char_031_wind_healer', 'char_032_wind_support', 'char_028_wind_magic_melee_dps', 'char_030_wind_magic_ranged_dps'],
            ['char_026_wind_magic_tank', 'char_031_wind_healer', 'char_028_wind_magic_melee_dps', 'char_029_wind_physical_ranged_dps', 'char_030_wind_magic_ranged_dps'],
        ]
    return [item for squad in squads for item in squad]


def make_party(roster):
    party = []
    for index, character_id in enumerate(roster):
        row = CHARACTERS[character_id]
        unit_id = 'focus' if index == (4 if len(roster) == 20 else len(roster) - 1) else f'ally-{index}'
        character = character_from_snapshot({
            'id': unit_id,
            'characterConfigId': character_id,
            'attributeType': row['attributeType'],
            'professionType': row['professionType'],
            'level': 100,
            'skillSlots': None,
            'equipment': {},
        })
        party.append(BattleUnit(character, is_player=True))
    return party


def boss_stats(size):
    if size == 5:
        return dict(hp=10_000_000, attack=500, defense=250, magic_attack=300,
                    magic_defense=200, duration=120, category='SQUAD')
    return dict(hp=100_000_000, attack=1000, defense=500, magic_attack=600,
                magic_defense=400, duration=180, category='TEAM')


def run(focus, attribute, size, seed, definition, *, disable_wuyin_debuff=False):
    random.seed(f'team-value-v2-{focus}-{attribute}-{size}-{definition["name"]}-{seed}')
    spec = boss_stats(size)
    roster = five_roster(focus, attribute) if size == 5 else twenty_roster(focus, attribute)
    party = make_party(roster)
    members = definition.get('members', [definition])
    bosses = []
    for index, member in enumerate(members):
        boss = Enemy(
            enemy_id=f'benchmark-boss-{index}',
            name=member.get('name', definition['name']),
            attribute_type=AttributeType[definition['element']],
            level=100,
            base_hp=spec['hp'] // len(members),
            base_attack=spec['attack'],
            base_defense=spec['defense'],
            base_magic_attack=spec['magic_attack'],
            base_magic_defense=spec['magic_defense'],
            is_boss=True,
        ).battle_unit
        boss.spawn_category = 'boss'
        bosses.append(boss)
    battle = Battle(party, bosses, max_duration=spec['duration'] + 1)
    battle.monster_runtime.rng = random.Random(f'team-value-monster-{seed}')
    for boss, member in zip(bosses, members):
        battle.monster_runtime.attach(boss, member, definition['interval'])
    battle.monster_runtime.add_group(bosses, definition)
    battle.start()

    original_stat = dps_second.stat

    def controlled_stat(unit, owner, name, stat_names, value, *args, **kwargs):
        if (disable_wuyin_debuff
                and owner.character.character_config_id == WUYIN
                and name == '碧落染'
                and set(stat_names) == {'defense', 'magic_defense'}):
            return None
        return original_stat(unit, owner, name, stat_names, value, *args, **kwargs)

    defense_samples = []
    magic_defense_samples = []
    wuyin_debuff_samples = []
    dps_second.stat = controlled_stat
    try:
        for tick in range(1, int(spec['duration'] / TICK) + 1):
            battle.update(TICK)
            if tick % int(1 / TICK) == 0:
                active = [boss for boss in bosses if boss.is_alive() and not getattr(boss, 'mechanic_inactive', False)]
                if active:
                    effective = [modifiers(boss) for boss in active]
                    defense_samples.append(statistics.mean(
                        boss.character.defense + current.get('defense', 0)
                        for boss, current in zip(active, effective)))
                    magic_defense_samples.append(statistics.mean(
                        boss.character.magic_defense + current.get('magic_defense', 0)
                        for boss, current in zip(active, effective)))
                wuyin_debuff_samples.append(any(
                    item.get('name') == '碧落染' and item.get('owner_id') == 'focus'
                    for boss in bosses for item in states(boss)
                ))
            if battle.state != BattleState.IN_PROGRESS:
                break
    finally:
        dps_second.stat = original_stat

    summary = battle.get_damage_summary()
    focus_stats = battle.damage_stats.get('focus', {})
    elapsed = min(battle.current_time, spec['duration'])
    alive = [unit for unit in party if unit.is_alive()]
    return {
        'seed': seed,
        'encounter': definition['name'],
        'duration': round(elapsed, 2),
        'teamDamage': summary['total_damage'],
        'focusDamage': focus_stats.get('total_damage', 0),
        'allyDamage': summary['total_damage'] - focus_stats.get('total_damage', 0),
        'focusShare': round(focus_stats.get('total_damage', 0) / summary['total_damage'], 4) if summary['total_damage'] else 0,
        'survivors': len(alive),
        'teamHealthRatio': round(sum(unit.current_health for unit in party) / sum(unit.max_health for unit in party), 4),
        'bossDamageTakenRatio': round(1 - sum(boss.current_health for boss in bosses)
                                      / sum(boss.max_health for boss in bosses), 6),
        'averageBossDefense': round(statistics.mean(defense_samples), 2) if defense_samples else spec['defense'],
        'averageBossMagicDefense': round(statistics.mean(magic_defense_samples), 2) if magic_defense_samples else spec['magic_defense'],
        'wuyinDebuffUptime': round(statistics.mean(wuyin_debuff_samples), 4) if wuyin_debuff_samples else 0,
        'partyDefeated': not alive,
    }


def summarize(rows):
    keys = ['duration', 'teamDamage', 'focusDamage', 'allyDamage', 'focusShare', 'survivors',
            'teamHealthRatio', 'bossDamageTakenRatio', 'averageBossDefense',
            'averageBossMagicDefense', 'wuyinDebuffUptime']
    result = {key: round(statistics.mean(row[key] for row in rows), 4) for key in keys}
    result['teamDamageMedian'] = round(statistics.median(row['teamDamage'] for row in rows), 2)
    result['partyDefeats'] = sum(row['partyDefeated'] for row in rows)
    return result


def summarize_by_encounter(rows):
    names = sorted({row['encounter'] for row in rows})
    return {name: summarize([row for row in rows if row['encounter'] == name]) for name in names}


def paired_delta(left, right):
    result = {}
    for key in ('teamDamage', 'focusDamage', 'allyDamage'):
        left_mean = statistics.mean(row[key] for row in left)
        right_mean = statistics.mean(row[key] for row in right)
        result[key] = {
            'absolute': round(left_mean - right_mean, 2),
            'percent': round((left_mean / right_mean - 1) * 100, 2) if right_mean else None,
        }
    result['survivors'] = round(statistics.mean(row['survivors'] for row in left)
                                - statistics.mean(row['survivors'] for row in right), 3)
    result['teamHealthRatio'] = round(statistics.mean(row['teamHealthRatio'] for row in left)
                                      - statistics.mean(row['teamHealthRatio'] for row in right), 4)
    return result


def main():
    report = {
        'checkedAt': datetime.now(timezone.utc).isoformat(),
        'seedCount': SEEDS,
        'method': 'real level-100 characters, default formal nine slots, authored single boss mechanics, '
                  'paired seeds, 120s five-player and 180s twenty-player sustained fights',
        'cases': [],
    }
    with contextlib.redirect_stdout(io.StringIO()):
        for size in (5, 20):
            category = 'SQUAD' if size == 5 else 'TEAM'
            wuyin_bosses = encounters(category, 'WOOD')
            chun_bosses = encounters(category, 'WIND')
            wuyin = [run(WUYIN, 'wood', size, seed, boss)
                     for boss in wuyin_bosses for seed in range(SEEDS)]
            wuyin_no_debuff = [run(WUYIN, 'wood', size, seed, boss, disable_wuyin_debuff=True)
                               for boss in wuyin_bosses for seed in range(SEEDS)]
            wuyin_peer = [run(WUYIN_PEER, 'wood', size, seed, boss)
                          for boss in wuyin_bosses for seed in range(SEEDS)]
            chun = [run(CHUN, 'wind', size, seed, boss)
                    for boss in chun_bosses for seed in range(SEEDS)]
            chun_peer = [run(CHUN_PEER, 'wind', size, seed, boss)
                         for boss in chun_bosses for seed in range(SEEDS)]
            report['cases'].append({
                'partySize': size,
                'bosses': {
                    'wuyin': [boss['name'] for boss in wuyin_bosses],
                    'chun': [boss['name'] for boss in chun_bosses],
                },
                'variants': {
                    'wuyin': summarize(wuyin),
                    'wuyinNoDefenseDebuff': summarize(wuyin_no_debuff),
                    'wuyinPeerReplacement': summarize(wuyin_peer),
                    'chun': summarize(chun),
                    'chunPeerReplacement': summarize(chun_peer),
                },
                'comparisons': {
                    'wuyinDebuffValue': paired_delta(wuyin, wuyin_no_debuff),
                    'wuyinSlotValueVsPeer': paired_delta(wuyin, wuyin_peer),
                    'chunSlotValueVsPeer': paired_delta(chun, chun_peer),
                },
                'byEncounter': {
                    'wuyin': summarize_by_encounter(wuyin),
                    'wuyinNoDefenseDebuff': summarize_by_encounter(wuyin_no_debuff),
                    'wuyinPeerReplacement': summarize_by_encounter(wuyin_peer),
                    'chun': summarize_by_encounter(chun),
                    'chunPeerReplacement': summarize_by_encounter(chun_peer),
                },
                'runs': {
                    'wuyin': wuyin,
                    'wuyinNoDefenseDebuff': wuyin_no_debuff,
                    'wuyinPeerReplacement': wuyin_peer,
                    'chun': chun,
                    'chunPeerReplacement': chun_peer,
                },
            })

    target = ROOT / 'docs/team-value-wuyin-chun-2026-09-23.json'
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Saved {target}')
    for case in report['cases']:
        print(json.dumps({k: case[k] for k in ('partySize', 'bosses', 'variants', 'comparisons')}, ensure_ascii=True))


if __name__ == '__main__':
    main()
