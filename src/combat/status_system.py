"""
状态系统
实现Buff/Debuff/HOT/DOT等状态效果
"""

from enum import Enum
from typing import Dict, Any, List, Optional
from abc import ABC, abstractmethod


class StatusType(Enum):
    """状态类型"""
    BUFF = "增益"           # 增益效果
    DEBUFF = "减益"         # 减益效果
    HOT = "持续回复"        # 持续回复（Heal Over Time）
    DOT = "持续伤害"        # 持续伤害（Damage Over Time）


class StatusEffect:
    """状态效果类"""
    
    def __init__(
        self,
        status_id: str,
        name: str,
        status_type: StatusType,
        duration: float,  # 持续时间（秒）
        value: float = 0.0,  # 效果数值
        effect_type: str = "",  # 效果类型（如：attack_boost, defense_boost等）
        tick_interval: float = 1.0,  # 触发间隔（秒，用于HOT/DOT）
        description: str = ""
    ):
        """
        初始化状态效果
        
        Args:
            status_id: 状态ID
            name: 状态名称
            status_type: 状态类型
            duration: 持续时间（秒）
            value: 效果数值
            effect_type: 效果类型
            tick_interval: 触发间隔（秒）
            description: 状态描述
        """
        self.status_id = status_id
        self.name = name
        self.status_type = status_type
        self.duration = duration
        self.remaining_time = duration
        self.value = value
        self.effect_type = effect_type
        self.tick_interval = tick_interval
        self.next_tick_time = tick_interval
        self.description = description
    
    def update(self, delta_time: float) -> Dict[str, Any]:
        """
        更新状态效果
        
        Args:
            delta_time: 时间增量（秒）
            
        Returns:
            返回需要处理的效果（如HOT/DOT的伤害/治疗）
        """
        result = {
            "should_remove": False,
            "damage": 0,
            "heal": 0,
            "stat_modifier": {}
        }
        
        # 减少剩余时间
        self.remaining_time -= delta_time
        
        # 检查是否过期
        if self.remaining_time <= 0:
            result["should_remove"] = True
            return result
        
        # 对于HOT/DOT类型，检查是否需要触发
        if self.status_type in [StatusType.HOT, StatusType.DOT]:
            self.next_tick_time -= delta_time
            if self.next_tick_time <= 0:
                if self.status_type == StatusType.HOT:
                    result["heal"] = int(self.value)
                elif self.status_type == StatusType.DOT:
                    result["damage"] = int(self.value)
                # 重置下次触发时间
                self.next_tick_time = self.tick_interval
        
        # 对于Buff/Debuff类型，返回属性修正
        if self.status_type in [StatusType.BUFF, StatusType.DEBUFF]:
            modifier = self.value
            if self.status_type == StatusType.DEBUFF:
                modifier = -modifier  # Debuff为负值
            
            if self.effect_type == "attack_boost":
                result["stat_modifier"]["attack"] = modifier
            elif self.effect_type == "defense_boost":
                result["stat_modifier"]["defense"] = modifier
            elif self.effect_type == "magic_attack_boost":
                result["stat_modifier"]["magic_attack"] = modifier
            elif self.effect_type == "magic_defense_boost":
                result["stat_modifier"]["magic_defense"] = modifier
            elif self.effect_type == "speed_boost":
                result["stat_modifier"]["speed"] = modifier
        
        return result
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "status_id": self.status_id,
            "name": self.name,
            "status_type": self.status_type.value,
            "duration": self.duration,
            "remaining_time": self.remaining_time,
            "value": self.value,
            "effect_type": self.effect_type,
            "description": self.description
        }


class StatusManager:
    """状态管理器"""
    
    def __init__(self, battle_unit):
        """
        初始化状态管理器
        
        Args:
            battle_unit: 战斗单位
        """
        self.battle_unit = battle_unit
        self.status_effects: List[StatusEffect] = []
    
    def add_status(self, status: StatusEffect):
        """添加状态效果"""
        # 检查是否已存在相同效果
        existing = self.get_status_by_id(status.status_id)
        if existing:
            # 如果已存在，刷新持续时间
            existing.remaining_time = status.duration
        else:
            # 添加新状态
            self.status_effects.append(status)
    
    def remove_status(self, status_id: str):
        """移除状态效果"""
        self.status_effects = [s for s in self.status_effects if s.status_id != status_id]
    
    def get_status_by_id(self, status_id: str) -> Optional[StatusEffect]:
        """根据ID获取状态效果"""
        for status in self.status_effects:
            if status.status_id == status_id:
                return status
        return None
    
    def update(self, delta_time: float) -> Dict[str, Any]:
        """
        更新所有状态效果
        
        Args:
            delta_time: 时间增量（秒）
            
        Returns:
            返回所有效果的总和
        """
        result = {
            "damage": 0,
            "heal": 0,
            "stat_modifier": {
                "attack": 0,
                "defense": 0,
                "magic_attack": 0,
                "magic_defense": 0,
                "speed": 0
            }
        }
        
        # 更新所有状态效果
        statuses_to_remove = []
        for status in self.status_effects:
            status_result = status.update(delta_time)
            
            # 累加效果
            result["damage"] += status_result.get("damage", 0)
            result["heal"] += status_result.get("heal", 0)
            
            # 累加属性修正
            stat_mod = status_result.get("stat_modifier", {})
            for key, value in stat_mod.items():
                if key in result["stat_modifier"]:
                    result["stat_modifier"][key] += value
            
            # 标记需要移除的状态
            if status_result.get("should_remove", False):
                statuses_to_remove.append(status.status_id)
        
        # 移除过期的状态
        for status_id in statuses_to_remove:
            self.remove_status(status_id)
        
        return result
    
    def get_stat_modifiers(self) -> Dict[str, float]:
        """获取所有属性修正"""
        modifiers = {
            "attack": 0,
            "defense": 0,
            "magic_attack": 0,
            "magic_defense": 0,
            "speed": 0
        }
        
        for status in self.status_effects:
            if status.status_type in [StatusType.BUFF, StatusType.DEBUFF]:
                modifier = status.value
                if status.status_type == StatusType.DEBUFF:
                    modifier = -modifier
                
                if status.effect_type == "attack_boost":
                    modifiers["attack"] += modifier
                elif status.effect_type == "defense_boost":
                    modifiers["defense"] += modifier
                elif status.effect_type == "magic_attack_boost":
                    modifiers["magic_attack"] += modifier
                elif status.effect_type == "magic_defense_boost":
                    modifiers["magic_defense"] += modifier
                elif status.effect_type == "speed_boost":
                    modifiers["speed"] += modifier
        
        return modifiers
    
    def has_status(self, status_id: str) -> bool:
        """检查是否拥有指定状态"""
        return self.get_status_by_id(status_id) is not None
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "status_effects": [s.to_dict() for s in self.status_effects],
            "stat_modifiers": self.get_stat_modifiers()
        }







