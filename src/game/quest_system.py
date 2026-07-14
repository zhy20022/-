"""
任务系统（参考失落的龙约）
实现主线任务、支线任务、日常任务等
"""

from enum import Enum
from typing import Dict, Any, List, Optional, Callable
from datetime import datetime, timedelta
import uuid


class QuestType(Enum):
    """任务类型"""
    MAIN = "主线任务"      # 主线剧情任务
    SIDE = "支线任务"      # 支线剧情任务
    DAILY = "日常任务"     # 每日刷新任务
    WEEKLY = "周常任务"    # 每周刷新任务
    ACHIEVEMENT = "成就任务"  # 成就类任务


class QuestStatus(Enum):
    """任务状态"""
    LOCKED = "未解锁"      # 未解锁
    AVAILABLE = "可接取"    # 可接取
    IN_PROGRESS = "进行中"  # 进行中
    COMPLETED = "已完成"    # 已完成
    CLAIMED = "已领取"     # 已领取奖励


class QuestReward:
    """任务奖励"""
    
    def __init__(
        self,
        exp: int = 0,
        gold: int = 0,
        materials: Dict[str, int] = None,
        items: List[str] = None
    ):
        """
        初始化任务奖励
        
        Args:
            exp: 经验值
            gold: 金币
            materials: 材料字典 {material_type: count}
            items: 物品ID列表
        """
        self.exp = exp
        self.gold = gold
        self.materials = materials or {}
        self.items = items or []
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "exp": self.exp,
            "gold": self.gold,
            "materials": self.materials,
            "items": self.items
        }


class QuestObjective:
    """任务目标"""
    
    def __init__(
        self,
        objective_id: str,
        description: str,
        target_type: str,  # "kill_monster", "complete_dungeon", "upgrade_equipment"等
        target_id: Optional[str] = None,
        target_count: int = 1,
        current_count: int = 0
    ):
        """
        初始化任务目标
        
        Args:
            objective_id: 目标ID
            description: 目标描述
            target_type: 目标类型
            target_id: 目标ID（如怪物ID、副本ID等）
            target_count: 目标数量
            current_count: 当前进度
        """
        self.objective_id = objective_id
        self.description = description
        self.target_type = target_type
        self.target_id = target_id
        self.target_count = target_count
        self.current_count = current_count
    
    def is_completed(self) -> bool:
        """检查是否完成"""
        return self.current_count >= self.target_count
    
    def update_progress(self, count: int = 1):
        """更新进度"""
        self.current_count = min(self.current_count + count, self.target_count)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "objective_id": self.objective_id,
            "description": self.description,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "target_count": self.target_count,
            "current_count": self.current_count,
            "is_completed": self.is_completed()
        }


class Quest:
    """任务类"""
    
    def __init__(
        self,
        quest_id: str,
        name: str,
        quest_type: QuestType,
        description: str = "",
        objectives: List[QuestObjective] = None,
        reward: QuestReward = None,
        unlock_condition: Optional[Callable] = None,
        daily_reset: bool = False,
        weekly_reset: bool = False
    ):
        """
        初始化任务
        
        Args:
            quest_id: 任务ID
            name: 任务名称
            quest_type: 任务类型
            description: 任务描述
            objectives: 任务目标列表
            reward: 任务奖励
            unlock_condition: 解锁条件（函数）
            daily_reset: 是否每日重置
            weekly_reset: 是否每周重置
        """
        self.quest_id = quest_id
        self.name = name
        self.quest_type = quest_type
        self.description = description
        self.objectives = objectives or []
        self.reward = reward or QuestReward()
        self.unlock_condition = unlock_condition
        self.daily_reset = daily_reset
        self.weekly_reset = weekly_reset
        
        self.status = QuestStatus.LOCKED
        self.accepted_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None
        self.claimed_at: Optional[datetime] = None
    
    def check_unlock(self, player_data: Dict[str, Any]) -> bool:
        """检查是否解锁"""
        if self.unlock_condition:
            return self.unlock_condition(player_data)
        return True
    
    def is_all_objectives_completed(self) -> bool:
        """检查是否所有目标都完成"""
        return all(obj.is_completed() for obj in self.objectives)
    
    def update_objective(self, objective_id: str, count: int = 1) -> bool:
        """
        更新任务目标进度
        
        Args:
            objective_id: 目标ID
            count: 增加的数量
            
        Returns:
            是否更新成功
        """
        if self.status != QuestStatus.IN_PROGRESS:
            return False
        
        for objective in self.objectives:
            if objective.objective_id == objective_id:
                objective.update_progress(count)
                # 检查是否完成
                if self.is_all_objectives_completed():
                    self.status = QuestStatus.COMPLETED
                    self.completed_at = datetime.now()
                return True
        return False
    
    def accept(self):
        """接取任务"""
        if self.status == QuestStatus.AVAILABLE:
            self.status = QuestStatus.IN_PROGRESS
            self.accepted_at = datetime.now()
    
    def claim_reward(self) -> QuestReward:
        """领取奖励"""
        if self.status == QuestStatus.COMPLETED:
            self.status = QuestStatus.CLAIMED
            self.claimed_at = datetime.now()
            return self.reward
        return QuestReward()
    
    def reset(self):
        """重置任务（用于日常/周常任务）"""
        if self.daily_reset or self.weekly_reset:
            self.status = QuestStatus.AVAILABLE
            self.accepted_at = None
            self.completed_at = None
            self.claimed_at = None
            # 重置目标进度
            for objective in self.objectives:
                objective.current_count = 0
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "quest_id": self.quest_id,
            "name": self.name,
            "quest_type": self.quest_type.value,
            "description": self.description,
            "status": self.status.value,
            "objectives": [obj.to_dict() for obj in self.objectives],
            "reward": self.reward.to_dict(),
            "accepted_at": self.accepted_at.isoformat() if self.accepted_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "claimed_at": self.claimed_at.isoformat() if self.claimed_at else None
        }


