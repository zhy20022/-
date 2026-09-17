import contextlib
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts.nest_battle_worker import character_from_snapshot
from src.combat.battle_unit import BattleUnit
from src.skills.skill_config import SkillConfig

CATALOG = json.loads((Path(__file__).resolve().parents[1] / "data/content/characters.json").read_text(encoding="utf-8-sig"))


def equipped_skills(row, slots):
    with contextlib.redirect_stdout(io.StringIO()):
        character = character_from_snapshot({
            "id": row["id"], "characterConfigId": row["id"], "level": 1,
            "attributeType": row["attributeType"], "professionType": row["professionType"],
            "skillSlots": slots, "equipment": {},
        })
        unit = BattleUnit(character)
        SkillConfig.setup_battle_skills(character, unit.skill_manager, character.skill_learning_system)
    manager = unit.skill_manager
    return manager, manager.low_tier_slots.skills + manager.mid_tier_slots.skills + manager.high_tier_slots.skills


class CharacterSkillAuditTests(unittest.TestCase):
    def test_online_ids_repetition_and_cross_tier_placement(self):
        for row in CATALOG["characters"]:
            with self.subTest(character=row["name"]):
                prefix = row["attributeType"]
                a, b, c = [f"{prefix}_{suffix}" for suffix in ("low_a_1", "low_b_1", "mid_c_1")]
                slots = {"low": [a, a, a], "mid": [a, a, b], "high": [c, c, c]}
                manager, skills = equipped_skills(row, {"skillSlots": slots})
                self.assertEqual(len(skills), 9)
                self.assertTrue(manager.validate_skill_configuration()[0])
                self.assertEqual(len({id(s) for s in skills}), 9)
                with patch('src.combat.skill_system.random.choice', side_effect=lambda choices: choices[-1]):
                    casts = [manager.get_next_skill(t) for t in range(1, 31)]
                self.assertEqual([s.skill_logic.name for s in casts], ['A', 'B', 'C'] * 10)
                self.assertEqual([s.skill_tier.name for s in casts], ['LOW', 'MID', 'HIGH'] * 10)
                self.assertIsNone(manager.get_next_skill(30.5))

    def test_nested_saved_loadouts_are_restored_for_all_characters(self):
        for row in CATALOG["characters"]:
            for field in ("skillSlots", "skill_slots"):
                with self.subTest(character=row["name"], field=field):
                    manager, _ = equipped_skills(row, {})
                    slots = {
                        key: [s.skill_id for s in reversed(getattr(manager, key + "_tier_slots").skills)]
                        for key in ("low", "mid", "high")
                    }
                    _, actual = equipped_skills(row, {
                        field: slots, "learnedSkills": [],
                        "lastBattleGrowth": {"afterLevel": 2},
                    })
                    self.assertEqual([s.skill_id for s in actual], slots["low"] + slots["mid"] + slots["high"])

    def test_growth_metadata_does_not_disable_skills_for_all_64_characters(self):
        self.assertEqual(len(CATALOG["characters"]), 64)
        for row in CATALOG["characters"]:
            with self.subTest(character=row["name"]):
                _, before = equipped_skills(row, {})
                manager, after = equipped_skills(row, {"lastBattleGrowth": {"afterLevel": 2}})
                self.assertEqual(len(after), 9)
                self.assertEqual([s.skill_id for s in before], [s.skill_id for s in after])
                self.assertIsNotNone(manager.get_next_skill(1))

    def test_explicit_loadout_is_preserved_with_growth_metadata(self):
        row = CATALOG["characters"][0]
        manager, _ = equipped_skills(row, {})
        slots = {
            key: [skill.skill_id for skill in getattr(manager, key + "_tier_slots").skills]
            for key in ("low", "mid", "high")
        }
        slots["lastBattleGrowth"] = {"afterLevel": 2}
        _, actual = equipped_skills(row, slots)
        self.assertEqual([s.skill_id for s in actual], slots["low"] + slots["mid"] + slots["high"])
