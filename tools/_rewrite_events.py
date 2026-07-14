from pathlib import Path

content = '''"""
活动与商店系统
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional

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
        quarter = (date.month - 1) // 3
        index = quarter % len(self.server_events)
        return self.server_events[index]

    def get_active_events(self, current_date: Optional[datetime] = None) -> Dict[str, Dict[str, object]]:
        date = current_date or datetime.utcnow()
        team_event = self._get_team_event_for_month(date)
        server_event = self._get_server_event_for_quarter(date)

        next_month = (date.replace(day=1) + timedelta(days=32)).replace(day=1)
        next_quarter_month = (((date.month - 1) // 3) * 3 + 4)
        next_quarter_year = date.year + (1 if next_quarter_month > 12 else 0)
        next_quarter_month = ((next_quarter_month - 1) % 12) + 1
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


def main():
    Path('src/events/event_system.py').write_text(content, encoding='utf-8')


if __name__ == '__main__':
    main()







