"""
玩家统计数据模型
"""

from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from . import Base


class PlayerStatisticsModel(Base):
    """玩家统计数据模型"""

    __tablename__ = 'player_statistics'

    # 基本信息
    player_id = Column(String(50), ForeignKey('players.player_id'), primary_key=True)
    
    # 战斗统计
    battles_completed = Column(Integer, default=0)  # 总战斗完成数
    dungeons_completed = Column(Integer, default=0)  # 总副本完成数
    monsters_killed = Column(Integer, default=0)  # 总击杀怪物数
    
    # 角色统计
    character_count = Column(Integer, default=0)  # 角色数量
    
    # 资源统计
    total_gold_earned = Column(Integer, default=0)  # 总获得金币
    total_materials_dropped = Column(Integer, default=0)  # 总掉落材料数量
    total_materials_earned = Column(Integer, default=0)  # 总获得材料数量
    
    # 等级统计
    level = Column(Integer, default=1)  # 当前等级
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系
    player = relationship('PlayerModel', back_populates='statistics')

    def to_dict(self) -> dict:
        return {
            'player_id': self.player_id,
            'battles_completed': self.battles_completed,
            'dungeons_completed': self.dungeons_completed,
            'monsters_killed': self.monsters_killed,
            'character_count': self.character_count,
            'total_gold_earned': self.total_gold_earned,
            'total_materials_dropped': self.total_materials_dropped,
            'total_materials_earned': self.total_materials_earned,
            'level': self.level,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


