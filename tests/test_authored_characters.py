import contextlib
import io
import unittest

from scripts.nest_battle_worker import character_from_snapshot
from src.combat.battle_unit import BattleUnit
from src.combat.battle import Battle
from src.combat.authored_monsters import begin_cast, end_cast, states, absorb_damage, modifiers
from src.skills.authored_characters import library
from src.attributes.attribute import Attribute, AttributeType


class AuthoredCharacterTests(unittest.TestCase):
    def test_tank_shield_defense_and_attack_reduction(self):
        battle, party = self.party(5)
        caster = party[0]
        config_id = 'char_017_thunder_physical_tank'
        caster.character.character_config_id = config_id
        caster.character.defense = 100
        skills = library(caster.character)
        battle._cast_skill(caster, skills[config_id + ':1'], [], party)
        self.assertEqual(states(caster)[0]['amount'], 2000)
        self.assertTrue(all(not states(other) for other in party[1:]))
        battle._cast_skill(caster, skills[config_id + ':2'], [], party)
        self.assertEqual(modifiers(caster)['defense'], 30)
        self.assertEqual(modifiers(caster).get('magic_defense', 0), 0)
        battle._cast_skill(caster, skills[config_id + ':3'], [], party)
        self.assertFalse(any(s['kind'] == 'shield' for s in states(caster)))
        before = caster.current_health
        caster.take_damage(100, 100)
        self.assertEqual(before - caster.current_health, 150)
        before = caster.current_health
        caster.take_damage(0, 100, is_attack=False)
        self.assertEqual(before - caster.current_health, 100)
        end_cast(battle, caster, begin_cast(caster))
        self.assertEqual(modifiers(caster).get('defense', 0), 0)
        self.assertTrue(any(s['kind'] == 'attack_reduction' for s in states(caster)))
        end_cast(battle, caster, begin_cast(caster))
        before = caster.current_health
        caster.take_damage(100, 100)
        self.assertEqual(before - caster.current_health, 200)

    def test_attack_reduction_precedes_shields_and_standard_buffs_stack(self):
        battle, party = self.party(5)
        caster = party[0]
        config_id = 'char_017_thunder_physical_tank'
        caster.character.character_config_id = config_id
        skills = library(caster.character)
        battle._cast_skill(caster, skills[config_id + ':3'], [], party)
        battle._cast_skill(caster, skills[config_id + ':3'], [], party)
        self.assertEqual(sum(s['value'] for s in states(caster)), .5)
        states(caster).append(dict(kind='shield', amount=100, remaining=2, source_skill='test'))
        before = caster.current_health
        caster.take_damage(100, 100)
        self.assertEqual(caster.current_health, before)
        self.assertFalse(any(s['kind'] == 'shield' for s in states(caster)))

    def test_tank_buffs_reduce_real_monster_hits(self):
        battle, party = self.party(5)
        target, attacker = party[:2]
        config_id = 'char_017_thunder_physical_tank'
        target.character.character_config_id = config_id
        target.character.defense = 100
        target.character.magic_defense = 100
        battle.damage_calculator.base_crit_rate = 0
        skills = library(target.character)
        battle._cast_skill(target, skills[config_id + ':2'], [], party)
        before = target.current_health
        battle.monster_runtime.apply(attacker, target, {'name':'physical hit'}, 0,
                                     {'kind':'damage', 'value':1, 'school':'physical'})
        self.assertEqual(before - target.current_health, 43)
        battle._cast_skill(target, skills[config_id + ':3'], [], party)
        before = target.current_health
        battle.monster_runtime.apply(attacker, target, {'name':'physical hit'}, 0,
                                     {'kind':'damage', 'value':1, 'school':'physical'})
        self.assertEqual(before - target.current_health, 32)

    def test_no_target_does_not_skip_cast_tier(self):
        battle, caster, enemies = self.damage_encounter('char_038_fire_magic_ranged_dps', 1)
        enemies[0].current_health = 1
        battle.current_time = 1
        battle._process_skill_casting(1)
        self.assertEqual(caster.skill_manager.current_tier_index, 1)
        battle.current_time = 2
        battle._process_skill_casting(1)
        self.assertEqual(caster.skill_manager.current_tier_index, 1)
        enemies[0].current_health = 10000
        battle.current_time = 3
        battle._process_skill_casting(1)
        self.assertEqual(caster.skill_manager.current_tier_index, 2)

    def damage_encounter(self, config_id, count):
        _, party = self.party(count + 1)
        caster, enemies = party[0], party[1:]
        caster.character.character_config_id = config_id
        attribute = 'FIRE' if '_fire_' in config_id else 'THUNDER' if '_thunder_' in config_id else 'LIGHT'
        for unit in party:
            unit.character.attribute = Attribute(AttributeType[attribute])
            unit.character.defense = unit.character.magic_defense = 0
            unit.current_health = unit.max_health = 10000
        caster.character.magic_attack = 100
        for unit in enemies:
            unit.is_player = False
        battle = Battle([caster], enemies)
        battle.damage_calculator.base_crit_rate = 0
        return battle, caster, enemies

    def test_damage_thresholds_snapshot_and_attack_scaling(self):
        for config_id, cases in [
            ('char_038_fire_magic_ranged_dps', [(1,560), (2,560), (3,280), (5,280), (10,280)]),
            ('char_020_thunder_magic_melee_dps', [(1,350), (2,350), (3,350), (5,350), (6,350), (7,250), (10,250)]),
        ]:
            for count, expected in cases:
                with self.subTest(config_id=config_id, count=count):
                    battle, caster, enemies = self.damage_encounter(config_id, count)
                    skill = library(caster.character)[config_id + ':3']
                    battle._cast_skill(caster, skill, enemies, [caster])
                    self.assertEqual([10000 - e.current_health for e in enemies], [expected] * count)
                    self.assertEqual(battle.damage_stats[caster.character.character_id]['physical_damage'], 0)

    def test_threshold_is_not_recalculated_after_aoe_kills(self):
        config_id = 'char_038_fire_magic_ranged_dps'
        battle, caster, enemies = self.damage_encounter(config_id, 3)
        enemies[0].current_health = 1
        battle._cast_skill(caster, library(caster.character)[config_id + ':3'], enemies, [caster])
        self.assertEqual(enemies[1].current_health, 9720)
        self.assertEqual(enemies[2].current_health, 9720)

    def test_damage_openers_and_second_skills(self):
        for config_id, ratios, all_targets in [
            ('char_038_fire_magic_ranged_dps', (1.5, 2.3), (True, False)),
            ('char_020_thunder_magic_melee_dps', (1, 2), (True, False)),
            ('char_051_light_physical_melee_dps', (1.6, 1.8), (True, True)),
        ]:
            for slot in (1, 2):
                with self.subTest(config_id=config_id, slot=slot):
                    battle, caster, enemies = self.damage_encounter(config_id, 2)
                    skill = library(caster.character)[f'{config_id}:{slot}']
                    battle._cast_skill(caster, skill, enemies, [caster])
                    amount = int(100 * ratios[slot - 1])
                    self.assertEqual(10000 - enemies[0].current_health, amount)
                    self.assertEqual(10000 - enemies[1].current_health, amount if all_targets[slot - 1] else 0)

    def test_dead_and_inactive_enemies_do_not_count_or_receive_damage(self):
        config_id = 'char_038_fire_magic_ranged_dps'
        battle, caster, enemies = self.damage_encounter(config_id, 4)
        enemies[2].current_health = 0
        enemies[3].mechanic_inactive = True
        battle._cast_skill(caster, library(caster.character)[config_id + ':3'], enemies, [caster])
        self.assertEqual([e.current_health for e in enemies], [9440, 9440, 0, 10000])

    def test_three_hits_count_as_one_cast_and_do_not_retarget_after_death(self):
        config_id = 'char_051_light_physical_melee_dps'
        battle, caster, enemies = self.damage_encounter(config_id, 2)
        enemies[1].current_health = 9999
        states(caster).append(dict(kind='shield', amount=100, remaining=2, source_skill='test'))
        skill = library(caster.character)[config_id + ':3']
        battle._cast_skill(caster, skill, enemies, [caster])
        self.assertEqual(enemies[0].current_health, 9400)
        self.assertEqual(enemies[1].current_health, 9999)
        self.assertEqual(states(caster)[0]['remaining'], 1)
        enemies[0].current_health, enemies[1].current_health = 150, 100
        battle._cast_skill(caster, skill, enemies, [caster])
        self.assertEqual(enemies[0].current_health, 0)
        self.assertEqual(enemies[1].current_health, 100)
        self.assertEqual(states(caster), [])

    def setUp(self):
        output = contextlib.redirect_stdout(io.StringIO())
        output.__enter__()
        self.addCleanup(output.__exit__, None, None, None)

    def party(self, count):
        party = [BattleUnit(character_from_snapshot({
            'id': f'p{i}', 'characterConfigId': 'char_008_water_support',
            'attributeType': 'WATER', 'professionType': 'SUPPORT', 'level': 1,
        })) for i in range(count)]
        battle = Battle(party, [])
        for unit in party:
            unit.max_health = 10000
            unit.current_health = 1000
            unit.character.attack = 100
        return battle, party

    def cast(self, battle, caster, slot):
        skill = library(caster.character)[f'char_008_water_support:{slot}']
        battle._cast_skill(caster, skill, [], battle.player_units)

    def test_lowest_current_health_heal_ignores_dead_and_caps(self):
        battle, party = self.party(5)
        party[1].current_health = 0
        party[2].current_health = 100
        party[2].max_health = 200
        self.cast(battle, party[0], 1)
        self.assertEqual(party[1].current_health, 0)
        self.assertEqual(party[2].current_health, 200)
        self.assertEqual(party[3].current_health, 1000)

    def test_aoe_healing_and_shield_squad_scaling(self):
        for count in (5, 20):
            with self.subTest(count=count):
                battle, party = self.party(count)
                self.cast(battle, party[0], 3)
                self.cast(battle, party[0], 2)
                for i, unit in enumerate(party):
                    self.assertEqual(unit.current_health, 1220 if i < 5 else 1110)
                    self.assertEqual(states(unit)[0]['amount'], 100 if i < 5 else 50)
                    self.assertEqual(states(unit)[0]['remaining'], 2)

    def test_shields_overwrite_by_source_share_damage_and_expire_on_owner_casts(self):
        battle, party = self.party(5)
        caster, other, target = party[:3]
        self.cast(battle, caster, 2)
        self.cast(battle, caster, 2)
        self.assertEqual(len(states(target)), 1)
        self.cast(battle, other, 2)
        self.assertEqual(len(states(target)), 2)
        self.assertEqual(absorb_damage(target, 100), 0)
        self.assertEqual([s['amount'] for s in states(target)], [50, 50])
        battle.current_time = 100
        self.assertEqual([s['remaining'] for s in states(target)], [2, 2])
        end_cast(battle, target, begin_cast(target))
        self.assertEqual([s['remaining'] for s in states(target)], [1, 1])
        end_cast(battle, target, begin_cast(target))
        self.assertEqual(states(target), [])

    def test_default_loadout_executes_real_authored_skills(self):
        battle, party = self.party(5)
        caster = party[0]
        slots = caster.skill_manager
        self.assertEqual(len(slots.low_tier_slots.skills), 5)
        for t in range(1, 31):
            skill = slots.get_next_skill(t)
            self.assertTrue(hasattr(skill, 'authored_effect'))
            battle._cast_skill(caster, skill, [], party)
        self.assertTrue(any(row.get('event_type') == 'skill' for row in battle.battle_log))
