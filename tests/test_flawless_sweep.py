from src.dungeons.dungeon_database import get_dungeon_database
from src.dungeons.dungeon_progress import DungeonProgressManager
from src.dungeons.dungeon import DungeonType
from src.dungeons.dungeon_reward import RewardCalculator


def test_sweep_requirements():
    manager = DungeonProgressManager("sweep-test")
    for dungeon in get_dungeon_database().get_all_dungeons():
        progress = manager.get_progress(dungeon.dungeon_id)
        if dungeon.dungeon_type == DungeonType.SQUAD:
            for _ in range(10):
                progress.add_attempt(True, 60, is_solo=False, no_deaths=True)
            assert not manager.can_sweep_dungeon(dungeon)
        required = 5 if dungeon.dungeon_type == DungeonType.SQUAD else 10
        for _ in range(required - 1):
            progress.add_attempt(True, 60, no_deaths=dungeon.dungeon_type not in (DungeonType.SINGLE, DungeonType.SQUAD))
        assert not manager.can_sweep_dungeon(dungeon)
        progress.add_attempt(False, 60, no_deaths=True)
        assert not manager.can_sweep_dungeon(dungeon)
        progress.add_attempt(True, 60, no_deaths=True)
        assert manager.can_sweep_dungeon(dungeon)


def test_boss_materials():
    for dungeon in get_dungeon_database().get_all_dungeons():
        if dungeon.dungeon_type not in (DungeonType.SQUAD, DungeonType.TEAM):
            continue
        partial = RewardCalculator.calculate_reward(dungeon, 60, 0, bosses_killed=2)
        assert partial.rewards["material_count"] == 2
        complete = RewardCalculator.calculate_reward(dungeon, 60, 0, bosses_killed=4, is_completed=True)
        assert complete.rewards["material_count"] == 6
