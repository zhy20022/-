"""
战魂数据模型
"""
from sqlalchemy import Column, String, Integer, ForeignKey
from sqlalchemy.orm import relationship
from . import Base


class BattleSoulModel(Base):
    """战魂数据模型"""
    
    __tablename__ = 'battle_soul'
    
    # 主键（玩家ID + 属性类型）
    player_id = Column(String(50), ForeignKey('players.player_id'), primary_key=True)
    attribute_type = Column(String(50), primary_key=True)
    
    # 战魂等级（0-5，0表示未激活，1-5表示对应等级）
    level = Column(Integer, default=0)
    
    # 精华数量
    essence_count = Column(Integer, default=0)
    
    # 关系
    player = relationship('PlayerModel')
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'player_id': self.player_id,
            'attribute_type': self.attribute_type,
            'level': self.level,
            'essence_count': self.essence_count
        }




