"""
武器系统
"""

from typing import Dict, Any
from abc import ABC, abstractmethod


class Weapon(ABC):
    """武器基类"""
    
    def __init__(
        self,
        weapon_id: str,
        name: str,
        attack_bonus: int = 0,
        magic_attack_bonus: int = 0,
        description: str = ""
    ):
        """
        初始化武器
        
        Args:
            weapon_id: 武器ID
            name: 武器名称
            attack_bonus: 物理攻击加成
            magic_attack_bonus: 魔法攻击加成
            description: 武器描述
        """
        self.weapon_id = weapon_id
        self.name = name
        self.attack_bonus = attack_bonus
        self.magic_attack_bonus = magic_attack_bonus
        self.description = description
    
    @abstractmethod
    def get_weapon_skill(self) -> Dict[str, Any]:
        """获取武器技能（子类实现）"""
        pass
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "weapon_id": self.weapon_id,
            "name": self.name,
            "attack_bonus": self.attack_bonus,
            "magic_attack_bonus": self.magic_attack_bonus,
            "description": self.description
        }
    
    def __str__(self) -> str:
        return f"{self.name} (+{self.attack_bonus} 物攻, +{self.magic_attack_bonus} 魔攻)"


class ExclusiveWeapon(Weapon):
    """专属武器"""
    
    def __init__(
        self,
        weapon_id: str,
        name: str,
        character_id: str,
        attack_bonus: int = 100,
        magic_attack_bonus: int = 100,
        description: str = "",
        special_skill: Dict[str, Any] = None
    ):
        """
        初始化专属武器
        
        Args:
            weapon_id: 武器ID
            name: 武器名称
            character_id: 所属角色ID
            attack_bonus: 物理攻击加成
            magic_attack_bonus: 魔法攻击加成
            description: 武器描述
            special_skill: 特殊技能
        """
        super().__init__(weapon_id, name, attack_bonus, magic_attack_bonus, description)
        self.character_id = character_id
        self.special_skill = special_skill or {
            "name": "专属技能",
            "description": "角色专属技能",
            "cooldown": 30,
            "damage_multiplier": 1.5
        }
    
    def get_weapon_skill(self) -> Dict[str, Any]:
        """获取武器技能"""
        return self.special_skill
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        result = super().to_dict()
        result.update({
            "character_id": self.character_id,
            "special_skill": self.special_skill,
            "type": "专属武器"
        })
        return result
    
    def __str__(self) -> str:
        return f"{self.name} (专属) - {self.character_id}"








