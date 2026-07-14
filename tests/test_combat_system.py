"""
战斗系统测试
演示战斗系统的使用
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
from src.versions.version import GameVersion
from src.combat.battle import Battle, BattleState, BattleSpeed
from src.combat.battle_unit import BattleUnit
from src.combat.skill_system import Skill, SkillLogic, SkillTier, SkillTargetType
from datetime import datetime
import time


def create_test_version():
    """创建测试版本"""
    return GameVersion(
        version_id="v1.0",
        version_name="第一纪元",
        era_name="初始纪元",
        era_year=0,
        release_date=datetime.now()
    )


def create_test_character(name: str, profession_type: ProfessionType, attribute_type: AttributeType, level: int = 1):
    """创建测试角色"""
    profession = get_profession(profession_type)
    attribute = Attribute(attribute_type)
    version = create_test_version()
    
    character = Character(
        character_id=f"char_{name}",
        name=name,
        profession=profession,
        attribute=attribute,
        version=version,
        level=level
    )
    
    # 添加立绘
    male_ill = Illustration(f"ill_{name}_m", f"char_{name}", IllustrationGender.MALE, f"images/{name}_m.png")
    character.add_illustration(male_ill)
    character.select_illustration(IllustrationGender.MALE)
    
    return character


def create_test_skills_for_character(character_name: str) -> list:
    """
    为角色创建测试技能
    按照要求配置：底(3-5) + 中(2-4) + 高(1-3) = 9
    A逻辑至少5个，B逻辑不超过5个，C逻辑最多3个
    底级别：A、B
    中级别：A、B、C
    高级别：B、C
    """
    skills = []
    
    # 示例配置：底5个 + 中3个 + 高1个 = 9
    # A逻辑：底4个 + 中1个 = 5个
    # B逻辑：底1个 + 中1个 + 高1个 = 3个
    # C逻辑：中1个 = 1个
    
    # 底级别技能（5个）：4个A + 1个B
    for i in range(4):
        skill = Skill(
            skill_id=f"{character_name}_low_a_{i}",
            name=f"{character_name}底级别A技能{i+1}",
            skill_logic=SkillLogic.A,
            skill_tier=SkillTier.LOW,
            cooldown=0.0,
            skill_multiplier=1.0,
            physical_damage_ratio=1.0,
            magical_damage_ratio=0.0,
            target_type=SkillTargetType.SINGLE
        )
        skills.append(skill)
    
    skill = Skill(
        skill_id=f"{character_name}_low_b_0",
        name=f"{character_name}底级别B技能",
        skill_logic=SkillLogic.B,
        skill_tier=SkillTier.LOW,
        cooldown=0.0,
        skill_multiplier=1.2,
        physical_damage_ratio=0.8,
        magical_damage_ratio=0.2,
        target_type=SkillTargetType.SINGLE
    )
    skills.append(skill)
    
    # 中级别技能（3个）：1个A + 1个B + 1个C
    skill = Skill(
        skill_id=f"{character_name}_mid_a_0",
        name=f"{character_name}中级别A技能",
        skill_logic=SkillLogic.A,
        skill_tier=SkillTier.MID,
        cooldown=0.0,
        skill_multiplier=1.5,
        physical_damage_ratio=1.0,
        magical_damage_ratio=0.0,
        target_type=SkillTargetType.ALL
    )
    skills.append(skill)
    
    skill = Skill(
        skill_id=f"{character_name}_mid_b_0",
        name=f"{character_name}中级别B技能",
        skill_logic=SkillLogic.B,
        skill_tier=SkillTier.MID,
        cooldown=0.0,
        skill_multiplier=1.3,
        physical_damage_ratio=0.7,
        magical_damage_ratio=0.3,
        target_type=SkillTargetType.MULTIPLE,
        target_count=2
    )
    skills.append(skill)
    
    skill = Skill(
        skill_id=f"{character_name}_mid_c_0",
        name=f"{character_name}中级别C技能",
        skill_logic=SkillLogic.C,
        skill_tier=SkillTier.MID,
        cooldown=0.0,
        skill_multiplier=2.0,
        physical_damage_ratio=0.5,
        magical_damage_ratio=0.5,
        target_type=SkillTargetType.SINGLE
    )
    skills.append(skill)
    
    # 高级别技能（1个）：1个B
    skill = Skill(
        skill_id=f"{character_name}_high_b_0",
        name=f"{character_name}高级别B技能",
        skill_logic=SkillLogic.B,
        skill_tier=SkillTier.HIGH,
        cooldown=0.0,
        skill_multiplier=2.5,
        physical_damage_ratio=0.6,
        magical_damage_ratio=0.4,
        target_type=SkillTargetType.SINGLE
    )
    skills.append(skill)
    
    return skills


def test_battle_system():
    """测试战斗系统"""
    print("=" * 60)
    print("战斗系统测试")
    print("=" * 60)
    
    # 创建玩家角色
    player_char = create_test_character("火焰战士", ProfessionType.PHYSICAL_TANK, AttributeType.FIRE, level=10)
    player_unit = BattleUnit(player_char, is_player=True)
    
    # 为玩家添加技能
    player_skills = create_test_skills_for_character("player")
    for skill in player_skills:
        player_unit.skill_manager.add_skill(skill)
    
    # 验证技能配置
    is_valid, message = player_unit.skill_manager.validate_skill_configuration()
    print(f"\n技能配置验证: {message}")
    assert is_valid, f"技能配置无效: {message}"
    
    # 创建敌人角色
    enemy_char = create_test_character("木系怪物", ProfessionType.PHYSICAL_MELEE_DPS, AttributeType.WOOD, level=5)
    enemy_unit = BattleUnit(enemy_char, is_player=False)
    
    # 为敌人添加技能（简化配置）
    enemy_skills = create_test_skills_for_character("enemy")
    for skill in enemy_skills:
        enemy_unit.skill_manager.add_skill(skill)
    
    # 创建战斗
    battle = Battle(
        player_units=[player_unit],
        enemy_units=[enemy_unit],
        max_duration=60.0,  # 1分钟
        battle_speed=BattleSpeed.X1
    )
    
    # 初始化战斗单位的管理器
    for unit in battle.player_units + battle.enemy_units:
        unit.status_manager = battle.__class__.__module__ + ".status_system.StatusManager"  # 临时修复
        from src.combat.status_system import StatusManager
        from src.combat.skill_system import SkillManager
        from src.combat.ai_system import AISystem
        
        unit.status_manager = StatusManager(unit)
        unit.skill_manager = SkillManager(unit)
        if not unit.is_player:
            unit.ai_system = AISystem(unit)
        
        # 重新添加技能
        if unit.is_player:
            for skill in player_skills:
                unit.skill_manager.add_skill(skill)
        else:
            for skill in enemy_skills:
                unit.skill_manager.add_skill(skill)
    
    # 开始战斗
    battle.start()
    print(f"\n战斗开始！")
    print(f"玩家: {player_unit}")
    print(f"敌人: {enemy_unit}")
    
    # 模拟战斗（简化版，实际应该使用游戏循环）
    max_iterations = 100
    iteration = 0
    
    while battle.state == BattleState.IN_PROGRESS and iteration < max_iterations:
        battle.update(1.0)  # 每秒更新一次
        iteration += 1
        
        # 每5秒输出一次状态
        if iteration % 5 == 0:
            print(f"\n--- {battle.current_time:.1f}秒 ---")
            print(f"玩家: 物理HP {player_unit.current_physical_health}/{player_unit.max_physical_health}, "
                  f"魔法HP {player_unit.current_magical_health}/{player_unit.max_magical_health}")
            print(f"敌人: 物理HP {enemy_unit.current_physical_health}/{enemy_unit.max_physical_health}, "
                  f"魔法HP {enemy_unit.current_magical_health}/{enemy_unit.max_magical_health}")
    
    # 获取战斗结果
    result = battle.get_result()
    if result:
        print(f"\n战斗结束！")
        print(f"结果: {'胜利' if result.is_victory else '失败'}")
        print(f"持续时间: {result.duration:.1f}秒")
    
    print("\n" + "=" * 60)


if __name__ == "__main__":
    test_battle_system()







