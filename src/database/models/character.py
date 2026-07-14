"""
角色数据模型
"""

from sqlalchemy import Column, String, Integer, ForeignKey, JSON, Text
from sqlalchemy.orm import relationship
from . import Base


class CharacterModel(Base):
    """角色数据模型"""
    
    __tablename__ = 'characters'
    
    # 基本信息
    character_id = Column(String(50), primary_key=True)
    player_id = Column(String(50), ForeignKey('players.player_id'), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    
    # 角色属性
    profession_type = Column(String(50), nullable=False)
    attribute_type = Column(String(50), nullable=False)
    version_id = Column(String(50), nullable=False)
    
    # 等级和经验
    level = Column(Integer, default=1)
    exp = Column(Integer, default=0)
    
    # 角色属性（JSON格式存储）
    stats = Column(JSON, default={})  # {hp, attack, defense, magic_attack, magic_defense}
    
    # 装备信息（JSON格式存储）
    equipment = Column(JSON, default={})  # {weapon, equipment_set, illustrations}
    
    # 技能信息（JSON格式存储）
    skills = Column(JSON, default={})  # {learned_skills, skill_slots}
    
    # 其他信息
    description = Column(Text, nullable=True)
    
    # 关系
    player = relationship('PlayerModel', back_populates='characters')
    
    def to_dict(self) -> dict:
        """转换为字典"""
        # 从equipment中提取is_locked和star信息
        equipment = self.equipment or {}
        is_locked = equipment.get('is_locked', False)
        star = equipment.get('star', None)
        
        return {
            'character_id': self.character_id,
            'player_id': self.player_id,
            'name': self.name,
            'profession_type': self.profession_type,
            'attribute_type': self.attribute_type,
            'version_id': self.version_id,
            'level': self.level,
            'exp': self.exp,
            'stats': self.stats,
            'equipment': self.equipment,
            'skills': self.skills,
            'description': self.description,
            'is_locked': is_locked,
            'star': star
        }


