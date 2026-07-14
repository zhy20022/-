"""
技能配置
用于配置角色的技能系统
"""

from typing import List
from ..characters.character import Character
from ..combat.skill_system import Skill, SkillManager
from .skill_learning import SkillLearningSystem
from .skill_database import get_skill_database, get_skill_by_id


class SkillConfig:
    """技能配置类"""
    
    @staticmethod
    def initialize_character_skills(character: Character) -> SkillLearningSystem:
        """
        为角色初始化技能系统
        
        Args:
            character: 角色
            
        Returns:
            技能学习系统
        """
        # 创建技能学习系统
        skill_learning_system = SkillLearningSystem(character)
        
        # 从技能数据库获取技能
        skill_database = get_skill_database()
        skill_database.initialize_character_skills(character, skill_learning_system)
        
        return skill_learning_system
    
    @staticmethod
    def setup_battle_skills(character: Character, skill_manager: SkillManager, skill_learning_system: SkillLearningSystem):
        """
        设置战斗技能（将已学习的技能添加到战斗技能管理器）
        
        Args:
            character: 角色
            skill_manager: 战斗技能管理器
            skill_learning_system: 技能学习系统
        """
        boss_slots = getattr(character, "boss_skill_slots", None)
        boss_library = getattr(character, "boss_skill_library", None)
        if boss_slots and boss_library:
            for tier_key in ["low", "mid", "high"]:
                for skill_id in boss_slots.get(tier_key, []):
                    skill = boss_library.get(skill_id)
                    if skill:
                        skill_manager.add_skill(skill)
        else:
            configured_slots = getattr(character, "saved_skill_slots", None)
            if configured_slots:
                for tier_key in ["low", "mid", "high"]:
                    for skill_id in configured_slots.get(tier_key, []):
                        skill = get_skill_by_id(skill_id)
                        if skill:
                            skill_manager.add_skill(skill)
            else:
                # 默认给出一套合法9技能配置：底5、中3、高1，让1级角色也能完整战斗。
                skill_database = get_skill_database()
                all_skills = skill_database.get_skills_for_attribute(character.attribute.attribute_type)
                low_skills = [s for s in all_skills if s.skill_tier.value == "底级别"][:5]
                mid_skills = [s for s in all_skills if s.skill_tier.value == "中级别"][:3]
                high_skills = [s for s in all_skills if s.skill_tier.value == "高级别"][:1]
                for skill in low_skills + mid_skills + high_skills:
                    skill_manager.add_skill(skill)

        # 验证技能配置
        is_valid, message = skill_manager.validate_skill_configuration()
        if not is_valid:
            print(f"警告：角色 {character.name} 的技能配置无效: {message}")
    
    @staticmethod
    def update_skills_on_level_up(character: Character, skill_learning_system: SkillLearningSystem, skill_manager: SkillManager):
        """
        角色升级时更新技能
        
        Args:
            character: 角色
            skill_learning_system: 技能学习系统
            skill_manager: 战斗技能管理器
        """
        # 自动学习新技能
        skill_learning_system.on_level_up()
        
        # 获取新学习的技能
        learned_skills = skill_learning_system.get_learned_skills()
        current_skill_ids = {s.skill_id for s in skill_manager.low_tier_slots.skills + 
                            skill_manager.mid_tier_slots.skills + 
                            skill_manager.high_tier_slots.skills}
        
        # 添加新学习的技能到战斗管理器
        for skill in learned_skills:
            if skill.skill_id not in current_skill_ids:
                skill_manager.add_skill(skill)







