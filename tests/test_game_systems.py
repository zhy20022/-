"""
游戏系统测试
"""

import sys
import os

# 添加项目根目录到路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from src.classes.profession import ProfessionType, get_profession
from src.attributes.attribute import Attribute, AttributeType
from src.characters.character import Character
from src.characters.illustration import Illustration, IllustrationGender
from src.characters.weapon import ExclusiveWeapon
from src.characters.equipment import Equipment, EquipmentSet, EquipmentSlot
from src.game_modes.solo_mode import SoloMode
from src.game_modes.team_mode import FivePlayerTeam, TwentyPlayerTeam
from src.game_modes.server_event import ServerEvent
from src.versions.version import GameVersion, VersionManager
from src.game.quest_system import QuestSystem
from src.game.achievement_system import AchievementSystem
from src.game.daily_checkin import DailyCheckIn
from src.events.event_system import EventRotationManager, ShopInventory
from src.social.friend_system import FriendSystem
from datetime import datetime


def test_profession_system():
    """测试职业系统"""
    print("测试职业系统...")
    
    # 测试所有职业
    for prof_type in ProfessionType:
        prof = get_profession(prof_type)
        assert prof is not None
        assert prof.profession_type == prof_type
        print(f"  [OK] {prof.profession_type.value}: HP={prof.base_hp}")
    
    # 测试职业判断
    physical_tank = get_profession(ProfessionType.PHYSICAL_TANK)
    assert physical_tank.is_physical()
    assert physical_tank.is_tank()
    assert not physical_tank.is_magic()
    
    print("  职业系统测试通过！\n")


def test_attribute_system():
    """测试属性系统"""
    print("测试属性系统...")
    
    # 测试相克关系
    fire = Attribute(AttributeType.FIRE)
    wood = Attribute(AttributeType.WOOD)
    wind = Attribute(AttributeType.WIND)
    
    # 火克木
    assert fire.is_counter_to(wood)
    assert fire.calculate_damage_multiplier(wood) == 1.5
    
    # 木被火克
    assert wood.is_countered_by(fire)
    assert wood.calculate_damage_multiplier(fire) == 0.75
    
    # 木克风
    assert wood.is_counter_to(wind)
    
    # 风克火
    assert wind.is_counter_to(fire)
    
    # 测试光暗互克
    light = Attribute(AttributeType.LIGHT)
    dark = Attribute(AttributeType.DARK)
    
    assert light.is_counter_to(dark)
    assert dark.is_counter_to(light)
    assert light.calculate_damage_multiplier(dark) == 1.5
    assert dark.calculate_damage_multiplier(light) == 1.5
    
    print("  属性系统测试通过！\n")


def test_character_system():
    """测试角色系统"""
    print("测试角色系统...")
    
    # 创建版本
    version = GameVersion(
        version_id="v1.0",
        version_name="第一纪元",
        era_name="初始纪元",
        era_year=0,
        release_date=datetime.now()
    )
    
    # 创建角色
    profession = get_profession(ProfessionType.PHYSICAL_TANK)
    attribute = Attribute(AttributeType.FIRE)
    
    character = Character(
        character_id="char_001",
        name="测试角色",
        profession=profession,
        attribute=attribute,
        version=version,
        level=1
    )
    
    assert character.level == 1
    assert character.hp > 0
    
    # 测试立绘
    male_ill = Illustration("ill_001_m", "char_001", IllustrationGender.MALE, "path1")
    female_ill = Illustration("ill_001_f", "char_001", IllustrationGender.FEMALE, "path2")
    
    character.add_illustration(male_ill)
    character.add_illustration(female_ill)
    
    assert len(character.available_illustrations) == 2
    assert character.selected_illustration is not None
    
    # 测试切换立绘
    character.select_illustration(IllustrationGender.FEMALE)
    assert character.selected_illustration.gender == IllustrationGender.FEMALE
    
    # 测试专属武器
    weapon = ExclusiveWeapon("weapon_001", "测试武器", "char_001")
    character.equip_weapon(weapon)
    assert character.exclusive_weapon is not None
    
    # 测试升级
    old_hp = character.hp
    character.gain_exp(2000)
    assert character.level > 1
    assert character.hp > old_hp
    
    print("  角色系统测试通过！\n")


def test_equipment_system():
    """测试装备系统"""
    print("测试装备系统...")
    
    # 创建套装
    pieces = [
        Equipment("eq_001", "头盔", EquipmentSlot.HELMET, hp_bonus=100),
        Equipment("eq_002", "胸甲", EquipmentSlot.CHEST, hp_bonus=200),
        Equipment("eq_003", "护腿", EquipmentSlot.LEGS, hp_bonus=100),
        Equipment("eq_004", "靴子", EquipmentSlot.BOOTS, hp_bonus=100),
        Equipment("eq_005", "手套", EquipmentSlot.GLOVES, hp_bonus=100),
        Equipment("eq_006", "饰品", EquipmentSlot.ACCESSORY, hp_bonus=100)
    ]
    
    equipment_set = EquipmentSet(
        set_id="set_001",
        name="测试套装",
        pieces=pieces,
        set_bonus_2={"hp": 500},
        set_bonus_4={"hp": 1000},
        set_bonus_6={"hp": 2000}
    )
    
    # 装备部件
    for piece in pieces:
        equipment_set.equip_piece(piece)
    
    assert equipment_set.is_complete()
    assert equipment_set.get_equipped_count() == 6
    
    # 测试套装加成
    bonus = equipment_set.get_set_bonus()
    assert bonus["hp"] > 0
    
    print("  装备系统测试通过！\n")


