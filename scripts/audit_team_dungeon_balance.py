"""Full production-flow calibration; no inflated HP or skipped trash waves."""
import argparse
import contextlib
import json
import random
import statistics
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.nest_battle_worker import character_from_snapshot, DiscardOutput
from src.attributes.attribute import AttributeType
from src.dungeons.dungeon import Dungeon, DungeonType
from src.dungeons.dungeon_battle import DungeonBattleFlow, DungeonBattleState
from src.dungeons.team_balance import TEAM_BALANCE
from src.enemies.authored_catalog import encounters

CATALOG = json.loads((ROOT / 'data/content/characters.json').read_text(encoding='utf-8-sig'))['characters']
ATTRIBUTES = ['WATER', 'EARTH', 'THUNDER', 'WIND', 'FIRE', 'WOOD', 'LIGHT', 'DARK']


def roster(attribute, size, variant=0):
    if size == 20 and variant >= 2:
        # A single formal account owns one copy per character config.
        elements = [ATTRIBUTES[(ATTRIBUTES.index(attribute) + offset) % len(ATTRIBUTES)]
                    for offset in (0, 2, 4, 6)]
        result = [row for index, element in enumerate(elements)
                  for row in roster(element, 5, (variant + index) % 2)]
        for index, row in enumerate(result):
            row['id'] = f'player-{index}'
        return result
    rows = [row for row in CATALOG if row['attributeType'] == attribute]
    by_role = {row['professionType']: row for row in rows}
    roles = ['PHYSICAL_TANK', 'HEALER', 'SUPPORT',
             'PHYSICAL_MELEE_DPS' if variant == 0 else 'MAGIC_MELEE_DPS',
             'MAGIC_RANGED_DPS' if variant == 0 else 'PHYSICAL_RANGED_DPS']
    if size == 20:
        roles = (roles + ['MAGIC_TANK', 'HEALER', 'SUPPORT', 'MAGIC_MELEE_DPS', 'PHYSICAL_RANGED_DPS']
                 + ['PHYSICAL_TANK', 'HEALER', 'SUPPORT', 'PHYSICAL_MELEE_DPS', 'MAGIC_RANGED_DPS']
                 + ['MAGIC_TANK', 'HEALER', 'MAGIC_MELEE_DPS', 'PHYSICAL_RANGED_DPS', 'MAGIC_RANGED_DPS'])
    return [dict(id=f'player-{i}', characterConfigId=by_role[role]['id'],
                 professionType=role, attributeType=attribute, level=100, skillSlots=None, equipment={})
            for i, role in enumerate(roles)]


def run(case, snapshots_override=None):
    kind, attribute, index, seed, variant = case
    random.seed(f'team-calibration-{kind}-{attribute}-{index}-{seed}-{variant}')
    config = TEAM_BALANCE[kind]
    definition = encounters(kind, attribute)[index]
    dungeon = Dungeon('calibration', 'calibration', AttributeType[attribute], DungeonType[kind],
                      duration=config['duration'])
    snapshots = snapshots_override or roster(attribute, 5 if kind == 'SQUAD' else 20, variant)
    started = time.perf_counter()
    with contextlib.redirect_stdout(DiscardOutput()):
        flow = DungeonBattleFlow(dungeon, [character_from_snapshot(row) for row in snapshots])
        flow._calculate_rewards = lambda: None
        # Select each real encounter explicitly; keep real trash and all combat rules.
        def selected(category, attr):
            return [definition] if category == kind else encounters(category, attr)
        with patch('src.enemies.authored_catalog.encounters', side_effect=selected):
            flow._start_actual_battle()
            flow.battle.monster_runtime.rng = random.Random(f'boss-{seed}')
            boss_casts = 0
            boss_spawns = []
            phases = set()
            def log(message, event_type='info', payload=None):
                nonlocal boss_casts
                if event_type == 'boss_skill' and '_boss_' in (payload or {}).get('caster_id', ''):
                    boss_casts += 1
                if event_type == 'boss_mechanic' and (payload or {}).get('members'):
                    boss_spawns.append(flow.current_time)
            flow.battle._log = log
            for _ in range(config['duration'] * 4):
                flow.update(.25)
                for unit in flow.battle.enemy_units:
                    if getattr(unit, 'spawn_category', '') == 'boss':
                        phases.add((unit.character.name, getattr(unit, 'authored_phase', 0)))
                if flow.state != DungeonBattleState.IN_BATTLE:
                    break
    bosses = [unit for unit in flow.battle.enemy_units if getattr(unit, 'spawn_category', '') == 'boss']
    players = flow.battle.player_units
    return dict(kind=kind, attribute=attribute, encounter=definition['name'], seed=seed, variant=variant,
                success=flow.is_successful, duration=flow.current_time,
                bossSeconds=max(0, flow.current_time - config['bossSpawnTime']),
                bossSpawns=boss_spawns, bossCasts=boss_casts, phases=len(phases),
                survivors=sum(unit.is_alive() for unit in players),
                healthRatio=round(sum(unit.current_health for unit in players) / sum(unit.max_health for unit in players), 4),
                bossRemaining=round(sum(unit.current_health for unit in bosses) / max(1, sum(unit.max_health for unit in bosses)), 4),
                damageByPlayer={unit.character.name + ':' + unit.character.character_id:
                                flow.battle.damage_stats.get(unit.character.character_id, {}).get('total_damage', 0)
                                for unit in players},
                wallSeconds=round(time.perf_counter() - started, 3))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seeds', type=int, default=3)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--output', default='docs/team-dungeon-balance-audit.json')
    args = parser.parse_args()
    cases = [(kind, attr, index, seed, variant) for kind in ('SQUAD', 'TEAM') for attr in ATTRIBUTES
             for index in range(len(encounters(kind, attr))) for seed in range(args.seeds)
             for variant in ((0, 1) if kind == 'SQUAD' else (2, 3))]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        rows = list(pool.map(run, cases))
    summary = []
    for kind in ('SQUAD', 'TEAM'):
        for attr in ATTRIBUTES:
            for definition in encounters(kind, attr):
                subset = [r for r in rows if r['kind'] == kind and r['attribute'] == attr and r['encounter'] == definition['name']]
                summary.append(dict(kind=kind, attribute=attr, encounter=definition['name'],
                    clears=sum(r['success'] for r in subset), runs=len(subset),
                    bossSeconds=round(statistics.median(r['bossSeconds'] for r in subset), 2),
                    survivors=round(statistics.mean(r['survivors'] for r in subset), 2),
                    healthRatio=round(statistics.mean(r['healthRatio'] for r in subset), 3),
                    bossRemaining=round(statistics.mean(r['bossRemaining'] for r in subset), 3),
                    bossCasts=round(statistics.mean(r['bossCasts'] for r in subset), 1)))
    report = dict(assumptions='Level100, no equipment, default nine slots; five-player same-element and twenty-player mixed-element DISTINCT-character rosters; two variants, full production flow at 0.25s.',
                  balance=TEAM_BALANCE, summary=summary, rows=rows)
    (ROOT / args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    for row in summary:
        print(json.dumps(row, ensure_ascii=False))
    print(f'{len(rows)} simulations, {sum(r["success"] for r in rows)} clears, max wall {max(r["wallSeconds"] for r in rows)}s')


if __name__ == '__main__':
    main()
