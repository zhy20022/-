"""
游戏管理器
管理游戏流程、状态转换等
"""

from typing import Dict, Any, Optional
from .game_state import GameState, GameStateType
from .scene_manager import SceneManager, SceneType
from ..player.player import Player, PlayerManager


class GameManager:
    """游戏管理器"""
    
    def __init__(self, player_id: str):
        """
        初始化游戏管理器
        
        Args:
            player_id: 玩家ID
        """
        self.player_id = player_id
        self.player: Optional[Player] = None
        self.current_state: Optional[GameState] = None
        self.scene_manager = SceneManager()
        
        # 加载玩家数据
        self.load_player()
    
    def load_player(self):
        """加载玩家数据"""
        self.player = PlayerManager.get_player_by_id(self.player_id)
    
    def set_state(self, state_type: GameStateType, data: Dict[str, Any] = None):
        """
        设置游戏状态
        
        Args:
            state_type: 状态类型
            data: 状态数据
        """
        self.current_state = GameState(state_type, self.player_id)
        if data:
            for key, value in data.items():
                self.current_state.set_data(key, value)
    
    def get_state(self) -> Optional[GameState]:
        """获取当前状态"""
        return self.current_state
    
    def switch_scene(self, scene_type: SceneType, data: Dict[str, Any] = None):
        """
        切换场景
        
        Args:
            scene_type: 场景类型
            data: 场景数据
        """
        self.scene_manager.switch_scene(scene_type, data)
    
    def handle_battle_start(self, dungeon_id: str, character_ids: list):
        """
        处理战斗开始
        
        Args:
            dungeon_id: 副本ID
            character_ids: 角色ID列表
        """
        # 切换到战斗状态
        self.set_state(GameStateType.BATTLE, {
            'dungeon_id': dungeon_id,
            'character_ids': character_ids
        })
        
        # 切换到战斗场景
        self.switch_scene(SceneType.BATTLE, {
            'dungeon_id': dungeon_id,
            'character_ids': character_ids
        })
    
    def handle_battle_end(self, result: Dict[str, Any]):
        """
        处理战斗结束
        
        Args:
            result: 战斗结果
        """
        # 切换到奖励状态
        self.set_state(GameStateType.REWARD, result)
        
        # 切换到奖励场景（暂时返回主菜单）
        self.switch_scene(SceneType.MAIN_MENU)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            'player_id': self.player_id,
            'player': self.player.to_dict() if self.player else None,
            'current_state': self.current_state.to_dict() if self.current_state else None,
            'current_scene': self.scene_manager.get_current_scene().value if self.scene_manager.get_current_scene() else None
        }


