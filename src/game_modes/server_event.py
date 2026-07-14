"""
全服活动模式
"""

from .game_mode import GameMode, GameModeType
from typing import Dict, Any
from datetime import datetime, timedelta


class ServerEvent(GameMode):
    """全服击杀活动 - 季度活动"""
    
    def __init__(self):
        super().__init__(
            mode_type=GameModeType.SERVER_EVENT,
            name="全服击杀活动",
            description="季度活动，获得立绘兑换材料。活动期间有特殊加成。",
            unlock_level=100,  # 需要满级
            reset_period_days=90  # 每季度（约90天）重置
        )
        self.illustration_material_reward = 200
        self.bonus_multiplier = 1.5  # 活动期间加成
        self.requires_twenty_player_team = True  # 需要先有二十人团队
        self.event_start_time: datetime = None
        self.event_end_time: datetime = None
        self.is_active = False
    
    def start_event(self, duration_days: int = 7):
        """
        开始活动
        
        Args:
            duration_days: 活动持续天数
        """
        self.event_start_time = datetime.now()
        self.event_end_time = self.event_start_time + timedelta(days=duration_days)
        self.is_active = True
    
    def end_event(self):
        """结束活动"""
        self.is_active = False
        self.event_start_time = None
        self.event_end_time = None
    
    def is_event_active(self) -> bool:
        """检查活动是否正在进行"""
        if not self.is_active:
            return False
        
        if self.event_end_time and datetime.now() > self.event_end_time:
            self.end_event()
            return False
        
        return True
    
    def _on_reset(self):
        """重置时的处理"""
        # 全服活动重置逻辑
        if self.is_event_active():
            self.end_event()
    
    def get_rewards(self) -> Dict[str, Any]:
        """
        获取奖励信息
        
        Returns:
            奖励字典，包含立绘兑换材料
        """
        base_materials = self.illustration_material_reward
        
        # 如果活动正在进行，应用加成
        if self.is_event_active():
            base_materials = int(base_materials * self.bonus_multiplier)
        
        return {
            "illustration_materials": base_materials,
            "bonus_active": self.is_event_active(),
            "bonus_multiplier": self.bonus_multiplier if self.is_event_active() else 1.0,
            "description": "立绘兑换材料（活动期间有加成）"
        }
    
    def calculate_rewards(self, contribution: float = 1.0) -> Dict[str, Any]:
        """
        根据贡献度计算奖励
        
        Args:
            contribution: 贡献度（0.0-1.0）
            
        Returns:
            奖励字典
        """
        base_materials = self.illustration_material_reward
        
        # 应用贡献度
        materials = int(base_materials * contribution)
        
        # 如果活动正在进行，应用加成
        if self.is_event_active():
            materials = int(materials * self.bonus_multiplier)
        
        return {
            "illustration_materials": materials,
            "bonus_active": self.is_event_active(),
            "bonus_multiplier": self.bonus_multiplier if self.is_event_active() else 1.0,
            "contribution": contribution
        }
    
    def get_event_status(self) -> Dict[str, Any]:
        """
        获取活动状态
        
        Returns:
            活动状态字典
        """
        if not self.is_event_active():
            return {
                "is_active": False,
                "time_until_next": None
            }
        
        time_remaining = self.event_end_time - datetime.now()
        
        return {
            "is_active": True,
            "start_time": self.event_start_time.isoformat() if self.event_start_time else None,
            "end_time": self.event_end_time.isoformat() if self.event_end_time else None,
            "time_remaining_seconds": int(time_remaining.total_seconds()) if time_remaining.total_seconds() > 0 else 0,
            "bonus_multiplier": self.bonus_multiplier
        }








