"""
成就系统（参考弹射世界）
实现成就解锁、成就奖励、成就展示等功能
"""

from enum import Enum
from typing import Dict, Any, List, Optional, Callable
from datetime import datetime
import uuid


class AchievementCategory(Enum):
    """成就分类"""
    COMBAT = "战斗"          # 战斗相关
    DUNGEON = "副本"         # 副本相关
    CHARACTER = "角色"       # 角色相关
    EQUIPMENT = "装备"       # 装备相关
    SOCIAL = "社交"         # 社交相关
    COLLECTION = "收集"     # 收集相关
    MILESTONE = "里程碑"     # 里程碑


class AchievementRarity(Enum):
    """成就稀有度"""
    COMMON = "普通"      # 普通成就
    RARE = "稀有"       # 稀有成就
    EPIC = "史诗"       # 史诗成就
    LEGENDARY = "传说"  # 传说成就


class Achievement:
    """成就类"""
    
    def __init__(
        self,
        achievement_id: str,
        name: str,
        description: str,
        category: AchievementCategory,
        rarity: AchievementRarity,
        condition: Callable[[Dict[str, Any]], bool],
        reward: Dict[str, Any] = None,
        icon: str = "",
        hidden: bool = False
    ):
        """
        初始化成就
        
        Args:
            achievement_id: 成就ID
            name: 成就名称
            description: 成就描述
            category: 成就分类
            rarity: 成就稀有度
            condition: 解锁条件（函数，接收玩家数据，返回是否解锁）
            reward: 成就奖励
            icon: 成就图标
            hidden: 是否隐藏（未解锁前不显示）
        """
        self.achievement_id = achievement_id
        self.name = name
        self.description = description
        self.category = category
        self.rarity = rarity
        self.condition = condition
        self.reward = reward or {}
        self.icon = icon
        self.hidden = hidden
        
        self.unlocked = False
        self.unlocked_at: Optional[datetime] = None
        self.progress: Dict[str, Any] = {}
    
    def check_unlock(self, player_data: Dict[str, Any]) -> bool:
        """
        检查是否解锁
        
        Args:
            player_data: 玩家数据
            
        Returns:
            是否解锁
        """
        if not self.unlocked:
            if self.condition(player_data):
                self.unlocked = True
                self.unlocked_at = datetime.now()
                return True
        return False
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "achievement_id": self.achievement_id,
            "name": self.name,
            "description": self.description,
            "category": self.category.value,
            "rarity": self.rarity.value,
            "unlocked": self.unlocked,
            "unlocked_at": self.unlocked_at.isoformat() if self.unlocked_at else None,
            "reward": self.reward,
            "icon": self.icon,
            "hidden": self.hidden and not self.unlocked,
            "progress": self.progress
        }


