"""
材料数据模型
"""

from sqlalchemy import Column, String, Integer, ForeignKey, Index
from sqlalchemy.orm import relationship
from . import Base


class MaterialModel(Base):
    """材料数据模型"""
    
    __tablename__ = 'materials'
    
    # 基本信息
    material_id = Column(String(50), primary_key=True)
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    
    # 材料信息
    material_type = Column(String(50), nullable=False)  # 材料类型
    attribute_type = Column(String(50), nullable=True)  # 属性类型（套装材料需要）
    
    # 数量
    count = Column(Integer, default=0)
    
    # 关系
    player = relationship('PlayerModel', back_populates='materials')
    
    # 唯一索引：每个玩家每种材料只有一条记录
    __table_args__ = (
        Index('idx_player_material', 'player_id', 'material_type', 'attribute_type', unique=True),
    )
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'material_id': self.material_id,
            'player_id': self.player_id,
            'material_type': self.material_type,
            'attribute_type': self.attribute_type,
            'count': self.count
        }


