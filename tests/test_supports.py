"""Effect tests use real BattleUnit damage/healing and the parent's cast clock."""
import contextlib
import io
import unittest
from unittest.mock import Mock, patch

from scripts.nest_battle_worker import character_from_snapshot
from src.attributes.attribute import Attribute, AttributeType
from src.classes.profession import Profession, ProfessionType
from src.combat.battle import Battle
from src.combat.battle_unit import BattleUnit
from src.combat.authored_monsters import begin_cast, end_cast, modifiers, states
from src.combat.status_system import StatusEffect, StatusType
from src.skills.authored_characters import library
from src.skills.characters import registry, supports
from src.skills.characters.common import shield, stat


class SupportTests(unittest.TestCase):
    def setUp(self):
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)
        # Parallel groups have their own suites; these tests exercise this group's
        # hooks through the real engine without depending on unfinished siblings.
        self.modules = patch.object(registry, 'modules', return_value=[supports])
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def party(self, number=7, count=5, caster_index=0):
        config = next(c for c in supports.CONFIG_IDS if int(c.split('_')[1]) == number)
        party = [BattleUnit(character_from_snapshot({
            'id': f'instance-{i}', 'characterConfigId': 'char_008_water_support',
            'attributeType': 'WATER', 'professionType': 'SUPPORT', 'level': 1,
        })) for i in range(count)]
        caster = party[caster_index]
        caster.character.character_config_id = config
        battle = Battle(party, [])
        for unit in party:
            unit._battle = battle
            unit.max_health = unit.character.hp = 10000
            unit.current_health = 1000
            unit.character.attack = 100
            unit.character.magic_attack = 200
            unit.character.defense = unit.character.magic_defense = 100
            unit._sync_legacy_health_fields()
        return battle, caster, party

    def cast(self, battle, caster, party, slot, enemies=(), lifecycle=False):
        skill = library(caster.character, include_drafts=True)[f'{caster.character.character_config_id}:{slot}']
        before = begin_cast(caster)
        result = supports.cast(battle, caster, skill, party, enemies)
        if lifecycle and result:
            end_cast(battle, caster, before)
        return result

    def tick(self, battle, unit):
        end_cast(battle, unit, begin_cast(unit))

    def shield_amount(self, unit):
        return sum(s['amount'] for s in states(unit) if s['kind'] == 'shield')

    def test_dispatch_is_effects_only_and_uses_config_not_instance_id(self):
        battle, caster, party = self.party(23)
        skill = library(caster.character, include_drafts=True)[caster.character.character_config_id + ':1']
        skill.use = Mock()
        old_log = len(battle.battle_log)
        states(caster).append(dict(kind='mark', name='sentinel', remaining=2, value=1))
        self.assertTrue(supports.cast(battle, caster, skill, party, []))
        skill.use.assert_not_called()
        self.assertEqual(len(battle.battle_log), old_log)
        self.assertEqual(states(caster)[0]['remaining'], 2)
        self.assertEqual(caster.current_health, 1220)
        caster.character.character_config_id = 'unknown'
        self.assertFalse(supports.cast(battle, caster, skill, party, []))

    def test_single_heals_ignore_dead_and_inactive_and_cap(self):
        for number, slot, ratio in [(15, 1, 2), (23, 1, 2.2), (39, 1, 1.8), (55, 2, 2.2)]:
            with self.subTest(number=number):
                battle, caster, party = self.party(number)
                party[1].current_health = 0
                party[2].current_health = 1
                party[2].mechanic_inactive = True
                party[3].current_health = 10
                self.cast(battle, caster, party, slot)
                self.assertEqual(party[3].current_health, 10 + int(100 * ratio))
                self.assertEqual(party[1].current_health, 0)
                self.assertEqual(party[2].current_health, 1)
                party[3].max_health = party[3].current_health + 1
                self.cast(battle, caster, party, slot)
                self.assertEqual(party[3].current_health, party[3].max_health)

    def test_all_heals_scale_by_fixed_party_order(self):
        for number, slot, amount in [(15, 2, 120), (23, 2, 120), (23, 3, 180),
                                      (39, 3, 250)]:
            with self.subTest(number=number, slot=slot):
                battle, caster, party = self.party(number, 20, 6)
                party[0].current_health = 0
                self.cast(battle, caster, party, slot)
                self.assertEqual(party[5].current_health, 1000 + amount)
                self.assertEqual(party[10].current_health, 1000 + amount // 2)
                if number != 23 or slot != 3:
                    self.assertEqual(party[0].current_health, 0)

    def test_mu_shield_break_creates_two_tick_hot_only_on_damage(self):
        battle, caster, party = self.party()
        target = party[1]
        target.current_health = 500
        self.cast(battle, caster, party, 1)
        self.assertEqual(self.shield_amount(target), 800)
        self.cast(battle, caster, party, 1)
        self.assertEqual(self.shield_amount(target), 800)
        self.assertFalse(any(s['kind'] == 'hot' for s in states(target)))
        target.take_damage(800, 0)
        self.assertEqual(target.current_health, 500)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 700)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 900)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 900)

    def test_mu_magic_scaling_heal_bonus_cashout_and_once_guard(self):
        battle, caster, party = self.party(7, 20)
        target = party[5]
        target.current_health = 100
        self.cast(battle, caster, party, 2)
        self.assertEqual(next(s['amount'] for s in states(target) if s['kind'] == 'hot'), 25)
        self.assertAlmostEqual(modifiers(target)['healing_received'], .1)
        self.cast(battle, caster, party, 3)
        self.assertEqual(target.current_health, 100 + 4400 + 55)
        self.assertFalse(any(s['kind'] == 'hot' for s in states(target)))
        target.take_damage(20000, 0)
        self.assertEqual(target.current_health, 1)
        target.take_damage(1, 0)
        self.assertTrue(target.is_dead())

    def test_mu_new_hot_does_not_tick_during_application_cast(self):
        battle, caster, party = self.party()
        self.cast(battle, caster, party, 2, lifecycle=True)
        self.assertEqual(caster.current_health, 1000)
        self.tick(battle, caster)
        self.assertEqual(caster.current_health, 1055)

    def test_gu_harden_moves_to_new_target_but_same_target_layers_stack(self):
        battle, caster, party = self.party(15)
        party[1].current_health = 100
        self.cast(battle, caster, party, 1)
        self.cast(battle, caster, party, 1)
        self.assertEqual(modifiers(party[1])['defense'], 30)
        party[2].current_health = 10
        self.cast(battle, caster, party, 1)
        self.assertEqual(modifiers(party[1]).get('defense', 0), 0)
        self.assertEqual(modifiers(party[2])['defense'], 15)

    def test_gu_resistance_affects_one_actual_hit_not_dot(self):
        battle, caster, party = self.party(15)
        target, source = party[1:3]
        source.character.attribute = Attribute(AttributeType.THUNDER)
        self.cast(battle, caster, party, 2)
        target.take_damage(0, 100, source=source, is_attack=False)
        self.assertEqual(target.current_health, 1040)
        target.take_damage(100, 0, source=source)
        self.assertEqual(target.current_health, 960)
        target.take_damage(100, 0, source=source)
        self.assertEqual(target.current_health, 860)

    def test_gu_break_heal_is_scaled_and_after_hit_not_overwrite_or_expiry(self):
        battle, caster, party = self.party(15, 20)
        self.cast(battle, caster, party, 3)
        target = party[5]
        self.assertEqual(self.shield_amount(target), 50)
        target.take_damage(100, 0)
        self.assertEqual(target.current_health, 1040)
        self.cast(battle, caster, party, 3)
        self.cast(battle, caster, party, 3)
        self.assertEqual(target.current_health, 1040)
        self.tick(battle, target)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 1040)

    def test_shield_break_cannot_resurrect_from_lethal_overflow(self):
        battle, caster, party = self.party(15)
        self.cast(battle, caster, party, 3)
        party[1].take_damage(50000, 0)
        self.assertTrue(party[1].is_dead())

    def test_yuan_debuffs_stack_expire_and_change_elemental_damage(self):
        battle, caster, party = self.party(16)
        target = party[1]
        self.cast(battle, caster, party, 1, [target])
        self.cast(battle, caster, party, 1, [target])
        self.assertEqual(modifiers(target)['defense'], -30)
        self.assertEqual(modifiers(target)['magic_defense'], -30)
        self.cast(battle, caster, party, 3, [target])
        self.assertEqual(modifiers(target)['attack'], -15)
        self.assertEqual(modifiers(target)['magic_attack'], -30)
        self.cast(battle, caster, party, 2, [target])
        caster.character.attribute = Attribute(AttributeType.EARTH)
        target.take_damage(100, 0, source=caster)
        self.assertEqual(target.current_health, 875)
        self.tick(battle, target)
        self.tick(battle, target)
        self.assertFalse(states(target))

    def test_nalan_revive_tank_then_oldest_with_once_battle_and_cross_ratio(self):
        battle, caster, party = self.party(23, 20)
        for index, time in [(1, 1), (5, 10), (6, 2)]:
            party[index].current_health = 0
            party[index].death_time = time
        for index in (5, 6):
            party[index].character.profession = Profession(ProfessionType.MAGIC_TANK)
        self.cast(battle, caster, party, 3)
        self.assertEqual(party[6].current_health, 2500)
        self.assertEqual(party[5].current_health, 0)
        party[6].current_health = 0
        self.cast(battle, caster, party, 3)
        self.assertTrue(all(party[i].is_dead() for i in (1, 5, 6)))
        supports.battle_end(battle)
        self.cast(battle, caster, party, 3)
        self.assertEqual(party[6].current_health, 2500)

    def test_nalan_oldest_nontank_and_local_revive(self):
        battle, caster, party = self.party(23)
        party[1].current_health = party[2].current_health = 0
        party[1].death_time, party[2].death_time = 2, 1
        self.cast(battle, caster, party, 3)
        self.assertEqual(party[2].current_health, 4000)
        self.assertEqual(party[1].current_health, 0)

    def test_lu_all_three_buffs_actual_modifier_values(self):
        battle, caster, party = self.party(24)
        foe = party[-1]
        self.cast(battle, caster, party[:-1], 1, [foe])
        self.cast(battle, caster, party[:-1], 2, [foe])
        self.cast(battle, caster, party[:-1], 3, [foe])
        self.assertAlmostEqual(modifiers(caster)['attack'], 30)
        self.assertEqual(modifiers(caster)['defense'], 20)
        self.assertAlmostEqual(modifiers(foe)['defense'], -30)
        self.assertEqual(modifiers(foe)['attack'], -20)

    def test_su_hot_and_shield_break_hot_scale_and_tick_exactly_twice(self):
        battle, caster, party = self.party(31, 20)
        party[1].current_health = 100
        self.cast(battle, caster, party, 1)
        self.assertEqual(party[1].current_health, 100)
        self.tick(battle, party[1])
        self.tick(battle, party[1])
        self.assertEqual(party[1].current_health, 500)
        self.cast(battle, caster, party, 2)
        self.tick(battle, party[5])
        self.assertEqual(party[5].current_health, 1060)
        self.cast(battle, caster, party, 3)
        self.assertEqual(self.shield_amount(party[5]), 40)
        party[5].take_damage(40, 0)
        self.tick(battle, party[5])
        self.assertEqual(party[5].current_health, 1180)
        self.tick(battle, party[5])
        self.assertEqual(party[5].current_health, 1240)

    def test_su_cleanse_only_six_types_and_preserves_mixed_other_components(self):
        battle, caster, party = self.party(31)
        target = party[1]
        states(target).extend([
            dict(kind='dot', name='poison', amount=10, remaining=2),
            dict(kind='stat', name='healing loss', stats=['healing_received'], value=-.2, remaining=2),
            dict(kind='stat', name='mixed', stats=['attack', 'healing_received'], value=-.1, remaining=2),
        ])
        self.cast(battle, caster, party, 2)
        self.assertEqual(len(states(target)), 4)
        self.assertEqual(modifiers(target).get('attack', 0), 0)
        self.assertAlmostEqual(modifiers(target)['healing_received'], -.3)
        self.assertTrue(any(s['kind'] == 'dot' for s in states(target)))

    def test_su_cleanse_each_of_six_and_legacy_status_id(self):
        for key in supports.SU_CLEANSE_STATS:
            with self.subTest(key=key):
                battle, caster, party = self.party(31)
                item = dict(kind='stat', name=key, stats=[key], remaining=2,
                            value=.2 if key == 'element_in_FIRE' else -.2)
                states(party[1]).append(item)
                self.cast(battle, caster, party, 2)
                self.assertFalse(any(s is item for s in states(party[1])))
        legacy = StatusEffect('legacy-id', '物攻降低', StatusType.DEBUFF, 10,
                              value=10, effect_type='attack_boost')
        party[1].status_manager.add_status(legacy)
        self.cast(battle, caster, party, 2)
        self.assertFalse(party[1].status_manager.status_effects)

    def test_su_remote_cleanse_max_five_and_local_all(self):
        battle, caster, party = self.party(31, 20)
        for i, target in enumerate(party):
            for j in range(2 if i >= 15 else 1):
                stat(target, caster, f'negative-{j}', ['defense'], -.1)
        self.cast(battle, caster, party, 2)
        self.assertEqual([supports._negative_count(u) for u in party], [0]*5 + [1]*15)

    def test_jiao_bound_hot_stops_on_break_and_includes_final_tick(self):
        battle, caster, party = self.party(39, 20)
        self.cast(battle, caster, party, 2)
        target = party[5]
        self.assertEqual(self.shield_amount(target), 50)
        self.tick(battle, target)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 1030)
        self.assertEqual(self.shield_amount(target), 0)
        self.cast(battle, caster, party, 2)
        target.take_damage(50, 0)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 1030)

    def test_jiao_cleanse_local_only_preserves_marks_and_permanent(self):
        battle, caster, party = self.party(39, 20)
        for target in party:
            states(target).extend([
                dict(kind='dot', name='ordinary', amount=10, remaining=2),
                dict(kind='dot', name='long', amount=10, remaining=None),
                dict(kind='mark', name='unique', value=1, unique_mark=True, remaining=2),
                dict(kind='stat', name='negative', stats=['attack'], value=-.2, remaining=2),
            ])
        self.cast(battle, caster, party, 3)
        self.assertEqual([s['name'] for s in states(party[1])], ['long', 'unique'])
        self.assertEqual(len(states(party[5])), 4)

    def test_health_max_buffs_add_not_compound_and_expire_with_clamp(self):
        for number, expected in [(32, 14000), (40, 13000)]:
            with self.subTest(number=number):
                battle, caster, party = self.party(number, 20)
                self.cast(battle, caster, party, 1)
                self.cast(battle, caster, party, 1)
                target = party[5]
                self.assertEqual(target.max_health, expected)
                self.assertEqual(target.current_health, 1000)
                target.current_health = expected
                self.tick(battle, target)
                self.tick(battle, target)
                self.assertEqual(target.max_health, 10000)
                self.assertEqual(target.current_health, 10000)

    def test_yicheng_tongdan_second_and_third_slots(self):
        for number in (32, 40):
            battle, caster, party = self.party(number)
            party[1].character.attack = 300
            foe = party[-1]
            self.cast(battle, caster, party[:-1], 2, [foe])
            self.assertEqual(modifiers(party[1])['defense'], 20)
            self.assertEqual(modifiers(party[1])['magic_defense'], 20)
            self.cast(battle, caster, party[:-1], 3, [foe])
            if number == 32:
                self.assertEqual(modifiers(party[1])['attack'], 60)
                self.assertEqual(modifiers(party[1])['magic_attack'], 40)
                self.assertEqual(modifiers(caster).get('attack', 0), 0)
            else:
                self.assertEqual(modifiers(party[1])['attack'], 75)
                self.assertEqual(modifiers(foe)['defense'], -20)

    def test_kong_targets_and_all_five_stats(self):
        battle, caster, party = self.party(47)
        party[1].character.attack = 300
        party[2].current_health = 9000
        self.cast(battle, caster, party, 1)
        self.cast(battle, caster, party, 2)
        self.assertEqual(modifiers(party[1])['attack'], 60)
        self.assertEqual(modifiers(party[2])['defense'], 25)
        self.assertTrue(self.cast(battle, caster, party, 3))
        self.assertEqual(caster.max_health, 11500)
        self.assertEqual(modifiers(caster)['magic_attack'], 30)
        self.assertEqual(modifiers(caster)['attack'], 15)
        self.assertEqual(modifiers(caster)['defense'], 15)
        self.assertEqual(modifiers(caster)['magic_defense'], 15)
        self.assertEqual(modifiers(caster).get('crit_rate', 0), 0)
        self.assertEqual(modifiers(caster).get('crit_damage', 0), 0)
        self.tick(battle, caster)
        self.assertEqual(caster.max_health, 11500)
        self.tick(battle, caster)
        self.assertEqual(caster.max_health, 10000)
        self.assertFalse(states(caster))

    def test_yin_all_abc_slots_draw_nine_pages_and_execute_matching_effect(self):
        for slot in (1, 2, 3):
            counts = {'枯': 0, '荣': 0, '莲子': 0}
            for index in range(9):
                battle, caster, party = self.party(48)
                with patch('src.skills.characters.supports.random.randrange', return_value=index):
                    self.assertTrue(self.cast(battle, caster, party, slot))
                page = battle.battle_log[-1]['payload']['page']
                counts[page] += 1
                self.assertEqual(len(supports.mark_layers(caster, '枯')), int(page != '荣'))
                self.assertEqual(len(supports.mark_layers(caster, '荣')), int(page != '枯'))
                self.assertEqual(self.shield_amount(caster), 15 if page == '莲子' else 0)
            self.assertEqual(counts, {'枯': 4, '荣': 4, '莲子': 1})

    def test_yin_explicit_rules_layers_cap_independent_clock_and_resonance(self):
        battle, caster, party = self.party(48, 20)
        roll = patch('src.skills.characters.supports.random.randrange', side_effect=[0, 0, 8, 0])
        roll.start()
        self.addCleanup(roll.stop)
        target = party[5]
        self.cast(battle, caster, party, 1)
        self.tick(battle, target)
        self.cast(battle, caster, party, 1)
        self.assertEqual([s['remaining'] for s in states(target)], [3, 4])
        self.cast(battle, caster, party, 3)
        self.cast(battle, caster, party, 1)
        self.assertEqual(len(supports.mark_layers(target, '枯')), 3)
        self.assertAlmostEqual(modifiers(target)['defense'], 15)
        self.assertEqual(modifiers(target)['attack'], 5)
        self.assertEqual(self.shield_amount(target), 22.5)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 1006)
        supports._cleanse(target)
        self.assertEqual(len(supports.mark_layers(target, '枯')), 3)

    def test_zhao_window_revives_on_death_only_once_and_expires(self):
        battle, caster, party = self.party(55, 20)
        self.cast(battle, caster, party, 3)
        party[5].take_damage(50000, 0)
        self.assertEqual(party[5].current_health, 2000)
        party[5].take_damage(50000, 0)
        self.assertTrue(party[5].is_dead())
        old = party[1].current_health
        self.cast(battle, caster, party, 3)
        self.assertEqual(party[1].current_health, old + 150)
        self.assertTrue(party[5].is_dead())
        battle, caster, party = self.party(55)
        self.cast(battle, caster, party, 3)
        self.tick(battle, caster)
        self.tick(battle, caster)
        party[1].take_damage(50000, 0)
        self.assertTrue(party[1].is_dead())

    def test_zhao_existing_dead_revive_and_hot_amount(self):
        battle, caster, party = self.party(55)
        party[1].current_health = 0
        self.cast(battle, caster, party, 3)
        self.assertEqual(party[1].current_health, 3000)
        self.assertEqual(party[2].current_health, 1000)
        self.cast(battle, caster, party, 1)
        self.tick(battle, party[2])
        self.assertEqual(party[2].current_health, 1040)

    def test_zhu_hot_healing_received_highest_max_target_and_bonus(self):
        battle, caster, party = self.party(56, 20)
        target = party[5]
        target.current_health = 100
        party[6].max_health = 20000
        self.cast(battle, caster, party, 1)
        self.assertAlmostEqual(modifiers(target)['healing_received'], .8)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 127)
        self.cast(battle, caster, party, 2)
        self.assertEqual(modifiers(party[6])['defense'], 50)
        self.assertEqual(modifiers(party[6])['magic_defense'], 50)
        self.cast(battle, caster, party, 3)
        self.assertEqual(self.shield_amount(target), 100)
        self.assertEqual(target.current_health, 172)
        self.assertEqual(party[6].current_health, 1025)
        self.assertEqual(party[7].current_health, 1000)

    def test_sikong_split_priority_and_twenty_person_override(self):
        for count, expected in [(5, 5000), (20, 2000)]:
            battle, caster, party = self.party(63, count)
            self.cast(battle, caster, party, 1)
            target = party[-1]
            self.assertEqual(self.shield_amount(target), expected)
            target.take_damage(100, 100)
            self.assertEqual(target.current_health, 900)
            self.assertEqual(self.shield_amount(target), expected - 100)
            self.cast(battle, caster, party, 2)
            target.take_damage(100, 100)
            self.assertEqual(target.current_health, 900)
            self.assertEqual(self.shield_amount(target), expected - 300)

    def test_sikong_conversion_consumes_all_sources_only_once_and_expires(self):
        battle, caster, party = self.party(63)
        target = party[1]
        shield(target, caster, 'one', 100)
        shield(target, party[2], 'two', 200)
        self.cast(battle, caster, party, 3)
        self.assertEqual(target.current_health, 1000)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 1300)
        self.assertEqual(self.shield_amount(target), 0)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 1300)
        shield(target, caster, 'later', 100)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 1300)

    def test_sikong_conversion_preserves_final_cast_shield_snapshot(self):
        battle, caster, party = self.party(63, 20)
        target = party[5]
        shield(target, caster, 'last-tick', 100, remaining=1)
        self.cast(battle, caster, party, 3)
        self.tick(battle, target)
        self.assertEqual(target.current_health, 1050)

    def test_qian_elemental_effects(self):
        battle, caster, party = self.party(64)
        target = party[1]
        self.cast(battle, caster, party, 1, [target])
        caster.character.attribute = Attribute(AttributeType.DARK)
        target.take_damage(100, 0, source=caster)
        self.assertEqual(target.current_health, 880)
        self.assertTrue(self.cast(battle, caster, party, 2))
        target.take_damage(100, 0, source=caster)
        self.assertEqual(target.current_health, 736)
        self.cast(battle, caster, party, 3)
        caster.character.attribute = Attribute(AttributeType.LIGHT)
        target.take_damage(100, 0, source=caster)
        self.assertEqual(target.current_health, 656)

    def test_qian_prioritizes_dark_dps_then_attack_and_ignores_dead(self):
        battle, caster, party = self.party(64)
        party[1].character.attribute = Attribute(AttributeType.DARK)
        party[1].character.profession = Profession(ProfessionType.MAGIC_MELEE_DPS)
        party[2].character.attack = 300
        party[3].character.attack = 1000
        party[3].current_health = 0
        self.cast(battle, caster, party, 2)
        self.assertEqual([modifiers(u).get('element_out_DARK', 0) for u in party], [0, .2, .2, 0, 0])
        battle, caster, party = self.party(64, 1)
        self.assertTrue(self.cast(battle, caster, party, 2))
        self.assertEqual(modifiers(caster)['element_out_DARK'], .2)


if __name__ == '__main__':
    unittest.main()
