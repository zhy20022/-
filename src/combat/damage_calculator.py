"""
伤害计算系统
实现百分比减伤公式和暴击系统
"""

from typing import Dict, Any, Tuple
from ..attributes.attribute import Attribute, AttributeType
from ..characters.character import Character


class DamageCalculator:
    """伤害计算器"""
    
    def __init__(
        self,
        base_crit_rate: float = 0.10,  # 基础暴击率10%
        base_crit_multiplier: float = 1.5  # 基础暴击倍率1.5倍
    ):
        """
        初始化伤害计算器
        
        Args:
            base_crit_rate: 基础暴击率
            base_crit_multiplier: 基础暴击倍率
        """
        self.base_crit_rate = base_crit_rate
        self.base_crit_multiplier = base_crit_multiplier
    
    def calculate_damage(
        self,
        attacker: Character,
        defender: Character,
        base_damage: float,
        is_physical: bool = True,
        skill_multiplier: float = 1.0,
        attacker_modifiers: Dict[str, float] = None,
        defender_modifiers: Dict[str, float] = None
    ) -> Dict[str, Any]:
        """
        计算伤害
        
        Args:
            attacker: 攻击者角色
            defender: 防御者角色
            base_damage: 基础伤害值
            is_physical: 是否为物理伤害
            skill_multiplier: 技能倍率
            
        Returns:
            伤害计算结果字典
        """
        import random
        
        attacker_modifiers = attacker_modifiers or {}
        defender_modifiers = defender_modifiers or {}

        # 1. 获取攻击和防御属性
        if is_physical:
            attack_stat = attacker.attack + attacker_modifiers.get("attack", 0)
            defense_stat = defender.defense + defender_modifiers.get("defense", 0)
        else:
            attack_stat = attacker.magic_attack + attacker_modifiers.get("magic_attack", 0)
            defense_stat = defender.magic_defense + defender_modifiers.get("magic_defense", 0)
        attack_stat = max(1, attack_stat)
        
        # 2. 计算基础伤害（攻击力 × 技能倍率）
        base_damage_value = attack_stat * skill_multiplier
        
        # 3. 应用百分比减伤公式
        # 减伤率 = 防御力 / (防御力 + 100)
        if defense_stat > 0:
            damage_reduction = defense_stat / (defense_stat + 100)
        else:
            damage_reduction = 0
        
        # 实际伤害 = 基础伤害 × (1 - 减伤率)
        damage_after_reduction = base_damage_value * (1 - damage_reduction)
        
        # 4. 应用属性相克倍率
        attacker_attr = Attribute(attacker.attribute.attribute_type)
        defender_attr = Attribute(defender.attribute.attribute_type)
        attribute_multiplier = attacker_attr.calculate_damage_multiplier(defender_attr)
        
        # 如果克制关系，暴击倍率为1.5倍（用户需求）
        if attribute_multiplier == 1.5:  # 克制关系
            # 克制关系下必定暴击
            is_crit = True
            crit_multiplier = 1.5
        else:
            # 否则按暴击率计算
            is_crit = random.random() < self.base_crit_rate
            crit_multiplier = self.base_crit_multiplier if is_crit else 1.0
        
        # 5. 应用属性倍率和暴击倍率
        final_damage = damage_after_reduction * attribute_multiplier * crit_multiplier
        
        # 6. 确保最小伤害（攻击力的10%）
        min_damage = attack_stat * 0.1
        final_damage = max(final_damage, min_damage)
        
        # 7. 返回结果
        result = {
            "base_damage": base_damage_value,
            "damage_after_reduction": damage_after_reduction,
            "attribute_multiplier": attribute_multiplier,
            "is_crit": is_crit,
            "crit_multiplier": crit_multiplier,
            "final_damage": int(final_damage),
            "is_physical": is_physical
        }
        
        return result
    
    def calculate_dual_damage(
        self,
        attacker: Character,
        defender: Character,
        physical_damage_ratio: float,
        magical_damage_ratio: float,
        skill_multiplier: float = 1.0,
        attacker_modifiers: Dict[str, float] = None,
        defender_modifiers: Dict[str, float] = None
    ) -> Dict[str, Any]:
        """
        计算双重伤害（物理+魔法）
        
        Args:
            attacker: 攻击者角色
            defender: 防御者角色
            physical_damage_ratio: 物理伤害比例
            magical_damage_ratio: 魔法伤害比例
            skill_multiplier: 技能倍率
            
        Returns:
            伤害计算结果字典，包含物理和魔法伤害
        """
        # 计算物理伤害
        physical_result = self.calculate_damage(
            attacker, defender, 0,
            is_physical=True,
            skill_multiplier=skill_multiplier * physical_damage_ratio,
            attacker_modifiers=attacker_modifiers,
            defender_modifiers=defender_modifiers
        )
        
        # 计算魔法伤害
        magical_result = self.calculate_damage(
            attacker, defender, 0,
            is_physical=False,
            skill_multiplier=skill_multiplier * magical_damage_ratio,
            attacker_modifiers=attacker_modifiers,
            defender_modifiers=defender_modifiers
        )
        
        return {
            "physical_damage": physical_result["final_damage"],
            "magical_damage": magical_result["final_damage"],
            "physical_result": physical_result,
            "magical_result": magical_result,
            "total_damage": physical_result["final_damage"] + magical_result["final_damage"]
        }







