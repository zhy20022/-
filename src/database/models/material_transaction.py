"""
材料变动流水模型
"""

from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from . import Base


class MaterialTransactionModel(Base):
    """记录玩家材料的获取与消耗"""

    __tablename__ = 'material_transactions'

    transaction_id = Column(String(50), primary_key=True)
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    material_type = Column(String(50), nullable=False)
    attribute_type = Column(String(50), nullable=True)
    transaction_type = Column(String(20), nullable=False)  # 获取 / 消耗
    amount = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=False, default=0)
    source = Column(String(50), nullable=True)
    description = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    player = relationship('PlayerModel')

    __table_args__ = (
        Index('idx_material_tx_player_time', 'player_id', 'created_at'),
    )

    def to_dict(self) -> dict:
        return {
            'transaction_id': self.transaction_id,
            'player_id': self.player_id,
            'material_type': self.material_type,
            'attribute_type': self.attribute_type,
            'transaction_type': self.transaction_type,
            'amount': self.amount,
            'balance_after': self.balance_after,
            'source': self.source,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
