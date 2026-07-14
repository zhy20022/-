"""
敌人/怪物类
实现怪物的基础属性、等级、职业等
"""

from enum import Enum
from typing import Dict, Any, Optional
from ..attributes.attribute import Attribute, AttributeType
from ..classes.profession import Profession, ProfessionType
from ..combat.battle_unit import BattleUnit
from ..characters.character import Character
from ..versions.version import GameVersion
from datetime import datetime


class EnemyType(Enum):
    """敌人类型"""
    SINGLE = "单体小怪"      # 单个小怪
    GROUP_3 = "群体小怪3个"  # 3个小怪一组
    GROUP_5 = "群体小怪5个"  # 5个小怪一组
    BOSS = "Boss"           # Boss


class Enemy:
    """敌人/怪物类"""
    
    def __init__(
        self,
        enemy_id: str,
        name: str,
        attribute_type: AttributeType,
        level: int,
        base_hp: int,
        base_attack: int,
        base_defense: int,
        base_magic_attack: int = 0,
        base_magic_defense: int = 0,
        profession: Optional[Profession] = None,
        version: Optional[GameVersion] = None,
        is_boss: bool = False
    ):
        """
        初始化敌人
        
        Args:
            enemy_id: 敌人ID
            name: 敌人名称
            attribute_type: 属性类型
            level: 等级
            base_hp: 基础生命值
            base_attack: 基础攻击力
            base_defense: 基础防御力
            base_magic_attack: 基础魔法攻击力
            base_magic_defense: 基础魔法防御力
            profession: 职业（Boss有职业，小怪没有）
            version: 游戏版本
            is_boss: 是否为Boss
        """
        self.enemy_id = enemy_id
        self.name = name
        self.attribute_type = attribute_type
        self.level = level
        self.base_hp = base_hp
        self.base_attack = base_attack
        self.base_defense = base_defense
        self.base_magic_attack = base_magic_attack
        self.base_magic_defense = base_magic_defense
        self.profession = profession
        self.version = version
        self.is_boss = is_boss
        
        # 创建角色对象（用于战斗系统）
        self.character = self._create_character()
        
        # 创建战斗单位
        self.battle_unit = BattleUnit(self.character, is_player=False)
    
    def _create_character(self) -> Character:
        """创建角色对象"""
        # 如果没有职业，使用默认职业（物理近战输出）
        if self.profession is None:
            from ..classes.profession import get_profession, ProfessionType
            self.profession = get_profession(ProfessionType.PHYSICAL_MELEE_DPS)
        
        # 如果没有版本，创建默认版本
        if self.version is None:
            self.version = GameVersion(
                version_id="v1.0",
                version_name="第一纪元",
                era_name="初始纪元",
                era_year=0,
                release_date=datetime.now()
            )
        
        # 创建属性
        attribute = Attribute(self.attribute_type)
        
        # 创建角色
        character = Character(
            character_id=self.enemy_id,
            name=self.name,
            profession=self.profession,
            attribute=attribute,
            version=self.version,
            level=self.level
        )
        
        # 直接设置角色属性（覆盖职业基础属性）
        # 注意：这里直接修改属性，不通过_calculate_stats()
        # 先调用_calculate_stats()计算基础属性，然后覆盖
        character._calculate_stats()
        
        # 覆盖为怪物属性
        character.hp = self.base_hp
        character.attack = self.base_attack
        character.defense = self.base_defense
        character.magic_attack = self.base_magic_attack
        character.magic_defense = self.base_magic_defense
        
        return character
    
    def apply_time_multiplier(self, time_multiplier: float):
        """
        应用时间倍率（怪物随时间变强）
        
        Args:
            time_multiplier: 时间倍率（如：1.0 + 时间秒数 * 0.01）
        """
        self.base_hp = int(self.base_hp * time_multiplier)
        self.base_attack = int(self.base_attack * time_multiplier)
        self.base_defense = int(self.base_defense * time_multiplier)
        self.base_magic_attack = int(self.base_magic_attack * time_multiplier)
        self.base_magic_defense = int(self.base_magic_defense * time_multiplier)
        
        # 更新角色属性
        self.character.hp = self.base_hp
        self.character.attack = self.base_attack
        self.character.defense = self.base_defense
        self.character.magic_attack = self.base_magic_attack
        self.character.magic_defense = self.base_magic_defense
        
        # 重新计算战斗单位属性
        self.battle_unit._init_health()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "enemy_id": self.enemy_id,
            "name": self.name,
            "attribute_type": self.attribute_type.value,
            "level": self.level,
            "base_hp": self.base_hp,
            "base_attack": self.base_attack,
            "base_defense": self.base_defense,
            "is_boss": self.is_boss,
            "has_profession": self.profession is not None
        }
    
    def __str__(self) -> str:
        return f"{self.name} (Lv.{self.level}) - {self.attribute_type.value}"

