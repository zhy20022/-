"""
装备系统
"""

from typing import Dict, Any, List, Optional
from enum import Enum


class EquipmentSlot(Enum):
    """装备槽位"""
    HELMET = "头盔"
    CHEST = "胸甲"
    LEGS = "护腿"
    BOOTS = "靴子"
    GLOVES = "手套"
    ACCESSORY = "饰品"


class Equipment:
    """装备类"""
    
    def __init__(
        self,
        equipment_id: str,
        name: str,
        slot: EquipmentSlot,
        hp_bonus: int = 0,
        attack_bonus: int = 0,
        defense_bonus: int = 0,
        magic_attack_bonus: int = 0,
        magic_defense_bonus: int = 0,
        description: str = ""
    ):
        """
        初始化装备
        
        Args:
            equipment_id: 装备ID
            name: 装备名称
            slot: 装备槽位
            hp_bonus: 生命值加成
            attack_bonus: 物理攻击加成
            defense_bonus: 物理防御加成
            magic_attack_bonus: 魔法攻击加成
            magic_defense_bonus: 魔法防御加成
            description: 装备描述
        """
        self.equipment_id = equipment_id
        self.name = name
        self.slot = slot
        self.hp_bonus = hp_bonus
        self.attack_bonus = attack_bonus
        self.defense_bonus = defense_bonus
        self.magic_attack_bonus = magic_attack_bonus
        self.magic_defense_bonus = magic_defense_bonus
        self.description = description
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "equipment_id": self.equipment_id,
            "name": self.name,
            "slot": self.slot.value,
            "hp_bonus": self.hp_bonus,
            "attack_bonus": self.attack_bonus,
            "defense_bonus": self.defense_bonus,
            "magic_attack_bonus": self.magic_attack_bonus,
            "magic_defense_bonus": self.magic_defense_bonus,
            "description": self.description
        }
    
    def __str__(self) -> str:
        return f"{self.name} ({self.slot.value})"


class EquipmentSet:
    """装备套装"""
    
    def __init__(
        self,
        set_id: str,
        name: str,
        pieces: List[Equipment],
        set_bonus_2: Optional[Dict[str, int]] = None,
        set_bonus_4: Optional[Dict[str, int]] = None,
        set_bonus_6: Optional[Dict[str, int]] = None,
        description: str = ""
    ):
        """
        初始化装备套装
        
        Args:
            set_id: 套装ID
            name: 套装名称
            pieces: 套装部件列表
            set_bonus_2: 2件套加成
            set_bonus_4: 4件套加成
            set_bonus_6: 6件套加成
            description: 套装描述
        """
        self.set_id = set_id
        self.name = name
        self.pieces = pieces
        self.set_bonus_2 = set_bonus_2 or {}
        self.set_bonus_4 = set_bonus_4 or {}
        self.set_bonus_6 = set_bonus_6 or {}
        self.description = description
        self.equipped_pieces: List[Equipment] = []
    
    def equip_piece(self, equipment: Equipment) -> bool:
        """
        装备套装部件
        
        Args:
            equipment: 装备
            
        Returns:
            如果装备成功返回True
        """
        if equipment not in self.pieces:
            return False
        
        if equipment in self.equipped_pieces:
            return False
        
        self.equipped_pieces.append(equipment)
        return True
    
    def unequip_piece(self, equipment: Equipment) -> bool:
        """
        卸下套装部件
        
        Args:
            equipment: 装备
            
        Returns:
            如果卸下成功返回True
        """
        if equipment in self.equipped_pieces:
            self.equipped_pieces.remove(equipment)
            return True
        return False
    
    def get_equipped_count(self) -> int:
        """获取已装备的套装部件数量"""
        return len(self.equipped_pieces)
    
    def get_set_bonus(self) -> Dict[str, int]:
        """
        获取当前套装加成
        
        Returns:
            加成字典
        """
        equipped_count = self.get_equipped_count()
        bonus = {
            "hp": 0,
            "attack": 0,
            "defense": 0,
            "magic_attack": 0,
            "magic_defense": 0
        }
        
        # 应用套装效果
        if equipped_count >= 6 and self.set_bonus_6:
            for key, value in self.set_bonus_6.items():
                bonus[key] += value
        elif equipped_count >= 4 and self.set_bonus_4:
            for key, value in self.set_bonus_4.items():
                bonus[key] += value
        elif equipped_count >= 2 and self.set_bonus_2:
            for key, value in self.set_bonus_2.items():
                bonus[key] += value
        
        # 应用单件装备加成
        for piece in self.equipped_pieces:
            bonus["hp"] += piece.hp_bonus
            bonus["attack"] += piece.attack_bonus
            bonus["defense"] += piece.defense_bonus
            bonus["magic_attack"] += piece.magic_attack_bonus
            bonus["magic_defense"] += piece.magic_defense_bonus
        
        return bonus
    
    def is_complete(self) -> bool:
        """检查套装是否完整（6件）"""
        return len(self.equipped_pieces) >= 6
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "set_id": self.set_id,
            "name": self.name,
            "description": self.description,
            "total_pieces": len(self.pieces),
            "equipped_pieces": len(self.equipped_pieces),
            "is_complete": self.is_complete(),
            "set_bonus": self.get_set_bonus(),
            "set_bonus_2": self.set_bonus_2,
            "set_bonus_4": self.set_bonus_4,
            "set_bonus_6": self.set_bonus_6
        }
    
    def __str__(self) -> str:
        return f"{self.name} ({len(self.equipped_pieces)}/6)"








