"""
抽卡数据模型
"""

from datetime import datetime
import uuid
from sqlalchemy import Column, String, Integer, ForeignKey, JSON, DateTime, Index, UniqueConstraint
from sqlalchemy.orm import relationship
from . import Base


class GachaStateModel(Base):
    """玩家卡池保底与抽取统计"""

    __tablename__ = 'gacha_states'

    state_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    pool_type = Column(String(50), nullable=False)
    pity_counter = Column(Integer, default=0)
    total_pulls = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    player = relationship('PlayerModel')

    __table_args__ = (
        UniqueConstraint('player_id', 'pool_type', name='uq_gacha_state_player_pool'),
        Index('idx_gacha_state_player_pool', 'player_id', 'pool_type'),
    )

    def to_dict(self) -> dict:
        return {
            'state_id': self.state_id,
            'player_id': self.player_id,
            'pool_type': self.pool_type,
            'pity_counter': self.pity_counter,
            'total_pulls': self.total_pulls,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class GachaHistoryModel(Base):
    """玩家抽卡历史"""

    __tablename__ = 'gacha_history'

    history_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    pool_type = Column(String(50), nullable=False, index=True)
    pull_count = Column(Integer, default=1)
    cost = Column(Integer, default=0)
    new_characters = Column(Integer, default=0)
    duplicates = Column(Integer, default=0)
    essence_gained = Column(Integer, default=0)
    pity_triggered = Column(Integer, default=0)
    result_data = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    player = relationship('PlayerModel')

    __table_args__ = (
        Index('idx_gacha_history_player_created', 'player_id', 'created_at'),
    )

    def to_dict(self) -> dict:
        return {
            'history_id': self.history_id,
            'timestamp': self.created_at.isoformat() + 'Z' if self.created_at else None,
            'pool_type': self.pool_type,
            'pull_count': self.pull_count,
            'cost': self.cost,
            'new_characters': self.new_characters,
            'duplicates': self.duplicates,
            'essence_gained': self.essence_gained,
            'pity_triggered': self.pity_triggered,
            'results': self.result_data or []
        }
