"""
游戏模式基类
"""

from enum import Enum
from abc import ABC, abstractmethod
from typing import List, Dict, Any
from datetime import datetime, timedelta


class GameModeType(Enum):
    """游戏模式类型"""
    SOLO_WILDER = "单人野外"
    FIVE_PLAYER_TEAM = "五人小队"
    TWENTY_PLAYER_TEAM = "二十人团队"
    SERVER_EVENT = "全服活动"


class GameMode(ABC):
    """游戏模式基类"""
    
    def __init__(
        self,
        mode_type: GameModeType,
        name: str,
        description: str,
        unlock_level: int = 1,
        reset_period_days: int = None
    ):
        """
        初始化游戏模式
        
        Args:
            mode_type: 模式类型
            name: 模式名称
            description: 模式描述
            unlock_level: 解锁等级
            reset_period_days: 重置周期（天数），None表示不重置
        """
        self.mode_type = mode_type
        self.name = name
        self.description = description
        self.unlock_level = unlock_level
        self.reset_period_days = reset_period_days
        self.last_reset_time: datetime = None
        if reset_period_days:
            self.last_reset_time = datetime.now()
    
    def can_access(self, player_level: int) -> bool:
        """
        检查玩家是否可以访问该模式
        
        Args:
            player_level: 玩家等级
            
        Returns:
            如果可以访问返回True
        """
        return player_level >= self.unlock_level
    
    def is_reset_available(self) -> bool:
        """
        检查是否可以进行重置
        
        Returns:
            如果可以重置返回True
        """
        if not self.reset_period_days:
            return False
        
        if not self.last_reset_time:
            return True
        
        next_reset = self.last_reset_time + timedelta(days=self.reset_period_days)
        return datetime.now() >= next_reset
    
    def reset(self):
        """重置模式"""
        if self.is_reset_available():
            self.last_reset_time = datetime.now()
            self._on_reset()
    
    @abstractmethod
    def _on_reset(self):
        """重置时的回调（子类实现）"""
        pass
    
    @abstractmethod
    def get_rewards(self) -> Dict[str, Any]:
        """
        获取奖励信息
        
        Returns:
            奖励字典
        """
        pass
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "mode_type": self.mode_type.value,
            "name": self.name,
            "description": self.description,
            "unlock_level": self.unlock_level,
            "reset_period_days": self.reset_period_days,
            "last_reset_time": self.last_reset_time.isoformat() if self.last_reset_time else None
        }








