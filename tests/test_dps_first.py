"""Effect-level tests independent of roster registration and default loadouts."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from src.attributes.attribute import Attribute, AttributeType
from src.combat.authored_monsters import begin_cast, end_cast, modifiers, states
from src.combat.battle_unit import BattleUnit
from src.combat.damage_calculator import DamageCalculator
from src.skills import authored_characters
from src.skills.characters import dps_first as dps


IDS = {int(key.split('_')[1]): key for key in dps.CONFIG_IDS}


class DpsFirstTests(unittest.TestCase):
    def setUp(self):
        # These assertions isolate authored mechanics; parity has integration tests.
        scaling = patch('src.skills.authored_characters.damage_scale', return_value=1)
        scaling.start()
        self.addCleanup(scaling.stop)

    def encounter(self, number, count=2):
        def unit(uid, config):
            obj = BattleUnit.__new__(BattleUnit)
            obj.character = SimpleNamespace(character_id=uid, character_config_id=config,
                name=uid, attack=100, magic_attack=100, defense=0, magic_defense=0,
                attribute=Attribute(AttributeType[IDS[number].split('_')[2].upper()]))
            obj.max_health = obj.current_health = 10000
            obj.is_player = uid == 'caster'
            obj.status_manager = None
            obj.cast_effects = []
            return obj
        caster = unit('caster', IDS[number])
        enemies = [unit(f'enemy{i}', 'test_enemy') for i in range(count)]
        battle = SimpleNamespace(player_units=[caster], enemy_units=enemies,
            current_time=0, damage_calculator=DamageCalculator(base_crit_rate=0),
            _log=Mock(), _record_damage=Mock(), _on_enemy_killed=Mock(),
            threat_system=SimpleNamespace(add_threat_from_damage=Mock(), add_threat_from_heal=Mock()))
        for obj in [caster] + enemies:
            obj._battle = battle
        return battle, caster, enemies

    def skill(self, caster, slot):
        return SimpleNamespace(skill_id=f'{caster.character.character_config_id}:{slot}',
            name=f'test-{slot}', authored_effect={'slot': slot, 'name': f'test-{slot}'}, use=Mock())

    def cast(self, battle, caster, enemies, slot, lifecycle=False):
        skill = self.skill(caster, slot)
        before = begin_cast(caster) if lifecycle else None
        result = dps.cast(battle, caster, skill, [caster], enemies)
        if lifecycle and result:
            end_cast(battle, caster, before)
        skill.use.assert_not_called()
        return result

    def tick(self, battle, unit):
        end_cast(battle, unit, begin_cast(unit))

    def test_every_opener_has_authored_damage_or_resources(self):
        expected = {4: 80, 5: 160, 6: 45, 11: 180, 12: 170, 13: 160,
                    14: 160, 19: 160, 21: 120, 22: 42, 28: 125, 29: 240, 30: 104}
        for number, amount in expected.items():
            with self.subTest(number=number):
                b, c, e = self.encounter(number)
                self.assertTrue(self.cast(b, c, e, 1))
                self.assertEqual(10000 - e[0].current_health, amount)
        b, c, e = self.encounter(27)
        self.assertTrue(self.cast(b, c, [], 1))
        self.assertEqual(len(dps._layers(c, '阳息', c)), 1)

    def test_han_per_hit_true_damage_cap_detonation_and_penetration(self):
        b, c, e = self.encounter(3, 1)
        self.cast(b, c, e, 1)
        self.assertEqual(e[0].current_health, 9800)
        self.assertEqual(len(dps._layers(e[0], '水蚀印记', c)), 2)
        self.cast(b, c, e, 2)
        self.assertEqual(len(dps._layers(e[0], '水蚀印记', c)), 3)
        self.assertEqual(len(dps._layers(e[0], '破甲', c)), 1)
        old = e[0].current_health
        self.cast(b, c, e, 3)
        self.assertEqual(old - e[0].current_health, 605)
        self.assertEqual(len(dps._layers(e[0], '水蚀印记', c)), 0)
        self.assertTrue(dps._layers(c, '断潮', c))
        self.assertFalse(dps._layers(c, '餍足', c))
        self.assertFalse(hasattr(c, '_dps_first_han_targets'))
        with patch.object(authored_characters, 'damage', wraps=authored_characters.damage) as hit:
            self.cast(b, c, e, 1)
            self.assertEqual(hit.call_args_list[0].args[2].authored_effect['ignore_defense'], .2)

    def test_han_multi_target_does_not_apply_single_enemy_limits(self):
        b, c, e = self.encounter(3, 2)
        self.cast(b, c, e, 1)
        self.assertEqual(e[0].current_health, 9771)
        self.cast(b, c, e, 2)
        e[0].current_health = e[0].max_health
        self.cast(b, c, e, 3)
        self.assertEqual(e[0].current_health, 9350)

    def test_short_marks_age_independently_at_cap(self):
        b, c, e = self.encounter(4, 1)
        self.cast(b, c, e, 1)
        self.tick(b, e[0])
        self.assertEqual([s['remaining'] for s in dps._layers(e[0], '稀释', c)], [2])
        self.tick(b, c)
        self.cast(b, c, e, 1)
        self.cast(b, c, e, 1)
        self.assertEqual([s['remaining'] for s in dps._layers(e[0], '稀释', c)], [1, 2])
        self.tick(b, c)
        self.assertEqual([s['remaining'] for s in dps._layers(e[0], '稀释', c)], [1])

    def test_lin_dilution_is_owner_only_and_wet_modifiers_expire(self):
        b, c, e = self.encounter(4, 1)
        t = e[0]
        self.cast(b, c, e, 1)
        self.cast(b, c, e, 2)
        self.assertEqual(t.current_health, 9828)
        t.character.magic_defense = 100
        self.assertEqual(modifiers(t)['magic_defense'], -30)
        old = t.current_health
        self.cast(b, c, e, 3)
        self.assertEqual(old - t.current_health, int(100 * 1.8 * 1.15 / 1.7))
        self.assertEqual(len(dps._layers(t, '稀释', c)), 1)
        c.character.character_id = 'second-caster'
        old = t.current_health
        self.cast(b, c, e, 3)
        self.assertEqual(old - t.current_health, int(150 / 1.7))
        c.character.character_id = 'caster'
        self.tick(b, c)
        self.tick(b, c)
        self.assertEqual(modifiers(t).get('magic_defense', 0), 0)

    def test_sheng_aoe_bonus_uses_preexisting_water(self):
        b, c, e = self.encounter(5)
        self.cast(b, c, e, 1)
        old = [t.current_health for t in e]
        self.cast(b, c, e, 2)
        self.assertEqual([hp-t.current_health for hp, t in zip(old, e)], [140, 120])
        old = [t.current_health for t in e]
        self.cast(b, c, e, 3)
        self.assertEqual([hp-t.current_health for hp, t in zip(old, e)], [280, 280])

    def test_jing_conditional_phantom_pulses_twice_and_detonates(self):
        b, c, e = self.encounter(6, 1)
        self.assertTrue(self.cast(b, c, e, 2))
        self.assertFalse(states(e[0]))
        self.cast(b, c, e, 1)
        self.cast(b, c, e, 2)
        self.assertEqual(e[0].current_health, 9955)
        self.tick(b, e[0])
        self.assertEqual(e[0].current_health, 9955)
        self.tick(b, c)
        self.assertEqual(e[0].current_health, 9895)
        self.assertEqual(len(dps._layers(e[0], '蜃痕', c)), 2)
        self.tick(b, c)
        self.assertEqual(e[0].current_health, 9835)
        self.assertEqual(len(dps._layers(e[0], '随引幻影', c)), 0)
        self.tick(b, c)
        self.assertEqual(e[0].current_health, 9835)
        self.cast(b, c, e, 1)
        self.cast(b, c, e, 1)
        old = e[0].current_health
        self.cast(b, c, e, 3)
        self.assertEqual(old-e[0].current_health, 360)
        self.assertFalse(dps._layers(e[0], '蜃痕', c))

    def test_heng_crack_is_stackable_and_changes_both_followups(self):
        b, c, e = self.encounter(11, 1)
        self.cast(b, c, e, 2)
        self.cast(b, c, e, 2)
        e[0].character.defense = 100
        self.assertEqual(modifiers(e[0])['defense'], -30)
        e[0].character.defense = 0
        old = e[0].current_health
        self.cast(b, c, e, 1)
        self.assertEqual(old-e[0].current_health, 225)
        old = e[0].current_health
        self.cast(b, c, e, 3)
        self.assertEqual(old-e[0].current_health, 310)

    def test_mo_strict_health_boundaries_and_lifesteal(self):
        for health, damage in [(3999, 380), (4000, 260), (6000, 260), (6001, 380)]:
            b, c, e = self.encounter(12, 1)
            e[0].current_health = health
            self.cast(b, c, e, 3)
            self.assertEqual(health-e[0].current_health, damage)
        for health, healed in [(6000, 42), (6001, 59)]:
            b, c, e = self.encounter(12, 1)
            c.current_health = 100
            e[0].current_health = health
            self.cast(b, c, e, 1)
            self.assertEqual(c.current_health, 100 + healed)
        b, c, e = self.encounter(12, 1)
        e[0].current_health = 3000
        self.cast(b, c, e, 2)
        self.assertEqual(e[0].current_health, 2820)
        e[0].character.magic_defense = 100
        self.assertEqual(modifiers(e[0])['magic_defense'], -20)

    def test_mo_pierce_reduces_only_target_magic_defense_for_two_casts(self):
        b, c, enemies = self.encounter(12)
        target = enemies[0]
        target.character.defense = target.character.magic_defense = 100
        self.cast(b, c, enemies, 2)
        self.assertEqual(target.current_health, 9925)
        self.assertEqual(modifiers(target)['magic_defense'], -20)
        self.assertEqual(modifiers(target).get('defense', 0), 0)
        self.assertFalse(states(enemies[1]))
        effect = next(s for s in states(target) if s['name'] == '贯刺破甲')
        self.assertEqual(effect['remaining'], 2)
        old = target.current_health
        self.cast(b, c, [target], 1, lifecycle=True)
        self.assertEqual(old - target.current_health, int(170 / 1.8))
        self.assertEqual(effect['remaining'], 1)
        self.assertEqual(modifiers(target)['magic_defense'], -20)
        self.tick(b, target)
        self.assertEqual(effect['remaining'], 1)
        self.tick(b, c)
        self.assertEqual(modifiers(target).get('magic_defense', 0), 0)
        old = target.current_health
        self.cast(b, c, [target], 1)
        self.assertEqual(old - target.current_health, 85)

    def test_shi_separate_corrosion_and_fire_states(self):
        b, c, e = self.encounter(13, 1)
        self.cast(b, c, e, 1)
        self.cast(b, c, e, 2)
        self.assertEqual({s['name'] for s in states(e[0])}, {'蚀骨', '炽火'})
        self.assertEqual(modifiers(e[0])['element_in_EARTH'], .2)
        old = e[0].current_health
        self.cast(b, c, e, 3)
        self.assertEqual(old-e[0].current_health, 309)

    def test_zhong_followup_clears_mark_and_its_defense_modifier(self):
        b, c, e = self.encounter(14, 1)
        self.cast(b, c, e, 1)
        old = e[0].current_health
        self.cast(b, c, e, 2)
        self.assertEqual(old-e[0].current_health, 143)
        old = e[0].current_health
        self.cast(b, c, e, 3)
        self.assertEqual(old-e[0].current_health, 320)
        self.assertFalse(states(e[0]))

    def test_yin_three_independent_rolls_cap_and_physical_followup(self):
        b, c, e = self.encounter(19, 1)
        with patch.object(dps.random, 'random', return_value=.5):
            self.cast(b, c, e, 2)
        self.assertEqual(len(dps._layers(e[0], '雷印', c)), 3)
        self.assertAlmostEqual(modifiers(e[0])['element_in_THUNDER'], .15)
        e[0].character.defense = 1000
        with patch.object(authored_characters, 'damage', wraps=authored_characters.damage) as hit:
            old = e[0].current_health
            self.cast(b, c, e, 3)
            effect = hit.call_args.args[2].authored_effect
            self.assertNotIn('health_ratio', effect)
            self.assertNotIn('ignore_defense', effect)
            self.assertEqual(hit.call_args.args[4], 3)
            self.assertLess(old-e[0].current_health, 100)

    def test_yin_followup_layers_and_damage_do_not_scale_with_enemy_health(self):
        for layers in range(4):
            losses = []
            for health in (10000, 10000000):
                b, c, e = self.encounter(19, 1)
                e[0].current_health = e[0].max_health = health
                dps._mark(e[0], c, self.skill(c, 1), '雷印', count=layers)
                self.cast(b, c, e, 3)
                losses.append(health - e[0].current_health)
            self.assertEqual(losses, [280 + min(layers, 2) * 150] * 2)

    def test_yin_failed_rolls_do_not_add_marks(self):
        b, c, e = self.encounter(19, 1)
        with patch.object(dps.random, 'random', return_value=.75):
            self.cast(b, c, e, 2)
        self.assertFalse(dps._layers(e[0], '雷印', c))
        self.assertEqual(e[0].current_health, 9700)

    def test_lifesteal_uses_health_damage_after_shields(self):
        b, c, e = self.encounter(12, 1)
        c.current_health = 100
        states(e[0]).append(dict(kind='shield', name='test-shield', source_skill='test',
                                amount=100, remaining=2))
        self.cast(b, c, e, 1)
        self.assertEqual(e[0].current_health, 9930)
        self.assertEqual(c.current_health, 124)

    def test_pulse_hooks_ignore_unrelated_states(self):
        b, c, e = self.encounter(6, 1)
        dps.after_effect_cast(b, c, e[0], [dict(kind='mark', name='unrelated', remaining=0)])
        self.assertEqual(e[0].current_health, 10000)
        b._record_damage.assert_not_called()

    def test_damage_copies_effect_without_leaking_options_or_mutating_slot(self):
        b, c, e = self.encounter(3, 1)
        skill = self.skill(c, 1)
        original = dict(skill.authored_effect)
        dps.cast(b, c, skill, [c], e)
        self.assertEqual(skill.authored_effect, original)

    def test_zhe_permanent_layers_and_round_half_up(self):
        for count, left in [(1, 0), (2, 1), (3, 1), (5, 2)]:
            b, c, e = self.encounter(21, 1)
            for _ in range(count):
                self.cast(b, c, e, 1)
            for _ in range(3):
                self.tick(b, e[0])
            self.assertEqual(len(dps._layers(e[0], '雷痕', c)), count)
            old = e[0].current_health
            self.cast(b, c, e, 3)
            self.assertEqual(old-e[0].current_health, 150 * count)
            self.assertEqual(len(dps._layers(e[0], '雷痕', c)), left)

    def test_xi_word_only_cap_amplifier_and_last_punishment_tick(self):
        b, c, e = self.encounter(22, 1)
        self.cast(b, c, e, 1)
        self.cast(b, c, e, 2)
        self.cast(b, c, e, 2)
        self.assertEqual(len(dps._layers(e[0], '迓', c)), 3)
        self.assertAlmostEqual(modifiers(e[0])['element_in_THUNDER'], .15)
        old = e[0].current_health
        self.cast(b, c, e, 3)
        self.assertEqual(old-e[0].current_health, 385)
        self.assertFalse(dps._layers(e[0], '迓', c))
        old = e[0].current_health
        self.tick(b, e[0])
        self.assertEqual(e[0].current_health, old)
        for _ in range(3):
            self.tick(b, c)
        self.assertEqual(old-e[0].current_health, 100)

    def test_only_one_effective_enemy_uses_reduced_followups(self):
        for number, slot, reduced, retained in ((11, 1, 225, 252), (11, 3, 310, 320),
                                                 (13, 3, 309, 374), (22, 3, 385, 660)):
            for active, expected in ((1, reduced), (2, retained)):
                with self.subTest(number=number, slot=slot, active=active):
                    b, c, e = self.encounter(number, 3)
                    e[1].mechanic_inactive = active == 1
                    e[2].current_health = 0
                    if number != 11:
                        self.cast(b, c, e, 1)
                    e[0].current_health = e[0].max_health
                    self.cast(b, c, e, 2)
                    e[0].current_health = e[0].max_health
                    self.cast(b, c, e, slot)
                    self.assertEqual(10000 - e[0].current_health, expected)

    def test_chun_word_branches_and_consumable_next_sword_bonuses(self):
        for slots, expected in [((1, 2), [600, 0]), ((1, 1), [420, 420]), ((2, 2), [250, 250])]:
            b, c, e = self.encounter(27)
            for slot in slots:
                self.cast(b, c, e, slot)
            self.assertAlmostEqual(modifiers(c)['damage_reduction'], .2 if slots == (1, 2) else .1)
            with patch('random.random', return_value=.99):
                self.cast(b, c, e, 3)
            self.assertEqual([10000-t.current_health for t in e], expected)
            self.assertFalse(states(c))
            if slots == (2, 2):
                e[0].character.defense = 100
                self.assertEqual(modifiers(e[0])['defense'], -20)
        b, c, e = self.encounter(27, 1)
        self.cast(b, c, e, 1)
        self.cast(b, c, e, 2)
        with patch('random.random', return_value=.1):
            self.cast(b, c, e, 3)
        self.assertEqual(e[0].current_health, 9100)

    def test_chun_guard_does_not_stack_per_skill_and_clears_on_sword(self):
        b, c, e = self.encounter(27, 1)
        self.cast(b, c, e, 1)
        self.cast(b, c, e, 1)
        self.assertAlmostEqual(modifiers(c)['damage_reduction'], .1)
        self.cast(b, c, e, 2)
        self.assertAlmostEqual(modifiers(c)['damage_reduction'], .2)
        self.cast(b, c, e, 3)
        self.assertEqual(modifiers(c).get('damage_reduction', 0), 0)

    def test_chun_zero_or_one_resource_uses_single_target_100_percent(self):
        for slots, expected in [((), 100), ((1,), 120), ((2,), 100)]:
            with self.subTest(slots=slots):
                b, c, enemies = self.encounter(27)
                for slot in slots:
                    self.cast(b, c, enemies, slot)
                with patch('random.random', return_value=.99):
                    self.cast(b, c, enemies, 3)
                self.assertEqual([10000-t.current_health for t in enemies], [expected, 0])
                self.assertFalse(states(c))
                old = sum(t.current_health for t in enemies)
                self.cast(b, c, enemies, 3)
                self.assertEqual(old-sum(t.current_health for t in enemies), 100)

    def test_wei_two_mark_damage_and_element_vulnerability(self):
        b, c, e = self.encounter(28, 1)
        self.cast(b, c, e, 1)
        old = e[0].current_health
        self.cast(b, c, e, 2)
        self.assertEqual(old - e[0].current_health, 135)
        old = e[0].current_health
        self.cast(b, c, e, 3)
        self.assertEqual(old - e[0].current_health, 363)
        self.assertEqual(len(dps._layers(e[0], '气滞', c)), 1)

    def test_wei_qizhi_and_magic_defense_last_through_c_despite_enemy_casts(self):
        b, c, e = self.encounter(28, 1)
        target = e[0]
        target.character.magic_defense = 100
        self.cast(b, c, e, 1, lifecycle=True)
        for _ in range(3):
            self.tick(b, target)
        self.assertEqual([s['remaining'] for s in dps._layers(target, '气滞', c)], [2])
        self.cast(b, c, e, 2, lifecycle=True)
        for _ in range(3):
            self.tick(b, target)
        self.assertEqual([s['remaining'] for s in dps._layers(target, '气滞', c)], [1])
        self.assertEqual(modifiers(target)['magic_defense'], -15)
        old = target.current_health
        self.cast(b, c, e, 3, lifecycle=True)
        self.assertEqual(old - target.current_health, 193)
        self.assertFalse(dps._layers(target, '气滞', c))
        self.assertNotIn('magic_defense', modifiers(target))
        self.assertEqual([s['remaining'] for s in dps._layers(target, '风压', c)], [1])

    def test_mu_six_real_hits_order_and_no_retarget_on_death(self):
        b, c, e = self.encounter(29)
        with patch.object(authored_characters, 'damage', wraps=authored_characters.damage) as hit:
            self.cast(b, c, e, 3)
            self.assertEqual([call.args[4] for call in hit.call_args_list],
                             [.64, .64, .72, .72, .8, .8, .88, .88, .96, .96, 1.04, 1.04])
        self.assertEqual([t.current_health for t in e], [9496, 9496])
        e[0].current_health, e[1].current_health = 100, 50
        self.cast(b, c, e, 1)
        self.assertEqual([t.current_health for t in e], [0, 50])

    def test_mu_all_skill_ratios_reduced_twenty_percent_with_same_targets(self):
        old_ratios = {1: (1.8, 1.2), 2: (1.5,), 3: (.8, .9, 1, 1.1, 1.2, 1.3)}
        for count in (1, 5, 10):
            for slot, ratios in old_ratios.items():
                with self.subTest(count=count, slot=slot):
                    b, c, enemies = self.encounter(29, count)
                    with patch.object(authored_characters, 'damage', wraps=authored_characters.damage) as hit:
                        self.cast(b, c, enemies, slot)
                    targets = enemies[:1] if slot == 1 else enemies
                    self.assertEqual(
                        [(call.args[3], call.args[4]) for call in hit.call_args_list],
                        [(target, round(ratio * .8, 12)) for ratio in ratios for target in targets])
                    expected = {1: 240, 2: 120, 3: 504}[slot]
                    self.assertEqual([10000 - t.current_health for t in enemies],
                                     [expected if t in targets else 0 for t in enemies])

    def test_shizhi_progression_consumed_once_all_three_hits_enhanced(self):
        b, c, e = self.encounter(30, 1)
        self.cast(b, c, e, 1)
        old = e[0].current_health
        self.cast(b, c, e, 2)
        self.assertEqual(old-e[0].current_health, 156)
        self.assertFalse(dps._layers(c, '递进', c))
        self.assertTrue(dps._layers(c, '转折', c))
        old = e[0].current_health
        self.cast(b, c, e, 3)
        self.assertEqual(old-e[0].current_health, 300)
        self.assertFalse(dps._layers(c, '转折', c))
        old = e[0].current_health
        self.cast(b, c, e, 3)
        self.assertEqual(old-e[0].current_health, 216)

    def test_shizhi_reduced_ratios_keep_aoe_hits_and_empowerment(self):
        for count in (1, 5, 10):
            for slot, ratio, hits in ((1, 1.04, 1), (2, 1.12, 1), (3, .72, 3)):
                for empowered in (False, True) if slot != 1 else (False,):
                    with self.subTest(count=count, slot=slot, empowered=empowered):
                        b, c, enemies = self.encounter(30, count)
                        if empowered:
                            mark = '递进' if slot == 2 else '转折'
                            dps._mark(c, c, self.skill(c, 1), mark, remaining=None)
                        with patch.object(authored_characters, 'damage', wraps=authored_characters.damage) as hit:
                            self.cast(b, c, enemies, slot)
                        expected_ratio = round(ratio * (1.4 if empowered else 1), 12)
                        self.assertEqual(
                            [(call.args[3], call.args[4]) for call in hit.call_args_list],
                            [(target, expected_ratio) for _ in range(hits) for target in enemies])
                        self.assertTrue(all(call.args[2].authored_effect['damageType'] == 'magical'
                                            for call in hit.call_args_list))
                        self.assertEqual([10000 - t.current_health for t in enemies],
                                         [int(100 * expected_ratio) * hits] * count)
                        if slot == 2:
                            self.assertEqual(bool(dps._layers(c, '转折', c)), empowered)
                            self.assertFalse(dps._layers(c, '递进', c))
                        elif slot == 3:
                            self.assertFalse(dps._layers(c, '转折', c))

    def test_no_targets_inactive_filter_and_no_lifecycle_ownership(self):
        b, c, e = self.encounter(29)
        e[0].current_health = 0
        e[1].mechanic_inactive = True
        self.assertFalse(self.cast(b, c, e, 3))
        self.assertEqual(e[1].current_health, 10000)
        states(c).append(dict(kind='mark', name='test', remaining=2))
        e[1].mechanic_inactive = False
        self.cast(b, c, e, 3)
        self.assertEqual(states(c)[0]['remaining'], 2)

    def test_zero_and_one_resource_use_base_hit_and_consume_existing(self):
        for opener, expected in [(None, 100), (1, 120), (2, 100)]:
            with self.subTest(opener=opener):
                b, c, e = self.encounter(27)
                if opener:
                    self.cast(b, c, e, opener)
                with patch('random.random', return_value=.99):
                    self.assertTrue(self.cast(b, c, e, 3))
                self.assertEqual([10000 - t.current_health for t in e], [expected, 0])
                self.assertFalse(states(c))

    def test_all_slots_complete_after_author_rulings(self):
        self.assertIn(IDS[3], dps.READY_CONFIG_IDS)
        self.assertIn(IDS[27], dps.COMPLETE_CONFIG_IDS)
        self.assertEqual(dps.IMPLEMENTED_SLOTS[IDS[27]], {1, 2, 3})
        self.assertEqual(len(dps.READY_CONFIG_IDS), 15)


if __name__ == '__main__':
    unittest.main()
