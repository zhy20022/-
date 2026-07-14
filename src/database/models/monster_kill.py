"""
怪物击杀统计数据模型
"""

from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from . import Base


class MonsterKillModel(Base):
    """怪物击杀统计数据模型"""

    __tablename__ = 'monster_kills'

    # 基本信息
    kill_id = Column(String(50), primary_key=True)
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    
    # 击杀信息
    monster_id = Column(String(50), nullable=False, index=True)  # 怪物ID
    monster_name = Column(String(100), nullable=True)  # 怪物名称
    kill_count = Column(Integer, default=1)  # 击杀数量
    
    # 战斗信息
    battle_id = Column(String(50), nullable=True, index=True)  # 战斗ID
    dungeon_id = Column(String(50), nullable=True, index=True)  # 副本ID
    
    # 额外信息（JSON格式存储）
    extra_info = Column(Text, nullable=True)  # 存储额外信息，如战斗详情等
    
    # 时间戳
    killed_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            'kill_id': self.kill_id,
            'player_id': self.player_id,
            'monster_id': self.monster_id,
            'monster_name': self.monster_name,
            'kill_count': self.kill_count,
            'battle_id': self.battle_id,
            'dungeon_id': self.dungeon_id,
            'extra_info': self.extra_info,
            'killed_at': self.killed_at.isoformat() if self.killed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