class AchievementSystem:
    """成就系统"""
    
    def __init__(self, player_id: str):
        """
        初始化成就系统
        
        Args:
            player_id: 玩家ID
        """
        self.player_id = player_id
        self.achievements: Dict[str, Achievement] = {}
        self.unlocked_achievements: List[str] = []
        
        self._initialize_achievements()
    
    def _initialize_achievements(self):
        """初始化成就列表"""
        # 战斗类成就
        combat_achievement_1 = Achievement(
            achievement_id="combat_001",
            name="初出茅庐",
            description="完成第一次战斗",
            category=AchievementCategory.COMBAT,
            rarity=AchievementRarity.COMMON,
            condition=lambda data: data.get("battles_completed", 0) >= 1,
            reward={"exp": 100, "gold": 500},
            icon="combat_001.png"
        )
        self.achievements["combat_001"] = combat_achievement_1
        
        combat_achievement_2 = Achievement(
            achievement_id="combat_002",
            name="百战不殆",
            description="完成100次战斗",
            category=AchievementCategory.COMBAT,
            rarity=AchievementRarity.RARE,
            condition=lambda data: data.get("battles_completed", 0) >= 100,
            reward={"exp": 1000, "gold": 5000},
            icon="combat_002.png"
        )
        self.achievements["combat_002"] = combat_achievement_2
        
        # 副本类成就
        dungeon_achievement_1 = Achievement(
            achievement_id="dungeon_001",
            name="副本探索者",
            description="完成所有类型的副本各1次",
            category=AchievementCategory.DUNGEON,
            rarity=AchievementRarity.EPIC,
            condition=lambda data: len(data.get("completed_dungeon_types", set())) >= 4,
            reward={"exp": 500, "gold": 2000, "materials": {"equipment_set": 5}},
            icon="dungeon_001.png"
        )
        self.achievements["dungeon_001"] = dungeon_achievement_1
        
        # 角色类成就
        character_achievement_1 = Achievement(
            achievement_id="character_001",
            name="角色收集家",
            description="拥有10个角色",
            category=AchievementCategory.CHARACTER,
            rarity=AchievementRarity.RARE,
            condition=lambda data: data.get("character_count", 0) >= 10,
            reward={"exp": 300, "gold": 1500},
            icon="character_001.png"
        )
        self.achievements["character_001"] = character_achievement_1
        
        # 装备类成就
        equipment_achievement_1 = Achievement(
            achievement_id="equipment_001",
            name="装备大师",
            description="拥有1件强化+50的装备",
            category=AchievementCategory.EQUIPMENT,
            rarity=AchievementRarity.LEGENDARY,
            condition=lambda data: data.get("max_equipment_enhancement", 0) >= 50,
            reward={"exp": 2000, "gold": 10000, "materials": {"equipment_set": 20}},
            icon="equipment_001.png",
            hidden=True
        )
        self.achievements["equipment_001"] = equipment_achievement_1
    
    def check_achievements(self, player_data: Dict[str, Any]) -> List[Achievement]:
        """
        检查并解锁成就
        
        Args:
            player_data: 玩家数据
            
        Returns:
            新解锁的成就列表
        """
        newly_unlocked = []
        
        for achievement in self.achievements.values():
            if not achievement.unlocked:
                if achievement.check_unlock(player_data):
                    newly_unlocked.append(achievement)
                    self.unlocked_achievements.append(achievement.achievement_id)
        
        return newly_unlocked
    
    def get_achievement(self, achievement_id: str) -> Optional[Achievement]:
        """获取成就"""
        return self.achievements.get(achievement_id)
    
    def get_all_achievements(self) -> List[Achievement]:
        """获取所有成就"""
        return list(self.achievements.values())
    
    def get_unlocked_achievements(self) -> List[Achievement]:
        """获取已解锁的成就"""
        return [self.achievements[aid] for aid in self.unlocked_achievements if aid in self.achievements]
    
    def get_achievements_by_category(self, category: AchievementCategory) -> List[Achievement]:
        """根据分类获取成就"""
        return [a for a in self.achievements.values() if a.category == category]
    
    def get_achievements_by_rarity(self, rarity: AchievementRarity) -> List[Achievement]:
        """根据稀有度获取成就"""
        return [a for a in self.achievements.values() if a.rarity == rarity]
    
    def get_achievement_progress(self, player_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        获取成就进度信息
        
        Args:
            player_data: 玩家数据
            
        Returns:
            成就进度字典
        """
        total = len(self.achievements)
        unlocked = len(self.unlocked_achievements)
        
        by_category = {}
        by_rarity = {}
        
        for achievement in self.achievements.values():
            # 按分类统计
            cat = achievement.category.value
            if cat not in by_category:
                by_category[cat] = {"total": 0, "unlocked": 0}
            by_category[cat]["total"] += 1
            if achievement.unlocked:
                by_category[cat]["unlocked"] += 1
            
            # 按稀有度统计
            rar = achievement.rarity.value
            if rar not in by_rarity:
                by_rarity[rar] = {"total": 0, "unlocked": 0}
            by_rarity[rar]["total"] += 1
            if achievement.unlocked:
                by_rarity[rar]["unlocked"] += 1
        
        return {
            "total": total,
            "unlocked": unlocked,
            "progress": unlocked / total if total > 0 else 0,
            "by_category": by_category,
            "by_rarity": by_rarity
        }







