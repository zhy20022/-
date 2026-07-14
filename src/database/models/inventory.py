"""
背包物品数据模型
"""

from sqlalchemy import Column, String, Integer, ForeignKey, JSON, Boolean, Index
from sqlalchemy.orm import relationship
from . import Base


class InventoryItemModel(Base):
    """背包物品数据模型"""
    
    __tablename__ = 'inventory_items'
    
    # 基本信息
    item_id = Column(String(50), primary_key=True)
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    
    # 物品信息
    item_type = Column(String(50), nullable=False)  # weapon, equipment, material, item
    item_subtype = Column(String(50), nullable=True)  # exclusive_weapon, equipment_set, etc.
    item_name = Column(String(100), nullable=False)
    
    # 物品属性（JSON格式存储）
    item_data = Column(JSON, default={})  # 物品的详细数据
    
    # 数量/等级
    count = Column(Integer, default=1)  # 材料/道具的数量
    level = Column(Integer, default=0)  # 装备/武器的等级
    
    # 状态
    is_locked = Column(Boolean, default=False)  # 是否锁定
    is_equipped = Column(Boolean, default=False)  # 是否已装备
    
    # 关系
    player = relationship('PlayerModel')
    
    # 索引
    __table_args__ = (
        Index('idx_player_item_type', 'player_id', 'item_type'),
    )
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'item_id': self.item_id,
            'player_id': self.player_id,
            'item_type': self.item_type,
            'item_subtype': self.item_subtype,
            'item_name': self.item_name,
            'item_data': self.item_data,
            'count': self.count,
            'level': self.level,
            'is_locked': self.is_locked,
            'is_equipped': self.is_equipped
        }


