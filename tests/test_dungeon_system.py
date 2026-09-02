"""
副本系统测试
"""

import sys
import os

# 添加项目根目录到路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from src.dungeons.dungeon_database import EXPERIENCE_REWARD_BY_DIFFICULTY, get_dungeon_database, get_dungeon_by_id
from src.dungeons.dungeon import DungeonDifficulty
from src.dungeons.dungeon import DungeonType
from src.dungeons.dungeon_progress import DungeonProgressManager
from src.dungeons.dungeon_reward import RewardCalculator
from src.attributes.attribute import AttributeType
from src.dungeons.dungeon_battle import distribute_quantity_evenly


def test_dungeon_database():
    """测试副本数据库"""
    print("=" * 60)
    print("副本数据库测试")
    print("=" * 60)
    
    # 获取副本数据库
    db = get_dungeon_database()
    
    # 获取所有副本
    all_dungeons = db.get_all_dungeons()
    print(f"\n总副本数量: {len(all_dungeons)}")
    assert len(all_dungeons) == 32, f"应该有32个副本，实际有{len(all_dungeons)}个"
    
    # 获取火系副本
    fire_dungeons = db.get_dungeons_by_attribute(AttributeType.FIRE)
    print(f"\n火系副本数量: {len(fire_dungeons)}")
    assert len(fire_dungeons) == 4, f"火系应该有4个副本，实际有{len(fire_dungeons)}个"
    
    # 获取1人本
    single_dungeons = db.get_dungeons_by_type(DungeonType.SINGLE)
    print(f"\n1人本数量: {len(single_dungeons)}")
    assert len(single_dungeons) == 8, f"1人本应该有8个，实际有{len(single_dungeons)}个"
    
    # 获取5人本
    squad_dungeons = db.get_dungeons_by_type(DungeonType.SQUAD)
    print(f"\n5人本数量: {len(squad_dungeons)}")
    assert len(squad_dungeons) == 8, f"5人本应该有8个，实际有{len(squad_dungeons)}个"
    
    # 获取20人本
    team_dungeons = db.get_dungeons_by_type(DungeonType.TEAM)
    print(f"\n20人本数量: {len(team_dungeons)}")
    assert len(team_dungeons) == 8, f"20人本应该有8个，实际有{len(team_dungeons)}个"
    
    # 获取世界boss本
    server_dungeons = db.get_dungeons_by_type(DungeonType.SERVER_BOSS)
    print(f"\n世界boss本数量: {len(server_dungeons)}")
    assert len(server_dungeons) == 8, f"世界boss本应该有8个，实际有{len(server_dungeons)}个"
    
    # 显示火系副本
    print("\n火系副本列表:")
    for dungeon in fire_dungeons:
        print(f"  - {dungeon.get_display_name()}")
        print(f"    描述: {dungeon.description}")
        print(f"    时长: {dungeon.duration}秒")
    
    print("\n[OK] 副本数据库测试通过")


def test_eight_attribute_experience_dungeon_rules():
    """测试8系经验本配置规则"""
    expected = {
        "fire_type_single_001": AttributeType.FIRE,
        "wood_type_single_001": AttributeType.WOOD,
        "wind_type_single_001": AttributeType.WIND,
        "water_type_single_001": AttributeType.WATER,
        "earth_type_single_001": AttributeType.EARTH,
        "lightning_type_single_001": AttributeType.THUNDER,
        "holy_type_single_001": AttributeType.LIGHT,
        "shadow_type_single_001": AttributeType.DARK,
    }
    for dungeon_id, attribute in expected.items():
        dungeon = get_dungeon_by_id(dungeon_id)
        assert dungeon is not None, f"{dungeon_id} 应该存在"
        assert dungeon.dungeon_type == DungeonType.SINGLE
        assert dungeon.attribute_type == attribute
        assert dungeon.duration == 60.0
        assert dungeon.reward_config["type"] == "experience"
        assert dungeon.reward_config["target_full_clear_exp"] == EXPERIENCE_REWARD_BY_DIFFICULTY[DungeonDifficulty.NORMAL]
        assert dungeon.reward_config["character_exp_per_single_kill"] == 0.1
        assert dungeon.reward_config["character_exp_per_five_group_kills"] == 0.1
        assert dungeon.monster_config["spawn_interval"] == 3.0
        assert dungeon.monster_config["spawn_wave_count"] == 20
        assert dungeon.monster_config["allowed_monster_types"] == ["SINGLE", "GROUP_5"]


