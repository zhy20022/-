"""
材料系统
实现材料定义、材料背包、材料分类筛选等
"""

from enum import Enum
from typing import Dict, Any, List, Optional
from ..attributes.attribute import AttributeType


MAX_CHARACTER_EXP_CRYSTALS = 999_999_999


class MaterialType(Enum):
    """材料类型"""
    EXCLUSIVE_ITEM = "专属道具材料"      # 通用材料，用于制作专属道具
    EQUIPMENT_SET = "套装材料"          # 不同属性的通用材料，用于制作对应属性的套装
    ILLUSTRATION_PIECE = "立绘拼图碎片"  # 拼图碎片，用于兑换立绘
    CHARACTER_EXP = "角色经验结晶"       # 用于提升角色等级的经验货币


class Material:
    """材料类"""
    
    def __init__(
        self,
        material_id: str,
        material_type: MaterialType,
        name: str,
        attribute_type: Optional[AttributeType] = None,
        description: str = ""
    ):
        """
        初始化材料
        
        Args:
            material_id: 材料ID
            material_type: 材料类型
            name: 材料名称
            attribute_type: 属性类型（套装材料需要，专属道具材料和立绘拼图碎片不需要）
            description: 材料描述
        """
        self.material_id = material_id
        self.material_type = material_type
        self.name = name
        self.attribute_type = attribute_type
        self.description = description
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "material_id": self.material_id,
            "material_type": self.material_type.value,
            "name": self.name,
            "attribute_type": self.attribute_type.value if self.attribute_type else None,
            "description": self.description
        }
    
    def __str__(self) -> str:
        attr_str = f"({self.attribute_type.value})" if self.attribute_type else ""
        return f"{self.name}{attr_str}"


class MaterialBag:
    """材料背包"""
    
    def __init__(self, player_id: str):
        """
        初始化材料背包
        
        Args:
            player_id: 玩家ID
        """
        self.player_id = player_id
        # 材料存储：{material_id: count}
        self.materials: Dict[str, int] = {}
        # 材料信息：{material_id: Material}
        self.material_info: Dict[str, Material] = {}
    
    def add_material(self, material: Material, count: int = 1):
        """
        添加材料
        
        Args:
            material: 材料对象
            count: 数量
        """
        if material.material_id not in self.materials:
            self.materials[material.material_id] = 0
            self.material_info[material.material_id] = material
        
        self.materials[material.material_id] += count
    
    def remove_material(self, material_id: str, count: int = 1) -> bool:
        """
        移除材料
        
        Args:
            material_id: 材料ID
            count: 数量
            
        Returns:
            如果成功移除返回True
        """
        if material_id not in self.materials:
            return False
        
        if self.materials[material_id] < count:
            return False
        
        self.materials[material_id] -= count
        
        # 如果数量为0，移除材料信息
        if self.materials[material_id] == 0:
            del self.materials[material_id]
            if material_id in self.material_info:
                del self.material_info[material_id]
        
        return True
    
    def get_material_count(self, material_id: str) -> int:
        """获取材料数量"""
        return self.materials.get(material_id, 0)
    
    def has_material(self, material_id: str, count: int = 1) -> bool:
        """检查是否有足够的材料"""
        return self.get_material_count(material_id) >= count
    
    def get_all_materials(self) -> Dict[str, int]:
        """获取所有材料"""
        return self.materials.copy()
    
    def get_material_info(self, material_id: str) -> Optional[Material]:
        """获取材料信息"""
        return self.material_info.get(material_id)
    
    def filter_materials(
        self,
        material_type: Optional[MaterialType] = None,
        attribute_type: Optional[AttributeType] = None
    ) -> Dict[str, int]:
        """
        筛选材料
        
        Args:
            material_type: 材料类型筛选
            attribute_type: 属性类型筛选
            
        Returns:
            筛选后的材料字典
        """
        filtered = {}
        
        for material_id, count in self.materials.items():
            material = self.material_info.get(material_id)
            if not material:
                continue
            
            # 材料类型筛选
            if material_type and material.material_type != material_type:
                continue
            
            # 属性类型筛选
            if attribute_type and material.attribute_type != attribute_type:
                continue
            
            filtered[material_id] = count
        
        return filtered
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "player_id": self.player_id,
            "materials": {
                material_id: {
                    "count": count,
                    "info": self.material_info[material_id].to_dict()
                }
                for material_id, count in self.materials.items()
            }
        }


class MaterialFilter:
    """材料筛选器"""
    
    @staticmethod
    def filter_by_type(materials: Dict[str, int], material_type: MaterialType) -> Dict[str, int]:
        """按材料类型筛选"""
        return {k: v for k, v in materials.items() if k.startswith(material_type.value)}
    
    @staticmethod
    def filter_by_attribute(materials: Dict[str, int], attribute_type: AttributeType) -> Dict[str, int]:
        """按属性类型筛选"""
        return {k: v for k, v in materials.items() if attribute_type.value in k}
    
    @staticmethod
    def filter_by_type_and_attribute(
        materials: Dict[str, int],
        material_type: MaterialType,
        attribute_type: AttributeType
    ) -> Dict[str, int]:
        """按材料类型和属性类型筛选"""
        filtered = MaterialFilter.filter_by_type(materials, material_type)
        return MaterialFilter.filter_by_attribute(filtered, attribute_type)


