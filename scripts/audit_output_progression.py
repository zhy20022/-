"""Reproducible solo experience audit using the production battle worker."""
import contextlib
import json
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.nest_battle_worker import DiscardOutput, simulate


def main():
    roster = json.loads((ROOT / 'data/content/characters.json').read_text(encoding='utf-8-sig'))['characters']
    roster = [row for row in roster if row['professionType'].endswith('_DPS')]
    assert len(roster) == 32
    dungeon_names = {'WATER': 'water', 'EARTH': 'earth', 'THUNDER': 'lightning', 'WIND': 'wind',
                     'FIRE': 'fire', 'WOOD': 'wood', 'LIGHT': 'holy', 'DARK': 'shadow'}
    report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'seedCount': 30,
              'levels': [1, 5, 10], 'method': 'production Python worker; normal matching-element dungeon; no equipment; default nine slots; fixed player id and paired seeds across levels', 'characters': []}
    for config in roster:
        runs = []
        for seed in range(30):
            for level in report['levels']:
                request = {'seed': f'output-growth-v1-{seed}', 'dungeon': {
                    'dungeonId': dungeon_names[config['attributeType']] + '_type_single_001',
                    'name': 'Progression audit', 'dungeonType': 'SINGLE', 'attributeType': config['attributeType'],
                    'duration': 60, 'difficulty': 'normal'}, 'characters': [{
                        'id': 'audit-output-fixed', 'characterConfigId': config['id'],
                        'attributeType': config['attributeType'], 'professionType': config['professionType'],
                        'level': level, 'skillSlots': None, 'equipment': {}}]}
                with contextlib.redirect_stdout(DiscardOutput()):
                    result = simulate(request)
                duration = result['duration']
                ratio = 1 if duration >= 60 else .65 if duration >= 45 else .4 if duration >= 30 else .15 if duration >= 15 else 0
                packages = int(531 * ratio)
                direct = result['singleMonstersKilled'] + result['groupMonstersKilled'] // 5
                runs.append({'seed': seed, 'level': level, 'duration': duration, 'success': result['success'],
                             'survived': result['survived'], 'damage': result['damageScore'],
                             'crystals': packages, 'directExp': direct,
                             'singleKills': result['singleMonstersKilled'], 'groupKills': result['groupMonstersKilled']})
        summaries = {}
        for level in report['levels']:
            rows = [r for r in runs if r['level'] == level]
            summaries[str(level)] = {'wins': sum(r['success'] for r in rows),
                'zeroReward': sum(r['crystals'] == 0 for r in rows),
                'zeroDamage': sum(r['damage'] == 0 for r in rows),
                'meanDuration': round(statistics.mean(r['duration'] for r in rows), 2),
                'meanCrystals': round(statistics.mean(r['crystals'] for r in rows), 2),
                'meanDamage': round(statistics.mean(r['damage'] for r in rows), 2),
                'minCrystals': min(r['crystals'] for r in rows),
                'firstUpgradeAffordable': sum(r['crystals'] + r['directExp'] >= 103 for r in rows) if level == 1 else None}
        initial = [r for r in runs if r['level'] == 1]
        waits = []
        for start in range(30):
            total = 0
            for count in range(1, 31):
                row = initial[(start + count - 1) % 30]
                total += row['crystals'] + row['directExp']
                if total >= 103:
                    waits.append(count)
                    break
            else:
                waits.append(None)
        paired = {}
        for level in [5, 10]:
            advanced = [r for r in runs if r['level'] == level]
            paired[str(level)] = {'fewerCrystalsThanLevel1': sum(b['crystals'] < a['crystals'] for a, b in zip(initial, advanced)),
                                 'winBecameLoss': sum(a['success'] and not b['success'] for a, b in zip(initial, advanced))}
        row = {'id': config['id'], 'name': config['name'], 'attribute': config['attributeType'],
               'profession': config['professionType'], 'summary': summaries, 'paired': paired,
               'firstUpgradeWaits': waits, 'runs': runs}
        report['characters'].append(row)
        print(json.dumps({k: row[k] for k in ['name', 'attribute', 'summary', 'paired']}, ensure_ascii=True), flush=True)
    target = ROOT / 'docs/output-progression-audit-2026-09-17.json'
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Saved {target}; {len(roster) * 90} battles', flush=True)


if __name__ == '__main__':
    main()
