"""
Boss系统
实现Boss的特殊机制、阶段转换等
"""

from enum import Enum
from typing import Dict, Any, List, Optional
from .enemy import Enemy
from ..combat.skill_system import Skill, SkillManager


class BossType(Enum):
    """Boss类型"""
    SINGLE = "单体boss"          # 一个boss分3个阶段
    TWIN_SEPARATE = "双子boss分离"  # 两个boss不共血量，附加2个阶段
    TWIN_SHARED = "双子boss共血"    # 两个boss共血量，附加2个阶段
    COUNCIL_SEQUENTIAL = "议会boss顺序"  # 3个boss一个接一个的逐个激活模式
    COUNCIL_SHARED = "议会boss共血"      # 3个boss为共血量不同技能


class BossPhase:
    """Boss阶段"""
    
    def __init__(
        self,
        phase_id: str,
        name: str,
        hp_threshold_min: float,
        hp_threshold_max: float,
        attribute_modifier: Dict[str, float] = None,
        special_skills: List[str] = None,
        special_mechanic: str = ""
    ):
        """
        初始化Boss阶段
        
        Args:
            phase_id: 阶段ID
            name: 阶段名称
            hp_threshold_min: 血量阈值最小值（百分比，如：0.33表示33%）
            hp_threshold_max: 血量阈值最大值（百分比，如：0.66表示66%）
            attribute_modifier: 属性修正（如：{"attack": 1.2}表示攻击力+20%）
            special_skills: 特殊技能ID列表
            special_mechanic: 特殊机制描述
        """
        self.phase_id = phase_id
        self.name = name
        self.hp_threshold_min = hp_threshold_min
        self.hp_threshold_max = hp_threshold_max
        self.attribute_modifier = attribute_modifier or {}
        self.special_skills = special_skills or []
        self.special_mechanic = special_mechanic
    
    def is_in_phase(self, hp_percentage: float) -> bool:
        """
        检查是否在这个阶段
        
        Args:
            hp_percentage: 当前血量百分比（0.0-1.0）
            
        Returns:
            如果在这个阶段返回True
        """
        return self.hp_threshold_min <= hp_percentage < self.hp_threshold_max
    
    def apply_modifier(self, enemy: Enemy):
        """应用属性修正"""
        if "attack" in self.attribute_modifier:
            enemy.base_attack = int(enemy.base_attack * self.attribute_modifier["attack"])
        if "defense" in self.attribute_modifier:
            enemy.base_defense = int(enemy.base_defense * self.attribute_modifier["defense"])
        if "hp" in self.attribute_modifier:
            enemy.base_hp = int(enemy.base_hp * self.attribute_modifier["hp"])


class Boss:
    """Boss类（扩展Enemy）"""
    
    def __init__(
        self,
        enemy: Enemy,
        boss_type: BossType,
        phases: List[BossPhase] = None,
        special_skills: List[Skill] = None
    ):
        """
        初始化Boss
        
        Args:
            enemy: 敌人对象
            boss_type: Boss类型
            phases: Boss阶段列表
            special_skills: 特殊技能列表
        """
        self.enemy = enemy
        self.boss_type = boss_type
        self.phases = phases or []
        self.special_skills = special_skills or []
        self.current_phase_index = 0
        
        # Boss有技能槽（使用技能系统）
        if enemy.character.skill_learning_system is None:
            # 如果没有技能学习系统，创建一个简化的技能管理器
            from ..combat.skill_system import SkillManager
            enemy.battle_unit.skill_manager = SkillManager(enemy.battle_unit)
        
        # 添加特殊技能到技能槽
        if special_skills:
            for skill in special_skills:
                enemy.battle_unit.skill_manager.add_skill(skill)
    
    def get_current_phase(self) -> Optional[BossPhase]:
        """获取当前阶段"""
        if not self.phases:
            return None
        
        # 获取当前血量百分比
        hp_percentage = self.enemy.battle_unit.get_total_health_percentage()
        
        # 查找当前阶段
        for phase in self.phases:
            if phase.is_in_phase(hp_percentage):
                return phase
        
        # 如果没有匹配的阶段，返回最后一个阶段
        return self.phases[-1] if self.phases else None
    
    def update_phase(self):
        """更新Boss阶段"""
        current_phase = self.get_current_phase()
        if current_phase:
            # 应用阶段属性修正
            current_phase.apply_modifier(self.enemy)
            
            # 更新当前阶段索引
            for i, phase in enumerate(self.phases):
                if phase == current_phase:
                    self.current_phase_index = i
                    break
    
    def get_special_skills(self) -> List[Skill]:
        """获取特殊技能"""
        return self.special_skills
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "enemy": self.enemy.to_dict(),
            "boss_type": self.boss_type.value,
            "current_phase": self.get_current_phase().name if self.get_current_phase() else None,
            "phases_count": len(self.phases),
            "special_skills_count": len(self.special_skills)
        }





