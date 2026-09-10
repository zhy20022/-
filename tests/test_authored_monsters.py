"""Regression tests for authored monster configuration and battle semantics."""

import json
import random
import unittest
from contextlib import redirect_stdout
from io import StringIO

from src.attributes.attribute import AttributeType
from src.combat.authored_monsters import begin_cast, end_cast, modifiers, states
from src.combat.battle import Battle
from src.combat.skill_system import Skill, SkillLogic, SkillTier, SkillTargetType
from src.dungeons.dungeon import Dungeon, DungeonType
from src.dungeons.dungeon_battle import DungeonBattleFlow
from src.enemies.authored_catalog import EXPERIENCE, SQUAD, TEAM, WORLD, encounters, skill, effect, shield, stat
from src.enemies.enemy import Enemy


def unit(name, player=False, hp=10000):
    result = Enemy(name, name, AttributeType.WATER, 1, hp, 100, 100, 100, 100).battle_unit
    result.is_player = player
    return result


def setup_encounter(definition, players=5):
    party = [unit(f"p{i}", True) for i in range(players)]
    enemies = [unit(f"e{i}") for i, _ in enumerate(definition.get("members", [definition]))]
    battle = Battle(party, enemies)
    battle.monster_runtime.rng = random.Random(17)
    definition = dict(interval=4, **definition) if "interval" not in definition else definition
    for enemy, member in zip(enemies, definition.get("members", [definition])):
        battle.monster_runtime.attach(enemy, member, definition["interval"])
    battle.monster_runtime.add_group(enemies, definition)
    return battle


