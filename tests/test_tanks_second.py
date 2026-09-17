import contextlib
import io
import unittest
from unittest.mock import patch

from scripts.nest_battle_worker import character_from_snapshot
from src.attributes.attribute import Attribute, AttributeType
from src.combat.authored_monsters import begin_cast, end_cast, modifiers, states
from src.combat.battle import Battle
from src.combat.battle_unit import BattleUnit
from src.combat.skill_system import Skill, SkillLogic, SkillTier
from src.skills.characters import tanks_second as tanks


class TanksSecondTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        # Exercise real HP, damage, duration and registry APIs, isolating this group.
        self.enterContext(patch('src.skills.characters.registry.modules', return_value=[tanks]))

    def encounter(self, number, party_size=1):
        config = next(c for c in tanks.CONFIG_IDS if c.startswith(f'char_{number:03}_'))
        units = []
        for i in range(party_size + 2):
            character = character_from_snapshot(dict(
                id=f'unit{i}', characterConfigId='char_008_water_support',
                attributeType='WATER', professionType='SUPPORT', level=1))
            character.character_config_id = config if i == 0 else 'unowned'
            character.attribute = Attribute(AttributeType.WATER)
            character.attack = 100
            character.magic_attack = 100
            character.defense = character.magic_defense = 100
            unit = BattleUnit(character, is_player=i < party_size)
            unit.max_health = 10000
            unit.current_health = 10000
            unit._sync_legacy_health_fields()
            units.append(unit)
        self.party, self.enemies = units[:party_size], units[party_size:]
        self.battle = Battle(self.party, self.enemies)
        self.battle.damage_calculator.base_crit_rate = 0
        for unit in units:
            unit._battle = self.battle
        tanks.attach(self.battle, units[0])
        self.unit = units[0]
        return self.unit

    def cast(self, slot, unit=None):
        unit = unit or self.unit
        skill = Skill(f'{unit.character.character_config_id}:{slot}', f'skill{slot}',
                      SkillLogic.A, SkillTier.LOW)
        skill.authored_effect = {'slot': slot}
        before = begin_cast(unit)
        tanks.before_skill(self.battle, unit, skill)
        try:
            result = tanks.cast(self.battle, unit, skill, self.party, self.enemies)
            if result:
                end_cast(self.battle, unit, before)
        finally:
            tanks.after_skill(self.battle, unit, skill)
        return result

    def tick(self, unit=None):
        unit = unit or self.unit
        end_cast(self.battle, unit, begin_cast(unit))

    def test_fire_thorns_require_heat_and_attack_then_conditionally_buff(self):
        unit = self.encounter(33)
        enemy = self.enemies[0]
        self.cast(2)
        unit.take_damage(100, 0, source=enemy)
        self.assertEqual(modifiers(enemy).get('attack', 0), 0)
        self.cast(1)
        self.assertEqual(modifiers(unit)['defense'], 5)
        unit.take_damage(100, 0, source=enemy, is_attack=False)
        self.assertEqual(modifiers(enemy).get('attack', 0), 0)
        unit.take_damage(100, 0, source=enemy)
        self.assertEqual(modifiers(enemy)['attack'], -20)
        self.cast(3)
        self.assertAlmostEqual(modifiers(unit)['defense'], 15)
        enemy.character.attribute = Attribute(AttributeType.WOOD)
        old = unit.current_health
        unit.take_damage(1000, 0, source=enemy)
        self.assertEqual(old - unit.current_health, 940)
        self.tick(enemy)
        self.tick(enemy)
        self.assertEqual(modifiers(enemy).get('attack', 0), 0)

    def test_calamity_modes_replace_and_healing_consumes_resource(self):
        unit = self.encounter(34)
        self.cast(1)
        unit.take_damage(600, 400)
        self.assertEqual(unit.current_health, 9350)
        self.assertEqual(tanks._pool(unit, tanks.CALAMITY)['value'], 350)
        self.cast(2)
        unit.take_damage(0, 1000)
        self.assertAlmostEqual(tanks._pool(unit, tanks.CALAMITY)['value'], 1150)
        self.assertEqual(unit.current_health, 9150)
        old = unit.current_health
        self.cast(3)
        self.assertEqual(unit.current_health - old, 529)
        self.assertAlmostEqual(tanks._pool(unit, tanks.CALAMITY)['value'], 621)
        self.assertEqual(modifiers(unit)['magic_defense'], 25)
        old = unit.current_health
        unit.take_damage(100, 0)
        self.assertEqual(old - unit.current_health, 100)

    def test_calamity_saturates_conversion_without_negative_pool(self):
        unit = self.encounter(34)
        unit.current_health = 1
        tanks._pool(unit, tanks.CALAMITY)['value'] = 10000
        self.cast(3)
        self.assertEqual(unit.current_health, unit.max_health)
        self.assertEqual(tanks._pool(unit, tanks.CALAMITY)['value'], 0)

    def test_hardwood_requires_physical_attack_and_hp_expires(self):
        unit = self.encounter(41)
        self.cast(1)
        unit.take_damage(0, 100)
        unit.take_damage(100, 0, is_attack=False)
        self.assertEqual(unit.max_health, 10000)
        unit.take_damage(100, 0)
        self.assertEqual(unit.max_health, 12000)
        self.assertEqual(unit.current_health, 9700)
        self.tick()
        self.tick()
        self.assertEqual(unit.max_health, 10000)

    def test_hardwood_wind_reduction_and_two_hot_ticks(self):
        unit = self.encounter(41)
        enemy = self.enemies[0]
        enemy.character.attribute = Attribute(AttributeType.WIND)
        self.cast(2)
        unit.take_damage(1000, 0, source=enemy)
        self.assertEqual(unit.current_health, 9450)
        unit.current_health = 1000
        self.cast(3)
        self.assertEqual(unit.current_health, 1000)
        self.assertEqual(modifiers(unit)['defense'], 20)
        self.tick()
        self.tick()
        self.assertEqual(unit.current_health, 4000)
        self.tick()
        self.assertEqual(unit.current_health, 4000)

    def test_leaf_zero_resource_never_grants_free_healing(self):
        unit = self.encounter(42)
        unit.current_health = 100
        self.assertTrue(self.cast(1))
        self.tick()
        self.tick()
        self.assertEqual(unit.current_health, 100)
        self.assertFalse(any(s['kind'] == 'hot' for s in states(unit)))
        self.assertTrue(self.cast(2))
        self.assertEqual(modifiers(unit).get('magic_defense', 0), 0)

    def test_leaf_existing_percent_conversion_and_party_defense(self):
        unit = self.encounter(42, party_size=7)
        tanks._pool(unit, tanks.LEAVES)['value'] = 4000
        self.assertTrue(self.cast(2))
        self.assertEqual(modifiers(unit)['magic_defense'], 40)
        self.assertEqual(tanks._pool(unit, tanks.LEAVES)['value'], 0)
        self.party[1].current_health = 0
        self.party[2].mechanic_inactive = True
        self.cast(3)
        self.assertEqual(modifiers(self.party[6])['magic_defense'], 25)
        self.assertEqual(states(self.party[1]), [])
        self.assertEqual(states(self.party[2]), [])

    def test_leaf_magic_storage_cap_and_overflow_do_not_store_physical(self):
        unit = self.encounter(42)
        unit.take_damage(1000, 1000)
        self.assertEqual(unit.current_health, 8300)
        pool = tanks._pool(unit, tanks.LEAVES)
        self.assertEqual(pool['value'], 300)
        pool['value'] = 4900
        unit.take_damage(500, 1000)
        self.assertEqual(pool['value'], 5000)
        self.assertEqual(unit.current_health, 6900)
        unit.take_damage(0, 1000)
        self.assertEqual(unit.current_health, 5900)
        self.assertEqual(pool['value'], 5000)

    def test_leaf_a_heals_actual_spend_without_hot_or_clearing_remainder(self):
        for stored, healed, remaining in [(0, 0, 0), (1000, 1000, 0),
                                           (2500, 2500, 0), (5000, 2500, 2500)]:
            with self.subTest(stored=stored):
                unit = self.encounter(42)
                unit.current_health = 1000
                pool = tanks._pool(unit, tanks.LEAVES)
                pool['value'] = stored
                self.cast(1)
                self.assertEqual(unit.current_health, 1000 + healed)
                self.assertEqual(pool['value'], remaining)
                self.tick()
                self.tick()
                self.assertEqual(unit.current_health, 1000 + healed)
                self.assertFalse(any(s['kind'] == 'hot' for s in states(unit)))

    def test_leaf_full_cycle_uses_stored_damage_for_heal_and_defense(self):
        unit = self.encounter(42)
        unit.take_damage(0, 1000)
        self.cast(1)
        self.assertEqual(unit.current_health, 9600)
        unit.take_damage(0, 2000)
        self.cast(2)
        self.assertEqual(modifiers(unit)['magic_defense'], 6)
        self.assertEqual(tanks._pool(unit, tanks.LEAVES)['value'], 0)
        self.cast(3)
        self.assertEqual(modifiers(unit)['magic_defense'], 31)

    def test_ready_manifest_includes_dark_tank(self):
        self.assertEqual(tanks.READY_CONFIG_IDS, tanks.CONFIG_IDS)

    def test_light_party_defense_damage_debuff_and_dark_resistance(self):
        unit = self.encounter(49, party_size=7)
        self.cast(1)
        self.assertTrue(all(modifiers(u)['defense'] == 20 for u in self.party))
        enemy = self.enemies[0]
        self.cast(2)
        self.assertEqual(enemy.current_health, 9900)
        self.assertEqual(self.enemies[1].current_health, 10000)
        self.assertEqual(modifiers(enemy)['attack'], -20)
        self.cast(3)
        enemy.character.attribute = Attribute(AttributeType.DARK)
        unit.take_damage(0, 1000, source=enemy)
        self.assertEqual(unit.current_health, 9500)

    def test_persuade_damage_reduction_layers_cap_and_expiration(self):
        unit = self.encounter(50)
        target = self.enemies[0]
        self.cast(1)
        self.assertEqual(target.current_health, 9925)
        self.tick(target)
        for _ in range(3):
            self.cast(1)
        marks = [s for s in states(target) if s.get('name') == tanks.PERSUADE]
        self.assertEqual([s['remaining'] for s in marks], [6, 7, 7])
        self.assertTrue(all(s['unique_mark'] for s in marks))
        unit.take_damage(1000, 0, source=target)
        self.assertEqual(unit.current_health, 9300)
        for _ in range(6):
            self.tick(target)
        old = unit.current_health
        unit.take_damage(1000, 0, source=target)
        self.assertEqual(old - unit.current_health, 800)

    def test_bless_magic_defense_three_layer_cap_and_heal(self):
        unit = self.encounter(50)
        for _ in range(4):
            self.cast(2)
        self.assertAlmostEqual(modifiers(unit)['magic_defense'], 30)
        unit.current_health = 100
        self.cast(3)
        self.assertEqual(unit.current_health, 1600)
        for _ in range(7):
            self.tick()
        self.assertEqual(modifiers(unit).get('magic_defense', 0), 0)

    def test_bone_repair_is_source_scoped_and_cost_bypasses_shields(self):
        unit = self.encounter(57)
        self.cast(1)
        self.assertEqual(modifiers(unit)['defense'], 25)
        self.cast(2)
        armor = next(s for s in states(unit) if s['kind'] == 'shield')
        unit.take_damage(500, 0)
        other = dict(kind='shield', amount=700, initial_amount=1000, remaining=2, source_skill='other')
        states(unit).append(other)
        self.cast(3)
        self.assertEqual(armor['amount'], 1800)
        self.assertEqual(other['amount'], 700)
        self.assertEqual(unit.current_health, 9000)
        self.assertEqual(armor['remaining'], 1)
        self.tick()
        self.assertFalse(any(s.get('tank_key') == 'bone_armor' for s in states(unit)))

    def test_bone_broken_shield_repairs_without_refreshing_lifetime(self):
        unit = self.encounter(57)
        self.cast(2)
        unit.take_damage(2000, 0)
        self.assertFalse(any(s['kind'] == 'shield' for s in states(unit)))
        self.cast(3)
        armor = next(s for s in states(unit) if s['kind'] == 'shield')
        self.assertEqual(armor['amount'], 1200)
        self.assertEqual(armor['remaining'], 1)
        self.tick()
        self.assertFalse(any(s['kind'] == 'shield' for s in states(unit)))

    def test_health_cost_death_records_hooks_once(self):
        unit = self.encounter(57)
        self.cast(2)
        unit.current_health = 500
        self.battle.current_time = 12
        with patch.object(tanks, 'on_death', wraps=tanks.on_death) as death:
            self.cast(3)
            tanks._health_loss(self.battle, unit, 1000)
        self.assertTrue(unit.is_dead())
        self.assertEqual(unit.death_time, 12)
        self.assertEqual(unit.death_serial, 1)
        self.assertEqual(death.call_count, 1)

    def test_blood_cap_overflow_and_expiry_preserve_debt(self):
        unit = self.encounter(58)
        self.cast(1)
        tanks._pool(unit, tanks.BLOOD)['value'] = 4900
        unit.take_damage(600, 400)
        self.assertEqual(unit.current_health, 9100)
        self.assertEqual(tanks._pool(unit, tanks.BLOOD)['value'], 5000)
        self.tick()
        self.tick()
        unit.take_damage(1000, 0)
        self.assertEqual(unit.current_health, 8100)
        self.assertEqual(tanks._pool(unit, tanks.BLOOD)['value'], 5000)

    def test_blood_settlement_bypasses_shield_and_only_runs_once(self):
        unit = self.encounter(58)
        self.cast(1)
        unit.take_damage(1000, 0)
        states(unit).append(dict(kind='shield', amount=9000, remaining=2, source_skill='other'))
        tanks.battle_end(self.battle)
        self.assertEqual(unit.current_health, 9000)
        self.assertEqual(tanks._pool(unit, tanks.BLOOD)['value'], 0)
        tanks.battle_end(self.battle)
        self.assertEqual(unit.current_health, 9000)
        self.assertEqual(next(s['amount'] for s in states(unit) if s['kind'] == 'shield'), 9000)

    def test_blood_clear_damage_is_magic_not_true_and_stops_on_cost_death(self):
        unit = self.encounter(58)
        tanks._pool(unit, tanks.BLOOD)['value'] = 1000
        self.cast(3)
        self.assertEqual(unit.current_health, 8000)
        self.assertEqual([u.current_health for u in self.enemies], [8750, 8750])
        self.assertEqual(tanks._pool(unit, tanks.BLOOD)['value'], 0)
        unit.current_health = 1000
        tanks._pool(unit, tanks.BLOOD)['value'] = 500
        self.cast(3)
        self.assertTrue(unit.is_dead())
        self.assertEqual([u.current_health for u in self.enemies], [8750, 8750])

    def test_bruise_converts_partial_pool_then_clear_restores_hp_and_aoe_bonus(self):
        unit = self.encounter(58)
        blood = tanks._pool(unit, tanks.BLOOD)
        blood['value'] = 1000
        self.assertTrue(self.cast(2))
        self.assertEqual(blood['value'], 600)
        self.assertEqual(unit.max_health, 9500)
        self.assertEqual(tanks._pool(unit, tanks.BRUISE)['value'], 400)
        self.assertTrue(tanks._has(unit, 'pending_dark_attack'))
        self.assertTrue(self.cast(3))
        self.assertEqual(unit.current_health, 8100)
        self.assertEqual(unit.max_health, 10000)
        self.assertEqual(blood['value'], 0)
        self.assertEqual(tanks._pool(unit, tanks.BRUISE)['value'], 0)
        self.assertEqual([t.current_health for t in self.enemies], [8700, 8700])
        self.assertFalse(tanks._has(unit, 'pending_dark_attack'))
        before = [t.current_health for t in self.enemies]
        self.cast(3)
        self.assertEqual([t.current_health for t in self.enemies], before)

    def test_empty_blood_has_no_conversion_cost(self):
        unit = self.encounter(58)
        self.assertTrue(self.cast(2))
        self.assertEqual(unit.max_health, 10000)
        self.assertFalse(tanks._has(unit, 'pending_dark_attack'))

    def test_true_damage_bypasses_leaf_blood_and_calamity_storage(self):
        for number in (34, 42, 58):
            unit = self.encounter(number)
            self.cast(1)
            hp = unit.current_health
            self.assertEqual(unit.take_damage(0, 1000, is_true=True), 1000)
            self.assertEqual(unit.current_health, hp - 1000)
            for pool in (tanks.LEAVES, tanks.BLOOD, tanks.CALAMITY):
                self.assertEqual(tanks._pool(unit, pool)['value'], 0)

    def test_attach_is_idempotent_and_new_battle_clears_owned_resources(self):
        unit = self.encounter(58)
        pool = tanks._pool(unit, tanks.BLOOD)
        pool['value'] = 123
        tanks.attach(self.battle, unit)
        self.assertEqual(pool['value'], 123)
        self.assertEqual(len(self.battle._tanks_second_units), 1)
        new_battle = Battle(self.party, self.enemies)
        tanks.attach(new_battle, unit)
        self.assertEqual(tanks._pool(unit, tanks.BLOOD)['value'], 0)

    def test_no_targets_and_unknown_id_do_not_cast(self):
        self.encounter(49)
        self.enemies.clear()
        self.assertFalse(self.cast(2))
        self.unit.character.character_config_id = 'unowned'
        self.assertFalse(self.cast(1))


if __name__ == '__main__':
    unittest.main()
