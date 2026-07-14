"""
活动与商店系统
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable
import json
import uuid
import pytz

from ..attributes.attribute import AttributeType


@dataclass
class ActivityEvent:
    event_id: str
    name: str
    event_type: str
    attribute_focus: Optional[AttributeType]
    rewards: Dict[str, int]
    description: str

    def to_dict(self) -> Dict[str, object]:
        return {
            "event_id": self.event_id,
            "name": self.name,
            "event_type": self.event_type,
            "attribute_focus": self.attribute_focus.value if self.attribute_focus else None,
            "rewards": self.rewards,
            "description": self.description,
        }


@dataclass
class ShopItem:
    item_id: str
    name: str
    attribute_type: AttributeType
    cost: Dict[str, int]
    icon: str
    description: str

    def to_dict(self) -> Dict[str, object]:
        return {
            "item_id": self.item_id,
            "name": self.name,
            "attribute_type": self.attribute_type.value,
            "cost": self.cost,
            "icon": self.icon,
            "description": self.description,
        }


class EventRotationManager:
    """活动轮换管理"""

    def __init__(self):
        self.team_events = self._build_team_events()
        self.server_events = self._build_server_events()
        # 当前活动状态（用于检测是否切换）
        self._current_team_event_id: Optional[str] = None
        self._current_server_event_id: Optional[str] = None
        # 切换回调函数（用于通知前端等）
        self._rotation_callbacks: List[Callable[[str, str, str], None]] = []
        # 历史记录回调（用于保存到数据库）
        self._history_callback: Optional[Callable[[str, str, str, str, str], None]] = None
        # 进度清空回调（用于清空活动进度）
        self._progress_clear_callback: Optional[Callable[[str, str], bool]] = None

    def _build_team_events(self) -> List[ActivityEvent]:
        events = []
        for attr in AttributeType:
            events.append(
                ActivityEvent(
                    event_id=f"team_{attr.name.lower()}",
                    name=f"{attr.value}阵营挑战",
                    event_type="team_monthly",
                    attribute_focus=attr,
                    rewards={"material": 1, "equipment": 1},
                    description=f"20人团队每月轮换的{attr.value}属性副本",
                )
            )
        return events

    def _build_server_events(self) -> List[ActivityEvent]:
        quarters = [
            ("春樱庆典", AttributeType.WIND),
            ("夏火炬节", AttributeType.FIRE),
            ("秋之丰收", AttributeType.EARTH),
            ("冬至光华", AttributeType.LIGHT),
        ]
        events: List[ActivityEvent] = []
        for index, (name, attr) in enumerate(quarters):
            events.append(
                ActivityEvent(
                    event_id=f"server_q{index+1}",
                    name=name,
                    event_type="server_quarterly",
                    attribute_focus=attr,
                    rewards={"illustration_piece": 1, "equipment": 1},
                    description=f"全服季度轮换活动：聚焦{attr.value}属性",
                )
            )
        return events

    def _get_team_event_for_month(self, date: datetime) -> ActivityEvent:
        index = (date.year * 12 + date.month) % len(self.team_events)
        return self.team_events[index]

    def _get_server_event_for_quarter(self, date: datetime) -> ActivityEvent:
        """获取当前季度对应的活动
        
        季度划分：
        - Q1: 3-5月（切换时间：3月1日）
        - Q2: 6-8月（切换时间：6月1日）
        - Q3: 9-11月（切换时间：9月1日）
        - Q4: 12-2月（切换时间：12月1日）
        """
        month = date.month
        if month in [3, 4, 5]:
            quarter = 0  # Q1
        elif month in [6, 7, 8]:
            quarter = 1  # Q2
        elif month in [9, 10, 11]:
            quarter = 2  # Q3
        else:  # month in [12, 1, 2]
            quarter = 3  # Q4
        
        index = quarter % len(self.server_events)
        return self.server_events[index]

    def get_active_events(self, current_date: Optional[datetime] = None) -> Dict[str, Dict[str, object]]:
        date = current_date or datetime.utcnow()
        team_event = self._get_team_event_for_month(date)
        server_event = self._get_server_event_for_quarter(date)

        next_month = (date.replace(day=1) + timedelta(days=32)).replace(day=1)
        
        # 计算下次季度切换时间
        # Q1: 3-5月 → 下次切换：6月1日
        # Q2: 6-8月 → 下次切换：9月1日
        # Q3: 9-11月 → 下次切换：12月1日
        # Q4: 12-2月 → 下次切换：3月1日
        month = date.month
        if month in [3, 4, 5]:
            next_quarter_month = 6
            next_quarter_year = date.year
        elif month in [6, 7, 8]:
            next_quarter_month = 9
            next_quarter_year = date.year
        elif month in [9, 10, 11]:
            next_quarter_month = 12
            next_quarter_year = date.year
        else:  # month in [12, 1, 2]
            if month == 12:
                next_quarter_month = 3
                next_quarter_year = date.year + 1
            else:  # month in [1, 2]
                next_quarter_month = 3
                next_quarter_year = date.year
        
        next_quarter = datetime(next_quarter_year, next_quarter_month, 1)

        return {
            "team_monthly": {
                "event": team_event.to_dict(),
                "refresh_at": next_month.isoformat(),
            },
            "server_quarterly": {
                "event": server_event.to_dict(),
                "refresh_at": next_quarter.isoformat(),
            },
        }

    def set_rotation_callback(self, callback: Callable[[str, str, str], None]) -> None:
        """设置活动切换回调函数
        
        Args:
            callback: 回调函数，参数为 (event_type, old_event_id, new_event_id)
        """
        self._rotation_callbacks.append(callback)

    def set_history_callback(self, callback: Callable[[str, str, str, str, str], None]) -> None:
        """设置历史记录回调函数
        
        Args:
            callback: 回调函数，参数为 (history_id, event_type, old_event_id, new_event_id, reason)
        """
        self._history_callback = callback

    def set_progress_clear_callback(self, callback: Callable[[str, str], bool]) -> None:
        """设置进度清空回调函数
        
        Args:
            callback: 回调函数，参数为 (event_type, old_event_id)，返回是否成功
        """
        self._progress_clear_callback = callback

    def _get_beijing_time(self, utc_time: datetime) -> datetime:
        """将UTC时间转换为北京时间"""
        utc_tz = pytz.UTC
        beijing_tz = pytz.timezone('Asia/Shanghai')
        
        if utc_time.tzinfo is None:
            utc_time = utc_tz.localize(utc_time)
        
        beijing_time = utc_time.astimezone(beijing_tz)
        return beijing_time.replace(tzinfo=None)  # 返回naive datetime用于比较

    def check_and_rotate_events(self, current_date: Optional[datetime] = None, reason: str = "auto") -> Dict[str, bool]:
        """检查并轮换活动
        
        Args:
            current_date: 当前时间，默认为UTC时间
            reason: 切换原因，"auto" 或 "manual"
            
        Returns:
            返回切换结果，格式为 {"team_monthly": bool, "server_quarterly": bool}
        """
        date = current_date or datetime.utcnow()
        result = {"team_monthly": False, "server_quarterly": False}
        
        # 获取当前应该显示的活动
        current_team_event = self._get_team_event_for_month(date)
        current_server_event = self._get_server_event_for_quarter(date)
        
        # 检查团队活动是否需要切换
        if self._current_team_event_id is None:
            # 首次初始化
            self._current_team_event_id = current_team_event.event_id
        elif self._current_team_event_id != current_team_event.event_id:
            # 活动已切换
            old_event_id = self._current_team_event_id
            new_event_id = current_team_event.event_id
            
            # 清空活动进度
            if self._progress_clear_callback and old_event_id:
                self._progress_clear_callback("team_monthly", old_event_id)
            
            self._current_team_event_id = new_event_id
            
            # 记录历史
            if self._history_callback:
                history_id = str(uuid.uuid4())
                self._history_callback(
                    history_id,
                    "team_monthly",
                    old_event_id,
                    new_event_id,
                    reason
                )
            
            # 触发回调
            for callback in self._rotation_callbacks:
                callback("team_monthly", old_event_id, new_event_id)
            
            result["team_monthly"] = True
        
        # 检查全服活动是否需要切换
        if self._current_server_event_id is None:
            # 首次初始化
            self._current_server_event_id = current_server_event.event_id
        elif self._current_server_event_id != current_server_event.event_id:
            # 活动已切换
            old_event_id = self._current_server_event_id
            new_event_id = current_server_event.event_id
            
            # 清空活动进度
            if self._progress_clear_callback and old_event_id:
                self._progress_clear_callback("server_quarterly", old_event_id)
            
            self._current_server_event_id = new_event_id
            
            # 记录历史
            if self._history_callback:
                history_id = str(uuid.uuid4())
                self._history_callback(
                    history_id,
                    "server_quarterly",
                    old_event_id,
                    new_event_id,
                    reason
                )
            
            # 触发回调
            for callback in self._rotation_callbacks:
                callback("server_quarterly", old_event_id, new_event_id)
            
            result["server_quarterly"] = True
        
        return result

    def force_rotate_event(self, event_type: str, target_event_id: Optional[str] = None, reason: str = "manual") -> bool:
        """手动强制切换活动
        
        Args:
            event_type: 活动类型，"team_monthly" 或 "server_quarterly"
            target_event_id: 目标活动ID，如果为None则切换到下一个
            reason: 切换原因，默认为 "manual"
            
        Returns:
            是否切换成功
        """
        current_date = datetime.utcnow()
        
        if event_type == "team_monthly":
            old_event_id = self._current_team_event_id
            
            if target_event_id:
                # 切换到指定活动
                target_event = next((e for e in self.team_events if e.event_id == target_event_id), None)
                if not target_event:
                    return False
                self._current_team_event_id = target_event_id
            else:
                # 切换到下一个活动
                current_event = self._get_team_event_for_month(current_date)
                current_index = next((i for i, e in enumerate(self.team_events) if e.event_id == current_event.event_id), 0)
                next_index = (current_index + 1) % len(self.team_events)
                self._current_team_event_id = self.team_events[next_index].event_id
            
            # 清空活动进度
            if self._progress_clear_callback and old_event_id:
                self._progress_clear_callback("team_monthly", old_event_id)
            
            # 记录历史
            if self._history_callback:
                history_id = str(uuid.uuid4())
                self._history_callback(
                    history_id,
                    "team_monthly",
                    old_event_id,
                    self._current_team_event_id,
                    reason
                )
            
            # 触发回调
            for callback in self._rotation_callbacks:
                callback("team_monthly", old_event_id, self._current_team_event_id)
            
            return True
        
        elif event_type == "server_quarterly":
            old_event_id = self._current_server_event_id
            
            if target_event_id:
                # 切换到指定活动
                target_event = next((e for e in self.server_events if e.event_id == target_event_id), None)
                if not target_event:
                    return False
                self._current_server_event_id = target_event_id
            else:
                # 切换到下一个活动
                current_event = self._get_server_event_for_quarter(current_date)
                current_index = next((i for i, e in enumerate(self.server_events) if e.event_id == current_event.event_id), 0)
                next_index = (current_index + 1) % len(self.server_events)
                self._current_server_event_id = self.server_events[next_index].event_id
            
            # 清空活动进度
            if self._progress_clear_callback and old_event_id:
                self._progress_clear_callback("server_quarterly", old_event_id)
            
            # 记录历史
            if self._history_callback:
                history_id = str(uuid.uuid4())
                self._history_callback(
                    history_id,
                    "server_quarterly",
                    old_event_id,
                    self._current_server_event_id,
                    reason
                )
            
            # 触发回调
            for callback in self._rotation_callbacks:
                callback("server_quarterly", old_event_id, self._current_server_event_id)
            
            return True
        
        return False


class ShopInventory:
    """活动商店库存"""

    def __init__(self):
        self.items = self._build_items()

    def _build_items(self) -> List[ShopItem]:
        items: List[ShopItem] = []
        for attr in AttributeType:
            items.append(
                ShopItem(
                    item_id=f"equip_{attr.name.lower()}",
                    name=f"{attr.value}系装备箱",
                    attribute_type=attr,
                    cost={"equipment_material": 5},
                    icon=f"/assets/shop/{attr.name.lower()}_gear.png",
                    description=f"兑换获得{attr.value}属性套装部件",
                )
            )
            items.append(
                ShopItem(
                    item_id=f"material_{attr.name.lower()}",
                    name=f"{attr.value}属性材料包",
                    attribute_type=attr,
                    cost={"exclusive_material": 10},
                    icon=f"/assets/shop/{attr.name.lower()}_material.png",
                    description=f"包含{attr.value}属性的专属材料",
                )
            )
        return items

    def get_grouped_items(self) -> Dict[str, List[Dict[str, object]]]:
        grouped: Dict[str, List[Dict[str, object]]] = {}
        for item in self.items:
            key = item.attribute_type.value
            grouped.setdefault(key, []).append(item.to_dict())
        grouped = dict(sorted(grouped.items(), key=lambda kv: kv[0]))
        return grouped


event_rotation_manager = EventRotationManager()
shop_inventory = ShopInventory()