def test_dungeon_unlock():
    """测试副本解锁条件"""
    print("\n" + "=" * 60)
    print("副本解锁条件测试")
    print("=" * 60)
    
    # 获取1人本
    dungeon = get_dungeon_by_id("fire_type_single_001")
    assert dungeon is not None
    
    # 测试1人本解锁（无条件）
    player_data = {"is_solo": True, "characters": []}
    can_enter = dungeon.check_unlock_condition(player_data)
    assert can_enter, "1人本应该无条件解锁"
    print("\n[OK] 1人本解锁测试通过")
    
    # 测试5人本解锁（需要满级角色）
    dungeon = get_dungeon_by_id("fire_type_squad_001")
    assert dungeon is not None
    
    # 单人模式：需要5个满级角色
    player_data = {
        "is_solo": True,
        "characters": [
            {"level": 100, "attribute": "火"},
            {"level": 100, "attribute": "火"},
            {"level": 100, "attribute": "火"},
            {"level": 100, "attribute": "火"},
            {"level": 100, "attribute": "火"},
        ]
    }
    can_enter = dungeon.check_unlock_condition(player_data)
    assert can_enter, "5人本应该可以进入（有5个满级角色）"
    print("[OK] 5人本解锁测试通过（单人，5个满级角色）")
    
    # 测试20人本解锁
    dungeon = get_dungeon_by_id("fire_type_team_001")
    assert dungeon is not None
    
    # 需要对应属性5个不同职业的满级角色，且通关过对应属性的5人本
    player_data = {
        "is_solo": True,
        "characters": [
            {"level": 100, "attribute": "火", "profession": "物理坦克"},
            {"level": 100, "attribute": "火", "profession": "物理近战输出"},
            {"level": 100, "attribute": "火", "profession": "法系坦克"},
            {"level": 100, "attribute": "火", "profession": "治疗"},
            {"level": 100, "attribute": "火", "profession": "辅助"},
        ],
        "completed_dungeons": ["fire_type_squad_001"]
    }
    can_enter = dungeon.check_unlock_condition(player_data)
    assert can_enter, "20人本应该可以进入（有5个不同职业的满级角色，且通关过5人本）"
    print("[OK] 20人本解锁测试通过")


def test_dungeon_reward():
    """测试副本奖励系统"""
    print("\n" + "=" * 60)
    print("副本奖励系统测试")
    print("=" * 60)
    
    # 测试1人本奖励
    dungeon = get_dungeon_by_id("fire_type_single_001")
    reward = RewardCalculator.calculate_reward(
        dungeon=dungeon,
        duration=60.0,  # 坚持1分钟
        monsters_killed=10,  # 击杀了10个小怪
        groups_killed=5,  # 击杀了5组群体小怪
        bosses_killed=0,
        is_completed=True
    )
    
    print(f"\n1人本奖励: {reward.rewards}")
    assert reward.reward_type == "experience", "1人本应该奖励经验"
    assert reward.rewards["exp"] > 10, "应该获得超过10点经验"
    print("[OK] 1人本奖励测试通过")
    
    # 测试5人本奖励
    dungeon = get_dungeon_by_id("fire_type_squad_001")
    reward = RewardCalculator.calculate_reward(
        dungeon=dungeon,
        duration=120.0,  # 坚持2分钟
        monsters_killed=0,
        groups_killed=0,
        bosses_killed=1,  # 击杀了1个Boss
        is_completed=True
    )
    
    print(f"\n5人本奖励: {reward.rewards}")
    assert reward.reward_type == "exclusive_material", "5人本应该奖励专属道具材料"
    assert reward.rewards["material_count"] >= 20, "应该获得至少20个材料"
    print("[OK] 5人本奖励测试通过")
    
    # 测试20人本奖励
    dungeon = get_dungeon_by_id("fire_type_team_001")
    reward = RewardCalculator.calculate_reward(
        dungeon=dungeon,
        duration=180.0,  # 坚持3分钟
        monsters_killed=0,
        groups_killed=0,
        bosses_killed=1,  # 击杀了1个Boss（5%概率掉落）
        is_completed=True
    )
    
    print(f"\n20人本奖励: {reward.rewards}")
    assert reward.reward_type == "equipment_material", "20人本应该奖励装备材料"
    assert reward.rewards["material_count"] >= 1, "应该获得至少1个装备材料"
    print("[OK] 20人本奖励测试通过")


