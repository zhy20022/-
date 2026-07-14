"""
制作系统
实现专属道具制作、套装制作等
"""

from enum import Enum
from typing import Dict, Any, Optional
from ..rewards.material import MaterialBag, MaterialType
from ..characters.weapon import ExclusiveWeapon
from ..characters.equipment import Equipment, EquipmentSet, EquipmentSlot
from ..attributes.attribute import AttributeType


class CraftingType(Enum):
    """制作类型"""
    EXCLUSIVE_ITEM = "专属道具"
    EQUIPMENT_SET = "套装"


class CraftingResult:
    """制作结果"""
    
    def __init__(
        self,
        crafting_type: CraftingType,
        item: Any,
        success: bool = True,
        message: str = ""
    ):
        """
        初始化制作结果
        
        Args:
            crafting_type: 制作类型
            item: 制作出的物品（专属道具或套装部件）
            success: 是否成功
            message: 结果消息
        """
        self.crafting_type = crafting_type
        self.item = item
        self.success = success
        self.message = message
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "crafting_type": self.crafting_type.value,
            "item": self.item.to_dict() if hasattr(self.item, 'to_dict') else str(self.item),
            "success": self.success,
            "message": self.message
        }


class CraftingSystem:
    """制作系统"""
    
    # 制作消耗
    EXCLUSIVE_ITEM_MATERIAL_COST = 20  # 专属道具：20个专属道具材料
    EQUIPMENT_SET_MATERIAL_COST = 1    # 套装：1份套装材料
    
    def __init__(self, player_id: str, material_bag: MaterialBag):
        """
        初始化制作系统
        
        Args:
            player_id: 玩家ID
            material_bag: 材料背包
        """
        self.player_id = player_id
        self.material_bag = material_bag
        self.crafted_items: list = []  # 制作历史
    
    def craft_exclusive_item(
        self,
        character_id: str,
        weapon_id: str = None
    ) -> CraftingResult:
        """
        制作专属道具
        
        Args:
            character_id: 角色ID
            weapon_id: 武器ID（如果为None，自动生成）
            
        Returns:
            制作结果
        """
        # 检查材料是否足够
        # 需要找到专属道具材料（通用材料，没有属性）
        exclusive_materials = self.material_bag.filter_materials(
            material_type=MaterialType.EXCLUSIVE_ITEM
        )
        
        if not exclusive_materials:
            return CraftingResult(
                CraftingType.EXCLUSIVE_ITEM,
                None,
                False,
                "材料不足！需要20个专属道具材料"
            )
        
        # 检查是否有足够的材料
        total_materials = sum(exclusive_materials.values())
        if total_materials < CraftingSystem.EXCLUSIVE_ITEM_MATERIAL_COST:
            return CraftingResult(
                CraftingType.EXCLUSIVE_ITEM,
                None,
                False,
                f"材料不足！需要{CraftingSystem.EXCLUSIVE_ITEM_MATERIAL_COST}个专属道具材料，当前只有{total_materials}个"
            )
        
        # 消耗材料（从第一个材料开始消耗）
        material_id = list(exclusive_materials.keys())[0]
        self.material_bag.remove_material(
            material_id,
            CraftingSystem.EXCLUSIVE_ITEM_MATERIAL_COST
        )
        
        # 创建专属道具
        if weapon_id is None:
            weapon_id = f"exclusive_{character_id}_{len(self.crafted_items)}"
        
        exclusive_weapon = ExclusiveWeapon(
            weapon_id=weapon_id,
            name=f"{character_id}的专属道具",
            character_id=character_id,
            attack_bonus=100,
            magic_attack_bonus=100,
            description="通过制作获得的专属道具"
        )
        
        self.crafted_items.append(exclusive_weapon)
        
        return CraftingResult(
            CraftingType.EXCLUSIVE_ITEM,
            exclusive_weapon,
            True,
            f"成功制作专属道具：{exclusive_weapon.name}"
        )
    
    def craft_equipment_set_piece(
        self,
        attribute_type: AttributeType,
        profession_category: str,
        slot: EquipmentSlot
    ) -> CraftingResult:
        """
        制作套装部件
        
        Args:
            attribute_type: 属性类型
            profession_category: 职业类别（A/B/C/D）
                A: 物理坦克和法系坦克
                B: 物理近战和物理远程
                C: 法系近战和法系远程
                D: 治疗和辅助
            slot: 装备槽位（头肩胸手腿脚）
            
        Returns:
            制作结果
        """
        # 检查材料是否足够
        # 需要找到对应属性的套装材料
        set_materials = self.material_bag.filter_materials(
            material_type=MaterialType.EQUIPMENT_SET,
            attribute_type=attribute_type
        )
        
        if not set_materials:
            return CraftingResult(
                CraftingType.EQUIPMENT_SET,
                None,
                False,
                f"材料不足！需要1份{attribute_type.value}属性的套装材料"
            )
        
        # 检查是否有足够的材料
        total_materials = sum(set_materials.values())
        if total_materials < CraftingSystem.EQUIPMENT_SET_MATERIAL_COST:
            return CraftingResult(
                CraftingType.EQUIPMENT_SET,
                None,
                False,
                f"材料不足！需要{CraftingSystem.EQUIPMENT_SET_MATERIAL_COST}份套装材料，当前只有{total_materials}份"
            )
        
        # 消耗材料（从第一个材料开始消耗）
        material_id = list(set_materials.keys())[0]
        self.material_bag.remove_material(
            material_id,
            CraftingSystem.EQUIPMENT_SET_MATERIAL_COST
        )
        
        # 创建套装部件
        equipment_id = f"set_{attribute_type.value}_{profession_category}_{slot.value}_{len(self.crafted_items)}"
        equipment_name = f"{attribute_type.value}系{profession_category}类{slot.value}"
        
        # 根据职业类别和槽位设置属性加成
        base_hp = 100
        base_attack = 50
        base_defense = 50
        
        equipment = Equipment(
            equipment_id=equipment_id,
            name=equipment_name,
            slot=slot,
            hp_bonus=base_hp,
            attack_bonus=base_attack,
            defense_bonus=base_defense,
            description=f"{attribute_type.value}属性套装部件"
        )
        
        self.crafted_items.append(equipment)
        
        return CraftingResult(
            CraftingType.EQUIPMENT_SET,
            equipment,
            True,
            f"成功制作套装部件：{equipment.name}"
        )
    
    def get_crafting_history(self) -> list:
        """获取制作历史"""
        return self.crafted_items.copy()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "player_id": self.player_id,
            "crafted_items_count": len(self.crafted_items),
            "crafted_items": [item.to_dict() if hasattr(item, 'to_dict') else str(item) for item in self.crafted_items]
        }


