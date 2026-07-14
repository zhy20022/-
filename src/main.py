"""
游戏主程序入口
演示游戏系统的使用
"""

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
from datetime import datetime


def create_example_version():
    """创建示例版本"""
    version = GameVersion(
        version_id="v1.0",
        version_name="第一纪元",
        era_name="初始纪元",
        era_year=0,
        release_date=datetime.now(),
        description="游戏的第一个版本，代表初始纪元"
    )
    return version


def create_example_character(version: GameVersion):
    """创建示例角色"""
    # 创建职业
    profession = get_profession(ProfessionType.PHYSICAL_TANK)
    
    # 创建属性
    attribute = Attribute(AttributeType.FIRE)
    
    # 创建角色
    character = Character(
        character_id="char_001",
        name="火焰守护者",
        profession=profession,
        attribute=attribute,
        version=version,
        level=1,
        exp=0
    )
    
    # 添加立绘
    male_illustration = Illustration(
        illustration_id="ill_001_m",
        character_id="char_001",
        gender=IllustrationGender.MALE,
        image_path="images/char_001_male.png",
        name="火焰守护者（男）"
    )
    
    female_illustration = Illustration(
        illustration_id="ill_001_f",
        character_id="char_001",
        gender=IllustrationGender.FEMALE,
        image_path="images/char_001_female.png",
        name="火焰守护者（女）"
    )
    
    character.add_illustration(male_illustration)
    character.add_illustration(female_illustration)
    character.select_illustration(IllustrationGender.MALE)
    
    # 创建专属武器
    weapon = ExclusiveWeapon(
        weapon_id="weapon_001",
        name="烈焰之盾",
        character_id="char_001",
        attack_bonus=150,
        magic_attack_bonus=100,
        description="火焰守护者的专属武器",
        special_skill={
            "name": "烈焰冲击",
            "description": "对敌人造成火焰伤害",
            "cooldown": 30,
            "damage_multiplier": 2.0
        }
    )
    character.equip_weapon(weapon)
    
    # 创建套装
    equipment_pieces = [
        Equipment("eq_001", "守护者头盔", EquipmentSlot.HELMET, hp_bonus=200, defense_bonus=50),
        Equipment("eq_002", "守护者胸甲", EquipmentSlot.CHEST, hp_bonus=300, defense_bonus=80),
        Equipment("eq_003", "守护者护腿", EquipmentSlot.LEGS, hp_bonus=200, defense_bonus=50),
        Equipment("eq_004", "守护者靴子", EquipmentSlot.BOOTS, hp_bonus=150, defense_bonus=40),
        Equipment("eq_005", "守护者手套", EquipmentSlot.GLOVES, hp_bonus=100, attack_bonus=30),
        Equipment("eq_006", "守护者饰品", EquipmentSlot.ACCESSORY, hp_bonus=150, attack_bonus=50)
    ]
    
    equipment_set = EquipmentSet(
        set_id="set_001",
        name="守护者套装",
        pieces=equipment_pieces,
        set_bonus_2={"hp": 500},
        set_bonus_4={"hp": 1000, "defense": 100},
        set_bonus_6={"hp": 2000, "defense": 200, "attack": 100},
        description="强大的守护者套装"
    )
    
    # 装备所有套装部件
    for piece in equipment_pieces:
        equipment_set.equip_piece(piece)
    
    character.equip_set(equipment_set)
    
    return character


def demonstrate_game_systems():
    """演示游戏系统"""
    print("=" * 60)
    print("灾异志 - 系统演示")
    print("=" * 60)
    
    # 1. 版本系统
    print("\n【版本系统】")
    version_manager = VersionManager()
    version = create_example_version()
    version_manager.add_version(version)
    version_manager.set_current_version(version)
    print(f"当前版本: {version_manager.get_current_version()}")
    
    # 2. 角色系统
    print("\n【角色系统】")
    character = create_example_character(version)
    print(f"角色: {character}")
    print(f"属性: HP={character.hp}, 攻击={character.attack}, 防御={character.defense}")
    print(f"选择的立绘: {character.selected_illustration}")
    print(f"专属武器: {character.exclusive_weapon}")
    print(f"套装: {character.equipment_set}")
    
    # 3. 属性相克系统
    print("\n【属性相克系统】")
    fire_attr = Attribute(AttributeType.FIRE)
    wood_attr = Attribute(AttributeType.WOOD)
    water_attr = Attribute(AttributeType.WATER)
    
    print(f"火 vs 木: 伤害倍率 = {fire_attr.calculate_damage_multiplier(wood_attr)}")
    print(f"木 vs 火: 伤害倍率 = {wood_attr.calculate_damage_multiplier(fire_attr)}")
    print(f"水 vs 火: 伤害倍率 = {water_attr.calculate_damage_multiplier(fire_attr)}")
    
    # 4. 游戏模式
    print("\n【游戏模式】")
    
    # 单人模式
    solo_mode = SoloMode()
    print(f"\n{solo_mode.name}: {solo_mode.description}")
    print(f"解锁等级: {solo_mode.unlock_level}")
    print(f"奖励: {solo_mode.get_rewards()}")
    
    # 五人小队
    five_team = FivePlayerTeam()
    print(f"\n{five_team.name}: {five_team.description}")
    print(f"解锁等级: {five_team.unlock_level}")
    print(f"团队大小: {five_team.team_size}")
    print(f"奖励: {five_team.get_rewards()}")
    
    # 二十人团队
    twenty_team = TwentyPlayerTeam()
    print(f"\n{twenty_team.name}: {twenty_team.description}")
    print(f"解锁等级: {twenty_team.unlock_level}")
    print(f"团队大小: {twenty_team.team_size}")
    print(f"奖励: {twenty_team.get_rewards()}")
    
    # 全服活动
    server_event = ServerEvent()
    print(f"\n{server_event.name}: {server_event.description}")
    print(f"解锁等级: {server_event.unlock_level}")
    print(f"奖励: {server_event.get_rewards()}")
    
    # 5. 职业系统
    print("\n【职业系统】")
    for prof_type in ProfessionType:
        prof = get_profession(prof_type)
        print(f"{prof.profession_type.value}: HP={prof.base_hp}, 物攻={prof.base_attack}, 物防={prof.base_defense}")
    
    print("\n" + "=" * 60)
    print("演示完成！")
    print("=" * 60)


if __name__ == "__main__":
    demonstrate_game_systems()

