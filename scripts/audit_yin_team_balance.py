"""Paired replacement audit for Yin Po's attack-scaled C skill."""
import json
import statistics
from concurrent.futures import ProcessPoolExecutor
from unittest.mock import patch
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.audit_team_dungeon_balance import CATALOG, roster, run
from src.skills.characters import dps_first

FOCUS = [row for row in CATALOG if row['number'] in (19, 20, 21)]


def sample(case):
    kind, index, seed, number, candidate = case
    focus = next(row for row in FOCUS if row['number'] == number)
    size, variant = (5, 0) if kind == 'SQUAD' else (20, 2)
    party = roster('THUNDER', size, variant)
    party[3].update(characterConfigId=focus['id'], professionType=focus['professionType'])
    assert len({row['characterConfigId'] for row in party}) == size
    original = dps_first._hit
    def adjusted(battle, caster, skill, target, ratio, *args, **kwargs):
        if (candidate and caster.character.character_config_id == focus['id']
                and skill.authored_effect['slot'] == 3 and ratio in (1.5, 3)):
            ratio *= 2 / 3
        return original(battle, caster, skill, target, ratio, *args, **kwargs)
    with patch.object(dps_first, '_hit', side_effect=adjusted):
        result = run((kind, 'THUNDER', index, seed, variant), party)
    result['focus'] = focus['name'] + ('(100%/200%试算)' if candidate else '')
    result['focusDamage'] = result['damageByPlayer'][focus['name'] + ':player-3']
    result['focusShare'] = result['focusDamage'] / max(1, sum(result['damageByPlayer'].values()))
    return result


def main():
    cases = [(kind, index, seed, row['number'], candidate) for kind, count in (('SQUAD', 2), ('TEAM', 3))
             for index in range(count) for seed in range(8) for row in FOCUS
             for candidate in ((False, True) if row['number'] == 19 else (False,))]
    with ProcessPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(sample, cases))
    summary = []
    for kind in ('SQUAD', 'TEAM'):
        for encounter in sorted({row['encounter'] for row in rows if row['kind'] == kind}):
            for focus in sorted({row['focus'] for row in rows}):
                samples = [row for row in rows if row['kind'] == kind and row['encounter'] == encounter and row['focus'] == focus]
                summary.append(dict(kind=kind, encounter=encounter, focus=focus,
                    wins=sum(row['success'] for row in samples), runs=len(samples),
                    bossSeconds=statistics.median(row['bossSeconds'] for row in samples),
                    focusShare=round(statistics.mean(row['focusShare'] for row in samples), 4)))
    (ROOT / 'docs/yin-team-balance-2026-09-23.json').write_text(
        json.dumps(dict(method='Same seed, full production battle, unique-character party; replace only slot 4 with Yin Po, Jing Wugu, or Zhe Yu. Damage share includes trash.',
                        summary=summary, rows=rows), ensure_ascii=False, indent=2), encoding='utf-8')
    for item in summary:
        print(json.dumps(item, ensure_ascii=False))


if __name__ == '__main__':
    main()
