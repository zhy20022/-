"""
职业定义
"""

from enum import Enum
from typing import Dict, Any


class ProfessionType(Enum):
    """职业类型枚举"""
    PHYSICAL_TANK = "物理坦克"
    PHYSICAL_MELEE_DPS = "物理近战输出"
    PHYSICAL_RANGED_DPS = "物理远程输出"
    MAGIC_TANK = "法系坦克"
    MAGIC_MELEE_DPS = "法系近战输出"
    MAGIC_RANGED_DPS = "法系远程输出"
    HEALER = "治疗"
    SUPPORT = "辅助"


class Profession:
    """职业类"""
    
    def __init__(
        self,
        profession_type: ProfessionType,
        base_hp: int = 1000,
        base_attack: int = 100,
        base_defense: int = 100,
        base_magic_attack: int = 100,
        base_magic_defense: int = 100,
        description: str = ""
    ):
        """
        初始化职业
        
        Args:
            profession_type: 职业类型
            base_hp: 基础生命值
            base_attack: 基础物理攻击
            base_defense: 基础物理防御
            base_magic_attack: 基础魔法攻击
            base_magic_defense: 基础魔法防御
            description: 职业描述
        """
        self.profession_type = profession_type
        self.base_hp = base_hp
        self.base_attack = base_attack
        self.base_defense = base_defense
        self.base_magic_attack = base_magic_attack
        self.base_magic_defense = base_magic_defense
        self.description = description or self._get_default_description()
    
    def _get_default_description(self) -> str:
        """获取默认职业描述"""
        descriptions = {
            ProfessionType.PHYSICAL_TANK: "高防御、高生命值的物理坦克，负责吸引怪物仇恨",
            ProfessionType.PHYSICAL_MELEE_DPS: "近距离物理伤害输出职业",
            ProfessionType.PHYSICAL_RANGED_DPS: "远距离物理伤害输出职业",
            ProfessionType.MAGIC_TANK: "魔法防御型坦克，使用魔法护盾保护团队",
            ProfessionType.MAGIC_MELEE_DPS: "近距离魔法伤害输出职业",
            ProfessionType.MAGIC_RANGED_DPS: "远距离魔法伤害输出职业",
            ProfessionType.HEALER: "恢复队友生命值和状态的治疗职业",
            ProfessionType.SUPPORT: "提供增益效果和团队支援的辅助职业"
        }
        return descriptions.get(self.profession_type, "")
    
    def is_physical(self) -> bool:
        """判断是否为物理职业"""
        return self.profession_type in [
            ProfessionType.PHYSICAL_TANK,
            ProfessionType.PHYSICAL_MELEE_DPS,
            ProfessionType.PHYSICAL_RANGED_DPS
        ]
    
    def is_magic(self) -> bool:
        """判断是否为法系职业"""
        return self.profession_type in [
            ProfessionType.MAGIC_TANK,
            ProfessionType.MAGIC_MELEE_DPS,
            ProfessionType.MAGIC_RANGED_DPS
        ]
    
    def is_tank(self) -> bool:
        """判断是否为坦克职业"""
        return self.profession_type in [
            ProfessionType.PHYSICAL_TANK,
            ProfessionType.MAGIC_TANK
        ]
    
    def is_dps(self) -> bool:
        """判断是否为输出职业"""
        return self.profession_type in [
            ProfessionType.PHYSICAL_MELEE_DPS,
            ProfessionType.PHYSICAL_RANGED_DPS,
            ProfessionType.MAGIC_MELEE_DPS,
            ProfessionType.MAGIC_RANGED_DPS
        ]
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "profession_type": self.profession_type.value,
            "base_hp": self.base_hp,
            "base_attack": self.base_attack,
            "base_defense": self.base_defense,
            "base_magic_attack": self.base_magic_attack,
            "base_magic_defense": self.base_magic_defense,
            "description": self.description
        }
    
    def __str__(self) -> str:
        return f"{self.profession_type.value}: {self.description}"


# 预定义职业配置
PROFESSION_CONFIGS = {
    ProfessionType.PHYSICAL_TANK: Profession(
        ProfessionType.PHYSICAL_TANK,
        base_hp=2000,
        base_attack=80,
        base_defense=200,
        base_magic_attack=50,
        base_magic_defense=150
    ),
    ProfessionType.PHYSICAL_MELEE_DPS: Profession(
        ProfessionType.PHYSICAL_MELEE_DPS,
        base_hp=1200,
        base_attack=180,
        base_defense=100,
        base_magic_attack=50,
        base_magic_defense=80
    ),
    ProfessionType.PHYSICAL_RANGED_DPS: Profession(
        ProfessionType.PHYSICAL_RANGED_DPS,
        base_hp=1000,
        base_attack=160,
        base_defense=80,
        base_magic_attack=50,
        base_magic_defense=80
    ),
    ProfessionType.MAGIC_TANK: Profession(
        ProfessionType.MAGIC_TANK,
        base_hp=1800,
        base_attack=60,
        base_defense=120,
        base_magic_attack=80,
        base_magic_defense=220
    ),
    ProfessionType.MAGIC_MELEE_DPS: Profession(
        ProfessionType.MAGIC_MELEE_DPS,
        base_hp=1100,
        base_attack=70,
        base_defense=90,
        base_magic_attack=190,
        base_magic_defense=100
    ),
    ProfessionType.MAGIC_RANGED_DPS: Profession(
        ProfessionType.MAGIC_RANGED_DPS,
        base_hp=900,
        base_attack=50,
        base_defense=70,
        base_magic_attack=170,
        base_magic_defense=100
    ),
    ProfessionType.HEALER: Profession(
        ProfessionType.HEALER,
        base_hp=1000,
        base_attack=60,
        base_defense=80,
        base_magic_attack=150,
        base_magic_defense=120
    ),
    ProfessionType.SUPPORT: Profession(
        ProfessionType.SUPPORT,
        base_hp=1100,
        base_attack=70,
        base_defense=90,
        base_magic_attack=130,
        base_magic_defense=110
    )
}


def get_profession(profession_type: ProfessionType) -> Profession:
    """获取职业实例"""
    return PROFESSION_CONFIGS[profession_type]








