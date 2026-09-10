"""Deterministic mechanism/pressure harness, not a 64-character balance verdict.

Run from the repository: python -X utf8 scripts/simulate_authored_monsters.py
Generated files contain no player accounts, saves or credentials.
"""

import contextlib
import io
import json
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.attributes.attribute import AttributeType
from src.combat.authored_monsters import begin_cast, end_cast, states
from src.combat.battle import Battle
from src.combat.skill_system import Skill, SkillLogic, SkillTier, SkillTargetType
from src.enemies.authored_catalog import encounters, DUNGEON_TO_MONSTER, WORLD, TEAM
from src.enemies.enemy import Enemy


def make_unit(name, element, hp, attack, player=False):
    result = Enemy(name, name, AttributeType[element], 1, hp, attack, 150, attack, 150).battle_unit
    result.is_player = player
    return result


def run(category, attribute, config, strength, seed):
    random.seed(seed)
    count = {"SINGLE": 1, "SQUAD": 5, "TEAM": 20, "SERVER_BOSS": 20}[category]
    duration = {"SINGLE": 60, "SQUAD": 180, "TEAM": 240, "SERVER_BOSS": 180}[category]
    hp_budget = {"SINGLE": 1500, "SQUAD": 25000, "TEAM": 100000, "SERVER_BOSS": 160000}[category]
    attack = {"SINGLE": 180, "SQUAD": 800, "TEAM": 1100, "SERVER_BOSS": 1200}[category]
    party = [make_unit(f"p{i}", attribute, int(10000 * strength), int(500 * strength), True) for i in range(count)]
    members = config.get("members", [config])
    enemies = [make_unit(f"e{i}", config["element"], hp_budget // len(members), attack) for i in range(len(members))]
    battle = Battle(party, enemies)
    battle.monster_runtime.rng = random.Random(seed)
    for enemy, member in zip(enemies, members):
        battle.monster_runtime.attach(enemy, member, config["interval"])
    battle.monster_runtime.add_group(enemies, config)
    direct = Skill("probe_attack", "测试攻击", SkillLogic.A, SkillTier.LOW, 0, 1, 1, 0, SkillTargetType.SINGLE)
    recovery = Skill("probe_heal", "测试治疗", SkillLogic.B, SkillTier.MID, 0, 0, 0, 0, SkillTargetType.ALL, is_heal=True, heal_ratio=1)
    peak_layers = 0
    elapsed = 0
    for elapsed in range(1, duration + 1):
        battle.current_time = elapsed
        battle.monster_runtime.update()
        if elapsed % 3 == 0:
            for index, player in enumerate(party):
                if player.is_alive():
                    healer = count >= 5 and index % 5 == 1
                    chosen = recovery if healer and (elapsed // 3) % 3 == 0 else direct
                    allies = party[index // 5 * 5:index // 5 * 5 + 5]
                    battle._cast_skill(player, chosen, battle.enemy_units, allies)
        for enemy in list(battle.enemy_units):
            battle.monster_runtime.step(enemy)
        peak_layers = max(peak_layers, max((len(states(player)) for player in party), default=0))
        if not any(u.is_alive() for u in party) or not any(u.is_alive() for u in battle.enemy_units):
            break
    killed = not any(u.is_alive() for u in battle.enemy_units)
    return dict(category=category, dungeon_attribute=attribute, encounter=config["name"], strength=strength,
                result="clear" if killed else "defeat" if not any(u.is_alive() for u in party) else "timeout",
                seconds=elapsed, survivors=sum(u.is_alive() for u in party), party_size=count,
                health_remaining=round(sum(u.current_health for u in party) / sum(u.max_health for u in party), 4),
                monster_casts=sum(log["event_type"] == "boss_skill" for log in battle.battle_log),
                peak_total_effect_layers=peak_layers)


def stack_probe(holder_interval, spell, element, stacks_name):
    target = make_unit("probe", "FIRE", 100000, 100, True)
    caster = make_unit("caster", element, 100000, 100)
    battle = Battle([target], [caster])
    peak = 0
    for second in range(1, 121):
        if second % holder_interval == 0:
            end_cast(battle, target, begin_cast(target))
        if second % 5 == 0:
            battle.monster_runtime.cast(caster, spell)
        peak = max(peak, sum(s["name"] == stacks_name for s in states(target)))
    return peak


def main():
    configs, rows = [], []
    with contextlib.redirect_stdout(io.StringIO()):
        for category in ("SINGLE", "SQUAD", "TEAM", "SERVER_BOSS"):
            for attribute in DUNGEON_TO_MONSTER:
                for index, definition in enumerate(encounters(category, attribute)):
                    configs.append(dict(id=f"{category.lower()}_{attribute.lower()}_{index + 1}", dungeon_type=category, dungeon_attribute=attribute, **definition))
                    for strength in (.5, 1, 1.5):
                        rows.append(run(category, attribute, definition, strength, 1701))
        probes = []
        spells = [("雷云压顶", "THUNDER", TEAM["THUNDER"][0]["phases"][0][0]), ("霜寒锁链", "WATER", TEAM["WATER"][1]["members"][0]["phases"][0][0])]
        for name, element, spell in spells:
            for interval in (1, 3, 6, 12):
                probes.append(dict(skill=name, holder_cast_interval=interval, peak_layers=stack_probe(interval, spell, element, name)))
    output = ROOT / "docs" / "monster-simulation-2026-09-09.json"
    output.write_text(json.dumps(dict(seed=1701, note="Normalized test party, not actual 64-character balance or online acceptance. One encounter, not full multi-wave dungeon.", cases=rows, stack_probes=probes), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    catalog_path = ROOT / "data" / "content" / "monster-catalog.json"
    catalog_path.write_text(json.dumps(dict(schema_version=1, rules_version="2026-09-09", encounters=configs), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(dict(cases=len(rows), results={key: sum(row["result"] == key for row in rows) for key in ("clear", "defeat", "timeout")}, stack_probes=probes), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
