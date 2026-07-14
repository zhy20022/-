"""
技能学习系统
实现自动解锁、技能解锁条件管理
"""

from typing import List, Dict, Any, Optional
from enum import Enum
from ..combat.skill_system import Skill, SkillLogic, SkillTier
from ..characters.character import Character


class UnlockType(Enum):
    """解锁类型"""
    INITIAL = "初始"      # 初始自带
    LEVEL = "等级解锁"    # 达到等级自动解锁
    MATERIAL = "材料学习"  # 使用材料学习（暂不支持）
    QUEST = "任务解锁"    # 完成任务解锁（暂不支持）


class SkillUnlockCondition:
    """技能解锁条件"""
    
    def __init__(
        self,
        unlock_type: UnlockType,
        required_level: int = 1,
        required_materials: Dict[str, int] = None,
        required_gold: int = 0,
        prerequisite_skills: List[str] = None
    ):
        """
        初始化技能解锁条件
        
        Args:
            unlock_type: 解锁类型
            required_level: 需要的等级
            required_materials: 需要的材料（字典：{material_id: count}）
            required_gold: 需要的金币
            prerequisite_skills: 前置技能ID列表
        """
        self.unlock_type = unlock_type
        self.required_level = required_level
        self.required_materials = required_materials or {}
        self.required_gold = required_gold
        self.prerequisite_skills = prerequisite_skills or []
    
    def is_unlocked(self, character: Character, learned_skills: List[str] = None) -> bool:
        """
        检查技能是否已解锁
        
        Args:
            character: 角色
            learned_skills: 已学习的技能ID列表
            
        Returns:
            如果已解锁返回True
        """
        learned_skills = learned_skills or []
        
        # 检查解锁类型
        if self.unlock_type == UnlockType.INITIAL:
            return True  # 初始技能总是解锁
        
        elif self.unlock_type == UnlockType.LEVEL:
            # 检查等级
            if character.level < self.required_level:
                return False
            
            # 检查前置技能
            if self.prerequisite_skills:
                for prereq_skill_id in self.prerequisite_skills:
                    if prereq_skill_id not in learned_skills:
                        return False
            
            return True
        
        elif self.unlock_type == UnlockType.MATERIAL:
            # 材料学习（暂不支持）
            return False
        
        elif self.unlock_type == UnlockType.QUEST:
            # 任务解锁（暂不支持）
            return False
        
        return False
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "unlock_type": self.unlock_type.value,
            "required_level": self.required_level,
            "required_materials": self.required_materials,
            "required_gold": self.required_gold,
            "prerequisite_skills": self.prerequisite_skills
        }


class SkillLearningSystem:
    """技能学习系统"""
    
    def __init__(self, character: Character):
        """
        初始化技能学习系统
        
        Args:
            character: 角色
        """
        self.character = character
        self.learned_skills: List[str] = []  # 已学习的技能ID列表
        self.available_skills: List[Skill] = []  # 可用的技能列表
        self.skill_unlock_conditions: Dict[str, SkillUnlockCondition] = {}  # 技能解锁条件
    
    def register_skill(
        self,
        skill: Skill,
        unlock_condition: SkillUnlockCondition
    ):
        """
        注册技能及其解锁条件
        
        Args:
            skill: 技能
            unlock_condition: 解锁条件
        """
        self.available_skills.append(skill)
        self.skill_unlock_conditions[skill.skill_id] = unlock_condition
    
    def get_unlockable_skills(self) -> List[Skill]:
        """
        获取当前可解锁的技能
        
        Returns:
            可解锁的技能列表
        """
        unlockable = []
        
        for skill in self.available_skills:
            if skill.skill_id in self.learned_skills:
                continue  # 已经学习过
            
            unlock_condition = self.skill_unlock_conditions.get(skill.skill_id)
            if unlock_condition and unlock_condition.is_unlocked(self.character, self.learned_skills):
                unlockable.append(skill)
        
        return unlockable
    
    def auto_learn_skills(self):
        """
        自动学习所有可解锁的技能
        """
        unlockable_skills = self.get_unlockable_skills()
        
        for skill in unlockable_skills:
            if skill.skill_id not in self.learned_skills:
                self.learn_skill(skill.skill_id)
    
    def learn_skill(self, skill_id: str) -> bool:
        """
        学习技能
        
        Args:
            skill_id: 技能ID
            
        Returns:
            如果学习成功返回True
        """
        # 检查技能是否存在
        skill = next((s for s in self.available_skills if s.skill_id == skill_id), None)
        if not skill:
            return False
        
        # 检查是否已学习
        if skill_id in self.learned_skills:
            return False
        
        # 检查解锁条件
        unlock_condition = self.skill_unlock_conditions.get(skill_id)
        if unlock_condition and not unlock_condition.is_unlocked(self.character, self.learned_skills):
            return False
        
        # 学习技能
        self.learned_skills.append(skill_id)
        return True
    
    def get_learned_skills(self) -> List[Skill]:
        """获取已学习的技能列表"""
        return [s for s in self.available_skills if s.skill_id in self.learned_skills]
    
    def get_learned_skills_by_tier(self, tier: SkillTier) -> List[Skill]:
        """获取指定梯度的已学习技能"""
        return [s for s in self.get_learned_skills() if s.skill_tier == tier]
    
    def get_learned_skills_by_logic(self, logic: SkillLogic) -> List[Skill]:
        """获取指定逻辑的已学习技能"""
        return [s for s in self.get_learned_skills() if s.skill_logic == logic]
    
    def has_skill(self, skill_id: str) -> bool:
        """检查是否已学习指定技能"""
        return skill_id in self.learned_skills
    
    def on_level_up(self):
        """角色升级时调用，自动学习新技能"""
        self.auto_learn_skills()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "character_id": self.character.character_id,
            "learned_skills": self.learned_skills,
            "available_skills_count": len(self.available_skills),
            "unlockable_skills_count": len(self.get_unlockable_skills())
        }







