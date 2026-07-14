"""
玩家数据模型
"""

from sqlalchemy import Column, String, Integer, DateTime, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from . import Base


class PlayerModel(Base):
    """玩家数据模型"""
    
    __tablename__ = 'players'
    
    # 基本信息
    player_id = Column(String(50), primary_key=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)  # 密码哈希
    email = Column(String(100), unique=True, nullable=True)
    
    # 游戏数据
    level = Column(Integer, default=1)
    exp = Column(Integer, default=0)
    gold = Column(Integer, default=0)
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 状态
    is_active = Column(Boolean, default=True)
    is_online = Column(Boolean, default=False)
    
    # 关系
    characters = relationship('CharacterModel', back_populates='player', cascade='all, delete-orphan')
    dungeon_progresses = relationship('DungeonProgressModel', back_populates='player', cascade='all, delete-orphan')
    materials = relationship('MaterialModel', back_populates='player', cascade='all, delete-orphan')
    statistics = relationship('PlayerStatisticsModel', back_populates='player', uselist=False, cascade='all, delete-orphan')
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'player_id': self.player_id,
            'username': self.username,
            'email': self.email,
            'level': self.level,
            'exp': self.exp,
            'gold': self.gold,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_login': self.last_login.isoformat() if self.last_login else None,
            'is_active': self.is_active,
            'is_online': self.is_online
        }


