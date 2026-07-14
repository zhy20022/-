"""
装备强化系统（参考天命之子）
实现装备强化、突破、精炼等功能
"""

from enum import Enum
from typing import Dict, Any, Optional, List
from ..characters.equipment import Equipment
from ..rewards.material import MaterialBag, MaterialType
from ..attributes.attribute import AttributeType
import random


class EnhancementType(Enum):
    """强化类型"""
    ENHANCE = "强化"      # 普通强化，提升基础属性
    BREAKTHROUGH = "突破"  # 突破，解锁更高等级上限
    REFINE = "精炼"       # 精炼，提升属性百分比


class EnhancementResult:
    """强化结果"""
    
    def __init__(
        self,
        enhancement_type: EnhancementType,
        equipment: Equipment,
        success: bool = True,
        new_level: int = 0,
        new_enhancement_level: int = 0,
        message: str = "",
        materials_used: Dict[str, int] = None
    ):
        """
        初始化强化结果
        
        Args:
            enhancement_type: 强化类型
            equipment: 装备
            success: 是否成功
            new_level: 新等级
            new_enhancement_level: 新强化等级
            message: 结果消息
            materials_used: 消耗的材料
        """
        self.enhancement_type = enhancement_type
        self.equipment = equipment
        self.success = success
        self.new_level = new_level
        self.new_enhancement_level = new_enhancement_level
        self.message = message
        self.materials_used = materials_used or {}
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "enhancement_type": self.enhancement_type.value,
            "equipment": self.equipment.to_dict() if hasattr(self.equipment, 'to_dict') else str(self.equipment),
            "success": self.success,
            "new_level": self.new_level,
            "new_enhancement_level": self.new_enhancement_level,
            "message": self.message,
            "materials_used": self.materials_used
        }


