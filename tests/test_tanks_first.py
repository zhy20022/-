"""Effect-level tests using real HP, shield, stat and cast-clock machinery."""
import contextlib
import io
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from scripts.nest_battle_worker import character_from_snapshot
from src.combat.authored_monsters import begin_cast, end_cast, modifiers, states
from src.combat.battle import Battle
from src.combat.battle_unit import BattleUnit
from src.skills.characters import tanks_first as tanks
from src.skills.characters.common import mark_layers, shield


class TanksFirstTests(unittest.TestCase):
    def setUp(self):
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)
        self.registry = patch('src.skills.characters.registry.modules', return_value=[tanks])
        self.registry.start()
        self.addCleanup(self.registry.stop)

    def encounter(self, number):
        def unit(config, identity, player):
            value = BattleUnit(character_from_snapshot({
                'id': identity, 'characterConfigId': config,
                'attributeType': 'EARTH', 'professionType': 'MAGIC_TANK', 'level': 1,
            }), is_player=player)
            value.max_health = value.current_health = value.character.hp = 10000
            value.character.attack = value.character.magic_attack = 100
            value.character.defense = value.character.magic_defense = 100
            value._sync_legacy_health_fields()
            return value
        target = unit(tanks.IDS[number], 'tank', True)
        source = unit('unassigned', 'source', False)
        battle = Battle([target], [source])
        target._battle = source._battle = battle
        tanks.attach(battle, target)
        return battle, target, source

    def cast(self, battle, unit, slot):
        before = begin_cast(unit)
        skill = SimpleNamespace(authored_effect={'slot': slot}, use=Mock())
        self.assertTrue(tanks.cast(battle, unit, skill, [unit], []))
        skill.use.assert_not_called()
        end_cast(battle, unit, before)

    def tick(self, battle, unit):
        end_cast(battle, unit, begin_cast(unit))

    def items(self, unit, key):
        return [s for s in states(unit) if s.get('tank_key') == key]

    def test_dispatch_all_twenty_one_slots_and_no_parent_cast_side_effects(self):
        self.assertEqual(tanks.CONFIG_IDS, set(tanks.IDS.values()))
        self.assertEqual(tanks.READY_CONFIG_IDS, set(tanks.IDS.values()))
        for number in tanks.IDS:
            for slot in (1, 2, 3):
                with self.subTest(number=number, slot=slot):
                    battle, unit, _ = self.encounter(number)
                    self.cast(battle, unit, slot)
                    self.assertEqual(unit._tanks_first_casts, 1)
        battle, unit, _ = self.encounter(1)
        self.assertFalse(tanks.cast(battle, unit, SimpleNamespace(authored_effect={'slot': 4}), [], []))
        unit.character.character_config_id = 'unassigned'
        self.assertFalse(tanks.cast(battle, unit, SimpleNamespace(authored_effect={'slot': 1}), [], []))

    def test_soft_force_resists_only_earth_and_converts_prevented_damage(self):
        battle, unit, source = self.encounter(1)
        self.cast(battle, unit, 1)
        unit.take_damage(1000, 0, source=source)
        self.assertEqual(unit.current_health, 9400)
        self.assertEqual(unit.max_health, 10120)
        self.assertAlmostEqual(self.items(unit, 'soft_force')[0]['amount'], 120)
        source.character.attribute.attribute_type = source.character.attribute.attribute_type.__class__.FIRE
        unit.take_damage(1000, 0, source=source)
        self.assertEqual(unit.current_health, 8400)
        self.assertEqual(unit.max_health, 10120)
        self.tick(battle, unit)
        self.assertEqual(self.items(unit, 'soft_force')[0]['remaining'], 1)
        self.tick(battle, unit)
        self.assertEqual(unit.max_health, 10000)
        released = [s for s in states(unit) if s['kind'] == 'shield'][0]
        self.assertEqual(released['amount'], 120)
        self.assertEqual(released['remaining'], 2)

    def test_soft_force_hp_cap_independent_layers_and_no_free_heal(self):
        battle, unit, source = self.encounter(1)
        self.cast(battle, unit, 1)
        self.cast(battle, unit, 1)
        first, second = self.items(unit, 'soft_force')
        self.assertEqual((first['remaining'], second['remaining']), (1, 2))
        physical, magical = tanks.before_damage(unit, 20000, 0,
            {'battle': battle, 'source': source, 'is_attack': True})
        self.assertEqual((physical, magical), (12000, 0))
        self.assertEqual(unit.max_health, 11500)
        self.assertEqual(unit.current_health, 10000)
        self.assertEqual(sum(s['amount'] for s in self.items(unit, 'soft_force')), 1500)
        self.assertTrue(all(s['unique_mark'] for s in self.items(unit, 'soft_force')))

    def test_inner_breath_storage_cap_overflow_and_two_recovery_ticks(self):
        battle, unit, source = self.encounter(1)
        self.cast(battle, unit, 2)
        unit.take_damage(4000, 0, source=source)
        self.assertEqual((unit.current_health, unit.max_health), (6800, 10800))
        unit.take_damage(2000, 0, source=source)
        self.assertEqual((unit.current_health, unit.max_health), (5000, 11000))
        unit.take_damage(0, 100, is_attack=False, source=source)
        self.assertEqual(unit.current_health, 4900)
        self.tick(battle, unit)
        self.tick(battle, unit)
        self.assertEqual((unit.current_health, unit.max_health), (4900, 10000))
        self.tick(battle, unit)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 5300)
        self.assertFalse(self.items(unit, 'breath_recovery'))

    def test_zero_inner_breath_does_not_create_recovery(self):
        battle, unit, _ = self.encounter(1)
        unit.current_health = 5000
        self.cast(battle, unit, 2)
        for _ in range(4):
            self.tick(battle, unit)
        self.assertEqual(unit.current_health, 5000)
        self.assertFalse(self.items(unit, 'breath_recovery'))

    def test_inner_breath_heal_uses_max_health_not_stored_amount(self):
        battle, unit, source = self.encounter(1)
        unit.current_health = 5000
        self.cast(battle, unit, 2)
        unit.take_damage(100, 0, source=source)
        self.assertEqual(self.items(unit, 'inner_breath')[0]['amount'], 20)
        self.tick(battle, unit)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 4920)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 5120)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 5320)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 5320)

    def test_reverse_wind_recalculates_defense_and_preserves_physical_origin(self):
        from src.skills.authored_characters import damage
        battle, unit, source = self.encounter(26)
        battle.damage_calculator.base_crit_rate = 0
        unit.character.defense = 900
        unit.character.magic_defense = 100
        source.character.attack = 1000
        source.character.magic_attack = 200
        self.cast(battle, unit, 3)
        # One cast gives 2% passive magic defense on top of C's 50%.
        skill = SimpleNamespace(authored_effect={'damageType': 'physical'}, skill_id='hit', name='hit')
        before = unit.current_health
        damage(battle, source, skill, unit, 1)
        self.assertEqual(before - unit.current_health, 39)
        self.assertAlmostEqual(self.items(unit, 'wind_storage')[0]['amount'], 356.4)
        before = unit.current_health
        damage(battle, source, skill, unit, 1)
        self.assertEqual(before - unit.current_health, 39)
        self.assertAlmostEqual(self.items(unit, 'wind_storage')[0]['amount'], 712.8)

    def test_reverse_wind_monster_mixed_hit_retains_both_attack_stats(self):
        battle, unit, source = self.encounter(26)
        battle.damage_calculator.base_crit_rate = 0
        source.character.attack = 1000
        source.character.magic_attack = 200
        self.cast(battle, unit, 3)
        battle.monster_runtime.apply(source, unit, {'name': 'mixed'}, 0,
                                     {'kind': 'damage', 'school': 'mixed', 'value': 1})
        # Physical half: 500/2.52 ->198; magical half:100/2.52 ->39.
        self.assertAlmostEqual(self.items(unit, 'wind_storage')[0]['amount'], 178.2)
        self.assertEqual(unit.current_health, 9942)

    def test_true_damage_is_never_stored_or_converted(self):
        for number, key in [(1, 'inner_breath'), (2, 'water_pressure'), (26, 'wind_storage')]:
            battle, unit, _ = self.encounter(number)
            self.cast(battle, unit, 2 if number == 1 else 3 if number == 26 else 1)
            old = unit.current_health
            unit.take_damage(100, 200, is_true=True)
            self.assertEqual(old - unit.current_health, 300)
            self.assertEqual(self.items(unit, key)[0]['amount'], 0)

    def test_mountain_shield_word_note_expiry_heals_half_remainder(self):
        battle, unit, source = self.encounter(1)
        unit.current_health = 5000
        self.cast(battle, unit, 3)
        self.assertEqual(self.items(unit, 'mountain_shield')[0]['amount'], 2000)
        unit.take_damage(1000, 0, source=source)
        self.assertEqual(unit.current_health, 5000)
        self.assertEqual(self.items(unit, 'mountain_shield')[0]['amount'], 1250)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 5000)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 5625)
        self.assertFalse(self.items(unit, 'mountain_shield'))

    def test_mountain_shield_broken_or_overwritten_does_not_expiry_heal(self):
        battle, unit, source = self.encounter(1)
        unit.current_health = 5000
        self.cast(battle, unit, 3)
        unit.take_damage(4000, 0, source=source)
        self.assertEqual(unit.current_health, 4000)
        self.tick(battle, unit)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 4000)
        self.cast(battle, unit, 3)
        self.cast(battle, unit, 3)
        self.assertEqual(unit.current_health, 4000)
        self.assertEqual(len(self.items(unit, 'mountain_shield')), 1)

    def test_pressure_capacity_overflow_and_two_payments_without_restore(self):
        battle, unit, source = self.encounter(2)
        self.cast(battle, unit, 1)
        unit.take_damage(11000, 0, source=source)
        self.assertEqual(unit.current_health, 9000)
        self.assertEqual(self.items(unit, 'water_pressure')[0]['amount'], 10000)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 5500)
        self.assertEqual(self.items(unit, 'water_pressure')[0]['amount'], 6500)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 0)
        self.assertEqual(self.items(unit, 'water_pressure')[0]['amount'], 0)
        self.assertEqual(unit._tanks_first_pressure_sources, [])
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 0)
        self.assertEqual(battle.damage_stats['source']['total_damage'], 9000)
        self.assertIn(tanks.PRESSURE_SKILL.skill_id, battle.damage_stats['source']['skills'])

    def test_pressure_clear_before_payment_and_crit_state(self):
        battle, unit, source = self.encounter(2)
        self.cast(battle, unit, 1)
        unit.take_damage(0, 1000, source=source)
        self.cast(battle, unit, 3)
        self.assertEqual(unit.current_health, 10000)
        self.assertEqual(self.items(unit, 'water_pressure')[0]['amount'], 0)
        self.assertEqual(unit._tanks_first_pressure_sources, [])
        self.cast(battle, unit, 2)
        self.assertEqual(modifiers(unit)['crit_immune_magical'], 1)
        self.tick(battle, unit)
        self.tick(battle, unit)
        self.assertNotIn('crit_immune_magical', modifiers(unit))

    def test_pressure_final_payment_uses_shield_and_clears_fractional_residue(self):
        battle, unit, source = self.encounter(2)
        self.cast(battle, unit, 1)
        tanks.before_damage(unit, .5, 0, {'battle': battle, 'source': source})
        shield(unit, unit, 'external', 10, remaining=None)
        self.tick(battle, unit)
        self.assertEqual(self.items(unit, 'water_pressure')[0]['amount'], .5)
        self.tick(battle, unit)
        self.assertEqual(self.items(unit, 'water_pressure')[0]['amount'], 0)
        self.assertEqual(unit._tanks_first_pressure_sources, [])
        self.assertEqual(unit.current_health, 10000)
        self.assertFalse(self.items(unit, 'abyss_stance'))

    def test_pressure_skill_three_clears_before_expiry_damage(self):
        battle, unit, source = self.encounter(2)
        self.cast(battle, unit, 1)
        unit.take_damage(1000, 0, source=source)
        self.cast(battle, unit, 2)
        self.assertEqual(unit.current_health, 9650)
        self.cast(battle, unit, 3)
        self.assertEqual(unit.current_health, 9650)
        self.assertEqual(self.items(unit, 'water_pressure')[0]['amount'], 0)
        self.assertFalse(self.items(unit, 'abyss_stance'))

    def test_pressure_multiple_sources_fractional_conservation_and_lethal_credit(self):
        battle, unit, source = self.encounter(2)
        self.cast(battle, unit, 1)
        tanks.before_damage(unit, 1.5, 0, {'battle': battle, 'source': source})
        tanks.before_damage(unit, 98.5, 0, {'battle': battle, 'source': source})
        unit.current_health = 10
        with patch.object(unit, 'take_damage', wraps=unit.take_damage) as take:
            self.tick(battle, unit)
        self.assertEqual(take.call_count, 1)
        self.assertEqual(unit.current_health, 0)
        self.assertEqual(battle.damage_stats['source']['total_damage'], 10)
        self.assertAlmostEqual(sum(s[1] for s in unit._tanks_first_pressure_sources), 65)
        self.assertEqual(self.items(unit, 'water_pressure')[0]['amount'], 65)

    def test_pressure_shield_absorption_records_only_effective_damage(self):
        battle, unit, source = self.encounter(2)
        self.cast(battle, unit, 1)
        shield(unit, unit, 'external', 100, remaining=None)
        unit.take_damage(0, 800, source=source)
        self.assertEqual(unit.current_health, 10000)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 9820)
        self.assertEqual(battle.damage_stats['source']['total_damage'], 180)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, 9300)
        self.assertEqual(self.items(unit, 'water_pressure')[0]['amount'], 0)
        unit.take_damage(0, 100, source=source)
        self.assertEqual(unit.current_health, 9200)
        self.assertEqual(self.items(unit, 'water_pressure')[0]['amount'], 0)

    def test_rock_entry_growth_probabilities_caps_and_jade_shield(self):
        battle, unit, source = self.encounter(9)
        unit.take_damage(1000, 0, source=source)
        self.assertEqual(unit.current_health, 9020)
        battle.rng = SimpleNamespace(random=lambda: 0)
        for _ in range(7):
            self.cast(battle, unit, 1)
        self.assertEqual(unit.max_health, 17500)
        self.assertEqual(unit.current_health, 9020)
        self.assertEqual(len(self.items(unit, 'mountain_blessing')), 5)
        for level in (1, 2, 3, 3):
            self.cast(battle, unit, 2)
            self.assertEqual(self.items(unit, 'rock_armor')[0]['level'], level)
            self.assertAlmostEqual(self.items(unit, 'rock_armor')[0]['value'], .02 * (level + 1))
        self.cast(battle, unit, 3)
        self.assertEqual([s['amount'] for s in states(unit) if s['kind'] == 'shield'], [875])
        battle, unit, _ = self.encounter(9)
        battle.rng = SimpleNamespace(random=lambda: .25)
        self.cast(battle, unit, 1)
        self.cast(battle, unit, 2)
        self.assertEqual(unit.max_health, 10000)
        self.assertEqual(self.items(unit, 'rock_armor')[0]['level'], 0)

    def test_earth_silt_on_magic_hit_cap_consume_and_hot(self):
        battle, unit, source = self.encounter(10)
        self.cast(battle, unit, 2)
        self.assertEqual(mark_layers(unit, 'earth_silt'), [])
        unit.take_damage(0, 1000, source=source)
        self.assertEqual(unit.current_health, 9000)
        unit.take_damage(0, 1000, source=source)
        self.assertEqual(unit.current_health, 8020)
        unit.take_damage(100, 0, source=source)
        self.assertEqual(len(mark_layers(unit, 'earth_silt')), 2)
        for _ in range(25):
            unit.take_damage(0, 10, source=source)
        self.assertEqual(len(mark_layers(unit, 'earth_silt')), 20)
        self.cast(battle, unit, 1)
        old = unit.current_health
        unit.take_damage(1000, 1000, source=source)
        self.assertEqual(old - unit.current_health, 1200)
        self.cast(battle, unit, 3)
        self.assertEqual(mark_layers(unit, 'earth_silt'), [])
        old = unit.current_health
        self.tick(battle, unit)
        self.tick(battle, unit)
        self.assertEqual(unit.current_health, min(10000, old + 2400))

    def test_earth_silt_requires_damage_not_zero_or_fully_absorbed_hit(self):
        battle, unit, source = self.encounter(10)
        unit.take_damage(0, 0, source=source)
        shield(unit, unit, 'external', 500)
        unit.take_damage(0, 100, source=source)
        self.assertEqual(mark_layers(unit, 'earth_silt'), [])

    def test_thunder_heal_attack_window_and_shield_bound_resistance(self):
        battle, unit, source = self.encounter(18)
        unit.current_health = 1000
        self.cast(battle, unit, 1)
        self.assertEqual(modifiers(unit)['magic_defense'], 20)
        self.cast(battle, unit, 3)
        self.assertEqual(modifiers(unit)['magic_defense'], 35)
        unit.take_damage(0, 100, source=source)
        self.cast(battle, unit, 2)
        self.assertEqual(unit.current_health, 2800)
        self.assertEqual(modifiers(unit)['magic_defense'], 15)
        unit.take_damage(0, 100, source=source, is_attack=False)
        self.cast(battle, unit, 2)
        self.assertEqual(unit.current_health, 4000)
        self.assertEqual(modifiers(unit).get('magic_defense', 0), 0)
        self.cast(battle, unit, 3)
        unit.take_damage(3000, 0, source=source)
        self.assertFalse(self.items(unit, 'cocoon_resistance'))

    def test_flowing_shield_cleanse_penalty_only_own_skill_sources(self):
        battle, unit, source = self.encounter(25)
        unit.current_health = 4000
        self.cast(battle, unit, 1)
        self.cast(battle, unit, 2)
        self.assertEqual(modifiers(unit)['attack'], -15)
        self.assertEqual(modifiers(unit)['magic_defense'], -15)
        other = shield(unit, source, 'other', 1000)
        # Effects-only call permits inspecting the penalty before parent expiry.
        tanks.cast(battle, unit, SimpleNamespace(authored_effect={'slot': 3}), [], [])
        self.assertEqual(unit.current_health, 5500)
        self.assertEqual(self.items(unit, 'flowing_shield')[0]['amount'], 2000)
        self.assertEqual(other['amount'], 1000)
        self.assertEqual(self.items(unit, 'listen_breath')[0]['value'], .2)
        self.assertEqual(modifiers(unit).get('attack', 0), 0)
        self.assertEqual(modifiers(unit).get('magic_defense', 0), 0)

    def test_listen_breath_fire_resistance_not_other_elements(self):
        battle, unit, source = self.encounter(25)
        self.cast(battle, unit, 2)
        unit.take_damage(1000, 0, source=source)
        self.assertEqual(unit.current_health, 9000)
        source.character.attribute.attribute_type = source.character.attribute.attribute_type.__class__.FIRE
        unit.take_damage(1000, 0, source=source)
        self.assertEqual(unit.current_health, 8400)

    def test_wind_passive_growth_storage_cap_and_heal_conversion(self):
        battle, unit, source = self.encounter(26)
        for _ in range(25):
            self.cast(battle, unit, 1)
        self.assertEqual(modifiers(unit)['magic_defense'], 30)
        self.assertEqual(modifiers(unit)['defense'], -20)
        unit.take_damage(4000, 0, source=source)
        self.assertEqual(unit.current_health, 9000)
        self.assertEqual(self.items(unit, 'wind_storage')[0]['amount'], 3000)
        unit.take_damage(4000, 0, source=source)
        self.assertEqual(unit.current_health, 7000)
        self.assertEqual(self.items(unit, 'wind_storage')[0]['amount'], 5000)
        unit.take_damage(1000, 0, source=source)
        self.assertEqual(unit.current_health, 6000)
        self.cast(battle, unit, 2)
        self.assertEqual(unit.current_health, 10000)
        self.assertEqual(self.items(unit, 'wind_storage')[0]['amount'], 0)

    def test_wind_spring_threshold_holder_clock_and_cooldown(self):
        battle, unit, source = self.encounter(26)
        unit.current_health = 2100
        unit.take_damage(0, 100, source=source)
        self.assertFalse(self.items(unit, 'spring_healing'))
        unit.take_damage(0, 1, source=source)
        self.assertEqual(modifiers(unit)['healing_received'], .3)
        self.tick(battle, source)
        self.assertEqual(self.items(unit, 'spring_healing')[0]['remaining'], 2)
        unit.heal(100, 0)
        self.assertEqual(unit.current_health, 2129)
        self.tick(battle, unit)
        self.tick(battle, unit)
        self.assertFalse(self.items(unit, 'spring_healing'))
        unit.take_damage(0, 200, source=source)
        self.assertEqual(self.items(unit, 'spring_healing')[0]['remaining'], 2)

    def test_reverse_wind_contract_uses_original_physical_post_defense_component(self):
        battle, unit, _ = self.encounter(26)
        self.cast(battle, unit, 3)
        self.assertEqual(modifiers(unit)['magic_defense'], 52)
        self.assertEqual(self.items(unit, 'reverse_wind')[0]['school'], 'magical')
        result = tanks.before_damage(unit, 0, 1000,
            {'battle': battle, 'original_physical': 400, 'original_magical': 600})
        self.assertEqual(result, (0, 640))
        self.assertEqual(self.items(unit, 'wind_storage')[0]['amount'], 360)
        self.tick(battle, unit)
        self.tick(battle, unit)
        self.assertFalse(self.items(unit, 'reverse_wind'))
        self.assertEqual(modifiers(unit)['magic_defense'], 6)


if __name__ == '__main__':
    unittest.main()
