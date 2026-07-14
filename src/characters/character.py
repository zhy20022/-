"""
角色系统
"""

from typing import Optional, Dict, Any
from ..classes.profession import Profession, ProfessionType
from ..attributes.attribute import Attribute, AttributeType
from .illustration import Illustration, IllustrationGender
from .weapon import Weapon, ExclusiveWeapon
from .equipment import EquipmentSet
from .leveling import MAX_CHARACTER_LEVEL, get_exp_for_next_level
from ..versions.version import GameVersion


class Character:
    """角色类"""
    
    def __init__(
        self,
        character_id: str,
        name: str,
        profession: Profession,
        attribute: Attribute,
        version: GameVersion,
        level: int = 1,
        exp: int = 0
    ):
        """
        初始化角色
        
        Args:
            character_id: 角色ID
            name: 角色名称
            profession: 职业
            attribute: 属性
            version: 所属游戏版本
            level: 等级
            exp: 经验值
        """
        self.character_id = character_id
        self.name = name
        self.profession = profession
        self.attribute = attribute
        self.version = version
        self.level = level
        self.exp = exp
        
        # 立绘系统
        self.selected_illustration: Optional[Illustration] = None
        self.available_illustrations: Dict[IllustrationGender, Illustration] = {}
        
        # 装备系统
        self.exclusive_weapon: Optional[ExclusiveWeapon] = None
        self.equipment_set: Optional[EquipmentSet] = None
        
        # 技能学习系统（将在需要时初始化）
        self.skill_learning_system = None
        
        # 角色属性（基于职业基础属性计算）
        self._calculate_stats()
    
    def _calculate_stats(self):
        """计算角色属性"""
        # 基础属性
        base_hp = self.profession.base_hp
        base_attack = self.profession.base_attack
        base_defense = self.profession.base_defense
        base_magic_attack = self.profession.base_magic_attack
        base_magic_defense = self.profession.base_magic_defense
        
        # 等级加成
        level_multiplier = 1 + (self.level - 1) * 0.05
        
        self.hp = int(base_hp * level_multiplier)
        self.attack = int(base_attack * level_multiplier)
        self.defense = int(base_defense * level_multiplier)
        self.magic_attack = int(base_magic_attack * level_multiplier)
        self.magic_defense = int(base_magic_defense * level_multiplier)
        
        # 装备加成
        if self.exclusive_weapon:
            self.attack += self.exclusive_weapon.attack_bonus
            self.magic_attack += self.exclusive_weapon.magic_attack_bonus
        
        if self.equipment_set:
            set_bonus = self.equipment_set.get_set_bonus()
            self.hp += set_bonus.get("hp", 0)
            self.attack += set_bonus.get("attack", 0)
            self.defense += set_bonus.get("defense", 0)
            self.magic_attack += set_bonus.get("magic_attack", 0)
            self.magic_defense += set_bonus.get("magic_defense", 0)
    
    def add_illustration(self, illustration: Illustration):
        """
        添加立绘
        
        Args:
            illustration: 立绘对象
        """
        self.available_illustrations[illustration.gender] = illustration
        
        # 如果还没有选择立绘，自动选择第一个
        if not self.selected_illustration:
            self.selected_illustration = illustration
    
    def select_illustration(self, gender: IllustrationGender):
        """
        选择立绘
        
        Args:
            gender: 立绘性别
            
        Returns:
            如果选择成功返回True
        """
        if gender in self.available_illustrations:
            self.selected_illustration = self.available_illustrations[gender]
            return True
        return False
    
    def get_illustration_for_player(self, player_id: str) -> Optional[Illustration]:
        """
        获取玩家看到的立绘（联机时使用）
        在实际游戏中，每个玩家会看到自己选择的立绘
        
        Args:
            player_id: 玩家ID
            
        Returns:
            立绘对象
        """
        # 这里简化处理，实际应该根据玩家ID返回该玩家选择的立绘
        return self.selected_illustration
    
    def equip_weapon(self, weapon: ExclusiveWeapon):
        """
        装备专属武器
        
        Args:
            weapon: 专属武器
        """
        if weapon.character_id == self.character_id:
            self.exclusive_weapon = weapon
            self._calculate_stats()
    
    def equip_set(self, equipment_set: EquipmentSet):
        """
        装备套装
        
        Args:
            equipment_set: 装备套装
        """
        self.equipment_set = equipment_set
        self._calculate_stats()
    
    def gain_exp(self, exp_amount: int) -> bool:
        """
        获得经验值
        
        Args:
            exp_amount: 经验值数量
            
        Returns:
            如果升级返回True
        """
        if self.is_max_level():
            self.exp = 0
            return False

        self.exp += max(0, int(exp_amount or 0))
        exp_to_next_level = self._get_exp_for_next_level()

        if exp_to_next_level > 0 and self.exp >= exp_to_next_level:
            self.level += 1
            self.exp -= exp_to_next_level
            if self.is_max_level():
                self.exp = 0
            self._calculate_stats()
            return True
        return False
    
    def _get_exp_for_next_level(self) -> int:
        """计算升级所需经验值"""
        return get_exp_for_next_level(self.level)
    
    def is_max_level(self) -> bool:
        """检查是否达到满级"""
        return self.level >= MAX_CHARACTER_LEVEL
    
    def can_use_in_version(self, version: GameVersion) -> bool:
        """
        检查角色是否可以在指定版本中使用
        
        Args:
            version: 游戏版本
            
        Returns:
            如果可以使用返回True
        """
        return self.version == version
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "character_id": self.character_id,
            "name": self.name,
            "profession": self.profession.profession_type.value,
            "attribute": self.attribute.attribute_type.value,
            "version": self.version.version_name,
            "level": self.level,
            "exp": self.exp,
            "hp": self.hp,
            "attack": self.attack,
            "defense": self.defense,
            "magic_attack": self.magic_attack,
            "magic_defense": self.magic_defense,
            "selected_illustration": self.selected_illustration.gender.value if self.selected_illustration else None,
            "has_exclusive_weapon": self.exclusive_weapon is not None,
            "has_equipment_set": self.equipment_set is not None
        }
    
    def __str__(self) -> str:
        return f"{self.name} (Lv.{self.level}) - {self.profession.profession_type.value} - {self.attribute.attribute_type.value}"
