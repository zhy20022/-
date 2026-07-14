"""
副本进度数据模型
"""

from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from . import Base


class DungeonProgressModel(Base):
    """副本进度数据模型"""
    
    __tablename__ = 'dungeon_progresses'
    
    # 基本信息
    progress_id = Column(String(50), primary_key=True)
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    dungeon_id = Column(String(50), nullable=False, index=True)
    
    # 挑战次数
    total_attempts = Column(Integer, default=0)
    successful_attempts = Column(Integer, default=0)
    failed_attempts = Column(Integer, default=0)
    
    # 完成状态
    is_completed = Column(Boolean, default=False)
    completion_count = Column(Integer, default=0)
    last_completion_time = Column(DateTime, nullable=True)
    
    # 扫荡模式
    sweep_unlocked = Column(Boolean, default=False)
    
    # 最佳成绩（JSON格式存储）
    best_record = Column(JSON, default={})  # {best_time, best_reward}
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系
    player = relationship('PlayerModel', back_populates='dungeon_progresses')
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'progress_id': self.progress_id,
            'player_id': self.player_id,
            'dungeon_id': self.dungeon_id,
            'total_attempts': self.total_attempts,
            'successful_attempts': self.successful_attempts,
            'failed_attempts': self.failed_attempts,
            'is_completed': self.is_completed,
            'completion_count': self.completion_count,
            'last_completion_time': self.last_completion_time.isoformat() if self.last_completion_time else None,
            'sweep_unlocked': self.sweep_unlocked,
            'best_record': self.best_record
        }


