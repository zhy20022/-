"""
单人野外模式
"""

from .game_mode import GameMode, GameModeType
from typing import Dict, Any


class SoloMode(GameMode):
    """单人野外模式 - 日常升级"""
    
    def __init__(self):
        super().__init__(
            mode_type=GameModeType.SOLO_WILDER,
            name="单人野外",
            description="单人野外日常任务，用于升级和获取基础资源",
            unlock_level=1,
            reset_period_days=1  # 每日重置
        )
        self.exp_reward_base = 100
        self.material_reward_base = 10
    
    def _on_reset(self):
        """重置时的处理"""
        # 单人模式重置逻辑
        pass
    
    def get_rewards(self) -> Dict[str, Any]:
        """
        获取奖励信息
        
        Returns:
            奖励字典，包含经验值和基础材料
        """
        return {
            "exp": self.exp_reward_base,
            "materials": {
                "basic": self.material_reward_base
            },
            "description": "经验值、基础材料"
        }
    
    def calculate_rewards(self, player_level: int, difficulty: int = 1) -> Dict[str, Any]:
        """
        根据玩家等级和难度计算奖励
        
        Args:
            player_level: 玩家等级
            difficulty: 难度等级（1-5）
            
        Returns:
            奖励字典
        """
        level_multiplier = 1 + (player_level - 1) * 0.1
        difficulty_multiplier = 1 + (difficulty - 1) * 0.2
        
        exp = int(self.exp_reward_base * level_multiplier * difficulty_multiplier)
        materials = int(self.material_reward_base * level_multiplier * difficulty_multiplier)
        
        return {
            "exp": exp,
            "materials": {
                "basic": materials
            }
        }








