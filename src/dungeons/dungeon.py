"""
副本定义系统
定义副本的基本信息、类型、解锁条件等
"""

from enum import Enum
from typing import Dict, Any, List, Optional
from ..attributes.attribute import AttributeType
from ..game_modes.game_mode import GameModeType


ATTRIBUTE_ID_MAP = {
    AttributeType.FIRE: "fire",
    AttributeType.WOOD: "wood",
    AttributeType.WIND: "wind",
    AttributeType.WATER: "water",
    AttributeType.EARTH: "earth",
    AttributeType.THUNDER: "lightning",
    AttributeType.LIGHT: "holy",
    AttributeType.DARK: "shadow",
}


class DungeonType(Enum):
    """副本类型"""
    SINGLE = "1人本"           # 一名玩家派出1个角色
    SQUAD = "5人本"            # 一至五名玩家派出总共5个角色
    TEAM = "20人本"            # 四名玩家每人派出5个角色
    SERVER_BOSS = "世界boss本"  # 一名玩家派出20个角色


class DungeonDifficulty(Enum):
    """副本难度"""
    NORMAL = "普通"
    HARD = "困难"
    NIGHTMARE = "噩梦"


DIFFICULTY_CONFIG = {
    DungeonDifficulty.NORMAL: {
        "key": "normal",
        "order": 1,
        "monster_multiplier": 1.0,
        "reward_multiplier": 1.0,
        "recommended_level_bonus": 0,
        "unlock": "默认解锁",
    },
    DungeonDifficulty.HARD: {
        "key": "hard",
        "order": 2,
        "monster_multiplier": 1.6,
        "reward_multiplier": 1.5,
        "recommended_level_bonus": 20,
        "unlock": "通关同副本普通难度1次",
    },
    DungeonDifficulty.NIGHTMARE: {
        "key": "nightmare",
        "order": 3,
        "monster_multiplier": 2.4,
        "reward_multiplier": 2.25,
        "recommended_level_bonus": 40,
        "unlock": "通关同副本困难难度1次",
    },
}