class EquipmentEnhancementSystem:
    """装备强化系统（参考天命之子设计）"""
    
    # 强化等级上限（每10级需要突破）
    MAX_ENHANCEMENT_LEVEL = 50
    BREAKTHROUGH_LEVELS = [10, 20, 30, 40, 50]  # 突破等级点
    
    # 强化成功率（随等级降低）
    ENHANCEMENT_SUCCESS_RATES = {
        0: 1.0,    # 0-9级：100%
        10: 0.8,   # 10-19级：80%
        20: 0.6,   # 20-29级：60%
        30: 0.4,   # 30-39级：40%
        40: 0.2,   # 40-49级：20%
        50: 0.1    # 50级：10%
    }
    
    # 强化消耗（每级需要的金币和材料）
    ENHANCEMENT_COST_BASE = 1000  # 基础金币消耗
    ENHANCEMENT_MATERIAL_COST = 1  # 每级需要的材料数量
    
    # 突破消耗
    BREAKTHROUGH_COST = {
        10: {"gold": 10000, "material": 5},
        20: {"gold": 20000, "material": 10},
        30: {"gold": 30000, "material": 15},
        40: {"gold": 40000, "material": 20},
        50: {"gold": 50000, "material": 25}
    }
    
    def __init__(self, player_id: str, material_bag: MaterialBag, gold: int = 0):
        """
        初始化装备强化系统
        
        Args:
            player_id: 玩家ID
            material_bag: 材料背包
            gold: 当前金币数量
        """
        self.player_id = player_id
        self.material_bag = material_bag
        self.gold = gold
    
    def enhance_equipment(
        self,
        equipment: Equipment,
        current_enhancement_level: int = 0,
        use_protection: bool = False
    ) -> EnhancementResult:
        """
        强化装备（参考天命之子）
        
        Args:
            equipment: 装备
            current_enhancement_level: 当前强化等级（0-50）
            use_protection: 是否使用保护符（失败不掉级）
            
        Returns:
            强化结果
        """
        # 检查是否达到上限
        if current_enhancement_level >= self.MAX_ENHANCEMENT_LEVEL:
            return EnhancementResult(
                EnhancementType.ENHANCE,
                equipment,
                False,
                current_enhancement_level,
                current_enhancement_level,
                "装备已达到最大强化等级"
            )
        
        # 检查是否需要突破
        if current_enhancement_level in self.BREAKTHROUGH_LEVELS:
            return EnhancementResult(
                EnhancementType.ENHANCE,
                equipment,
                False,
                current_enhancement_level,
                current_enhancement_level,
                f"需要先进行突破才能继续强化（当前等级：{current_enhancement_level}）"
            )
        
        # 计算成功率
        success_rate = self._get_success_rate(current_enhancement_level)
        
        # 计算消耗
        cost_gold = self.ENHANCEMENT_COST_BASE * (current_enhancement_level + 1)
        cost_material = self.ENHANCEMENT_MATERIAL_COST * (current_enhancement_level + 1)
        
        # 检查资源
        if self.gold < cost_gold:
            return EnhancementResult(
                EnhancementType.ENHANCE,
                equipment,
                False,
                current_enhancement_level,
                current_enhancement_level,
                f"金币不足！需要{cost_gold}，当前有{self.gold}",
                {}
            )
        
        # 检查材料（使用装备材料）
        set_materials = self.material_bag.filter_materials(
            material_type=MaterialType.EQUIPMENT_SET
        )
        total_materials = sum(set_materials.values())
        if total_materials < cost_material:
            return EnhancementResult(
                EnhancementType.ENHANCE,
                equipment,
                False,
                current_enhancement_level,
                current_enhancement_level,
                f"材料不足！需要{cost_material}，当前有{total_materials}",
                {}
            )
        
        # 消耗资源
        self.gold -= cost_gold
        material_id = list(set_materials.keys())[0] if set_materials else None
        if material_id:
            self.material_bag.remove_material(material_id, cost_material)
        
        materials_used = {"gold": cost_gold, "material": cost_material}
        
        # 尝试强化
        success = random.random() < success_rate
        
        if success:
            # 强化成功
            new_level = current_enhancement_level + 1
            enhancement_multiplier = 1 + (new_level * 0.02)  # 每级提升2%属性
            
            equipment.hp_bonus = int(equipment.hp_bonus * enhancement_multiplier)
            equipment.attack_bonus = int(equipment.attack_bonus * enhancement_multiplier)
            equipment.defense_bonus = int(equipment.defense_bonus * enhancement_multiplier)
            equipment.magic_attack_bonus = int(equipment.magic_attack_bonus * enhancement_multiplier)
            equipment.magic_defense_bonus = int(equipment.magic_defense_bonus * enhancement_multiplier)
            
            return EnhancementResult(
                EnhancementType.ENHANCE,
                equipment,
                True,
                new_level,
                new_level,
                f"强化成功！装备强化等级提升至{new_level}级",
                materials_used
            )
        else:
            # 强化失败
            if use_protection:
                # 使用保护符，不掉级
                return EnhancementResult(
                    EnhancementType.ENHANCE,
                    equipment,
                    False,
                    current_enhancement_level,
                    current_enhancement_level,
                    "强化失败，但使用了保护符，等级未下降",
                    materials_used
                )
            else:
                # 失败掉级（最多掉到最近的突破点）
                drop_level = max(0, current_enhancement_level - 1)
                # 如果掉到突破点，保持在该突破点
                for breakthrough_level in reversed(self.BREAKTHROUGH_LEVELS):
                    if drop_level >= breakthrough_level:
                        drop_level = breakthrough_level
                        break
                
                return EnhancementResult(
                    EnhancementType.ENHANCE,
                    equipment,
                    False,
                    drop_level,
                    drop_level,
                    f"强化失败！装备强化等级下降至{drop_level}级",
                    materials_used
                )
    
    def breakthrough_equipment(
        self,
        equipment: Equipment,
        current_enhancement_level: int
    ) -> EnhancementResult:
        """
        突破装备（解锁更高强化等级上限）
        
        Args:
            equipment: 装备
            current_enhancement_level: 当前强化等级
            
        Returns:
            突破结果
        """
        # 检查是否在突破点
        if current_enhancement_level not in self.BREAKTHROUGH_LEVELS:
            return EnhancementResult(
                EnhancementType.BREAKTHROUGH,
                equipment,
                False,
                current_enhancement_level,
                current_enhancement_level,
                f"当前等级{current_enhancement_level}无法突破，需要在突破点（{self.BREAKTHROUGH_LEVELS}）进行突破"
            )
        
        # 检查是否已达到最大突破
        if current_enhancement_level >= self.MAX_ENHANCEMENT_LEVEL:
            return EnhancementResult(
                EnhancementType.BREAKTHROUGH,
                equipment,
                False,
                current_enhancement_level,
                current_enhancement_level,
                "装备已达到最大突破等级"
            )
        
        # 获取突破消耗
        cost = self.BREAKTHROUGH_COST.get(current_enhancement_level)
        if not cost:
            return EnhancementResult(
                EnhancementType.BREAKTHROUGH,
                equipment,
                False,
                current_enhancement_level,
                current_enhancement_level,
                "无法突破：未找到对应的突破消耗配置"
            )
        
        # 检查资源
        if self.gold < cost["gold"]:
            return EnhancementResult(
                EnhancementType.BREAKTHROUGH,
                equipment,
                False,
                current_enhancement_level,
                current_enhancement_level,
                f"金币不足！需要{cost['gold']}，当前有{self.gold}",
                {}
            )
        
        # 检查材料
        set_materials = self.material_bag.filter_materials(
            material_type=MaterialType.EQUIPMENT_SET
        )
        total_materials = sum(set_materials.values())
        if total_materials < cost["material"]:
            return EnhancementResult(
                EnhancementType.BREAKTHROUGH,
                equipment,
                False,
                current_enhancement_level,
                current_enhancement_level,
                f"材料不足！需要{cost['material']}，当前有{total_materials}",
                {}
            )
        
        # 消耗资源
        self.gold -= cost["gold"]
        material_id = list(set_materials.keys())[0] if set_materials else None
        if material_id:
            self.material_bag.remove_material(material_id, cost["material"])
        
        materials_used = {"gold": cost["gold"], "material": cost["material"]}
        
        # 突破成功，属性大幅提升
        breakthrough_multiplier = 1.2  # 突破提升20%属性
        equipment.hp_bonus = int(equipment.hp_bonus * breakthrough_multiplier)
        equipment.attack_bonus = int(equipment.attack_bonus * breakthrough_multiplier)
        equipment.defense_bonus = int(equipment.defense_bonus * breakthrough_multiplier)
        equipment.magic_attack_bonus = int(equipment.magic_attack_bonus * breakthrough_multiplier)
        equipment.magic_defense_bonus = int(equipment.magic_defense_bonus * breakthrough_multiplier)
        
        return EnhancementResult(
            EnhancementType.BREAKTHROUGH,
            equipment,
            True,
            current_enhancement_level,
            current_enhancement_level,
            f"突破成功！装备属性大幅提升，可以继续强化至{current_enhancement_level + 10}级",
            materials_used
        )
    
    def _get_success_rate(self, current_level: int) -> float:
        """获取强化成功率"""
        for level_threshold in sorted(self.ENHANCEMENT_SUCCESS_RATES.keys(), reverse=True):
            if current_level >= level_threshold:
                return self.ENHANCEMENT_SUCCESS_RATES[level_threshold]
        return 1.0
    
    def get_enhancement_info(self, current_level: int) -> Dict[str, Any]:
        """
        获取强化信息
        
        Args:
            current_level: 当前强化等级
            
        Returns:
            强化信息字典
        """
        return {
            "current_level": current_level,
            "max_level": self.MAX_ENHANCEMENT_LEVEL,
            "success_rate": self._get_success_rate(current_level),
            "next_breakthrough": self._get_next_breakthrough(current_level),
            "enhancement_cost": {
                "gold": self.ENHANCEMENT_COST_BASE * (current_level + 1),
                "material": self.ENHANCEMENT_MATERIAL_COST * (current_level + 1)
            }
        }
    
    def _get_next_breakthrough(self, current_level: int) -> Optional[int]:
        """获取下一个突破等级"""
        for breakthrough_level in self.BREAKTHROUGH_LEVELS:
            if current_level < breakthrough_level:
                return breakthrough_level
        return None







