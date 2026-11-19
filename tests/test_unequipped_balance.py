"""Production-path balance checks without bypassing the real ratio profiles."""
import unittest
from unittest.mock import patch

from scripts import audit_exclusive_review as audit
from src.skills import authored_characters, damage_balance

class UnequippedBalanceTests(unittest.TestCase):
    def test_profiles_only_reduce_dps_and_preserve_description_sync(self):
        self.assertEqual(len(damage_balance.PROFILES), 32)
        for config, profile in damage_balance.PROFILES.items():
            row = next(r for r in audit.CATALOG if r["id"] == config)
            self.assertTrue(row["professionType"].endswith("_DPS"))
            self.assertEqual(set(profile["targetScales"]), {"1", "2", "3", "5", "6", "10", "20"})
            self.assertTrue(all(0 < value <= 1 for value in profile["targetScales"].values()))
            for slot in range(3):
                displayed = row["skills"][slot]["effect"].split("【无专属伤害平衡】")[1]
                executable = authored_characters.DEFINITIONS[config][slot]["description"].split(
                    "【无专属伤害平衡】")[1]
                self.assertEqual(displayed, executable)

    def test_single_enemy_abc_stays_within_two_times(self):
        values = [
            sum(audit.rotation_run((n, 1, True, seed))["totalDamage"]
                for seed in range(3)) / 3
            for n, row in audit.BY_NUMBER.items() if row["professionType"].endswith("_DPS")
        ]
        self.assertGreater(min(values), 0)
        self.assertLessEqual(max(values), min(values) * 2, (min(values), max(values)))

    def test_dead_and_inactive_targets_do_not_change_budget_and_aoe_snapshots(self):
        from tests.test_authored_characters import AuthoredCharacterTests
        battle, caster, enemies = AuthoredCharacterTests().damage_encounter(
            'char_038_fire_magic_ranged_dps', 4)
        enemies[2].current_health = 0
        enemies[3].mechanic_inactive = True
        enemies[0].current_health = 1
        skills = authored_characters.library(caster.character)
        profile = damage_balance.PROFILES[caster.character.character_config_id]
        with patch('random.random', return_value=.99):
            battle._cast_skill(caster, skills[caster.character.character_config_id + ':3'],
                               enemies, [caster])
        self.assertEqual(10000 - enemies[1].current_health, int(560 * profile["targetScales"]["2"]))
        self.assertFalse(hasattr(caster, "_damage_balance_target_count"))

    def test_reduced_multihit_does_not_retain_old_attack_floor(self):
        from tests.test_authored_characters import AuthoredCharacterTests
        battle, caster, enemies = AuthoredCharacterTests().damage_encounter(
            'char_038_fire_magic_ranged_dps', 1)
        skill = authored_characters.library(caster.character)[caster.character.character_config_id + ':1']
        profile = damage_balance.PROFILES[caster.character.character_config_id]
        amount = authored_characters.damage(battle, caster, skill, enemies[0], .1)
        self.assertEqual(amount, int(10 * profile["targetScales"]["1"]))
        self.assertLess(amount, 10)


if __name__ == "__main__":
    unittest.main()
