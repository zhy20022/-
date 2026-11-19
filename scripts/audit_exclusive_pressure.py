"""Synthetic role diagnostics; not released dungeon encounters."""
import contextlib
import json
import random
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.audit_exclusive_review import (
    Attribute, AttributeType, Battle, BattleUnit, BY_NUMBER, DiscardOutput,
    Enemy, Metrics, begin_cast, character_from_snapshot, end_cast, library, snapshot,
)
from src.skills.authored_characters import damage


def run(number, size, school, pressure, seed, disabled, equipped=False):
    random.seed(f"role-pressure-v1:{seed}")
    with contextlib.redirect_stdout(DiscardOutput()):
        panel = [number] + [51] * (size-1)
        party = []
        for i, n in enumerate(panel):
            row = snapshot(n, f"unit-{i}")
            if equipped and i == 0:
                from scripts.audit_exclusive_review import equipped_snapshot
                row = equipped_snapshot(row)
            c = character_from_snapshot(row)
            c.hp, c.attack, c.magic_attack, c.defense, c.magic_defense = 12000, 1000, 1000, 300, 300
            party.append(BattleUnit(c))
        enemy = Enemy("pressure", "synthetic", AttributeType.WATER, 100,
                      100_000_000, pressure, 300, pressure, 300, is_boss=True).battle_unit
        battle = Battle(party, [enemy])
        battle.damage_calculator.base_crit_rate = 0
        battle.start()
        metrics = Metrics(battle)
        skills = library(party[0].character)
        actions = [skills[f'{BY_NUMBER[number]["id"]}:{i}'] for i in (1, 2, 3)]
        attack = SimpleNamespace(skill_id="diagnostic-pressure", name="diagnostic-pressure",
                                 authored_effect={"damageType": school})
        first_death = None
        with patch.object(Attribute, "calculate_damage_multiplier", return_value=1):
            for step in range(36):
                battle.current_time = step * 3
                targets = [party[0]] if size == 1 else list(party)
                for target in targets:
                    if target.is_alive():
                        damage(battle, enemy, attack, target, 1)
                metrics.sample()
                if first_death is None and any(u.is_dead() for u in party):
                    first_death = step+1
                caster = party[0]
                if caster.is_alive():
                    skill = actions[step % 3]
                    skill.current_cooldown = 0
                    if disabled:
                        end_cast(battle, caster, begin_cast(caster))
                    else:
                        battle._cast_skill(caster, skill, [enemy], party)
                # Idle allies still have their normal status-expiry clock.
                for ally in party[1:]:
                    if ally.is_alive():
                        end_cast(battle, ally, begin_cast(ally))
                metrics.sample()
                if first_death is None and any(u.is_dead() for u in party):
                    first_death = step+1
                if not any(u.is_alive() for u in party):
                    break
    return dict(number=number, size=size, school=school, pressure=pressure, seed=seed,
                disabled=disabled, rounds=step+1, firstDeathRound=first_death,
                survivors=sum(u.is_alive() for u in party), metrics=metrics.result())


def main():
    rows = []
    for n, c in BY_NUMBER.items():
        if c["professionType"].endswith("_DPS"):
            continue
        for size in ((1,) if c["professionType"].endswith("TANK") else (5, 20)):
            for school in ("physical", "magical"):
                for pressure in (3000, 6000):
                    for seed in range(3):
                        for disabled in (False, True):
                            rows.append(run(n, size, school, pressure, seed, disabled))
    path = ROOT / "docs/exclusive-review-2026-11-16/role-pressure-runs.jsonl"
    path.write_text("".join(json.dumps(r, ensure_ascii=False)+"\n" for r in rows), encoding="utf-8")
    print(f"Completed {len(rows)} synthetic pressure diagnostics.")


if __name__ == "__main__":
    main()
