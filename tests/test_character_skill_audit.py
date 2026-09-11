import contextlib
import io
import json
from pathlib import Path
import unittest

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
