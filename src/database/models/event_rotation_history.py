"""
活动切换历史数据模型
"""

import enum
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Enum
from sqlalchemy.orm import relationship
from datetime import datetime
from . import Base


class RotationReasonEnum(str, enum.Enum):
    """切换原因枚举"""
    AUTO = "auto"  # 自动切换（到期）
    MANUAL = "manual"  # 手动切换（管理员）


class EventRotationHistoryModel(Base):
    """活动切换历史数据模型"""

    __tablename__ = 'event_rotation_history'

    history_id = Column(String(50), primary_key=True)
    event_type = Column(String(50), nullable=False, index=True)  # 'team_monthly' 或 'server_quarterly'
    old_event_id = Column(String(50), nullable=True)  # 旧活动ID
    new_event_id = Column(String(50), nullable=False)  # 新活动ID
    rotation_reason = Column(Enum(RotationReasonEnum), default=RotationReasonEnum.AUTO, nullable=False)
    rotated_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    
    # 额外信息（JSON格式存储）
    extra_info = Column(Text, nullable=True)  # 存储额外信息，如切换时的活动数据等

    def to_dict(self) -> dict:
        return {
            'history_id': self.history_id,
            'event_type': self.event_type,
            'old_event_id': self.old_event_id,
            'new_event_id': self.new_event_id,
            'rotation_reason': self.rotation_reason.value,
            'rotated_at': self.rotated_at.isoformat() if self.rotated_at else None,
            'extra_info': self.extra_info,
        }