class AuthoredMonsterTests(unittest.TestCase):
    def setUp(self):
        output = redirect_stdout(StringIO())
        output.__enter__()
        self.addCleanup(output.__exit__, None, None, None)

    def test_all_64_definitions_execute_every_phase_and_serialize(self):
        count = 0
        for table in (EXPERIENCE, SQUAD, TEAM, WORLD):
            for entries in table.values():
                for definition in entries if isinstance(entries, list) else [entries]:
                    count += 1
                    with self.subTest(name=definition["name"]):
                        battle = setup_encounter(definition)
                        for enemy in list(battle.enemy_units):
                            for phase in enemy.authored_monster["phases"]:
                                for item in phase:
                                    battle.monster_runtime.cast(enemy, item)
                            if enemy.authored_monster.get("death_skill"):
                                enemy.current_health = 0
                                battle._on_enemy_killed(enemy)
                            json.dumps(enemy.to_dict(), default=str)
                        common = definition.get("common")
                        if common:
                            battle.monster_runtime.cast(battle.enemy_units[0], common, triggered=True)
        self.assertEqual(count, 64)

    def test_dot_ticks_only_on_next_two_casts(self):
        battle = setup_encounter(WORLD["FIRE"])
        caster, target = battle.enemy_units[0], battle.player_units[0]
        spell = skill("test", effect("dot", "single", 1, casts=2))
        battle.monster_runtime.cast(caster, spell)
        self.assertEqual(target.current_health, target.max_health)
        before = target.current_health
        end_cast(battle, target, begin_cast(target))
        self.assertLess(target.current_health, before)
        before = target.current_health
        end_cast(battle, target, begin_cast(target))
        self.assertLess(target.current_health, before)
        self.assertEqual(states(target), [])
        before = target.current_health
        end_cast(battle, target, begin_cast(target))
        self.assertEqual(target.current_health, before)

    def test_self_application_does_not_consume_cast(self):
        battle = setup_encounter(WORLD["FIRE"])
        boss = battle.enemy_units[0]
        battle.monster_runtime.cast(boss, skill("self", stat("attack", .2)))
        self.assertEqual(states(boss)[0]["remaining"], 2)

    def test_layer_duration_not_refreshed_at_cap(self):
        battle = setup_encounter(WORLD["FIRE"])
        caster, target = battle.enemy_units[0], battle.player_units[0]
        spell = skill("stack", stat("defense", -.05, "single", cap=9, stacks=3))
        for _ in range(3):
            battle.monster_runtime.cast(caster, spell)
        self.assertEqual(len(states(target)), 9)
        end_cast(battle, target, begin_cast(target))
        battle.monster_runtime.cast(caster, spell)
        self.assertEqual(len(states(target)), 9)
        self.assertTrue(all(s["remaining"] == 1 for s in states(target)))
        end_cast(battle, target, begin_cast(target))
        self.assertEqual(states(target), [])

    def test_shields_replace_same_source_and_absorb_proportionally(self):
        battle = setup_encounter(WORLD["FIRE"])
        boss = battle.enemy_units[0]
        for _ in range(2):
            battle.monster_runtime.cast(boss, skill("shield1", shield(.2)), triggered=True)
        battle.monster_runtime.cast(boss, skill("shield2", shield(.1)), triggered=True)
        self.assertEqual(len(states(boss)), 2)
        boss.take_damage(1500, 0)
        self.assertEqual(boss.current_health, boss.max_health)
        self.assertEqual([s["amount"] for s in states(boss)], [1000, 500])

    def test_hp_attack_cannot_bypass_shield(self):
        battle = setup_encounter(WORLD["WATER"])
        boss, player = battle.enemy_units[0], battle.player_units[0]
        battle.monster_runtime.apply(boss, player, skill("guard"), 0, effect("shield", value=.7))
        battle.monster_runtime.cast(boss, WORLD["WATER"]["phases"][0][8])
        self.assertEqual(player.current_health, player.max_health)
        self.assertAlmostEqual(states(player)[0]["amount"], 1000)

    def test_shared_pool_heals_once_and_fuses_one_unit(self):
        battle = setup_encounter(TEAM["WATER"][1])
        first, second = battle.enemy_units
        first.take_damage(5000, 0)
        self.assertEqual(first.current_health, second.current_health)
        battle.monster_runtime.cast(first, skill("heal", effect("heal", "allies", .1)), triggered=True)
        self.assertEqual(first.current_health, 17000)
        first.take_damage(12000, 0)
        battle.monster_runtime.refresh_groups()
        self.assertEqual(len(battle.enemy_units), 1)
        self.assertEqual(first.current_health, 9000)
        first.take_damage(4000, 0)
        battle.monster_runtime.refresh_groups()
        self.assertEqual(first.current_health, 5000)
        self.assertTrue(second.authored_retired)

    def test_phase_crossing_is_latched_before_healing(self):
        battle = setup_encounter(TEAM["EARTH"][0])
        boss = battle.enemy_units[0]
        boss.take_damage(7000, 0)
        self.assertEqual(boss.authored_phase, 2)
        boss.heal(7000, 0)
        battle.current_time = 4
        battle.monster_runtime.step(boss)
        self.assertEqual(boss.authored_phase, 2)
        cast = next(log for log in reversed(battle.battle_log) if log["event_type"] == "boss_skill")
        self.assertEqual(cast["payload"]["skill_name"], "地龙翻身")

    def test_guard_releases_when_partner_dies(self):
        battle = setup_encounter(TEAM["DARK"][1])
        low, high = battle.enemy_units
        low.take_damage(5000, 0)
        low.take_damage(5000, 0)
        self.assertEqual(low.current_health, 5000)
        high.take_damage(10000, 0)
        low.take_damage(5000, 0)
        self.assertTrue(low.is_dead())

    def test_permanent_growth_is_additive(self):
        battle = setup_encounter(WORLD["LIGHT"])
        boss = battle.enemy_units[0]
        for _ in range(10):
            battle.monster_runtime.cast(boss, WORLD["LIGHT"]["phases"][0][4])
        self.assertAlmostEqual(modifiers(boss)["attack"], 50)

    def test_death_explosion_once(self):
        battle = setup_encounter(EXPERIENCE["FIRE"][0])
        boss = battle.enemy_units[0]
        boss.current_health = 0
        battle._on_enemy_killed(boss)
        health = battle.player_units[0].current_health
        self.assertLess(health, 10000)
        battle._on_enemy_killed(boss)
        self.assertEqual(battle.player_units[0].current_health, health)

    def test_world_nine_skill_order(self):
        battle = setup_encounter(WORLD["EARTH"])
        boss = battle.enemy_units[0]
        for tick in range(1, 19):
            battle.current_time = tick * 4
            battle.monster_runtime.step(boss)
        casts = [log["payload"]["skill_name"] for log in battle.battle_log if log["event_type"] == "boss_skill"]
        self.assertEqual(casts, [s["name"] for s in WORLD["EARTH"]["phases"][0]] * 2)

    def test_real_player_cast_consumes_dot_and_records_only_positive_damage(self):
        battle = setup_encounter(WORLD["FIRE"], players=1)
        boss, player = battle.enemy_units[0], battle.player_units[0]
        battle.monster_runtime.cast(boss, skill("dot", effect("dot", "single", .5, casts=2)))
        attack = Skill("test", "test", SkillLogic.A, SkillTier.LOW, 0, 1, 1, 0, SkillTargetType.SINGLE)
        before = player.current_health
        battle._cast_skill(player, attack, [boss], [player])
        self.assertLess(player.current_health, before)
        self.assertEqual(states(player)[0]["remaining"], 1)
        recorded = sum(row["total_damage"] for row in battle.damage_stats.values())
        boss.heal(1000, 0)
        self.assertEqual(recorded, sum(row["total_damage"] for row in battle.damage_stats.values()))

    def test_shared_lethal_reports_each_member_once(self):
        battle = setup_encounter(TEAM["WATER"][1], players=0)
        callbacks = []
        battle.set_enemy_killed_callback(lambda dead: callbacks.append(dead.character.character_id))
        battle.enemy_units[0].take_damage(50000, 0)
        battle._process_skill_casting(1)
        battle._process_skill_casting(1)
        self.assertEqual(len(callbacks), 2)
        self.assertEqual(len(set(callbacks)), 2)

    def test_sequential_activation_and_rotation(self):
        battle = setup_encounter(TEAM["DARK"][2])
        first, second, third = battle.enemy_units
        self.assertTrue(second.mechanic_inactive)
        second.take_damage(99999, 0)
        self.assertEqual(second.current_health, second.max_health)
        first.take_damage(99999, 0)
        battle.monster_runtime.refresh_groups()
        self.assertFalse(second.mechanic_inactive)
        self.assertTrue(third.mechanic_inactive)
        rotating = setup_encounter(TEAM["EARTH"][2])
        self.assertEqual(states(rotating.enemy_units[0])[0]["stats"], ["attack"])
        rotating.current_time = 30
        rotating.monster_runtime.refresh_groups()
        self.assertEqual(states(rotating.enemy_units[0])[0]["stats"], ["magic_attack"])

    def test_visual_summons_add_no_units(self):
        battle = setup_encounter(WORLD["DARK"])
        boss = battle.enemy_units[0]
        battle.monster_runtime.cast(boss, WORLD["DARK"]["phases"][0][7])
        self.assertEqual(battle.enemy_units, [boss])

    def test_bound_shield_buff_never_multiplies_on_recast(self):
        battle = setup_encounter(WORLD["WATER"])
        boss = battle.enemy_units[0]
        spell = WORLD["WATER"]["phases"][0][2]
        for _ in range(3):
            battle.monster_runtime.cast(boss, spell)
        self.assertAlmostEqual(modifiers(boss)["defense"], 40)
        boss.take_damage(2000, 0)
        self.assertEqual(modifiers(boss).get("defense", 0), 0)

    def test_dungeon_spawn_uses_authored_catalog(self):
        for category in (DungeonType.SQUAD, DungeonType.TEAM, DungeonType.SERVER_BOSS):
            dungeon = Dungeon("test", "test", AttributeType.WIND, category)
            flow = DungeonBattleFlow(dungeon, [])
            flow.battle = Battle([], [])
            flow._spawn_boss({})
            self.assertTrue(all(u.authored_monster for u in flow.battle.enemy_units))
            self.assertTrue(all(u.character.attribute.attribute_type == AttributeType.FIRE for u in flow.battle.enemy_units))
        self.assertEqual(encounters("SINGLE", "WATER")[0]["name"], "石灵丸")

    def test_named_group_kills_use_type_not_display_name(self):
        flow = DungeonBattleFlow(Dungeon('probe', 'probe', AttributeType.WIND, DungeonType.SINGLE), [])
        flow._maybe_generate_runtime_drop = lambda dead: None
        group_unit = unit('丹焰稚雀')
        group_unit.spawn_category = 'monster'
        group_unit.exp_kill_unit_type = 'group'
        flow._on_enemy_killed(group_unit)
        boss = unit('离火庭王')
        boss.spawn_category = 'boss'
        flow._on_enemy_killed(boss)
        self.assertEqual(flow.group_monsters_killed, 1)
        self.assertEqual(flow.single_monsters_killed, 0)
        self.assertEqual(flow.bosses_killed, 1)


if __name__ == "__main__":
    unittest.main()