def test_game_modes():
    """测试游戏模式"""
    print("测试游戏模式...")
    
    # 测试单人模式
    solo = SoloMode()
    assert solo.unlock_level == 1
    assert solo.can_access(1)
    rewards = solo.get_rewards()
    assert "exp" in rewards
    
    # 测试五人小队
    five_team = FivePlayerTeam()
    assert five_team.team_size == 5
    assert five_team.unlock_level == 100
    assert not five_team.can_access(50)
    assert five_team.can_access(100)
    
    # 测试二十人团队
    twenty_team = TwentyPlayerTeam()
    assert twenty_team.team_size == 20
    assert twenty_team.unlock_level == 100
    
    # 测试全服活动
    server_event = ServerEvent()
    assert server_event.unlock_level == 100
    assert server_event.reset_period_days == 90
    
    print("  游戏模式测试通过！\n")


def test_quest_and_achievement_systems():
    """测试任务与成就系统"""
    quest_system = QuestSystem("player_unit")
    available = quest_system.get_available_quests()
    assert available, "至少应有一个可接任务"
    quest_id = available[0].quest_id
    quest_system.accept_quest(quest_id)
    quest_system.update_quest_progress("complete_dungeon", count=1)
    reward = quest_system.claim_quest_reward(quest_id)
    assert reward.exp >= 0

    achievement_system = AchievementSystem("player_unit")
    player_data = {
        "battles_completed": 120,
        "character_count": 12,
        "completed_dungeon_types": {"1人本", "5人本", "20人本", "世界boss本"},
        "max_equipment_enhancement": 50
    }
    unlocked = achievement_system.check_achievements(player_data)
    assert len(unlocked) >= 1


def test_checkin_and_event_systems():
    """测试签到、活动与商店系统"""
    checkin = DailyCheckIn("player_unit")
    status = checkin.get_checkin_status()
    assert 'status' in status
    result = checkin.check_in()
    assert result['success']

    event_manager = EventRotationManager()
    events = event_manager.get_active_events()
    assert 'team_monthly' in events and 'server_quarterly' in events

    shop = ShopInventory()
    grouped = shop.get_grouped_items()
    assert len(grouped) > 0

    friend_system = FriendSystem("player_unit")
    friend_system.add_friend("ally_001", "协战者")
    assert friend_system.friend_count() == 1
    friend_system.set_assist_mode(True)
    assert friend_system.is_assist_enabled()


def test_version_system():
    """测试版本系统"""
    print("测试版本系统...")
    
    version_manager = VersionManager()
    
    # 创建版本
    version1 = GameVersion(
        version_id="v1.0",
        version_name="第一纪元",
        era_name="初始纪元",
        era_year=0,
        release_date=datetime.now()
    )
    
    version2 = GameVersion(
        version_id="v2.0",
        version_name="第二纪元",
        era_name="发展纪元",
        era_year=0,
        release_date=datetime.now()
    )
    
    version_manager.add_version(version1)
    version_manager.add_version(version2)
    
    # 设置当前版本
    version_manager.set_current_version(version1)
    assert version_manager.get_current_version() == version1
    assert version1.is_active
    
    # 更新到新版本
    version_manager.update_to_new_version(version2)
    assert version_manager.get_current_version() == version2
    assert not version1.is_active
    assert version2.is_active
    
    # 测试角色版本绑定
    profession = get_profession(ProfessionType.PHYSICAL_TANK)
    attribute = Attribute(AttributeType.FIRE)
    
    char1 = Character("char_001", "角色1", profession, attribute, version1)
    char2 = Character("char_002", "角色2", profession, attribute, version2)
    
    assert version_manager.can_character_use_in_version(char1, version1)
    assert not version_manager.can_character_use_in_version(char1, version2)
    assert version_manager.can_character_use_in_version(char2, version2)
    
    print("  版本系统测试通过！\n")


def run_all_tests():
    """运行所有测试"""
    print("=" * 60)
    print("开始运行游戏系统测试")
    print("=" * 60)
    print()
    
    try:
        test_profession_system()
        test_attribute_system()
        test_character_system()
        test_equipment_system()
        test_game_modes()
        test_quest_and_achievement_systems()
        test_checkin_and_event_systems()
        test_version_system()
        
        print("=" * 60)
        print("所有测试通过！[OK]")
        print("=" * 60)
        
    except AssertionError as e:
        print(f"测试失败: {e}")
        raise
    except Exception as e:
        print(f"测试出错: {e}")
        raise


if __name__ == "__main__":
    run_all_tests()

