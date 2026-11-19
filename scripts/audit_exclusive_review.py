"""Read-only balance screening. Writes evidence only; never changes game rules."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import random
import statistics
import sys
import time
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.nest_battle_worker import DiscardOutput, character_from_snapshot
from src.attributes.attribute import Attribute, AttributeType
from src.combat.authored_monsters import begin_cast, end_cast, states
from src.combat.battle import Battle, BattleState
from src.combat.battle_unit import BattleUnit
from src.dungeons.dungeon import Dungeon, DungeonType
from src.dungeons.dungeon_battle import DungeonBattleFlow, DungeonBattleState
from src.enemies.authored_catalog import encounters
from src.enemies.enemy import Enemy
from src.skills.authored_characters import library

CATALOG = json.loads((ROOT / "data/content/characters.json").read_text(encoding="utf-8-sig"))["characters"]
BY_NUMBER = {r["number"]: r for r in CATALOG}
ATTRS = ["WATER", "EARTH", "THUNDER", "WIND", "FIRE", "WOOD", "LIGHT", "DARK"]
DIFFICULTIES = {"normal": 1, "hard": 1.6, "nightmare": 2.4}
RUN_DURATION = {"SINGLE": 60, "SQUAD": 120, "TEAM": 180, "SERVER_BOSS": 180}


def snapshot(number, uid, level=100):
    row = BY_NUMBER[number]
    return dict(id=uid, characterConfigId=row["id"], attributeType=row["attributeType"],
                professionType=row["professionType"], level=level, skillSlots=None, equipment={})


def squad_panels():
    # Both physical and magical tanks and all four DPS positions are covered.
    return [[base + n for n in offsets] for base in range(0, 64, 8)
            for offsets in ((1, 7, 8, 3, 6), (2, 7, 8, 4, 5))]


def raid_panels():
    result = []
    for base in range(0, 64, 16):
        a, b = base, base + 8
        other = (base + 16) % 64
        # Four tanks, three healers, three supports and ten DPS; distinct configs.
        numbers = [a+1, a+7, a+8, a+3, a+6,
                   a+2, b+7, b+8, a+4, a+5,
                   b+1, other+7, other+8, b+3, b+6,
                   b+2, other+5, other+6, b+4, b+5]
        assert len(numbers) == len(set(numbers)) == 20
        result.append(numbers)
    assert set().union(*(set(r) for r in result)) == set(range(1, 65))
    return result


def read_sources():
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    result = []
    for row in CATALOG:
        path = ROOT.parent / row["source"]
        with zipfile.ZipFile(path) as archive:
            tree = ET.fromstring(archive.read("word/document.xml"))
        paragraphs = ["".join(p.itertext()).strip() for p in tree.findall(".//w:p", ns)]
        paragraphs = [p for p in paragraphs if p]
        candidates = [p for p in paragraphs if any(k in p for k in ("武器", "专属装备", "功法", "法器"))]
        result.append(dict(number=row["number"], name=row["name"], source=str(path),
                           sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                           weaponCatalog=row.get("weaponName", ""),
                           itemSourceParagraphs=candidates, paragraphs=paragraphs))
    return result


class Metrics:
    def __init__(self, battle):
        self.battle = battle
        self.incoming = Counter()
        self.healed = Counter()
        self.shield_absorbed = Counter()
        self.casts = Counter()
        self.death_at = {}
        self.role_questions = set()
        self.start_heals = {}
        self.incoming_samples = []
        self.party = list(battle.player_units)
        for unit in self.party:
            uid = unit.character.character_id
            original_damage, original_heal = unit.take_damage, unit.heal

            def take_damage(physical, magical, _original=original_damage, _u=unit, _id=uid, **kwargs):
                old_hp = _u.current_health
                before = [(s, s.get("amount", 0)) for s in states(_u) if s["kind"] == "shield"]
                value = _original(physical, magical, **kwargs)
                self.incoming[_id] += max(0, old_hp - _u.current_health)
                for item, amount in before:
                    used = max(0, amount - item.get("amount", 0))
                    owner = item.get("owner_id") or getattr(getattr(item.get("owner"), "character", None), "character_id", None)
                    owner = owner or str(item.get("source_skill", "")).split(":")[0]
                    self.shield_absorbed[owner] += used
                return value

            def heal(physical, magical, _original=original_heal, _u=unit, _id=uid):
                old_hp = _u.current_health
                value = _original(physical, magical)
                self.healed[_id] += max(0, _u.current_health - old_hp)
                return value

            unit.take_damage, unit.heal = take_damage, heal
        # Retain the log list: authored dispatch reorders its final skill event.
        original_log = battle._log

        def log(message, event_type="info", payload=None):
            if event_type == "skill" and payload:
                self.casts[payload.get("caster_id", "")] += 1
            original_log(message, event_type, payload)
            if len(battle.battle_log) > 100:
                del battle.battle_log[:50]

        battle._log = log

    def sample(self):
        for unit in self.party:
            if unit.is_dead():
                self.death_at.setdefault(unit.character.character_id, round(self.battle.current_time, 2))

    def result(self):
        ids = {u.character.character_id for u in self.party}
        return dict(teamDamage=sum(v.get("total_damage", 0) for k, v in self.battle.damage_stats.items() if k in ids),
                    totalEffectiveHealing=round(sum(self.healed.values()), 2),
                    totalShieldAbsorbed=round(sum(self.shield_absorbed.values()), 2),
                    shieldByOwner={k: round(v, 2) for k, v in self.shield_absorbed.items() if v},
                    incomingHpLoss={k: round(v, 2) for k, v in self.incoming.items()},
                    members=[dict(number=int(u.character.character_config_id.split("_")[1]),
                                  uid=u.character.character_id,
                                  damage=self.battle.damage_stats.get(u.character.character_id, {}).get("total_damage", 0),
                                  casts=self.casts[u.character.character_id],
                                  alive=u.is_alive(),
                                  deathCount=getattr(u, "death_serial", 0),
                                  firstDeath=self.death_at.get(u.character.character_id),
                                  hpRatio=round(u.current_health/u.max_health, 5),
                                  shieldAbsorbed=round(self.shield_absorbed[u.character.character_id], 2))
                             for u in self.party],
                    supportQuestions=sorted(getattr(self.battle, "support_questions", set())))


def production_run(case):
    started = time.perf_counter()
    kind, attr, encounter_index, difficulty, panel, seed = case
    random.seed(f"exclusive-screen-v1:{kind}:{attr}:{encounter_index}:{difficulty}:{seed}")
    definition = encounters(kind, attr)[encounter_index] if kind != "SINGLE" else None
    dungeon = Dungeon("exclusive-audit", "exclusive-audit", AttributeType[attr], DungeonType[kind],
                      duration=RUN_DURATION[kind],
                      monster_config=dict(allowed_monster_types=["SINGLE", "GROUP_5"],
                                          spawn_interval=3, spawn_wave_count=20,
                                          stat_multiplier=DIFFICULTIES[difficulty]))
    with contextlib.redirect_stdout(DiscardOutput()):
        party = [character_from_snapshot(snapshot(n, f"unit-{i}")) for i, n in enumerate(panel)]
        flow = DungeonBattleFlow(dungeon, party)
        flow._calculate_rewards = lambda: None

        def selected(category, element):
            return [definition] if category == kind and definition else encounters(category, element)

        with patch("src.enemies.authored_catalog.encounters", side_effect=selected):
            flow._start_actual_battle()
            flow.battle.monster_runtime.rng = random.Random(f"monster:{seed}")
            metrics = Metrics(flow.battle)
            for _ in range(RUN_DURATION[kind] * 4):
                flow.update(.25)
                metrics.sample()
                if kind == "SINGLE" and flow.is_successful and flow.battle.current_time < 60:
                    flow.state = DungeonBattleState.IN_BATTLE
                    flow.battle.state = BattleState.IN_PROGRESS
                    flow.is_successful = False
                if flow.state != DungeonBattleState.IN_BATTLE:
                    break
    bosses = [u for u in flow.battle.enemy_units if getattr(u, "spawn_category", "") == "boss"]
    # Shared pools must be counted once, not once per member portrait.
    budgets = {}
    for u in bosses:
        pool = getattr(u, "authored_pool", None)
        budgets[id(pool) if pool else id(u)] = (pool.current, pool.maximum) if pool else (u.current_health, u.max_health)
    return dict(kind=kind, attribute=attr, encounter=definition["name"] if definition else "experience-waves",
                encounterIndex=encounter_index, difficulty=difficulty, panel=panel, seed=seed,
                duration=round(flow.battle.current_time, 2),
                success=bool(flow.is_successful), survived=any(u.is_alive() for u in flow.battle.player_units),
                noDeaths=all(u.is_alive() and not getattr(u, "death_serial", 0) for u in flow.battle.player_units),
                bossesKilled=flow.bosses_killed, singleKills=flow.single_monsters_killed,
                groupKills=flow.group_monsters_killed,
                bossRemainingRatio=round(sum(v[0] for v in budgets.values())/max(1, sum(v[1] for v in budgets.values())), 5),
                metrics=metrics.result(), wallSeconds=round(time.perf_counter()-started, 3))


def control_party(number, size):
    # Synthetic controls may duplicate a config, never an instance ID. This keeps
    # anchors identical across candidates; production panels are config-distinct.
    anchors = [49, 23, 8, 38, 51, 63, 24, 29, 54, 9, 39, 40, 37, 62, 17, 55, 16, 53, 6]
    role = BY_NUMBER[number]["professionType"]
    if role.endswith("TANK"):
        anchors = [23, 8, 38, 51] + anchors
    elif role == "HEALER":
        anchors = [49, 8, 38, 51] + anchors
    elif role == "SUPPORT":
        anchors = [49, 23, 38, 51] + anchors
    else:
        anchors = [49, 23, 8, 38] + anchors
    result = []
    for n in anchors:
        if len(result) >= size-1:
            break
        if n not in result:
            result.append(n)
    return [number] + result


def control_run(case):
    number, size, profile, seed, disabled = case
    panel = control_party(number, size)
    random.seed(f"exclusive-control-v1:{size}:{profile}:{seed}")
    # Neutralized, equalized panel is diagnostic, not a real dungeon clear.
    with contextlib.redirect_stdout(DiscardOutput()):
        party = []
        for i, n in enumerate(panel):
            c = character_from_snapshot(snapshot(n, f"unit-{i}"))
            c.hp, c.attack, c.magic_attack, c.defense, c.magic_defense = 12000, 1000, 1000, 300, 300
            party.append(BattleUnit(c))
        definition = encounters("SQUAD" if profile == "single" else "TEAM", "WATER")[0 if profile == "single" else 1]
        members = definition.get("members", [definition])
        enemies = []
        for i, member in enumerate(members):
            u = Enemy(f"control-{i}", member["name"], AttributeType.WATER, 100,
                      50_000_000//len(members), 1600 if size == 5 else 2400, 300,
                      1600 if size == 5 else 2400, 300, is_boss=True).battle_unit
            enemies.append(u)
        battle = Battle(party, enemies, max_duration=121 if size == 5 else 181)
        battle.damage_calculator.base_crit_rate = 0
        for u, member in zip(enemies, members):
            battle.monster_runtime.attach(u, member, 4 if size == 5 else 5)
        battle.monster_runtime.rng = random.Random(f"monster-control:{seed}")
        battle.monster_runtime.add_group(enemies, definition)
        metrics = Metrics(battle)
        if disabled:
            original_cast = battle._cast_skill

            def cast(caster, skill, enemies, allies, source="skill"):
                if caster is party[0]:
                    before = begin_cast(caster)
                    skill.use()
                    end_cast(battle, caster, before)
                    return True
                return original_cast(caster, skill, enemies, allies, source)
            battle._cast_skill = cast
        battle.start()
        with patch.object(Attribute, "calculate_damage_multiplier", return_value=1):
            for _ in range((120 if size == 5 else 180)*4):
                battle.update(.25)
                metrics.sample()
                if battle.state != BattleState.IN_PROGRESS:
                    break
    return dict(number=number, size=size, profile=profile, seed=seed, panel=panel,
                focusActiveSkillsDisabled=disabled,
                duration=round(battle.current_time, 2), metrics=metrics.result(),
                survivors=sum(u.is_alive() for u in party),
                healthRatio=round(sum(u.current_health for u in party)/sum(u.max_health for u in party), 5))


def equipped_snapshot(row):
    return {**row, "equipment": {"weapon": {
        "itemId": "audit-exclusive", "itemType": "weapon",
        "itemData": {"subtype": "exclusive_weapon", "characterConfigId": row["characterConfigId"]},
    }}}


def rotation_run(case, equipped=False):
    number, count, cadence, seed, *extra = case
    sequence = extra[0] if extra else (1, 2, 3)
    random.seed(f"exclusive-rotation-v1:{seed}")
    row = BY_NUMBER[number]
    with contextlib.redirect_stdout(DiscardOutput()):
        row_snapshot = snapshot(number, "focus")
        c = character_from_snapshot(equipped_snapshot(row_snapshot) if equipped else row_snapshot)
        c.attack = c.magic_attack = 1000
        c.hp = 100000
        c.defense = c.magic_defense = 100
        caster = BattleUnit(c)
        enemies = []
        for i in range(count):
            u = Enemy(f"dummy-{i}", "dummy", AttributeType[row["attributeType"]], 100,
                      100000, 0, 100, 0, 100).battle_unit
            u.character.character_config_id = "diagnostic-dummy"
            enemies.append(u)
        battle = Battle([caster], enemies)
        battle.damage_calculator.base_crit_rate = 0
        skills = library(caster.character)
        initial = 0
        for rotation in range(10):
            for slot in sequence:
                s = skills[f'{row["id"]}:{slot}']
                s.current_cooldown = 0
                battle._cast_skill(caster, s, enemies, [caster])
                for target in enemies:
                    if cadence and target.is_alive():
                        end_cast(battle, target, begin_cast(target))
                    target.current_health = target.max_health
                    target._sync_legacy_health_fields()
            if rotation == 0:
                initial = battle.damage_stats.get("focus", {}).get("total_damage", 0)
        total = battle.damage_stats.get("focus", {}).get("total_damage", 0)
    return dict(number=number, targets=count, cadence=cadence, seed=seed, sequence=list(sequence),
                firstRotationDamage=initial, totalDamage=total)


def execute(kind, cases, output, workers):
    functions = {"production": production_run, "control": control_run, "rotation": rotation_run}
    existing = []
    path = output / f"{kind}-runs.jsonl"
    if path.exists():
        existing = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    if len(existing) == len(cases):
        print(f"{kind}: reused {len(existing)} complete samples", flush=True)
        return existing
    if existing:
        raise RuntimeError(f"Incomplete {path}; choose a new output directory to avoid duplicate evidence")
    rows = []
    started = time.perf_counter()
    with path.open("w", encoding="utf-8") as stream:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            for row in pool.map(functions[kind], cases, chunksize=1):
                rows.append(row)
                stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False)+"\n")
                stream.flush()
                if len(rows) % 25 == 0 or len(rows) == len(cases):
                    print(f"{kind}: {len(rows)}/{len(cases)} samples; {time.perf_counter()-started:.1f}s", flush=True)
    return rows


def coverage_assertions(rows):
    expected = {(kind, attr, index, diff)
                for kind in ("SQUAD", "TEAM", "SERVER_BOSS") for attr in ATTRS
                for index in range(len(encounters(kind, attr))) for diff in DIFFICULTIES}
    for n in range(1, 65):
        actual = {(r["kind"], r["attribute"], r["encounterIndex"], r["difficulty"])
                  for r in rows if n in r["panel"] and r["kind"] != "SINGLE"}
        assert actual == expected, (n, len(actual), len(expected))
        singles = [r for r in rows if r["kind"] == "SINGLE" and n in r["panel"]]
        assert {r["difficulty"] for r in singles} == set(DIFFICULTIES)
    return dict(characterCount=64, multiplayerEnvironmentCellsPerCharacter=len(expected),
                experienceDifficultiesPerCharacter=3,
                allCharactersCovered=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="docs/exclusive-review-2026-11-16")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--mode", choices=["all", "sources", "production", "control", "rotation"], default="all")
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if args.mode in ("all", "sources"):
        sources = read_sources()
        (output/"word-sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")
        files = list((ROOT/"src").rglob("*.py")) + [ROOT/"scripts/nest_battle_worker.py"] + list((ROOT/"data/content").glob("*.json"))
        manifest = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
        (output/"source-hashes.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"Read {len(sources)} original Word documents; recorded {len(files)} source hashes.", flush=True)
    if args.mode in ("all", "production"):
        cases = [("SINGLE", row["attributeType"], 0, diff, [row["number"]], seed)
                 for row in CATALOG for diff in DIFFICULTIES for seed in range(3)]
        cases += [(kind, attr, index, diff, panel, 0)
                  for kind in ("SQUAD", "TEAM", "SERVER_BOSS") for attr in ATTRS
                  for index in range(len(encounters(kind, attr))) for diff in DIFFICULTIES
                  for panel in (squad_panels() if kind == "SQUAD" else raid_panels())]
        rows = execute("production", cases, output, args.workers)
        (output/"coverage.json").write_text(json.dumps(coverage_assertions(rows), indent=2), encoding="utf-8")
    if args.mode in ("all", "control"):
        cases = [(n, size, profile, seed, disabled) for n in range(1, 65)
                 for size in (5, 20) for profile in ("single", "shared")
                 for seed in range(3) for disabled in (False, True)]
        execute("control", cases, output, args.workers)
    if args.mode in ("all", "rotation"):
        cases = [(n, count, cadence, seed) for n in range(1, 65)
                 for count in (1, 3, 5, 10) for cadence in (True, False) for seed in range(3)]
        execute("rotation", cases, output, args.workers)


if __name__ == "__main__":
    main()