def test_distribute_quantity_evenly():
    """测试掉落平均分配函数"""
    assert distribute_quantity_evenly(9, 3) == [3, 3, 3]
    assert distribute_quantity_evenly(5, 2) == [3, 2]
    assert distribute_quantity_evenly(2, 5) == [1, 1, 0, 0, 0]
    assert distribute_quantity_evenly(0, 3) == [0, 0, 0]
    assert distribute_quantity_evenly(5, 0) == []


def test_dungeon_progress():
    """测试副本进度管理"""
    print("\n" + "=" * 60)
    print("副本进度管理测试")
    print("=" * 60)
    
    # 创建进度管理器
    progress_manager = DungeonProgressManager("player_001")
    
    # 获取副本进度
    dungeon = get_dungeon_by_id("fire_type_single_001")
    progress = progress_manager.get_progress(dungeon.dungeon_id)
    
    # 添加挑战记录
    for i in range(50):
        progress.add_attempt(
            is_success=True,
            duration=60.0,
            rewards={"exp": 10}
        )
    
    print(f"\n挑战次数: {progress.total_attempts}")
    print(f"完成次数: {progress.completion_count}")
    print(f"扫荡解锁: {progress.sweep_unlocked}")
    
    assert progress.total_attempts == 50, "应该有50次挑战"
    assert progress.completion_count == 50, "应该有50次完成"
    assert progress.sweep_unlocked, "应该解锁扫荡"
    print("[OK] 副本进度管理测试通过")


def test_dungeon_monster_spawner():
    """测试副本怪物生成器"""
    print("\n" + "=" * 60)
    print("副本怪物生成器测试")
    print("=" * 60)
    
    # 测试1人本怪物生成
    dungeon = get_dungeon_by_id("fire_type_single_001")
    from src.dungeons.dungeon_monster import MonsterSpawner
    
    spawner = MonsterSpawner(dungeon)
    
    # 检查怪物属性（应该是木属性，因为火克木）
    print(f"\n副本属性: {dungeon.attribute_type.value}")
    print(f"怪物属性: {spawner.monster_attribute.value}")
    assert spawner.monster_attribute == AttributeType.WOOD, "火副本的怪物应该是木属性"
    
    # 检查生成时间
    print(f"\n1人本怪物生成时间: {len(spawner.spawn_times)}波")
    assert len(spawner.spawn_times) == 20, "1人本应该有20波怪物"
    assert spawner.spawn_times[0] == 0.0, "1人本应该从0秒开始刷新"
    assert spawner.spawn_times[-1] == 57.0, "1人本应该每3秒刷新一波并在57秒刷新最后一波"
    first_wave = spawner.get_monster_spawns(0.0, -0.001)
    assert len(first_wave) == 1, "0秒应该生成首波怪物"
    assert first_wave[0]["monster_type"] in {"单体小怪", "群体小怪5个"}, "1人本只应该出现单体或5只群体小怪"
    
    # 测试5人本怪物生成
    dungeon = get_dungeon_by_id("fire_type_squad_001")
    spawner = MonsterSpawner(dungeon)
    
    print(f"\n5人本怪物生成时间: {len(spawner.spawn_times)}波")
    print(f"5人本Boss生成时间: {len(spawner.boss_spawn_times)}个")
    assert len(spawner.spawn_times) == 60, "5人本应该有60波怪物"
    assert len(spawner.boss_spawn_times) == 4, "5人本应该有4个Boss"
    
    print("[OK] 副本怪物生成器测试通过")


def run_all_tests():
    """运行所有测试"""
    try:
        test_dungeon_database()
        test_eight_attribute_experience_dungeon_rules()
        test_dungeon_unlock()
        test_dungeon_reward()
        test_dungeon_progress()
        test_dungeon_monster_spawner()
        
        print("\n" + "=" * 60)
        print("所有测试通过！[OK]")
        print("=" * 60)
        
    except AssertionError as e:
        print(f"\n测试失败: {e}")
        raise
    except Exception as e:
        print(f"\n测试出错: {e}")
        raise


if __name__ == "__main__":
    run_all_tests()






