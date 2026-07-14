"""
签到系统（参考天命之子）
实现每日签到、连续签到奖励、签到日历等功能
"""

from enum import Enum
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import uuid


class CheckInReward:
    """签到奖励"""
    
    def __init__(
        self,
        day: int,
        exp: int = 0,
        gold: int = 0,
        materials: Dict[str, int] = None,
        items: List[str] = None,
        is_special: bool = False
    ):
        """
        初始化签到奖励
        
        Args:
            day: 签到天数（1-7或1-30）
            exp: 经验值
            gold: 金币
            materials: 材料字典
            items: 物品ID列表
            is_special: 是否为特殊奖励（如第7天、第30天）
        """
        self.day = day
        self.exp = exp
        self.gold = gold
        self.materials = materials or {}
        self.items = items or []
        self.is_special = is_special
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "day": self.day,
            "exp": self.exp,
            "gold": self.gold,
            "materials": self.materials,
            "items": self.items,
            "is_special": self.is_special
        }


class CheckInStatus(Enum):
    """签到状态"""
    NOT_CHECKED = "未签到"      # 今日未签到
    CHECKED = "已签到"          # 今日已签到
    MISSED = "已错过"           # 已错过（连续签到中断）


class DailyCheckIn:
    """每日签到系统"""
    
    # 每周签到奖励配置（参考天命之子）
    WEEKLY_REWARDS = [
        CheckInReward(day=1, exp=50, gold=500),  # 第1天
        CheckInReward(day=2, exp=50, gold=500),  # 第2天
        CheckInReward(day=3, exp=100, gold=1000),  # 第3天
        CheckInReward(day=4, exp=100, gold=1000),  # 第4天
        CheckInReward(day=5, exp=150, gold=1500),  # 第5天
        CheckInReward(day=6, exp=150, gold=1500),  # 第6天
        CheckInReward(day=7, exp=300, gold=3000, materials={"equipment_set": 5}, is_special=True),  # 第7天（特殊奖励）
    ]
    
    # 每月签到奖励配置（可选）
    MONTHLY_REWARDS = [
        CheckInReward(day=i, exp=50 + i * 10, gold=500 + i * 50)
        for i in range(1, 31)
    ]
    # 第30天特殊奖励
    MONTHLY_REWARDS[29] = CheckInReward(
        day=30,
        exp=1000,
        gold=10000,
        materials={"equipment_set": 10, "exclusive_item": 5},
        is_special=True
    )
    
    def __init__(self, player_id: str):
        """
        初始化签到系统
        
        Args:
            player_id: 玩家ID
        """
        self.player_id = player_id
        self.last_checkin_date: Optional[datetime] = None
        self.consecutive_days: int = 0  # 连续签到天数
        self.total_checkins: int = 0  # 总签到次数
        self.current_week_day: int = 0  # 当前周的第几天（1-7）
        self.current_month_day: int = 0  # 当前月的第几天（1-30）
        self.checkin_history: List[Dict[str, Any]] = []  # 签到历史
    
    def check_in(self) -> Dict[str, Any]:
        """
        执行签到
        
        Returns:
            签到结果字典
        """
        now = datetime.now()
        today = now.date()
        
        # 检查今日是否已签到
        if self.last_checkin_date and self.last_checkin_date.date() == today:
            return {
                "success": False,
                "message": "今日已签到",
                "reward": None
            }
        
        # 检查是否连续签到
        if self.last_checkin_date:
            last_date = self.last_checkin_date.date()
            days_diff = (today - last_date).days
            
            if days_diff == 1:
                # 连续签到
                self.consecutive_days += 1
            elif days_diff > 1:
                # 中断连续签到
                self.consecutive_days = 1
                self.current_week_day = 1
                self.current_month_day = 1
        else:
            # 首次签到
            self.consecutive_days = 1
            self.current_week_day = 1
            self.current_month_day = 1
        
        # 更新签到日期
        self.last_checkin_date = now
        self.total_checkins += 1
        
        # 获取奖励
        reward = self._get_reward()
        
        # 更新周/月天数
        if self.consecutive_days <= 7:
            self.current_week_day = self.consecutive_days
        else:
            # 超过7天，循环到下一周
            self.current_week_day = ((self.consecutive_days - 1) % 7) + 1
        
        if self.consecutive_days <= 30:
            self.current_month_day = self.consecutive_days
        else:
            # 超过30天，循环到下一个月
            self.current_month_day = ((self.consecutive_days - 1) % 30) + 1
        
        # 记录签到历史
        self.checkin_history.append({
            "date": now.isoformat(),
            "consecutive_days": self.consecutive_days,
            "reward": reward.to_dict()
        })
        
        return {
            "success": True,
            "message": f"签到成功！连续签到{self.consecutive_days}天",
            "reward": reward.to_dict(),
            "consecutive_days": self.consecutive_days,
            "total_checkins": self.total_checkins
        }
    
    def _get_reward(self) -> CheckInReward:
        """获取签到奖励"""
        # 优先使用周奖励（前7天）
        if self.consecutive_days <= 7:
            return self.WEEKLY_REWARDS[self.current_week_day - 1]
        else:
            # 超过7天，使用月奖励（循环）
            day_index = (self.current_month_day - 1) % len(self.MONTHLY_REWARDS)
            return self.MONTHLY_REWARDS[day_index]
    
    def get_checkin_status(self) -> Dict[str, Any]:
        """
        获取签到状态
        
        Returns:
            签到状态字典
        """
        now = datetime.now()
        today = now.date()
        
        status = CheckInStatus.NOT_CHECKED
        can_check_in = False
        
        if self.last_checkin_date:
            last_date = self.last_checkin_date.date()
            days_diff = (today - last_date).days
            
            if days_diff == 0:
                status = CheckInStatus.CHECKED
                can_check_in = False
            elif days_diff == 1:
                status = CheckInStatus.NOT_CHECKED
                can_check_in = True
            else:
                status = CheckInStatus.MISSED
                can_check_in = True
        else:
            status = CheckInStatus.NOT_CHECKED
            can_check_in = True
        
        # 获取今日奖励预览
        next_reward = None
        if can_check_in:
            if self.last_checkin_date:
                last_date = self.last_checkin_date.date()
                days_diff = (today - last_date).days
                if days_diff == 1:
                    # 连续签到
                    next_consecutive = self.consecutive_days + 1
                else:
                    # 重新开始
                    next_consecutive = 1
            else:
                next_consecutive = 1
            
            # 计算下次奖励
            if next_consecutive <= 7:
                next_reward = self.WEEKLY_REWARDS[next_consecutive - 1]
            else:
                day_index = ((next_consecutive - 1) % 30)
                next_reward = self.MONTHLY_REWARDS[day_index]
        
        return {
            "status": status.value,
            "can_check_in": can_check_in,
            "last_checkin_date": self.last_checkin_date.isoformat() if self.last_checkin_date else None,
            "consecutive_days": self.consecutive_days,
            "total_checkins": self.total_checkins,
            "current_week_day": self.current_week_day,
            "current_month_day": self.current_month_day,
            "next_reward": next_reward.to_dict() if next_reward else None
        }
    
    def get_reward_calendar(self, calendar_type: str = "weekly") -> List[Dict[str, Any]]:
        """
        获取奖励日历
        
        Args:
            calendar_type: 日历类型（"weekly"或"monthly"）
            
        Returns:
            奖励日历列表
        """
        if calendar_type == "weekly":
            return [reward.to_dict() for reward in self.WEEKLY_REWARDS]
        else:
            return [reward.to_dict() for reward in self.MONTHLY_REWARDS]
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "player_id": self.player_id,
            "last_checkin_date": self.last_checkin_date.isoformat() if self.last_checkin_date else None,
            "consecutive_days": self.consecutive_days,
            "total_checkins": self.total_checkins,
            "current_week_day": self.current_week_day,
            "current_month_day": self.current_month_day,
            "checkin_history": self.checkin_history[-30:]  # 最近30条记录
        }







