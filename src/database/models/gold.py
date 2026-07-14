"""
金币数据模型（金币记录在PlayerModel中，这里可以用于金币交易记录）
"""

from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from . import Base


class GoldModel(Base):
    """金币交易记录模型"""
    
    __tablename__ = 'gold_transactions'
    
    # 基本信息
    transaction_id = Column(String(50), primary_key=True)
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    
    # 交易信息
    transaction_type = Column(String(50), nullable=False)  # 获取/消耗
    amount = Column(Integer, nullable=False)  # 数量（正数表示获取，负数表示消耗）
    balance_after = Column(Integer, nullable=False)  # 交易后余额
    
    # 交易描述
    description = Column(Text, nullable=True)
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # 关系
    player = relationship('PlayerModel')
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'transaction_id': self.transaction_id,
            'player_id': self.player_id,
            'transaction_type': self.transaction_type,
            'amount': self.amount,
            'balance_after': self.balance_after,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