class Dungeon:
    """副本类"""
    
    def __init__(
        self,
        dungeon_id: str,
        name: str,
        attribute_type: AttributeType,
        dungeon_type: DungeonType,
        description: str = "",
        duration: float = 60.0,  # 副本时长（秒）
        unlock_condition: Dict[str, Any] = None,
        reward_config: Dict[str, Any] = None,
        monster_config: Dict[str, Any] = None,
        difficulty: DungeonDifficulty = DungeonDifficulty.NORMAL,
        base_dungeon_id: Optional[str] = None
    ):
        """
        初始化副本
        
        Args:
            dungeon_id: 副本ID
            name: 副本名称
            attribute_type: 副本属性（火、水、雷等）
            dungeon_type: 副本类型（1人本、5人本、20人本、世界boss本）
            description: 副本描述
            duration: 副本时长（秒）
            unlock_condition: 解锁条件
            reward_config: 奖励配置
            monster_config: 怪物配置
        """
        self.dungeon_id = dungeon_id
        self.name = name
        self.attribute_type = attribute_type
        self.dungeon_type = dungeon_type
        self.description = description
        self.duration = duration
        self.difficulty = difficulty
        self.base_dungeon_id = base_dungeon_id or dungeon_id
        self.unlock_condition = unlock_condition or {}
        self.reward_config = reward_config or {}
        self.monster_config = monster_config or {}
        
        # 副本状态
        self.is_unlocked = False
    
    def check_unlock_condition(self, player_data: Dict[str, Any]) -> bool:
        """
        检查解锁条件
        
        Args:
            player_data: 玩家数据（等级、角色列表等）
            
        Returns:
            如果满足解锁条件返回True
        """
        if not self._check_difficulty_unlock(player_data):
            return False

        if self.dungeon_type == DungeonType.SINGLE:
            # 1人本：无条件
            return True
        
        elif self.dungeon_type == DungeonType.SQUAD:
            # 5人本：角色满级（100级），单人则需要5个满级角色
            if player_data.get("is_solo", False):
                # 单人：需要5个满级角色
                characters = player_data.get("characters", [])
                max_level_chars = [c for c in characters if c.get("level", 0) >= 100]
                return len(max_level_chars) >= 5
            else:
                # 多人：至少有一个满级角色
                characters = player_data.get("characters", [])
                return any(c.get("level", 0) >= 100 for c in characters)
        
        elif self.dungeon_type == DungeonType.TEAM:
            # 20人本：对应属性拥有至少五个不同职业的满级角色（单人通关过对应属性的5人本）
            if player_data.get("is_solo", False):
                # 单人：需要对应属性5个不同职业的满级角色，且通关过对应属性的5人本
                characters = player_data.get("characters", [])
                attribute_chars = [c for c in characters 
                                 if (c.get("attribute") or c.get("attribute_type")) == self.attribute_type.value 
                                 and c.get("level", 0) >= 100]
                
                # 检查是否有5个不同职业
                professions = set(c.get("profession") or c.get("profession_type") for c in attribute_chars)
                if len(professions) < 5:
                    return False
                
                # 检查是否通关过对应属性的5人本
                completed_dungeons = player_data.get("completed_dungeons", [])
                attr_id = ATTRIBUTE_ID_MAP.get(self.attribute_type, self.attribute_type.name.lower())
                squad_dungeon_id = f"{attr_id}_type_squad_001"
                return squad_dungeon_id in completed_dungeons
            else:
                # 多人：至少有对应属性的满级角色
                characters = player_data.get("characters", [])
                return any((c.get("attribute") or c.get("attribute_type")) == self.attribute_type.value 
                          and c.get("level", 0) >= 100 
                          for c in characters)
        
        elif self.dungeon_type == DungeonType.SERVER_BOSS:
            # 世界boss本：拥有至少20个满级角色
            characters = player_data.get("characters", [])
            max_level_chars = [c for c in characters if c.get("level", 0) >= 100]
            return len(max_level_chars) >= 20
        
        return False

    def _check_difficulty_unlock(self, player_data: Dict[str, Any]) -> bool:
        completed_dungeons = set(player_data.get("completed_dungeons", []))
        if self.difficulty == DungeonDifficulty.NORMAL:
            return True
        if self.difficulty == DungeonDifficulty.HARD:
            return self.base_dungeon_id in completed_dungeons
        if self.difficulty == DungeonDifficulty.NIGHTMARE:
            return f"{self.base_dungeon_id}_hard" in completed_dungeons
        return True

    def get_difficulty_config(self) -> Dict[str, Any]:
        return DIFFICULTY_CONFIG[self.difficulty]

    def get_reward_multiplier(self) -> float:
        return float(self.get_difficulty_config()["reward_multiplier"])

    def get_monster_multiplier(self) -> float:
        return float(self.get_difficulty_config()["monster_multiplier"])
    
    def get_display_name(self) -> str:
        """获取显示名称"""
        return f"{self.name}-{self.attribute_type.value}{self.dungeon_type.value}-{self.difficulty.value}（{self.dungeon_id}）"
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "dungeon_id": self.dungeon_id,
            "name": self.name,
            "attribute_type": self.attribute_type.value,
            "dungeon_type": self.dungeon_type.value,
            "description": self.description,
            "duration": self.duration,
            "difficulty": self.difficulty.value,
            "difficulty_key": self.get_difficulty_config()["key"],
            "difficulty_order": self.get_difficulty_config()["order"],
            "base_dungeon_id": self.base_dungeon_id,
            "recommended_level_bonus": self.get_difficulty_config()["recommended_level_bonus"],
            "monster_multiplier": self.get_monster_multiplier(),
            "reward_multiplier": self.get_reward_multiplier(),
            "difficulty_unlock": self.get_difficulty_config()["unlock"],
            "unlock_condition": self.unlock_condition,
            "reward_config": self.reward_config,
            "monster_config": self.monster_config,
            "is_unlocked": self.is_unlocked
        }
    
    def __str__(self) -> str:
        return f"{self.get_display_name()}: {self.description}"