class QuestSystem:
    """任务系统"""
    
    def __init__(self, player_id: str):
        """
        初始化任务系统
        
        Args:
            player_id: 玩家ID
        """
        self.player_id = player_id
        self.quests: Dict[str, Quest] = {}
        self.quest_history: List[Dict[str, Any]] = []
        self.last_daily_reset: Optional[datetime] = None
        self.last_weekly_reset: Optional[datetime] = None
        
        self._initialize_quests()
    
    def _initialize_quests(self):
        """初始化任务列表"""
        # 主线任务示例
        main_quest_1 = Quest(
            quest_id="main_001",
            name="初入游戏",
            quest_type=QuestType.MAIN,
            description="完成第一次副本挑战",
            objectives=[
                QuestObjective(
                    objective_id="obj_001",
                    description="完成任意副本1次",
                    target_type="complete_dungeon",
                    target_count=1
                )
            ],
            reward=QuestReward(exp=100, gold=1000)
        )
        self.quests["main_001"] = main_quest_1
        
        # 日常任务示例
        daily_quest_1 = Quest(
            quest_id="daily_001",
            name="每日副本",
            quest_type=QuestType.DAILY,
            description="完成3次副本",
            objectives=[
                QuestObjective(
                    objective_id="obj_daily_001",
                    description="完成任意副本3次",
                    target_type="complete_dungeon",
                    target_count=3
                )
            ],
            reward=QuestReward(exp=50, gold=500),
            daily_reset=True
        )
        self.quests["daily_001"] = daily_quest_1
        
        daily_quest_2 = Quest(
            quest_id="daily_002",
            name="每日强化",
            quest_type=QuestType.DAILY,
            description="强化装备1次",
            objectives=[
                QuestObjective(
                    objective_id="obj_daily_002",
                    description="强化任意装备1次",
                    target_type="upgrade_equipment",
                    target_count=1
                )
            ],
            reward=QuestReward(exp=30, gold=300),
            daily_reset=True
        )
        self.quests["daily_002"] = daily_quest_2
    
    def update_quest_progress(
        self,
        target_type: str,
        target_id: Optional[str] = None,
        count: int = 1
    ):
        """
        更新任务进度
        
        Args:
            target_type: 目标类型
            target_id: 目标ID
            count: 增加的数量
        """
        for quest in self.quests.values():
            if quest.status == QuestStatus.IN_PROGRESS:
                for objective in quest.objectives:
                    if objective.target_type == target_type:
                        if target_id is None or objective.target_id == target_id:
                            quest.update_objective(objective.objective_id, count)
    
    def get_available_quests(self, player_data: Dict[str, Any] = None) -> List[Quest]:
        """
        获取可接取的任务
        
        Args:
            player_data: 玩家数据（用于检查解锁条件）
            
        Returns:
            可接取的任务列表
        """
        available = []
        player_data = player_data or {}
        
        for quest in self.quests.values():
            if quest.status == QuestStatus.LOCKED:
                if quest.check_unlock(player_data):
                    quest.status = QuestStatus.AVAILABLE
                    available.append(quest)
            elif quest.status == QuestStatus.AVAILABLE:
                available.append(quest)
        
        return available
    
    def accept_quest(self, quest_id: str) -> bool:
        """
        接取任务
        
        Args:
            quest_id: 任务ID
            
        Returns:
            是否接取成功
        """
        quest = self.quests.get(quest_id)
        if quest and quest.status == QuestStatus.AVAILABLE:
            quest.accept()
            return True
        return False
    
    def claim_quest_reward(self, quest_id: str) -> Optional[QuestReward]:
        """
        领取任务奖励
        
        Args:
            quest_id: 任务ID
            
        Returns:
            任务奖励，如果失败返回None
        """
        quest = self.quests.get(quest_id)
        if quest and quest.status == QuestStatus.COMPLETED:
            reward = quest.claim_reward()
            # 记录到历史
            self.quest_history.append({
                "quest_id": quest_id,
                "name": quest.name,
                "reward": reward.to_dict(),
                "claimed_at": datetime.now().isoformat()
            })
            return reward
        return None
    
    def reset_daily_quests(self):
        """重置日常任务"""
        now = datetime.now()
        # 检查是否需要重置（每天0点重置）
        if self.last_daily_reset is None or (now - self.last_daily_reset).days >= 1:
            for quest in self.quests.values():
                if quest.daily_reset:
                    quest.reset()
            self.last_daily_reset = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    def reset_weekly_quests(self):
        """重置周常任务"""
        now = datetime.now()
        # 检查是否需要重置（每周一0点重置）
        if self.last_weekly_reset is None or (now - self.last_weekly_reset).days >= 7:
            for quest in self.quests.values():
                if quest.weekly_reset:
                    quest.reset()
            # 设置为本周一
            days_since_monday = now.weekday()
            self.last_weekly_reset = (now - timedelta(days=days_since_monday)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
    
    def get_quest(self, quest_id: str) -> Optional[Quest]:
        """获取任务"""
        return self.quests.get(quest_id)
    
    def get_all_quests(self) -> List[Quest]:
        """获取所有任务"""
        return list(self.quests.values())
    
    def get_quests_by_type(self, quest_type: QuestType) -> List[Quest]:
        """根据类型获取任务"""
        return [q for q in self.quests.values() if q.quest_type == quest_type]







