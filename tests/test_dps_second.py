"""Damage assertions use the real calculator and BattleUnit health pools."""
import contextlib
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from scripts.nest_battle_worker import character_from_snapshot
from src.attributes.attribute import Attribute, AttributeType
from src.combat.authored_monsters import begin_cast, end_cast, modifiers, states
from src.combat.battle import Battle
from src.combat.battle_unit import BattleUnit
from src.skills.characters import dps_second as dps


CONTENT = json.loads((Path(__file__).resolve().parents[1] /
                     'data/content/characters.json').read_text(encoding='utf-8'))
CHARACTERS = {row['number']: row for row in CONTENT['characters']}


class DpsSecondTests(unittest.TestCase):
    def setUp(self):
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)
        self.random = patch('random.random', return_value=.999)
        self.random.start()
        self.addCleanup(self.random.stop)

    def encounter(self, number, count=1):
        units = [BattleUnit(character_from_snapshot({
            'id': f'dps-second-{i}', 'characterConfigId': 'char_008_water_support',
            'attributeType': 'WATER', 'professionType': 'SUPPORT', 'level': 1,
        }), is_player=i == 0) for i in range(count + 1)]
        caster = units[0]
        caster.character.character_config_id = CHARACTERS[number]['id']
        for unit in units:
            unit.character.attribute = Attribute(AttributeType.WATER)
            unit.character.attack = 100
            unit.character.magic_attack = 100
            unit.character.defense = unit.character.magic_defense = 0
            unit.current_health = unit.max_health = 100000
        battle = Battle([caster], units[1:])
        battle.damage_calculator.base_crit_rate = 0
        return battle, caster, units[1:]

    def skill(self, number, slot):
        authored = CHARACTERS[number]['skills'][slot - 1]
        return SimpleNamespace(skill_id=f"{CHARACTERS[number]['id']}:{slot}",
                               name=authored['name'], authored_effect=dict(authored))

    def cast(self, battle, caster, number, slot, enemies, tick=False):
        before = begin_cast(caster)
        result = dps.cast(battle, caster, self.skill(number, slot), [caster], enemies)
        if result and tick:
            end_cast(battle, caster, before)
        return result

    def test_all_simple_authored_damage_segments(self):
        cases = {
            37: [(1, 180, 1, False), (2, 260, 1, True), (3, 480, 4, True)],
            53: [(1, 170, 1, True), (2, 210, 3, True), (3, 300, 10, True)],
            54: [(1, 160, 1, False), (2, 240, 3, True), (3, 280, 1, True)],
            59: [(1, 250, 1, False), (2, 180, 1, True), (3, 540, 6, False)],
            62: [(1, 300, 3, False), (2, 240, 3, True), (3, 360, 3, True)],
        }
        for number, slots in cases.items():
            for slot, expected, hits, aoe in slots:
                with self.subTest(number=number, slot=slot):
                    battle, caster, enemies = self.encounter(number, 2)
                    self.assertTrue(self.cast(battle, caster, number, slot, enemies))
                    self.assertEqual([100000 - e.current_health for e in enemies],
                                     [expected, expected if aoe else 0])
                    events = [r for r in battle.battle_log if r.get('event_type') == 'damage']
                    self.assertEqual(len(events), hits * (2 if aoe else 1))

    def test_prince_lowest_current_health_and_no_retarget(self):
        battle, caster, enemies = self.encounter(59, 2)
        enemies[1].current_health = 99999
        self.cast(battle, caster, 59, 1, enemies)
        self.assertEqual(enemies[1].current_health, 99749)
        enemies[0].current_health, enemies[1].current_health = 100, 90
        self.cast(battle, caster, 59, 3, enemies)
        self.assertEqual([u.current_health for u in enemies], [0, 90])

    def test_no_targets_has_no_resource_or_lifecycle_side_effect(self):
        battle, caster, enemies = self.encounter(35, 2)
        enemies[0].current_health = 0
        enemies[1].mechanic_inactive = True
        self.assertFalse(self.cast(battle, caster, 35, 1, enemies))
        self.assertEqual(states(caster), [])
        self.assertEqual(battle.battle_log, [])

    def test_dragon_fallback_caps_and_consumption(self):
        battle, caster, enemies = self.encounter(35)
        self.cast(battle, caster, 35, 3, enemies)
        self.assertEqual(enemies[0].current_health, 99750)
        for _ in range(10):
            self.cast(battle, caster, 35, 1, enemies, tick=True)
        self.assertEqual(len(dps._layers(caster, '龙爪印', caster)), 9)
        self.assertTrue(all(s['remaining'] is None for s in states(caster)))
        old = enemies[0].current_health
        self.cast(battle, caster, 35, 3, enemies)
        self.assertEqual(old - enemies[0].current_health, 1500)
        self.assertFalse(dps._layers(caster, '龙爪印', caster))
        self.assertFalse(any('crit_rate' in s.get('stats', []) for s in states(caster)))

    def test_root_and_scar_add_damage_without_consumption(self):
        battle, caster, enemies = self.encounter(43)
        self.cast(battle, caster, 43, 1, enemies, tick=True)
        self.cast(battle, caster, 43, 2, enemies, tick=True)
        old = enemies[0].current_health
        self.cast(battle, caster, 43, 3, enemies, tick=True)
        self.assertEqual(old - enemies[0].current_health, 500)
        self.assertFalse(dps._layers(caster, '根脉', caster))
        self.assertEqual(len(dps._layers(enemies[0], '青痕', caster)), 1)

    def test_flower_cap_per_layer_lifetime_and_clear(self):
        battle, caster, enemies = self.encounter(45)
        target = enemies[0]
        self.cast(battle, caster, 45, 1, enemies)
        end_cast(battle, target, begin_cast(target))
        self.cast(battle, caster, 45, 1, enemies)
        self.assertEqual([s['remaining'] for s in dps._layers(target, '花痕', caster)],
                         [1, 1, 1, 2, 2, 2])
        end_cast(battle, target, begin_cast(target))
        self.assertEqual(len(dps._layers(target, '花痕', caster)), 3)
        for _ in range(3):
            self.cast(battle, caster, 45, 1, enemies)
        self.assertEqual(len(dps._layers(target, '花痕', caster)), 10)
        old = target.current_health
        self.cast(battle, caster, 45, 3, enemies)
        self.assertEqual(old - target.current_health, 800)
        self.assertFalse(dps._layers(target, '花痕', caster))
        old = target.current_health
        self.assertTrue(self.cast(battle, caster, 45, 3, enemies))
        self.assertEqual(old, target.current_health)

    def test_flower_aoe_adds_one_mark_per_target_not_per_hit(self):
        battle, caster, enemies = self.encounter(45, 3)
        self.cast(battle, caster, 45, 2, enemies)
        self.assertEqual([u.current_health for u in enemies], [99760] * 3)
        self.assertEqual([len(dps._layers(u, '花痕', caster)) for u in enemies], [1] * 3)

    def test_five_target_selection_is_snapshot_and_ignores_inactive(self):
        for number, expected in [(46, 120), (53, 300)]:
            battle, caster, enemies = self.encounter(number, 7)
            for i, enemy in enumerate(enemies):
                enemy.current_health = 10000 + i
            enemies[6].mechanic_inactive = True
            if number == 46:
                self.cast(battle, caster, 46, 1, enemies)
            before = [e.current_health for e in enemies]
            self.cast(battle, caster, number, 3, enemies)
            self.assertEqual([old - e.current_health for old, e in zip(before, enemies)],
                             [0, expected, expected, expected, expected, expected, 0])
            if number == 46:
                self.assertEqual(len(dps._layers(enemies[0], '絮蚀', caster)), 2)
                self.assertFalse(dps._layers(enemies[1], '絮蚀', caster))

    def test_magic_defense_debuff_changes_real_damage(self):
        battle, caster, enemies = self.encounter(44)
        target = enemies[0]
        target.character.magic_defense = target.character.defense = 100
        self.cast(battle, caster, 44, 1, enemies)
        initial = 100000 - target.current_health
        self.cast(battle, caster, 44, 2, enemies)
        self.assertEqual(modifiers(target)['magic_defense'], -25)
        old = target.current_health
        self.cast(battle, caster, 44, 1, enemies)
        self.assertGreater(old - target.current_health, initial)

    def test_execute_threshold_is_checked_after_first_five_hits(self):
        for start, expected in [(1000, 560), (600, 600), (610, 560)]:
            battle, caster, enemies = self.encounter(52)
            target = enemies[0]
            target.current_health, target.max_health = start, 1000
            self.cast(battle, caster, 52, 3, enemies)
            self.assertEqual(start - target.current_health, expected)

    def test_threads_are_per_enemy_per_owner_permanent_and_consumed(self):
        battle, caster, enemies = self.encounter(61, 2)
        self.cast(battle, caster, 61, 2, enemies)
        self.assertEqual([u.current_health for u in enemies], [99850] * 2)
        for unit in enemies:
            end_cast(battle, unit, begin_cast(unit))
            self.assertEqual(dps._layers(unit, '丝线', caster)[0]['remaining'], None)
        self.cast(battle, caster, 61, 3, enemies)
        self.assertEqual([u.current_health for u in enemies], [99770] * 2)
        self.assertTrue(all(not dps._layers(u, '丝线', caster) for u in enemies))

    def test_poison_conversion_heal_reduction_and_persistent_finisher(self):
        battle, caster, enemies = self.encounter(36)
        target = enemies[0]
        self.cast(battle, caster, 36, 2, enemies)
        self.assertEqual(target.current_health, 99920)
        self.assertFalse(dps._layers(target, '火毒', caster))
        self.cast(battle, caster, 36, 1, enemies)
        self.cast(battle, caster, 36, 2, enemies)
        self.assertFalse(dps._layers(target, '蛛毒', caster))
        self.assertEqual(len(dps._layers(target, '火毒', caster)), 2)
        target.current_health = 1000
        target.heal(100, 0)
        self.assertEqual(target.current_health, 1096)
        old = target.current_health
        self.cast(battle, caster, 36, 3, enemies)
        self.assertEqual(old - target.current_health, 500)
        self.assertEqual(len(dps._layers(target, '火毒', caster)), 2)

    def test_poison_hook_affects_both_types_but_not_true_damage(self):
        battle, caster, enemies = self.encounter(36)
        self.cast(battle, caster, 36, 1, enemies)
        physical, magical = dps.before_damage(enemies[0], 100, 50, {})
        self.assertAlmostEqual(physical, 110)
        self.assertAlmostEqual(magical, 55)
        self.assertEqual(dps.before_damage(enemies[0], 100, 50, {'is_true': True}), (100, 50))

    def test_zhang_three_hits_add_exactly_three_independent_layers(self):
        battle, caster, enemies = self.encounter(60)
        self.cast(battle, caster, 60, 2, enemies)
        self.assertEqual(enemies[0].current_health, 99850)
        layers = dps._layers(enemies[0], '太阴引', caster)
        self.assertEqual(len(layers), 3)
        self.assertEqual([item['remaining'] for item in layers], [2, 2, 2])
        self.assertAlmostEqual(modifiers(enemies[0])['element_in_DARK'], .3)

    def test_wuyin_detonation_per_layer_then_aoe_and_clear(self):
        for count in (0, 1, 3):
            with self.subTest(layers=count):
                battle, caster, enemies = self.encounter(44, 2)
                dps._mark(enemies[0], caster, self.skill(44, 1), '朱砂印', count)
                self.assertTrue(self.cast(battle, caster, 44, 3, enemies))
                expected = [100 * count + 80, 80] if count else [0, 0]
                self.assertEqual([100000 - t.current_health for t in enemies], expected)
                self.assertFalse(dps._layers(enemies[0], '朱砂印', caster))
                before = [t.current_health for t in enemies]
                self.assertTrue(self.cast(battle, caster, 44, 3, enemies))
                self.assertEqual([t.current_health for t in enemies], before)

    def test_wuyin_lethal_detonation_still_hits_other_enemies(self):
        battle, caster, enemies = self.encounter(44, 2)
        enemies[0].current_health = 300
        enemies[1].current_health = 200
        dps._mark(enemies[0], caster, self.skill(44, 1), '朱砂印', 3)
        self.cast(battle, caster, 44, 3, enemies)
        self.assertEqual([t.current_health for t in enemies], [0, 120])

    def test_thread_opener_uses_defense_without_penetration(self):
        battle, caster, enemies = self.encounter(61, 2)
        enemies[0].character.defense = 100
        self.cast(battle, caster, 61, 1, enemies)
        self.assertEqual([u.current_health for u in enemies], [99900, 100000])
        mark = dps._layers(enemies[0], '丝线', caster)[0]
        self.assertIsNone(mark['remaining'])
        self.assertTrue(mark['unique_mark'])
        self.assertEqual(mark['value'], 1)
        self.assertEqual(mark['owner_id'], caster.character.character_id)
        self.assertEqual(mark['source_skill'], self.skill(61, 1).skill_id)
        self.assertIn(CHARACTERS[61]['id'], dps.COMPLETE_CONFIG_IDS)

    def test_dragon_heads_ignore_thirty_percent_defense(self):
        battle, caster, enemies = self.encounter(35)
        for _ in range(4):
            self.cast(battle, caster, 35, 2, enemies)
        self.assertEqual(len(dps._layers(caster, '龙首印', caster)), 3)
        self.assertAlmostEqual(modifiers(caster)['crit_damage'], .3)
        target = enemies[0]
        target.character.defense = 100
        old = target.current_health
        self.cast(battle, caster, 35, 3, enemies)
        self.assertEqual(old - target.current_health, int(1500 * 100 / 170))
        self.assertEqual(modifiers(caster).get('crit_damage', 0), 0)

    def test_dragon_claw_crit_chance_really_changes_attack(self):
        battle, caster, enemies = self.encounter(35)
        self.cast(battle, caster, 35, 1, enemies)
        self.assertAlmostEqual(modifiers(caster)['crit_rate'], .02)
        old = enemies[0].current_health
        with patch('random.random', return_value=.01):
            self.cast(battle, caster, 35, 1, enemies)
        self.assertEqual(old - enemies[0].current_health, 390)

    def test_poison_real_incoming_damage_caps_and_full_fire_poison(self):
        battle, caster, enemies = self.encounter(36)
        target = enemies[0]
        for _ in range(12):
            self.cast(battle, caster, 36, 1, enemies)
        self.assertEqual(len(dps._layers(target, '蛛毒', caster)), 10)
        old = target.current_health
        target.take_damage(100, 50, source=caster)
        self.assertEqual(old - target.current_health, 300)
        for _ in range(10):
            self.cast(battle, caster, 36, 2, enemies)
        self.assertEqual(len(dps._layers(target, '火毒', caster)), 20)
        self.assertAlmostEqual(modifiers(target)['healing_received'], -.4)
        target.character.magic_defense = 100
        old = target.current_health
        self.cast(battle, caster, 36, 3, enemies)
        self.assertEqual(old - target.current_health, int(1400 * 100 / 170))
        self.assertEqual(len(dps._layers(target, '火毒', caster)), 20)

    def test_light_marks_have_numeric_effect_and_expire_with_target(self):
        battle, caster, enemies = self.encounter(52)
        target = enemies[0]
        caster.character.attribute = target.character.attribute = Attribute(AttributeType.LIGHT)
        self.cast(battle, caster, 52, 1, enemies)
        self.assertEqual(target.current_health, 99800)
        self.assertEqual(len(dps._layers(target, '圣火烙印', caster)), 1)
        old = target.current_health
        target.take_damage(0, 100, source=caster)
        self.assertEqual(old - target.current_health, 110)
        self.cast(battle, caster, 52, 2, enemies)
        self.assertEqual(len(dps._layers(target, '灼魂', caster)), 1)
        target.character.magic_defense = 100
        self.assertEqual(modifiers(target)['magic_defense'], -15)
        for _ in range(2):
            end_cast(battle, target, begin_cast(target))
        self.assertEqual(states(target), [])
        self.assertEqual(modifiers(target).get('element_in_LIGHT', 0), 0)

    def test_floating_poison_second_skill_damage_debuff_and_cap(self):
        battle, caster, enemies = self.encounter(46, 2)
        self.cast(battle, caster, 46, 2, enemies)
        self.assertEqual([t.current_health for t in enemies], [99920] * 2)
        for target in enemies:
            target.character.magic_defense = 100
            self.assertEqual(modifiers(target)['magic_defense'], -15)
        for _ in range(3):
            self.cast(battle, caster, 46, 1, enemies)
        self.assertEqual([len(dps._layers(t, '絮蚀', caster)) for t in enemies], [5, 5])

    def test_dark_confirmed_slots_stat_and_consumption(self):
        battle, caster, enemies = self.encounter(60)
        target = enemies[0]
        self.cast(battle, caster, 60, 1, enemies)
        self.assertEqual(target.current_health, 99940)
        self.assertEqual(modifiers(caster)['magic_attack'], 15)
        self.assertEqual(modifiers(target)['magic_attack'], -15)
        # Spell attack gained by A must increase the following C hit.
        dps._mark(target, caster, self.skill(60, 3), '太阴引', 2)
        old = target.current_health
        self.cast(battle, caster, 60, 3, enemies)
        self.assertEqual(old - target.current_health, 494)
        self.assertFalse(dps._layers(target, '太阴引', caster))

    def test_ready_set_only_contains_complete_characters(self):
        self.assertEqual(dps.READY_CONFIG_IDS, {CHARACTERS[n]['id'] for n in
                         (35, 36, 37, 43, 44, 45, 46, 52, 53, 54, 59, 60, 61, 62)})

    def test_consumption_preserves_other_owner_and_accepts_shared_mark_schema(self):
        battle, caster, enemies = self.encounter(45)
        target = enemies[0]
        states(target).extend([
            dict(kind='mark', name='花痕', value=1, remaining=2, unique_mark=True,
                 owner_id=caster.character.character_id, source_skill='shared'),
            dict(kind='mark', name='花痕', value=1, remaining=2, unique_mark=True,
                 owner_id='other-caster', source_skill='other'),
        ])
        self.cast(battle, caster, 45, 3, enemies)
        self.assertEqual(target.current_health, 99920)
        self.assertEqual(len(states(target)), 1)
        self.assertEqual(states(target)[0]['owner_id'], 'other-caster')


if __name__ == '__main__':
    unittest.main()
