"""
游戏状态管理
实现游戏状态机
"""

from enum import Enum
from typing import Dict, Any, Optional
from datetime import datetime


class GameStateType(Enum):
    """游戏状态类型"""
    MENU = "主菜单"
    CHARACTER_SELECTION = "角色选择"
    DUNGEON_SELECTION = "副本选择"
    BATTLE = "战斗"
    REWARD = "奖励结算"
    CRAFTING = "制作"
    GACHA = "抽取"
    INVENTORY = "背包"
    SETTINGS = "设置"


class GameState:
    """游戏状态"""
    
    def __init__(self, state_type: GameStateType, player_id: str):
        """
        初始化游戏状态
        
        Args:
            state_type: 状态类型
            player_id: 玩家ID
        """
        self.state_type = state_type
        self.player_id = player_id
        self.created_at = datetime.now()
        self.data: Dict[str, Any] = {}
    
    def set_data(self, key: str, value: Any):
        """设置状态数据"""
        self.data[key] = value
    
    def get_data(self, key: str, default: Any = None) -> Any:
        """获取状态数据"""
        return self.data.get(key, default)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            'state_type': self.state_type.value,
            'player_id': self.player_id,
            'created_at': self.created_at.isoformat(),
            'data': self.data
        }


