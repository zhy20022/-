"""
升级系统
实现专属道具升级、套装升级等
"""

from enum import Enum
from typing import Dict, Any, Optional
from ..rewards.material import MaterialBag, MaterialType
from ..characters.weapon import ExclusiveWeapon
from ..characters.equipment import Equipment, EquipmentSet
from ..attributes.attribute import AttributeType


class UpgradeType(Enum):
    """升级类型"""
    EXCLUSIVE_ITEM = "专属道具"
    EQUIPMENT_SET = "套装"


class UpgradeResult:
    """升级结果"""
    
    def __init__(
        self,
        upgrade_type: UpgradeType,
        item: Any,
        new_level: int,
        success: bool = True,
        message: str = ""
    ):
        """
        初始化升级结果
        
        Args:
            upgrade_type: 升级类型
            item: 升级后的物品
            new_level: 新等级
            success: 是否成功
            message: 结果消息
        """
        self.upgrade_type = upgrade_type
        self.item = item
        self.new_level = new_level
        self.success = success
        self.message = message
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "upgrade_type": self.upgrade_type.value,
            "item": self.item.to_dict() if hasattr(self.item, 'to_dict') else str(self.item),
            "new_level": self.new_level,
            "success": self.success,
            "message": self.message
        }


class UpgradeSystem:
    """升级系统"""
    
    # 专属道具升级消耗（5个等级：0->1, 1->2, 2->3, 3->4, 4->5）
    EXCLUSIVE_ITEM_UPGRADE_COSTS = [40, 80, 160, 320]  # 每一级需要的材料递增
    
    # 套装升级消耗（5个等级：0->1, 1->2, 2->3, 3->4, 4->5）
    EQUIPMENT_SET_UPGRADE_COSTS = [2, 4, 8, 16]  # 每一级需要的材料增加
    
    MAX_LEVEL = 5  # 最大等级
    
    def __init__(self, player_id: str, material_bag: MaterialBag):
        """
        初始化升级系统
        
        Args:
            player_id: 玩家ID
            material_bag: 材料背包
        """
        self.player_id = player_id
        self.material_bag = material_bag
    
    def upgrade_exclusive_item(
        self,
        exclusive_item: ExclusiveWeapon,
        current_level: int
    ) -> UpgradeResult:
        """
        升级专属道具
        
        Args:
            exclusive_item: 专属道具
            current_level: 当前等级（0-4，最高5级）
            
        Returns:
            升级结果
        """
        # 检查等级
        if current_level >= UpgradeSystem.MAX_LEVEL:
            return UpgradeResult(
                UpgradeType.EXCLUSIVE_ITEM,
                exclusive_item,
                current_level,
                False,
                f"专属道具已达到最大等级（{UpgradeSystem.MAX_LEVEL}级）"
            )
        
        # 获取升级消耗
        cost = UpgradeSystem.EXCLUSIVE_ITEM_UPGRADE_COSTS[current_level]
        
        # 检查材料是否足够
        exclusive_materials = self.material_bag.filter_materials(
            material_type=MaterialType.EXCLUSIVE_ITEM
        )
        
        total_materials = sum(exclusive_materials.values())
        if total_materials < cost:
            return UpgradeResult(
                UpgradeType.EXCLUSIVE_ITEM,
                exclusive_item,
                current_level,
                False,
                f"材料不足！需要{cost}个专属道具材料，当前只有{total_materials}个"
            )
        
        # 消耗材料
        material_id = list(exclusive_materials.keys())[0]
        self.material_bag.remove_material(material_id, cost)
        
        # 升级专属道具（提升属性）
        new_level = current_level + 1
        level_multiplier = 1 + (new_level * 0.1)  # 每级提升10%属性
        
        exclusive_item.attack_bonus = int(exclusive_item.attack_bonus * level_multiplier)
        exclusive_item.magic_attack_bonus = int(exclusive_item.magic_attack_bonus * level_multiplier)
        
        return UpgradeResult(
            UpgradeType.EXCLUSIVE_ITEM,
            exclusive_item,
            new_level,
            True,
            f"成功升级专属道具到{new_level}级！"
        )
    
    def upgrade_equipment_set(
        self,
        equipment: Equipment,
        current_level: int,
        attribute_type: AttributeType
    ) -> UpgradeResult:
        """
        升级套装
        
        Args:
            equipment: 套装部件
            current_level: 当前等级（0-4，最高5级）
            attribute_type: 属性类型
            
        Returns:
            升级结果
        """
        # 检查等级
        if current_level >= UpgradeSystem.MAX_LEVEL:
            return UpgradeResult(
                UpgradeType.EQUIPMENT_SET,
                equipment,
                current_level,
                False,
                f"套装已达到最大等级（{UpgradeSystem.MAX_LEVEL}级）"
            )
        
        # 获取升级消耗
        cost = UpgradeSystem.EQUIPMENT_SET_UPGRADE_COSTS[current_level]
        
        # 检查材料是否足够（需要对应属性的套装材料）
        set_materials = self.material_bag.filter_materials(
            material_type=MaterialType.EQUIPMENT_SET,
            attribute_type=attribute_type
        )
        
        total_materials = sum(set_materials.values())
        if total_materials < cost:
            return UpgradeResult(
                UpgradeType.EQUIPMENT_SET,
                equipment,
                current_level,
                False,
                f"材料不足！需要{cost}份{attribute_type.value}属性的套装材料，当前只有{total_materials}份"
            )
        
        # 消耗材料
        material_id = list(set_materials.keys())[0]
        self.material_bag.remove_material(material_id, cost)
        
        # 升级套装（提升属性）
        new_level = current_level + 1
        level_multiplier = 1 + (new_level * 0.1)  # 每级提升10%属性
        
        equipment.hp_bonus = int(equipment.hp_bonus * level_multiplier)
        equipment.attack_bonus = int(equipment.attack_bonus * level_multiplier)
        equipment.defense_bonus = int(equipment.defense_bonus * level_multiplier)
        equipment.magic_attack_bonus = int(equipment.magic_attack_bonus * level_multiplier)
        equipment.magic_defense_bonus = int(equipment.magic_defense_bonus * level_multiplier)
        
        return UpgradeResult(
            UpgradeType.EQUIPMENT_SET,
            equipment,
            new_level,
            True,
            f"成功升级套装到{new_level}级！"
        )
    
    def get_upgrade_cost(self, upgrade_type: UpgradeType, current_level: int) -> int:
        """
        获取升级消耗
        
        Args:
            upgrade_type: 升级类型
            current_level: 当前等级
            
        Returns:
            消耗的材料数量
        """
        if current_level >= UpgradeSystem.MAX_LEVEL:
            return 0
        
        if upgrade_type == UpgradeType.EXCLUSIVE_ITEM:
            return UpgradeSystem.EXCLUSIVE_ITEM_UPGRADE_COSTS[current_level]
        elif upgrade_type == UpgradeType.EQUIPMENT_SET:
            return UpgradeSystem.EQUIPMENT_SET_UPGRADE_COSTS[current_level]
        
        return 0


