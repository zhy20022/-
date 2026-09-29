"""Compare all DPS kits under the same deterministic A/B/C rotation."""
import contextlib
import argparse
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
from src.combat.authored_monsters import begin_cast, end_cast
from src.combat.battle import Battle
from src.combat.battle_unit import BattleUnit
from src.skills.authored_characters import library


TARGET_COUNTS = (1, 2, 3, 5, 10)
SEEDS = 30
ROTATIONS = 10
FOCUS_NAMES = {'张静虚', '淳于绝', '殷破', '折羽', '闻微', '喜诛', '梧隐'}


def make_unit(row, unit_id, *, config_id=None, is_player=True):
    character = character_from_snapshot({
        'id': unit_id,
        'characterConfigId': config_id or row['id'],
        'attributeType': row['attributeType'],
        'professionType': row['professionType'],
        'level': 100,
        'skillSlots': None,
        'equipment': {},
    })
    character.attack = 1000
    character.magic_attack = 1000
    character.defense = 100
    character.magic_defense = 100
    unit = BattleUnit(character, is_player=is_player)
    unit.max_health = 100000
    unit.current_health = unit.max_health
    unit._sync_legacy_health_fields()
    return unit


def simulate(config, target_count, seed, *, target_casts):
    random.seed(f'dps-parity-v1-{config["id"]}-{target_count}-{seed}')
    caster = make_unit(config, 'benchmark-caster')
    enemies = []
    for index in range(target_count):
        target = make_unit(config, f'benchmark-target-{index}',
                           config_id='char_008_water_support', is_player=False)
        target.character.character_config_id = 'benchmark_dummy'
        enemies.append(target)

    battle = Battle([caster], enemies)
    battle.damage_calculator.base_crit_rate = 0
    skills = library(caster.character)
    if len(skills) != 3:
        raise AssertionError(f'{config["id"]} has {len(skills)} authored skills')

    for _ in range(ROTATIONS):
        for slot in (1, 2, 3):
            skill = skills[f'{config["id"]}:{slot}']
            skill.current_cooldown = 0
            battle._cast_skill(caster, skill, enemies, [caster])

            # Equal-cadence profile lets short effects expire on affected-unit casts.
            for target in enemies:
                if target_casts and target.is_alive():
                    end_cast(battle, target, begin_cast(target))
                target.current_health = target.max_health
                target._sync_legacy_health_fields()

    stats = battle.damage_stats.get(caster.character.character_id, {})
    return int(stats.get('total_damage', 0))


def percentile(values, value):
    if len(values) < 2:
        return 100.0
    below = sum(candidate < value for candidate in values)
    equal = sum(candidate == value for candidate in values)
    return round(100 * (below + 0.5 * equal) / len(values), 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-stem', default='dps-damage-parity-2026-09-23')
    args = parser.parse_args()
    catalog = json.loads((ROOT / 'data/content/characters.json').read_text(encoding='utf-8-sig'))
    roster = [row for row in catalog['characters'] if row['professionType'].endswith('_DPS')]
    assert len(roster) == 32

    report = {
        'checkedAt': datetime.now(timezone.utc).isoformat(),
        'method': 'normalized level-100 stats; 1000 attack/magic attack; 100 defense; no crit; '
                  'neutral same-attribute targets; A/B/C x10; equal-cadence and stationary-target profiles',
        'seedCount': SEEDS,
        'rotations': ROTATIONS,
        'targetCounts': list(TARGET_COUNTS),
        'profiles': {
            'equalCadence': 'target performs one empty cast after each player skill',
            'stationaryTargets': 'targets do not cast; isolates raw rotation ratios',
        },
        'characters': [],
    }

    with contextlib.redirect_stdout(io.StringIO()):
        for config in roster:
            profiles = {}
            for profile, target_casts in [('equalCadence', True), ('stationaryTargets', False)]:
                scenarios = {}
                for count in TARGET_COUNTS:
                    samples = [simulate(config, count, seed, target_casts=target_casts)
                               for seed in range(SEEDS)]
                    scenarios[str(count)] = {
                        'meanTotalDamage': round(statistics.mean(samples), 2),
                        'medianTotalDamage': round(statistics.median(samples), 2),
                        'minTotalDamage': min(samples),
                        'maxTotalDamage': max(samples),
                        'meanPerTarget': round(statistics.mean(samples) / count, 2),
                    }
                profiles[profile] = scenarios
            report['characters'].append({
                'id': config['id'],
                'name': config['name'],
                'attribute': config['attributeType'],
                'profession': config['professionType'],
                'profiles': profiles,
            })

    for profile in report['profiles']:
        for count in TARGET_COUNTS:
            values = [row['profiles'][profile][str(count)]['meanTotalDamage']
                      for row in report['characters']]
            ordered = sorted(report['characters'],
                             key=lambda row: row['profiles'][profile][str(count)]['meanTotalDamage'], reverse=True)
            ranks = {row['id']: index + 1 for index, row in enumerate(ordered)}
            median = statistics.median(values)
            for row in report['characters']:
                scenario = row['profiles'][profile][str(count)]
                value = scenario['meanTotalDamage']
                scenario['rank'] = ranks[row['id']]
                scenario['percentile'] = percentile(values, value)
                scenario['ratioToDpsMedian'] = round(value / median, 3) if median else None

    json_target = ROOT / 'docs' / (args.output_stem + '.json')
    json_target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    lines = [
        '# 输出角色统一伤害基准（2026-09-23）',
        '',
        '统一 1000 物攻/法攻、100 双防、无暴击、同属性中性目标；A→B→C 循环 10 轮。',
        '目标在每次技能后进行一次空施法，使按“后续技能次数”计时的短状态正常衰减。',
        '',
    ]
    for profile, title in [('equalCadence', '敌我等速施法'), ('stationaryTargets', '静止木桩')]:
        lines.extend([f'## {title}', '', '| 角色 | 1目标 | 2目标 | 3目标 | 5目标 | 10目标 |',
                      '|---|---:|---:|---:|---:|---:|'])
        for row in report['characters']:
            if row['name'] not in FOCUS_NAMES:
                continue
            cells = []
            for count in TARGET_COUNTS:
                item = row['profiles'][profile][str(count)]
                cells.append(f'{int(item["meanTotalDamage"]):,} / #{item["rank"]} / {item["ratioToDpsMedian"]:.2f}x')
            lines.append('| ' + row['name'] + ' | ' + ' | '.join(cells) + ' |')
        lines.append('')
    lines.extend(['', '单元格格式：平均总伤害 / 32名输出中的名次 / 输出职业中位数倍率。', ''])
    md_target = ROOT / 'docs' / (args.output_stem + '.md')
    md_target.write_text('\n'.join(lines), encoding='utf-8')

    print(f'Saved {json_target}')
    print(f'Saved {md_target}')
    for row in report['characters']:
        if row['name'] in FOCUS_NAMES:
            print(json.dumps({'name': row['name'], 'profiles': row['profiles']}, ensure_ascii=True))


if __name__ == '__main__':
    main()
