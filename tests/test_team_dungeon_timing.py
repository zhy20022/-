"""Production schedule, wave-boundary lifecycle and encounter budget regressions."""
import contextlib
import unittest
from unittest.mock import patch

from scripts.nest_battle_worker import character_from_snapshot, DiscardOutput
from scripts.audit_team_dungeon_balance import roster
from src.attributes.attribute import AttributeType
from src.combat.battle import Battle, BattleState
from src.dungeons.dungeon import Dungeon, DungeonDifficulty, DungeonType
from src.dungeons.dungeon_battle import DungeonBattleFlow, DungeonBattleState
from src.dungeons.dungeon_database import DungeonDatabase
from src.dungeons.dungeon_monster import MonsterSpawner
from src.dungeons.team_balance import team_config
from src.enemies.authored_catalog import encounters
from src.enemies.enemy_factory import EnemyFactory


class TeamDungeonTimingTests(unittest.TestCase):
    def test_all_attributes_and_difficulties_have_one_reachable_encounter(self):
        db = DungeonDatabase()
        for dungeon in db.get_all_dungeons(include_difficulties=True):
            if dungeon.dungeon_type not in (DungeonType.SQUAD, DungeonType.TEAM):
                continue
            with self.subTest(dungeon=dungeon.dungeon_id):
                spawner = MonsterSpawner(dungeon)
                self.assertEqual(dungeon.duration, team_config(dungeon.dungeon_type)['duration'])
                self.assertEqual(spawner.spawn_times, list(range(60)))
                self.assertEqual(spawner.boss_spawn_times, [60])
                self.assertLess(60, dungeon.duration)
                spawns = spawner.get_monster_spawns(60, 59.75)
                self.assertEqual([s['type'] for s in spawns], ['boss'])
                self.assertEqual(spawner.get_monster_spawns(dungeon.duration, 60), [])

    def test_boss_budget_is_not_changed_by_spawn_time_and_scales_with_difficulty(self):
        for kind in (DungeonType.SQUAD, DungeonType.TEAM):
            dungeon = Dungeon('test', 'test', AttributeType.WIND, kind)
            early = EnemyFactory.create_boss(dungeon, 'SINGLE', 60)
            late = EnemyFactory.create_boss(dungeon, 'SINGLE', 195)
            self.assertEqual(early.base_hp, late.base_hp)
            self.assertEqual(early.level, 100)
            dungeon.difficulty = DungeonDifficulty.HARD
            hard = EnemyFactory.create_boss(dungeon, 'SINGLE', 60)
            self.assertEqual(hard.base_hp, int(early.base_hp * 1.6))

    def flow(self, kind=DungeonType.SQUAD):
        dungeon = Dungeon('test', 'test', AttributeType.WIND, kind, duration=team_config(kind)['duration'])
        flow = DungeonBattleFlow(dungeon, [character_from_snapshot(roster('WIND', 5)[0])])
        flow._calculate_rewards = lambda: None
        with contextlib.redirect_stdout(DiscardOutput()):
            flow._start_actual_battle()
        return flow

    def test_wave_gap_does_not_finalize_character_effects(self):
        flow = self.flow()
        for enemy in flow.battle.enemy_units:
            enemy.current_health = 0
        with contextlib.redirect_stdout(DiscardOutput()):
            flow.update(.25)
        self.assertEqual(flow.battle.state, BattleState.IN_PROGRESS)
        self.assertFalse(getattr(flow.battle, '_effects_finalized', False))

    def test_last_spawn_boundary_is_not_a_transient_victory(self):
        flow = self.flow()
        for enemy in flow.battle.enemy_units:
            enemy.current_health = 0
        flow.current_time = flow.battle.current_time = 59.75
        flow.last_spawn_check_time = 59.75
        with contextlib.redirect_stdout(DiscardOutput()):
            flow.update(.25)
        self.assertTrue(any(getattr(e, 'spawn_category', '') == 'boss' for e in flow.battle.enemy_units))
        self.assertFalse(getattr(flow.battle, '_effects_finalized', False))
        self.assertEqual(flow.battle.state, BattleState.IN_PROGRESS)

    def test_every_authored_encounter_has_one_shared_health_budget(self):
        for kind in (DungeonType.SQUAD, DungeonType.TEAM):
            for attribute in AttributeType:
                for definition in encounters(kind.name, attribute.name):
                    dungeon = Dungeon('test', 'test', attribute, kind)
                    flow = DungeonBattleFlow(dungeon, [])
                    flow.battle = Battle([], [])
                    tuning = team_config(kind)['encounterMultipliers'].get(definition['name'], {})
                    expected = team_config(kind)['bossStats']['base_hp'] * tuning.get('health', 1)
                    with patch('src.enemies.authored_catalog.encounters', return_value=[definition]), contextlib.redirect_stdout(DiscardOutput()):
                        flow._spawn_authored_boss()
                    pool = flow.battle.monster_runtime.groups[0].get('pool')
                    budget = pool.maximum if pool else sum(u.max_health for u in flow.battle.enemy_units)
                    self.assertAlmostEqual(budget, expected, delta=4)

    def test_timeout_fails_with_enemy_and_allows_early_clear(self):
        for alive in (True, False):
            flow = self.flow()
            flow.monster_spawner.spawn_times = []
            flow.monster_spawner.boss_spawn_times = []
            if not alive:
                for enemy in flow.battle.enemy_units:
                    enemy.current_health = 0
            with contextlib.redirect_stdout(DiscardOutput()):
                if alive:
                    flow.current_time = flow.dungeon.duration
                    flow._on_timeout()
                else:
                    flow.update(.25)
            self.assertEqual(flow.is_successful, not alive)
            self.assertEqual(flow.state, DungeonBattleState.REWARD)
            self.assertTrue(getattr(flow.battle, '_effects_finalized', False))


if __name__ == '__main__':
    unittest.main()
