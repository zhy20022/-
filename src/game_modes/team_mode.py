"""
团队模式（五人小队和二十人团队）
"""

from abc import abstractmethod
from .game_mode import GameMode, GameModeType
from typing import List, Dict, Any, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from ..characters.character import Character


class TeamMode(GameMode):
    """团队模式基类"""
    
    def __init__(
        self,
        mode_type: GameModeType,
        name: str,
        description: str,
        team_size: int,
        unlock_level: int,
        reset_period_days: int
    ):
        super().__init__(
            mode_type=mode_type,
            name=name,
            description=description,
            unlock_level=unlock_level,
            reset_period_days=reset_period_days
        )
        self.team_size = team_size
        self.team_members: List['Character'] = []
    
    def add_member(self, character: 'Character') -> bool:
        """
        添加团队成员
        
        Args:
            character: 角色
            
        Returns:
            如果添加成功返回True
        """
        if len(self.team_members) >= self.team_size:
            return False
        
        if character in self.team_members:
            return False
        
        self.team_members.append(character)
        return True
    
    def remove_member(self, character: 'Character') -> bool:
        """
        移除团队成员
        
        Args:
            character: 角色
            
        Returns:
            如果移除成功返回True
        """
        if character in self.team_members:
            self.team_members.remove(character)
            return True
        return False
    
    def is_team_full(self) -> bool:
        """检查团队是否已满"""
        return len(self.team_members) >= self.team_size
    
    def is_team_ready(self) -> bool:
        """检查团队是否准备就绪（子类可重写）"""
        return self.is_team_full()
    
    def _on_reset(self):
        """重置时的处理"""
        # 团队模式重置逻辑
        pass
    
    @abstractmethod
    def get_rewards(self) -> Dict[str, Any]:
        """获取奖励信息（子类实现）"""
        pass


class FivePlayerTeam(TeamMode):
    """五人小队模式 - 周长副本"""
    
    def __init__(self):
        super().__init__(
            mode_type=GameModeType.FIVE_PLAYER_TEAM,
            name="五人小队",
            description="周长副本，获得专属武器抽取材料。副本内装备固定，无法带出。",
            team_size=5,
            unlock_level=100,  # 满级后解锁
            reset_period_days=7  # 每周重置
        )
        self.weapon_material_reward = 50
    
    def is_team_ready(self) -> bool:
        """检查团队是否准备就绪"""
        if not self.is_team_full():
            return False
        
        # 检查职业搭配（建议至少有一个坦克和一个治疗）
        has_tank = any(member.profession.is_tank() for member in self.team_members)
        has_healer = any(
            member.profession.profession_type.value == "治疗" 
            for member in self.team_members
        )
        
        # 不是必须，但建议有
        return True
    
    def get_rewards(self) -> Dict[str, Any]:
        """
        获取奖励信息
        
        Returns:
            奖励字典，包含专属武器抽取材料
        """
        return {
            "weapon_materials": self.weapon_material_reward,
            "equipment": {
                "type": "副本内装备",
                "can_take_out": False,
                "description": "副本内装备固定，无法带出副本"
            },
            "description": "专属武器抽取材料、副本内装备（固定）"
        }
    
    def calculate_rewards(self, difficulty: int = 1) -> Dict[str, Any]:
        """
        根据难度计算奖励
        
        Args:
            difficulty: 难度等级（1-5）
            
        Returns:
            奖励字典
        """
        difficulty_multiplier = 1 + (difficulty - 1) * 0.3
        materials = int(self.weapon_material_reward * difficulty_multiplier)
        
        return {
            "weapon_materials": materials,
            "equipment": {
                "type": "副本内装备",
                "can_take_out": False
            }
        }


class TwentyPlayerTeam(TeamMode):
    """二十人团队模式 - 月度副本"""
    
    def __init__(self):
        super().__init__(
            mode_type=GameModeType.TWENTY_PLAYER_TEAM,
            name="二十人团队",
            description="月度副本，获得套装制作材料。副本内饰品固定，无法带出。",
            team_size=20,
            unlock_level=100,  # 需要满级
            reset_period_days=30  # 每月重置
        )
        self.set_material_reward = 100
        self.requires_five_player_team = True  # 需要先有五人小队
    
    def is_team_ready(self) -> bool:
        """检查团队是否准备就绪"""
        if not self.is_team_full():
            return False
        
        # 检查职业搭配（建议有多个坦克、治疗和输出）
        tanks = sum(1 for member in self.team_members if member.profession.is_tank())
        healers = sum(
            1 for member in self.team_members 
            if member.profession.profession_type.value == "治疗"
        )
        dps = sum(1 for member in self.team_members if member.profession.is_dps())
        
        # 建议配置：至少3个坦克，3个治疗，其余输出
        return tanks >= 2 and healers >= 2 and dps >= 5
    
    def get_rewards(self) -> Dict[str, Any]:
        """
        获取奖励信息
        
        Returns:
            奖励字典，包含套装制作材料
        """
        return {
            "set_materials": self.set_material_reward,
            "accessories": {
                "type": "副本内饰品",
                "can_take_out": False,
                "description": "副本内饰品固定，无法带出副本"
            },
            "description": "套装制作材料、副本内饰品（固定）"
        }
    
    def calculate_rewards(self, difficulty: int = 1) -> Dict[str, Any]:
        """
        根据难度计算奖励
        
        Args:
            difficulty: 难度等级（1-5）
            
        Returns:
            奖励字典
        """
        difficulty_multiplier = 1 + (difficulty - 1) * 0.25
        materials = int(self.set_material_reward * difficulty_multiplier)
        
        return {
            "set_materials": materials,
            "accessories": {
                "type": "副本内饰品",
                "can_take_out": False
            }
        }

