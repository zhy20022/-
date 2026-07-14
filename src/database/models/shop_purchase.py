"""
商店购买记录模型
"""

from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from . import Base


class ShopPurchaseModel(Base):
    """记录活动商店每个周期内的购买次数"""

    __tablename__ = 'shop_purchases'

    purchase_id = Column(String(50), primary_key=True)
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    item_id = Column(String(100), nullable=False)
    period_key = Column(String(20), nullable=False)
    purchase_count = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    player = relationship('PlayerModel')

    __table_args__ = (
        Index('idx_shop_purchase_period', 'player_id', 'item_id', 'period_key', unique=True),
    )

    def to_dict(self) -> dict:
        return {
            'purchase_id': self.purchase_id,
            'player_id': self.player_id,
            'item_id': self.item_id,
            'period_key': self.period_key,
            'purchase_count': self.purchase_count,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
