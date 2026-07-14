"""
副本进度管理系统
管理副本的进度、完成状态、挑战次数等
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from .dungeon import Dungeon, DungeonType


class DungeonProgress:
    """副本进度"""
    
    def __init__(
        self,
        dungeon_id: str,
        player_id: str
    ):
        """
        初始化副本进度
        
        Args:
            dungeon_id: 副本ID
            player_id: 玩家ID
        """
        self.dungeon_id = dungeon_id
        self.player_id = player_id
        
        # 挑战次数
        self.total_attempts = 0
        self.successful_attempts = 0
        self.failed_attempts = 0
        
        # 完成状态
        self.is_completed = False
        self.completion_count = 0
        self.last_completion_time: Optional[datetime] = None
        
        # 扫荡模式解锁
        self.sweep_unlocked = False
        self.sweep_unlock_count = 50  # 经验本在接口层使用100次，其余可扫荡副本默认50次
        
        # 连续战斗
        self.continuous_battle_count = 0
        self.continuous_battle_results: List[Dict[str, Any]] = []
        
        # 最佳成绩
        self.best_time: Optional[float] = None
        self.best_reward: Dict[str, Any] = {}
    
    def add_attempt(self, is_success: bool, duration: float, rewards: Dict[str, Any] = None):
        """
        添加挑战记录
        
        Args:
            is_success: 是否成功
            duration: 持续时间
            rewards: 奖励
        """
        self.total_attempts += 1
        
        if is_success:
            self.successful_attempts += 1
            self.completion_count += 1
            self.is_completed = True
            self.last_completion_time = datetime.now()
            
            # 更新最佳成绩
            if self.best_time is None or duration < self.best_time:
                self.best_time = duration
            
            if rewards:
                total_reward = sum(rewards.values()) if isinstance(rewards, dict) else 0
                best_total = sum(self.best_reward.values()) if self.best_reward else 0
                if total_reward > best_total:
                    self.best_reward = rewards
            
            # 检查扫荡解锁
            if not self.sweep_unlocked and self.completion_count >= self.sweep_unlock_count:
                self.sweep_unlocked = True
        else:
            self.failed_attempts += 1
    
    def can_sweep(self) -> bool:
        """检查是否可以扫荡"""
        return self.sweep_unlocked
    
    def add_continuous_battle_result(self, result: Dict[str, Any]):
        """添加连续战斗结果"""
        self.continuous_battle_results.append(result)
        self.continuous_battle_count += 1
    
    def clear_continuous_battle(self):
        """清除连续战斗记录"""
        self.continuous_battle_count = 0
        self.continuous_battle_results = []
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "dungeon_id": self.dungeon_id,
            "player_id": self.player_id,
            "total_attempts": self.total_attempts,
            "successful_attempts": self.successful_attempts,
            "failed_attempts": self.failed_attempts,
            "is_completed": self.is_completed,
            "completion_count": self.completion_count,
            "last_completion_time": self.last_completion_time.isoformat() if self.last_completion_time else None,
            "sweep_unlocked": self.sweep_unlocked,
            "best_time": self.best_time,
            "best_reward": self.best_reward
        }


class DungeonProgressManager:
    """副本进度管理器"""
    
    def __init__(self, player_id: str):
        """
        初始化副本进度管理器
        
        Args:
            player_id: 玩家ID
        """
        self.player_id = player_id
        self.progresses: Dict[str, DungeonProgress] = {}
    
    def get_progress(self, dungeon_id: str) -> DungeonProgress:
        """获取副本进度"""
        if dungeon_id not in self.progresses:
            self.progresses[dungeon_id] = DungeonProgress(dungeon_id, self.player_id)
        return self.progresses[dungeon_id]
    
    def can_enter_dungeon(self, dungeon: Dungeon, player_data: Dict[str, Any]) -> bool:
        """
        检查是否可以进入副本
        
        Args:
            dungeon: 副本
            player_data: 玩家数据
            
        Returns:
            如果可以进入返回True
        """
        # 检查解锁条件
        if not dungeon.check_unlock_condition(player_data):
            return False
        
        # 副本没有次数限制，可以无限次挑战
        return True
    
    def can_sweep_dungeon(self, dungeon: Dungeon) -> bool:
        """
        检查是否可以扫荡副本
        
        Args:
            dungeon: 副本
            
        Returns:
            如果可以扫荡返回True
        """
        if dungeon.dungeon_type == DungeonType.SINGLE:
            # 1人本：经验本由接口层按100次解锁
            progress = self.get_progress(dungeon.dungeon_id)
            return progress.can_sweep()
        
        elif dungeon.dungeon_type == DungeonType.SQUAD:
            # 5人本：单人通关50次后解锁扫荡
            progress = self.get_progress(dungeon.dungeon_id)
            return progress.can_sweep()
        
        elif dungeon.dungeon_type == DungeonType.TEAM:
            # 20人本：不能扫荡
            return False
        
        elif dungeon.dungeon_type == DungeonType.SERVER_BOSS:
            # 世界boss本：不能扫荡
            return False
        
        return False
    
    def can_use_4x_speed(self, dungeon: Dungeon, is_multiplayer: bool, all_players_agree: bool) -> bool:
        """
        检查是否可以使用4倍速
        
        Args:
            dungeon: 副本
            is_multiplayer: 是否多人
            all_players_agree: 是否所有玩家同意
            
        Returns:
            如果可以使用4倍速返回True
        """
        if dungeon.dungeon_type == DungeonType.SINGLE:
            # 1人本：不能使用4倍速（只能扫荡）
            return False
        
        elif dungeon.dungeon_type == DungeonType.SQUAD:
            # 5人本：多人组队共同同意后发起4倍速
            return is_multiplayer and all_players_agree
        
        elif dungeon.dungeon_type == DungeonType.TEAM:
            # 20人本：可4名玩家共同同意后发起4倍速
            return is_multiplayer and all_players_agree
        
        elif dungeon.dungeon_type == DungeonType.SERVER_BOSS:
            # 世界boss本：不能使用4倍速
            return False
        
        return False
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "player_id": self.player_id,
            "progresses": {k: v.to_dict() for k, v in self.progresses.items()}
        }






