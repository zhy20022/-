"""
技能学习系统测试
"""

import sys
import os

# 添加项目根目录到路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from src.classes.profession import ProfessionType, get_profession
from src.attributes.attribute import Attribute, AttributeType
from src.characters.character import Character
from src.versions.version import GameVersion
from src.skills.skill_learning import SkillLearningSystem
from src.skills.skill_config import SkillConfig
from src.combat.skill_system import SkillTier
from datetime import datetime


def create_test_character(name: str, profession_type: ProfessionType, attribute_type: AttributeType, level: int = 1):
    """创建测试角色"""
    profession = get_profession(profession_type)
    attribute = Attribute(attribute_type)
    version = GameVersion(
        version_id="v1.0",
        version_name="第一纪元",
        era_name="初始纪元",
        era_year=0,
        release_date=datetime.now()
    )
    
    character = Character(
        character_id=f"char_{name}",
        name=name,
        profession=profession,
        attribute=attribute,
        version=version,
        level=level
    )
    
    return character


def test_skill_learning_system():
    """测试技能学习系统"""
    print("=" * 60)
    print("技能学习系统测试")
    print("=" * 60)
    
    # 创建角色（1级）
    character = create_test_character("火焰战士", ProfessionType.PHYSICAL_TANK, AttributeType.FIRE, level=1)
    
    # 初始化技能系统
    skill_learning_system = SkillConfig.initialize_character_skills(character)
    character.skill_learning_system = skill_learning_system
    
    # 检查初始技能（底级别）
    learned_skills = skill_learning_system.get_learned_skills()
    low_tier_skills = skill_learning_system.get_learned_skills_by_tier(SkillTier.LOW)
    
    print(f"\n角色等级: {character.level}")
    print(f"已学习技能总数: {len(learned_skills)}")
    print(f"底级别技能数量: {len(low_tier_skills)}")
    
    # 验证：1级应该只有底级别技能（5个）
    assert len(low_tier_skills) == 5, f"1级应该有5个底级别技能，实际有{len(low_tier_skills)}个"
    assert len(learned_skills) == 5, f"1级应该有5个已学习技能，实际有{len(learned_skills)}个"
    
    print("\n✓ 初始技能测试通过")
    
    # 升级到2级
    character.level = 2
    character.gain_exp(2000)  # 触发升级逻辑
    skill_learning_system.on_level_up()
    
    learned_skills = skill_learning_system.get_learned_skills()
    mid_tier_skills = skill_learning_system.get_learned_skills_by_tier(SkillTier.MID)
    
    print(f"\n角色等级: {character.level}")
    print(f"已学习技能总数: {len(learned_skills)}")
    print(f"中级别技能数量: {len(mid_tier_skills)}")
    
    # 验证：2级应该有底级别（5个）+ 中级别（4个）= 9个技能
    assert len(mid_tier_skills) == 4, f"2级应该有4个中级别技能，实际有{len(mid_tier_skills)}个"
    assert len(learned_skills) == 9, f"2级应该有9个已学习技能，实际有{len(learned_skills)}个"
    
    print("\n✓ 2级技能解锁测试通过")
    
    # 升级到4级
    character.level = 4
    skill_learning_system.on_level_up()
    
    learned_skills = skill_learning_system.get_learned_skills()
    high_tier_skills = skill_learning_system.get_learned_skills_by_tier(SkillTier.HIGH)
    
    print(f"\n角色等级: {character.level}")
    print(f"已学习技能总数: {len(learned_skills)}")
    print(f"高级别技能数量: {len(high_tier_skills)}")
    
    # 验证：4级应该有底级别（5个）+ 中级别（4个）+ 高级别（1个）= 10个技能
    assert len(high_tier_skills) == 1, f"4级应该有1个高级别技能，实际有{len(high_tier_skills)}个"
    assert len(learned_skills) == 10, f"4级应该有10个已学习技能，实际有{len(learned_skills)}个"
    
    print("\n✓ 4级技能解锁测试通过")
    
    # 显示所有技能
    print("\n所有已学习技能:")
    for skill in learned_skills:
        print(f"  - {skill.name} ({skill.skill_tier.value}, {skill.skill_logic.value})")
    
    print("\n" + "=" * 60)
    print("所有测试通过！✓")
    print("=" * 60)


if __name__ == "__main__":
    test_skill_learning_system()







