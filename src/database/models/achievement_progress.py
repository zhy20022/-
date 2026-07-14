"""
成就进度数据模型
"""

from sqlalchemy import Column, String, DateTime, ForeignKey, JSON, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from . import Base


class AchievementProgressModel(Base):
    """成就进度数据模型"""
    
    __tablename__ = 'achievement_progresses'
    
    # 基本信息
    progress_id = Column(String(50), primary_key=True)
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    achievement_id = Column(String(50), nullable=False, index=True)
    
    # 解锁状态
    unlocked = Column(Boolean, default=False)
    unlocked_at = Column(DateTime, nullable=True)
    
    # 进度数据（JSON格式存储）
    progress_data = Column(JSON, default={})  # 用于存储进度相关信息
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系
    player = relationship('PlayerModel')
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'progress_id': self.progress_id,
            'player_id': self.player_id,
            'achievement_id': self.achievement_id,
            'unlocked': self.unlocked,
            'unlocked_at': self.unlocked_at.isoformat() if self.unlocked_at else None,
            'progress_data': self.progress_data,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }



