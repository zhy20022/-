"""
属性系统
包含8种属性及其相克关系
"""

from enum import Enum
from typing import Optional, Dict, Tuple


class AttributeType(Enum):
    """属性类型枚举"""
    FIRE = "火"
    WATER = "水"
    THUNDER = "雷"
    WOOD = "木"
    WIND = "风"
    EARTH = "土"
    LIGHT = "光"
    DARK = "暗"


class Attribute:
    """属性类"""
    
    # 属性相克关系：key克制value
    ADVANTAGE_MAP: Dict[AttributeType, AttributeType] = {
        AttributeType.WIND: AttributeType.FIRE,      # 风克火
        AttributeType.FIRE: AttributeType.WOOD,      # 火克木
        AttributeType.WOOD: AttributeType.WIND,      # 木克风
        AttributeType.THUNDER: AttributeType.WATER,  # 雷克水
        AttributeType.WATER: AttributeType.EARTH,    # 水克土
        AttributeType.EARTH: AttributeType.THUNDER,  # 土克雷
    }
    
    # 相互克制关系
    MUTUAL_COUNTER: Tuple[AttributeType, AttributeType] = (
        AttributeType.LIGHT,
        AttributeType.DARK
    )
    
    def __init__(self, attribute_type: AttributeType):
        """
        初始化属性
        
        Args:
            attribute_type: 属性类型
        """
        self.attribute_type = attribute_type
    
    def get_advantage_against(self) -> Optional[AttributeType]:
        """
        获取被当前属性克制的属性
        
        Returns:
            被克制的属性类型，如果没有则返回None
        """
        return self.ADVANTAGE_MAP.get(self.attribute_type)
    
    def get_disadvantage_against(self) -> Optional[AttributeType]:
        """
        获取克制当前属性的属性
        
        Returns:
            克制当前属性的属性类型，如果没有则返回None
        """
        for attacker, defender in self.ADVANTAGE_MAP.items():
            if defender == self.attribute_type:
                return attacker
        return None
    
    def is_counter_to(self, other: 'Attribute') -> bool:
        """
        判断当前属性是否克制目标属性
        
        Args:
            other: 目标属性
            
        Returns:
            如果克制则返回True，否则返回False
        """
        # 检查直接克制关系
        if self.get_advantage_against() == other.attribute_type:
            return True
        
        # 检查相互克制关系（光暗）
        if (self.attribute_type in self.MUTUAL_COUNTER and 
            other.attribute_type in self.MUTUAL_COUNTER and
            self.attribute_type != other.attribute_type):
            return True
        
        return False
    
    def is_countered_by(self, other: 'Attribute') -> bool:
        """
        判断当前属性是否被目标属性克制
        
        Args:
            other: 目标属性
            
        Returns:
            如果被克制则返回True，否则返回False
        """
        return other.is_counter_to(self)
    
    def calculate_damage_multiplier(self, defender_attribute: 'Attribute') -> float:
        """
        计算伤害倍率
        
        Args:
            defender_attribute: 防御方属性
            
        Returns:
            伤害倍率（1.0为正常，>1.0为克制，<1.0为被克制）
        """
        # 如果攻击方克制防御方
        if self.is_counter_to(defender_attribute):
            return 1.5  # 克制时造成150%伤害
        
        # 如果攻击方被防御方克制
        if self.is_countered_by(defender_attribute):
            return 0.75  # 被克制时造成75%伤害
        
        # 正常伤害
        return 1.0
    
    def __str__(self) -> str:
        return self.attribute_type.value
    
    def __eq__(self, other):
        if not isinstance(other, Attribute):
            return False
        return self.attribute_type == other.attribute_type
    
    def __hash__(self):
        return hash(self.attribute_type)


def get_attribute_advantage(attacker: AttributeType, defender: AttributeType) -> float:
    """
    获取属性相克倍率（便捷函数）
    
    Args:
        attacker: 攻击方属性
        defender: 防御方属性
        
    Returns:
        伤害倍率
    """
    attacker_attr = Attribute(attacker)
    defender_attr = Attribute(defender)
    return attacker_attr.calculate_damage_multiplier(defender_attr)


# 所有属性列表
ALL_ATTRIBUTES = [AttributeType.FIRE, AttributeType.WATER, AttributeType.THUNDER,
                  AttributeType.WOOD, AttributeType.WIND, AttributeType.EARTH,
                  AttributeType.LIGHT, AttributeType.DARK]








