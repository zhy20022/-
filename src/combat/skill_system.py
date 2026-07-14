"""
技能系统
实现A/B/C逻辑技能、底中高梯度、循环释放
"""

from enum import Enum
from typing import List, Dict, Any, Optional, Callable
from abc import ABC, abstractmethod
import random


class SkillLogic(Enum):
    """技能逻辑类型"""
    A = "A逻辑技能"  # 至少5个及以上
    B = "B逻辑技能"  # 不超过5个
    C = "C逻辑技能"  # 最多3个


class SkillTier(Enum):
    """技能梯度"""
    LOW = "底级别"      # 3-5个，从A、B中选择
    MID = "中级别"      # 2-4个，从A、B、C中选择
    HIGH = "高级别"     # 1-3个，从B、C中选择


class SkillTargetType(Enum):
    """技能目标类型"""
    SINGLE = "单体"           # 优先攻击血量最多的怪物
    ALL = "全体"              # 覆盖场上所有怪物
    MULTIPLE = "指定目标数"   # 可选择优先攻击距离最近或血量最少的敌人


class Skill:
    """技能类"""
    
    def __init__(
        self,
        skill_id: str,
        name: str,
        skill_logic: SkillLogic,
        skill_tier: SkillTier,
        cooldown: float = 0.0,  # 冷却时间（秒）
        skill_multiplier: float = 1.0,  # 技能倍率
        physical_damage_ratio: float = 1.0,  # 物理伤害比例
        magical_damage_ratio: float = 0.0,  # 魔法伤害比例
        target_type: SkillTargetType = SkillTargetType.SINGLE,
        target_count: int = 1,  # 目标数量（用于MULTIPLE类型）
        priority_target: str = "highest_health",  # 目标优先级：highest_health, lowest_health, nearest
        description: str = "",
        is_heal: bool = False,  # 是否为治疗技能
        heal_ratio: float = 0.0,  # 治疗比例
        status_effects: List[Dict[str, Any]] = None,  # 状态效果
        effect_tags: List[str] = None,
        telegraph: str = "",
        cast_hint: str = "",
        impact_hint: str = ""
    ):
        """
        初始化技能
        
        Args:
            skill_id: 技能ID
            name: 技能名称
            skill_logic: 技能逻辑类型
            skill_tier: 技能梯度
            cooldown: 冷却时间（秒）
            skill_multiplier: 技能倍率
            physical_damage_ratio: 物理伤害比例
            magical_damage_ratio: 魔法伤害比例
            target_type: 目标类型
            target_count: 目标数量
            priority_target: 目标优先级
            description: 技能描述
            is_heal: 是否为治疗技能
            heal_ratio: 治疗比例
            status_effects: 状态效果列表
        """
        self.skill_id = skill_id
        self.name = name
        self.skill_logic = skill_logic
        self.skill_tier = skill_tier
        self.cooldown = cooldown
        self.skill_multiplier = skill_multiplier
        self.physical_damage_ratio = physical_damage_ratio
        self.magical_damage_ratio = magical_damage_ratio
        self.target_type = target_type
        self.target_count = target_count
        self.priority_target = priority_target
        self.description = description
        self.is_heal = is_heal
        self.heal_ratio = heal_ratio
        self.status_effects = status_effects or []
        self.effect_tags = effect_tags or []
        self.telegraph = telegraph
        self.cast_hint = cast_hint
        self.impact_hint = impact_hint
        
        # 当前冷却时间
        self.current_cooldown = 0.0
    
    def can_use(self) -> bool:
        """检查技能是否可以使用"""
        return self.current_cooldown <= 0
    
    def use(self):
        """使用技能（进入冷却）"""
        self.current_cooldown = self.cooldown
    
    def update_cooldown(self, delta_time: float):
        """更新冷却时间"""
        if self.current_cooldown > 0:
            self.current_cooldown = max(0, self.current_cooldown - delta_time)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "skill_id": self.skill_id,
            "name": self.name,
            "skill_logic": self.skill_logic.value,
            "skill_tier": self.skill_tier.value,
            "cooldown": self.cooldown,
            "current_cooldown": self.current_cooldown,
            "skill_multiplier": self.skill_multiplier,
            "physical_damage_ratio": self.physical_damage_ratio,
            "magical_damage_ratio": self.magical_damage_ratio,
            "target_type": self.target_type.value,
            "target_count": self.target_count,
            "priority_target": self.priority_target,
            "is_heal": self.is_heal,
            "heal_ratio": self.heal_ratio,
            "status_effects": self.status_effects,
            "effect_tags": self.effect_tags,
            "telegraph": self.telegraph,
            "cast_hint": self.cast_hint,
            "impact_hint": self.impact_hint,
            "description": self.description
        }


class SkillSlot:
    """技能槽类"""
    
    def __init__(
        self,
        skill_tier: SkillTier,
        skills: List[Skill]
    ):
        """
        初始化技能槽
        
        Args:
            skill_tier: 技能梯度
            skills: 该梯度的技能列表
        """
        self.skill_tier = skill_tier
        self.skills = skills
    
    def get_random_skill(self) -> Optional[Skill]:
        """随机获取一个可用技能"""
        available_skills = [s for s in self.skills if s.can_use()]
        if not available_skills:
            # 如果没有可用技能，返回第一个技能（即使冷却中）
            if self.skills:
                return self.skills[0]
            return None
        return random.choice(available_skills)
    
    def update_cooldowns(self, delta_time: float):
        """更新所有技能的冷却时间"""
        for skill in self.skills:
            skill.update_cooldown(delta_time)
    
    def get_skill_count(self) -> int:
        """获取技能数量"""
        return len(self.skills)


