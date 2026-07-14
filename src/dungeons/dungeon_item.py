"""
副本内装备系统
管理副本内的临时装备、道具、饰品等
"""

from typing import Dict, Any, List, Optional
from enum import Enum
from .dungeon import Dungeon, DungeonType


class ItemType(Enum):
    """物品类型"""
    PROP = "局内道具"    # 5人本掉落
    ACCESSORY = "局内饰品"  # 20人本掉落


class DungeonItem:
    """副本内物品"""
    
    def __init__(
        self,
        item_id: str,
        name: str,
        item_type: ItemType,
        attribute_bonus: Dict[str, int] = None,
        description: str = "",
        rarity: str = "rare",
        quality: str = "A",
        icon: Optional[str] = None,
        classifications: Optional[Dict[str, Any]] = None
    ):
        """
        初始化副本内物品
        
        Args:
            item_id: 物品ID
            name: 物品名称
            item_type: 物品类型
            attribute_bonus: 属性加成（如：{"attack": 100, "defense": 50}）
            description: 物品描述
        """
        self.item_id = item_id
        self.name = name
        self.item_type = item_type
        self.attribute_bonus = attribute_bonus or {}
        self.description = description
        self.rarity = rarity
        self.quality = quality
        self.icon = icon or f"/assets/drops/{item_id}.png"
        self.classifications = classifications or {}
        self.can_take_out = False  # 副本内物品无法带出
    
    def apply_bonus(self, character) -> Dict[str, int]:
        """
        应用属性加成
        
        Args:
            character: 角色
            
        Returns:
            属性加成字典
        """
        return self.attribute_bonus.copy()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "item_id": self.item_id,
            "name": self.name,
            "item_type": self.item_type.value,
            "attribute_bonus": self.attribute_bonus,
            "description": self.description,
            "can_take_out": self.can_take_out,
            "rarity": self.rarity,
            "quality": self.quality,
            "icon": self.icon,
            "classifications": self.classifications
        }


class DungeonItemManager:
    """副本内物品管理器"""
    
    def __init__(self, dungeon: Dungeon):
        """
        初始化副本内物品管理器
        
        Args:
            dungeon: 副本
        """
        self.dungeon = dungeon
        self.items: List[DungeonItem] = []
        self._initialize_items()
    
    def _initialize_items(self):
        """初始化物品池"""
        if self.dungeon.dungeon_type == DungeonType.SQUAD:
            # 5人本：局内道具
            self.items = self._create_props()
        elif self.dungeon.dungeon_type == DungeonType.TEAM:
            # 20人本：局内饰品
            self.items = self._create_accessories()
        else:
            self.items = []
    
    def _create_props(self) -> List[DungeonItem]:
        """创建局内道具"""
        attr = self.dungeon.attribute_type
        attr_value = attr.value
        attr_slug = attr.name.lower()
        props = [
            DungeonItem(
                item_id=f"{attr_slug}_prop_attack",
                name=f"{attr_value}系攻击道具",
                item_type=ItemType.PROP,
                attribute_bonus={"attack": 100, "magic_attack": 50},
                description="增加攻击力",
                rarity="epic",
                quality="S",
                icon=f"/assets/drops/{attr_slug}_attack.png",
                classifications={
                    "slot": "offense",
                    "attribute": attr_value,
                    "category": "prop"
                }
            ),
            DungeonItem(
                item_id=f"{attr_slug}_prop_defense",
                name=f"{attr_value}系防御道具",
                item_type=ItemType.PROP,
                attribute_bonus={"defense": 50, "magic_defense": 50},
                description="增加防御力",
                rarity="rare",
                quality="A",
                icon=f"/assets/drops/{attr_slug}_defense.png",
                classifications={
                    "slot": "defense",
                    "attribute": attr_value,
                    "category": "prop"
                }
            ),
            DungeonItem(
                item_id=f"{attr_slug}_prop_hp",
                name=f"{attr_value}系生命道具",
                item_type=ItemType.PROP,
                attribute_bonus={"hp": 500},
                description="增加生命值",
                rarity="rare",
                quality="A",
                icon=f"/assets/drops/{attr_slug}_hp.png",
                classifications={
                    "slot": "support",
                    "attribute": attr_value,
                    "category": "prop"
                }
            ),
        ]
        return props
    
    def _create_accessories(self) -> List[DungeonItem]:
        """创建局内饰品"""
        attr = self.dungeon.attribute_type
        attr_value = attr.value
        attr_slug = attr.name.lower()
        accessories = [
            DungeonItem(
                item_id=f"{attr_slug}_accessory_attack",
                name=f"{attr_value}系攻击饰品",
                item_type=ItemType.ACCESSORY,
                attribute_bonus={"attack": 150, "magic_attack": 100},
                description="增加攻击力",
                rarity="legendary",
                quality="S+",
                icon=f"/assets/drops/{attr_slug}_acc_attack.png",
                classifications={
                    "slot": "accessory",
                    "set": f"{attr_value}征伐",
                    "attribute": attr_value,
                    "category": "accessory"
                }
            ),
            DungeonItem(
                item_id=f"{attr_slug}_accessory_defense",
                name=f"{attr_value}系防御饰品",
                item_type=ItemType.ACCESSORY,
                attribute_bonus={"defense": 100, "magic_defense": 100},
                description="增加防御力",
                rarity="epic",
                quality="S",
                icon=f"/assets/drops/{attr_slug}_acc_defense.png",
                classifications={
                    "slot": "accessory",
                    "set": f"{attr_value}壁垒",
                    "attribute": attr_value,
                    "category": "accessory"
                }
            ),
            DungeonItem(
                item_id=f"{attr_slug}_accessory_hp",
                name=f"{attr_value}系生命饰品",
                item_type=ItemType.ACCESSORY,
                attribute_bonus={"hp": 1000},
                description="增加生命值",
                rarity="epic",
                quality="S",
                icon=f"/assets/drops/{attr_slug}_acc_hp.png",
                classifications={
                    "slot": "accessory",
                    "set": f"{attr_value}生命",
                    "attribute": attr_value,
                    "category": "accessory"
                }
            ),
        ]
        return accessories
    
    def get_random_item(self) -> Optional[DungeonItem]:
        """随机获取一个物品"""
        import random
        if self.items:
            return random.choice(self.items)
        return None
    
    def drop_item_on_monster_kill(self, monster_type: str) -> Optional[DungeonItem]:
        """
        怪物死亡时掉落物品
        
        Args:
            monster_type: 怪物类型（monster/boss）
            
        Returns:
            掉落的物品，如果没有掉落返回None
        """
        import random
        
        # 随机掉落概率
        if monster_type == "boss":
            drop_rate = 0.3  # Boss 30%概率掉落
        else:
            drop_rate = 0.1  # 小怪 10%概率掉落
        
        if random.random() < drop_rate:
            return self.get_random_item()
        
        return None






