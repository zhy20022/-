"""
场景管理
管理游戏场景切换
"""

from enum import Enum
from typing import Dict, Any, Optional, Callable
from .game_state import GameState, GameStateType


class SceneType(Enum):
    """场景类型"""
    LOGIN = "登录"
    MAIN_MENU = "主菜单"
    CHARACTER = "角色"
    DUNGEON = "副本"
    BATTLE = "战斗"
    GACHA = "抽取"
    CRAFTING = "制作"
    INVENTORY = "背包"
    SETTINGS = "设置"


class SceneManager:
    """场景管理器"""
    
    def __init__(self):
        """初始化场景管理器"""
        self.current_scene: Optional[SceneType] = None
        self.scene_data: Dict[str, Any] = {}
        self.scene_handlers: Dict[SceneType, Callable] = {}
    
    def register_scene_handler(self, scene_type: SceneType, handler: Callable):
        """
        注册场景处理器
        
        Args:
            scene_type: 场景类型
            handler: 处理函数
        """
        self.scene_handlers[scene_type] = handler
    
    def switch_scene(self, scene_type: SceneType, data: Dict[str, Any] = None):
        """
        切换场景
        
        Args:
            scene_type: 目标场景
            data: 场景数据
        """
        self.current_scene = scene_type
        self.scene_data = data or {}
        
        # 调用场景处理器
        if scene_type in self.scene_handlers:
            self.scene_handlers[scene_type](self.scene_data)
    
    def get_current_scene(self) -> Optional[SceneType]:
        """获取当前场景"""
        return self.current_scene
    
    def get_scene_data(self) -> Dict[str, Any]:
        """获取场景数据"""
        return self.scene_data.copy()