class SkillManager:
    """技能管理器"""
    
    def __init__(self, battle_unit):
        """
        初始化技能管理器
        
        Args:
            battle_unit: 战斗单位
        """
        self.battle_unit = battle_unit
        
        # 三个梯度的技能槽
        self.low_tier_slots = SkillSlot(SkillTier.LOW, [])
        self.mid_tier_slots = SkillSlot(SkillTier.MID, [])
        self.high_tier_slots = SkillSlot(SkillTier.HIGH, [])
        
        # 当前释放顺序（底→中→高循环）
        self.current_tier_index = 0
        self.tier_order = [SkillTier.LOW, SkillTier.MID, SkillTier.HIGH]
        
        # 上次释放时间
        self.last_skill_time = 0.0
    
    def add_skill(self, skill: Skill):
        """添加技能到对应梯度"""
        if skill.skill_tier == SkillTier.LOW:
            self.low_tier_slots.skills.append(skill)
        elif skill.skill_tier == SkillTier.MID:
            self.mid_tier_slots.skills.append(skill)
        elif skill.skill_tier == SkillTier.HIGH:
            self.high_tier_slots.skills.append(skill)
    
    def get_next_skill(self, current_time: float) -> Optional[Skill]:
        """
        获取下一个要释放的技能
        按照底→中→高的顺序循环，每1秒释放一个
        
        Args:
            current_time: 当前时间（秒）
            
        Returns:
            要释放的技能，如果还没到释放时间返回None
        """
        # 检查是否到了释放时间（每1秒释放一个）
        if current_time - self.last_skill_time < 1.0:
            return None
        
        # 获取当前梯度的技能槽
        current_tier = self.tier_order[self.current_tier_index]
        
        if current_tier == SkillTier.LOW:
            skill = self.low_tier_slots.get_random_skill()
        elif current_tier == SkillTier.MID:
            skill = self.mid_tier_slots.get_random_skill()
        else:  # HIGH
            skill = self.high_tier_slots.get_random_skill()
        
        # 移动到下一个梯度
        self.current_tier_index = (self.current_tier_index + 1) % len(self.tier_order)
        self.last_skill_time = current_time
        
        return skill
    
    def update(self, delta_time: float):
        """更新技能管理器（更新冷却时间）"""
        self.low_tier_slots.update_cooldowns(delta_time)
        self.mid_tier_slots.update_cooldowns(delta_time)
        self.high_tier_slots.update_cooldowns(delta_time)
    
    def validate_skill_configuration(self) -> tuple:
        """
        验证技能配置是否符合要求
        
        Returns:
            (是否有效, 错误信息)
        """
        low_count = self.low_tier_slots.get_skill_count()
        mid_count = self.mid_tier_slots.get_skill_count()
        high_count = self.high_tier_slots.get_skill_count()
        
        # 检查总数是否为9
        total = low_count + mid_count + high_count
        if total != 9:
            return False, f"技能总数必须为9，当前为{total}"
        
        # 检查数量关系：底≥中≥高
        if not (low_count >= mid_count >= high_count):
            return False, f"技能数量关系不符合要求：底({low_count})≥中({mid_count})≥高({high_count})"
        
        # 检查底级别数量范围（3-5）
        if not (3 <= low_count <= 5):
            return False, f"底级别技能数量必须在3-5之间，当前为{low_count}"
        
        # 检查中级别数量范围（2-4）
        if not (2 <= mid_count <= 4):
            return False, f"中级别技能数量必须在2-4之间，当前为{mid_count}"
        
        # 检查高级别数量范围（1-3）
        if not (1 <= high_count <= 3):
            return False, f"高级别技能数量必须在1-3之间，当前为{high_count}"
        
        # 统计各逻辑技能数量
        all_skills = (self.low_tier_slots.skills + 
                     self.mid_tier_slots.skills + 
                     self.high_tier_slots.skills)
        
        a_count = sum(1 for s in all_skills if s.skill_logic == SkillLogic.A)
        b_count = sum(1 for s in all_skills if s.skill_logic == SkillLogic.B)
        c_count = sum(1 for s in all_skills if s.skill_logic == SkillLogic.C)
        
        # 检查A逻辑技能至少5个
        if a_count < 5:
            return False, f"A逻辑技能至少需要5个，当前为{a_count}"
        
        # 检查B逻辑技能不超过5个
        if b_count > 5:
            return False, f"B逻辑技能不能超过5个，当前为{b_count}"
        
        # 检查C逻辑技能最多3个
        if c_count > 3:
            return False, f"C逻辑技能最多3个，当前为{c_count}"
        
        # 检查底级别技能只能从A、B中选择
        for skill in self.low_tier_slots.skills:
            if skill.skill_logic == SkillLogic.C:
                return False, "底级别技能只能从A、B逻辑中选择，不能包含C逻辑"
        
        # 检查中级别技能可以从A、B、C中选择（这个不需要检查，因为都可以）
        
        # 检查高级别技能只能从B、C中选择
        for skill in self.high_tier_slots.skills:
            if skill.skill_logic == SkillLogic.A:
                return False, "高级别技能只能从B、C逻辑中选择，不能包含A逻辑"
        
        return True, "配置有效"
