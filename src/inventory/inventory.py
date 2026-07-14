"""
背包系统
实现物品管理、锁定、分解等
"""

from enum import Enum
from typing import Dict, Any, List, Optional
from ..database import get_database
from ..database.models.inventory import InventoryItemModel
from ..rewards.material import MaterialType
from ..rewards.material_storage import MaterialStorage
from ..attributes.attribute import AttributeType
import uuid


class ItemType(Enum):
    """物品类型"""
    WEAPON = "weapon"              # 武器
    EQUIPMENT = "equipment"        # 装备
    MATERIAL = "material"          # 材料
    ITEM = "item"                 # 道具


class Inventory:
    """背包类"""
    
    def __init__(self, player_id: str):
        """
        初始化背包
        
        Args:
            player_id: 玩家ID
        """
        self.player_id = player_id
        self.items: Dict[str, InventoryItemModel] = {}
        self._load_items()
    
    def _load_items(self):
        """从数据库加载物品"""
        db = get_database()
        session = db.get_session()
        try:
            items = session.query(InventoryItemModel).filter(
                InventoryItemModel.player_id == self.player_id
            ).all()
            self.items = {item.item_id: item for item in items}
        finally:
            session.close()
    
    def add_item(
        self,
        item_type: ItemType,
        item_name: str,
        item_data: Dict[str, Any] = None,
        count: int = 1,
        level: int = 0,
        item_subtype: str = None
    ) -> InventoryItemModel:
        """
        添加物品
        
        Args:
            item_type: 物品类型
            item_name: 物品名称
            item_data: 物品数据
            count: 数量
            level: 等级
            item_subtype: 物品子类型
            
        Returns:
            物品模型
        """
        db = get_database()
        session = db.get_session()
        try:
            item_id = str(uuid.uuid4())
            item = InventoryItemModel(
                item_id=item_id,
                player_id=self.player_id,
                item_type=item_type.value,
                item_subtype=item_subtype,
                item_name=item_name,
                item_data=item_data or {},
                count=count,
                level=level,
                is_locked=False,
                is_equipped=False
            )
            session.add(item)
            session.commit()
            
            self.items[item_id] = item
            return item
        finally:
            session.close()
    
    def remove_item(self, item_id: str, count: int = 1) -> bool:
        """
        移除物品
        
        Args:
            item_id: 物品ID
            count: 数量
            
        Returns:
            如果成功移除返回True
        """
        if item_id not in self.items:
            return False
        
        db = get_database()
        session = db.get_session()
        try:
            item = session.query(InventoryItemModel).filter(
                InventoryItemModel.player_id == self.player_id,
                InventoryItemModel.item_id == item_id
            ).first()
            if not item or item.is_locked:
                return False

            if item.count <= count:
                # 完全移除
                session.delete(item)
                session.commit()
                del self.items[item_id]
            else:
                # 减少数量
                item.count -= count
                session.commit()
                self.items[item_id].count = item.count
            
            return True
        finally:
            session.close()
    
    def lock_item(self, item_id: str) -> bool:
        """
        锁定物品
        
        Args:
            item_id: 物品ID
            
        Returns:
            如果成功锁定返回True
        """
        if item_id not in self.items:
            return False
        
        db = get_database()
        session = db.get_session()
        try:
            item = session.query(InventoryItemModel).filter(
                InventoryItemModel.player_id == self.player_id,
                InventoryItemModel.item_id == item_id
            ).first()
            if not item:
                return False
            item.is_locked = True
            session.commit()
            self.items[item_id].is_locked = True
            return True
        finally:
            session.close()
    
    def unlock_item(self, item_id: str) -> bool:
        """
        解锁物品
        
        Args:
            item_id: 物品ID
            
        Returns:
            如果成功解锁返回True
        """
        if item_id not in self.items:
            return False
        
        db = get_database()
        session = db.get_session()
        try:
            item = session.query(InventoryItemModel).filter(
                InventoryItemModel.player_id == self.player_id,
                InventoryItemModel.item_id == item_id
            ).first()
            if not item:
                return False
            item.is_locked = False
            session.commit()
            self.items[item_id].is_locked = False
            return True
        finally:
            session.close()

    def _get_item_attribute(self, item: InventoryItemModel) -> Optional[AttributeType]:
        data = item.item_data or {}
        value = data.get("attribute_type") or data.get("attribute")
        if isinstance(value, AttributeType):
            return value
        if isinstance(value, str):
            try:
                return AttributeType[value]
            except KeyError:
                try:
                    return AttributeType(value)
                except ValueError:
                    return None
        return None

    def _calculate_dismantle_materials(self, item: InventoryItemModel) -> List[Dict[str, Any]]:
        level = max(int(item.level or 0), 0)
        data = item.item_data or {}
        quality = str(data.get("quality") or data.get("rarity") or "").lower()
        quality_bonus = {
            "common": 0,
            "rare": 1,
            "epic": 2,
            "legendary": 4,
            "普通": 0,
            "稀有": 1,
            "史诗": 2,
            "传说": 4,
        }.get(quality, 1)
        if item.item_type == ItemType.WEAPON.value:
            return [{
                "material_type": MaterialType.EXCLUSIVE_ITEM,
                "attribute_type": None,
                "count": max(5, 6 + quality_bonus * 3 + level * 4)
            }]
        if item.item_type == ItemType.EQUIPMENT.value:
            return [{
                "material_type": MaterialType.EQUIPMENT_SET,
                "attribute_type": self._get_item_attribute(item),
                "count": max(1, 1 + quality_bonus + level)
            }]
        return []

    def preview_dismantle_item(self, item_id: str) -> Dict[str, Any]:
        """预览分解收益，不改变背包和材料"""
        if item_id not in self.items:
            return {'success': False, 'message': '物品不存在'}

        item = self.items[item_id]
        if item.is_locked:
            return {'success': False, 'message': '物品已锁定，无法分解'}
        if item.is_equipped:
            return {'success': False, 'message': '物品已装备，无法分解'}
        if item.item_type not in {ItemType.WEAPON.value, ItemType.EQUIPMENT.value}:
            return {'success': False, 'message': '该物品不能分解'}

        materials = [
            {
                "material_type": reward["material_type"].value,
                "attribute_type": reward["attribute_type"].value if reward["attribute_type"] else None,
                "count": reward["count"]
            }
            for reward in self._calculate_dismantle_materials(item)
        ]
        return {
            'success': True,
            'message': '分解预览',
            'materials': materials
        }
    
    def dismantle_item(self, item_id: str) -> Dict[str, Any]:
        """
        分解物品
        
        Args:
            item_id: 物品ID
            
        Returns:
            分解获得的材料
        """
        if item_id not in self.items:
            return {'success': False, 'message': '物品不存在'}
        
        item = self.items[item_id]
        if item.is_locked:
            return {'success': False, 'message': '物品已锁定，无法分解'}
        
        if item.is_equipped:
            return {'success': False, 'message': '物品已装备，无法分解'}
        
        if item.item_type not in {ItemType.WEAPON.value, ItemType.EQUIPMENT.value}:
            return {'success': False, 'message': '该物品不能分解'}

        material_rewards = self._calculate_dismantle_materials(item)
        if not material_rewards:
            return {'success': False, 'message': '没有可返还的材料'}
        
        # 移除物品
        if self.remove_item(item_id):
            materials_payload = []
            for reward in material_rewards:
                MaterialStorage.save_material(
                    self.player_id,
                    reward["material_type"],
                    reward["attribute_type"],
                    reward["count"],
                    source="dismantle",
                    description=f"分解{item.item_name}"
                )
                materials_payload.append({
                    "material_type": reward["material_type"].value,
                    "attribute_type": reward["attribute_type"].value if reward["attribute_type"] else None,
                    "count": reward["count"]
                })
            return {
                'success': True,
                'message': '分解成功',
                'materials': materials_payload
            }
        else:
            return {'success': False, 'message': '分解失败'}
    
    def get_items_by_type(self, item_type: ItemType) -> List[InventoryItemModel]:
        """按类型获取物品"""
        return [item for item in self.items.values() if item.item_type == item_type.value]
    
    def get_all_items(self) -> List[InventoryItemModel]:
        """获取所有物品"""
        return list(self.items.values())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            'player_id': self.player_id,
            'items': [item.to_dict() for item in self.items.values()]
        }


class InventoryManager:
    """背包管理器"""
    
    @staticmethod
    def get_inventory(player_id: str) -> Inventory:
        """
        获取玩家背包
        
        Args:
            player_id: 玩家ID
            
        Returns:
            背包对象
        """
        return Inventory(player_id)


