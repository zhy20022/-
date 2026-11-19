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
from src.combat.authored_monsters import HealthPool, begin_cast, end_cast, modifiers, states
from src.combat.battle import Battle
from src.combat.battle_unit import BattleUnit
from src.skills.authored_characters import library
from src.skills.characters import dps_second as dps


CONTENT = json.loads((Path(__file__).resolve().parents[1] /
                     'data/content/characters.json').read_text(encoding='utf-8'))
CHARACTERS = {row['number']: row for row in CONTENT['characters']}


class DpsSecondTests(unittest.TestCase):
    def setUp(self):
        scaling = patch('src.skills.authored_characters.damage_scale', return_value=1)
        scaling.start()
        self.addCleanup(scaling.stop)
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

    def test_jiwei_three_target_exclusive_does_not_recount_after_lethal_hit(self):
        config = CHARACTERS[46]['id']
        battle, caster, enemies = self.encounter(46, 3)
        caster.character.profession = character_from_snapshot({
            'id': 'owner', 'characterConfigId': config, 'attributeType': 'WOOD',
            'professionType': 'MAGIC_RANGED_DPS', 'level': 1,
        }).profession
        caster.character.exclusive_weapon = SimpleNamespace(authored_config_id=config)
        skills = library(caster.character)
        for target in enemies:
            dps._mark(target, caster, skills[config + ':2'], '絮蚀', cap=5, remaining=None)
        enemies[0].current_health = 1
        self.assertTrue(battle._cast_skill(caster, skills[config + ':3'], enemies, [caster]))
        self.assertTrue(enemies[0].is_dead())
        self.assertEqual([len(dps._layers(t, '絮蚀', caster)) for t in enemies], [0, 2, 2])
        self.assertFalse(hasattr(caster, '_damage_balance_target_count'))

    def test_all_simple_authored_damage_segments(self):
        cases = {
            37: [(1, 180, 1, False), (2, 208, 1, True), (3, 384, 4, True)],
            53: [(1, 170, 1, True), (2, 210, 3, True), (3, 300, 10, True)],
            54: [(1, 160, 1, False), (2, 240, 3, True), (3, 280, 1, True)],
            59: [(1, 250, 1, False), (2, 180, 1, True), (3, 540, 6, False)],
            62: [(1, 300, 3, False), (2, 192, 3, True), (3, 288, 3, True)],
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
        self.assertEqual(enemies[0].current_health, 99800)
        for _ in range(10):
            self.cast(battle, caster, 35, 1, enemies, tick=True)
        self.assertEqual(len(dps._layers(caster, '龙爪印', caster)), 9)
        self.assertTrue(all(s['remaining'] is None for s in states(caster)))
        old = enemies[0].current_health
        self.cast(battle, caster, 35, 3, enemies)
        self.assertEqual(old - enemies[0].current_health, 1200)
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
        end_cast(battle, caster, begin_cast(caster))
        self.cast(battle, caster, 45, 1, enemies)
        self.assertEqual([s['remaining'] for s in dps._layers(target, '花痕', caster)],
                         [1, 1, 1, 2, 2, 2])
        end_cast(battle, caster, begin_cast(caster))
        self.assertEqual(len(dps._layers(target, '花痕', caster)), 3)
        for _ in range(3):
            self.cast(battle, caster, 45, 1, enemies)
        self.assertEqual(len(dps._layers(target, '花痕', caster)), 10)
        old = target.current_health
        self.cast(battle, caster, 45, 3, enemies)
        self.assertEqual(old - target.current_health, 284)
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
        self.assertEqual(target.current_health, 99936)
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
        self.assertEqual(old - target.current_health, 400)
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
                expected = [140 * count + 100, 100] if count else [0, 0]
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
        self.assertEqual([t.current_health for t in enemies], [0, 100])

    def test_wuyin_mark_persists_until_detonation(self):
        battle, caster, enemies = self.encounter(44, 1)
        self.cast(battle, caster, 44, 1, enemies)
        mark = dps._layers(enemies[0], '朱砂印', caster)[0]
        self.assertIsNone(mark['remaining'])
        end_cast(battle, enemies[0], begin_cast(enemies[0]))
        end_cast(battle, enemies[0], begin_cast(enemies[0]))
        self.assertEqual(len(dps._layers(enemies[0], '朱砂印', caster)), 1)
        old = enemies[0].current_health
        self.cast(battle, caster, 44, 3, enemies)
        self.assertEqual(old - enemies[0].current_health, 240)
        self.assertFalse(dps._layers(enemies[0], '朱砂印', caster))

    def test_thread_opener_uses_defense_without_penetration(self):
        battle, caster, enemies = self.encounter(61, 2)
        enemies[0].character.defense = 100
        self.cast(battle, caster, 61, 1, enemies)
        self.assertEqual([u.current_health for u in enemies], [99875, 100000])
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
        self.assertEqual(old - target.current_health, int(1200 * 100 / 170))
        self.assertEqual(modifiers(caster).get('crit_damage', 0), 0)

    def test_dragon_claw_crit_chance_really_changes_attack(self):
        battle, caster, enemies = self.encounter(35)
        self.cast(battle, caster, 35, 1, enemies)
        self.assertAlmostEqual(modifiers(caster)['crit_rate'], .02)
        old = enemies[0].current_health
        with patch('random.random', return_value=.01):
            self.cast(battle, caster, 35, 1, enemies)
        self.assertEqual(old - enemies[0].current_health, 312)

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
        self.assertEqual(old - target.current_health, int(1120 * 100 / 170))
        self.assertEqual(len(dps._layers(target, '火毒', caster)), 20)

    def test_light_marks_have_numeric_effect_and_expire_with_source_casts(self):
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
            end_cast(battle, caster, begin_cast(caster))
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
        self.assertEqual(target.current_health, 99905)
        self.assertEqual(len(states(target)), 1)
        self.assertEqual(states(target)[0]['owner_id'], 'other-caster')

    def test_dragon_reduced_single_hits_preserve_aoe_and_full_mark_thresholds(self):
        for slot, expected in ((1, [208, 0]), (2, [200, 200]), (3, [200, 0])):
            battle, caster, enemies = self.encounter(35, 2)
            self.cast(battle, caster, 35, slot, enemies)
            self.assertEqual([100000 - t.current_health for t in enemies], expected)
        for name, threshold in (('龙爪印', 9), ('龙首印', 3)):
            for count in (threshold - 1, threshold):
                with self.subTest(name=name, count=count):
                    battle, caster, enemies = self.encounter(35)
                    dps._mark(caster, caster, self.skill(35, 1), name, count, remaining=None)
                    self.cast(battle, caster, 35, 3, enemies)
                    full = count == threshold
                    self.assertEqual(100000 - enemies[0].current_health, 1200 if full else 200)
                    self.assertEqual(len(dps._layers(caster, name, caster)), 0 if full else count)

    def test_poison_reduced_finisher_scales_at_empty_partial_and_full_stacks(self):
        for count in (0, 2, 19, 20):
            with self.subTest(count=count):
                battle, caster, enemies = self.encounter(36, 2)
                target = enemies[0]
                target.character.magic_defense = 100
                dps._mark(target, caster, self.skill(36, 2), '火毒', count, remaining=None)
                self.cast(battle, caster, 36, 3, enemies)
                expected = int(160 * (2 + .25 * count) * 100 / (170 if count == 20 else 200))
                self.assertEqual(100000 - target.current_health, expected)
                self.assertEqual(enemies[1].current_health, 100000)
                self.assertEqual(len(dps._layers(target, '火毒', caster)), count)

    def test_flower_stronger_opener_and_finisher_keep_layer_cap_and_single_target(self):
        battle, caster, enemies = self.encounter(45, 2)
        self.cast(battle, caster, 45, 1, enemies)
        self.assertEqual([t.current_health for t in enemies], [99850, 100000])
        self.assertEqual(len(dps._layers(enemies[0], '花痕', caster)), 3)
        # Keep the marked target selected for the finisher.
        enemies[0].current_health = 100000
        self.cast(battle, caster, 45, 3, enemies)
        self.assertEqual([t.current_health for t in enemies], [99700, 100000])
        self.assertFalse(dps._layers(enemies[0], '花痕', caster))

    def test_floating_poison_bonus_uses_active_count_and_clears_only_owner(self):
        for active, (base, per_layer) in ((1, (120, 30)), (2, (80, 20)),
                                          (3, (80, 40)), (4, (80, 20))):
            for count in (0, 3, 5):
                with self.subTest(active=active, count=count):
                    battle, caster, enemies = self.encounter(46, active + 2)
                    target = enemies[0]
                    enemies[-2].mechanic_inactive = True
                    enemies[-1].current_health = 0
                    dps._mark(target, caster, self.skill(46, 1), '絮蚀', count, cap=5)
                    other = dict(kind='mark', name='絮蚀', value=1, remaining=2,
                                 owner_id='other', source_skill='other')
                    states(target).append(other)
                    self.cast(battle, caster, 46, 3, enemies)
                    expected = base + per_layer * count
                    self.assertEqual(100000 - target.current_health, expected)
                    self.assertFalse(dps._layers(target, '絮蚀', caster))
                    self.assertIn(other, states(target))
                    self.assertEqual(enemies[-2].current_health, 100000)
                    self.assertEqual([100000 - t.current_health for t in enemies[1:active]],
                                     [base] * (active - 1))

    def test_zhang_secondary_damage_has_four_target_cap_and_owner_only_resource(self):
        for count in (0, 3, 6):
            with self.subTest(count=count):
                battle, caster, enemies = self.encounter(60, 7)
                for i, target in enumerate(enemies):
                    target.current_health -= i
                enemies[6].mechanic_inactive = True
                primary = enemies[0]
                dps._mark(primary, caster, self.skill(60, 2), '太阴引', count)
                other = dict(kind='mark', name='太阴引', value=1, remaining=2,
                             owner_id='other', source_skill='other')
                states(primary).append(other)
                before = [t.current_health for t in enemies]
                self.cast(battle, caster, 60, 3, enemies)
                self.assertEqual([hp - t.current_health for hp, t in zip(before, enemies)],
                                 [350 + 40 * count] + [120 + 20 * min(count, 3)] * 4 + [0, 0])
                self.assertFalse(dps._layers(primary, '太阴引', caster))
                self.assertIn(other, states(primary))
                self.assertTrue(all(not dps._layers(t, '太阴引', caster) for t in enemies[1:]))

    def test_zhang_lethal_primary_does_not_cancel_secondary_hits(self):
        battle, caster, enemies = self.encounter(60, 3)
        for i, target in enumerate(enemies):
            target.current_health = 300 - i
        self.cast(battle, caster, 60, 3, enemies)
        self.assertEqual([t.current_health for t in enemies], [0, 179, 178])

    def test_zhang_shared_pool_applies_only_selected_hits_and_stays_synchronized(self):
        battle, caster, enemies = self.encounter(60, 7)
        pool = HealthPool(enemies)
        self.cast(battle, caster, 60, 3, enemies)
        self.assertEqual(pool.current, pool.maximum - 350 - 4 * 120)
        self.assertTrue(all(t.current_health == pool.current for t in enemies))
        events = [r for r in battle.battle_log if r.get('event_type') == 'damage']
        self.assertEqual(len(events), 5)
        pool.change(-pool.current + 300)
        self.cast(battle, caster, 60, 3, enemies)
        self.assertEqual(pool.current, 0)
        self.assertTrue(all(t.is_dead() for t in enemies))

    def test_thread_single_target_bonus_keeps_cap_ordinary_damage_and_consumption(self):
        for active in (1, 2):
            for count in (0, 1, 10):
                with self.subTest(active=active, count=count):
                    battle, caster, enemies = self.encounter(61, 3)
                    target = enemies[0]
                    target.character.defense = 100
                    enemies[2].mechanic_inactive = True
                    if active == 1:
                        enemies[1].current_health = 0
                    dps._mark(target, caster, self.skill(61, 1), '丝线', count, cap=10, remaining=None)
                    other = dict(kind='mark', name='丝线', value=1, remaining=None,
                                 owner_id='other', source_skill='other')
                    states(target).append(other)
                    self.cast(battle, caster, 61, 3, enemies)
                    self.assertEqual(100000 - target.current_health, (60 if active == 1 else 40) * count)
                    self.assertFalse(dps._layers(target, '丝线', caster))
                    self.assertIn(other, states(target))
                    old = target.current_health
                    self.cast(battle, caster, 61, 3, enemies)
                    self.assertEqual(target.current_health, old)
                    self.assertEqual(enemies[2].current_health, 100000)

    def test_reduced_aoe_keeps_hit_count_scope_and_inactive_filter(self):
        for number, amounts, hits in ((37, (180, 208, 384), (1, 1, 4)),
                                     (62, (300, 192, 288), (3, 3, 3))):
            for count in (1, 5, 10):
                for slot in (1, 2, 3):
                    with self.subTest(number=number, count=count, slot=slot):
                        battle, caster, enemies = self.encounter(number, count + 1)
                        enemies[-1].mechanic_inactive = True
                        self.cast(battle, caster, number, slot, enemies)
                        expected = [amounts[slot - 1]] * (count if slot > 1 else 1)
                        expected += [0] * (len(enemies) - len(expected))
                        self.assertEqual([100000 - t.current_health for t in enemies], expected)
                        events = [r for r in battle.battle_log if r.get('event_type') == 'damage']
                        self.assertEqual(len(events), hits[slot - 1] * (count if slot > 1 else 1))

    def test_adjusted_skill_descriptions_match_both_catalogs(self):
        path = Path(__file__).resolve().parents[1] / 'data/content/authored-character-skills.json'
        authored = json.loads(path.read_text(encoding='utf-8'))
        slots = {35: (1, 3), 36: (1, 2, 3), 37: (2, 3), 42: (1, 2, 3),
                 45: (1, 3), 46: (3,), 60: (3,), 61: (1, 3), 62: (2, 3)}
        for number, changed_slots in slots.items():
            row = CHARACTERS[number]
            for skill, override in zip(row['skills'], authored['characters'][row['id']]):
                if skill['slot'] not in changed_slots:
                    continue
                with self.subTest(number=number, slot=skill['slot']):
                    self.assertEqual(skill['effect'], override['description'])


if __name__ == '__main__':
    unittest.main()
