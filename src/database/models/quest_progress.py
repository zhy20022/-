"""
任务进度数据模型
"""

from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, JSON, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
from . import Base
import enum


class QuestStatusEnum(str, enum.Enum):
    """任务状态枚举"""
    LOCKED = "LOCKED"
    AVAILABLE = "AVAILABLE"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CLAIMED = "CLAIMED"


class QuestProgressModel(Base):
    """任务进度数据模型"""
    
    __tablename__ = 'quest_progresses'
    
    # 基本信息
    progress_id = Column(String(50), primary_key=True)
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    quest_id = Column(String(50), nullable=False, index=True)
    
    # 任务状态
    status = Column(SQLEnum(QuestStatusEnum), default=QuestStatusEnum.LOCKED)
    
    # 任务目标进度（JSON格式存储）
    objectives_progress = Column(JSON, default={})  # {objective_id: current_count}
    
    # 时间戳
    accepted_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    claimed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系
    player = relationship('PlayerModel')
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'progress_id': self.progress_id,
            'player_id': self.player_id,
            'quest_id': self.quest_id,
            'status': self.status.value if self.status else None,
            'objectives_progress': self.objectives_progress,
            'accepted_at': self.accepted_at.isoformat() if self.accepted_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'claimed_at': self.claimed_at.isoformat() if self.claimed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }



