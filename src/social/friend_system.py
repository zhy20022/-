"""
好友与助战系统
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional


@dataclass
class FriendProfile:
    """好友档案"""

    friend_id: str
    username: str
    last_active_at: datetime = field(default_factory=datetime.utcnow)
    support_attribute: Optional[str] = None
    assist_available: bool = True

    def to_dict(self) -> Dict[str, object]:
        return {
            "friend_id": self.friend_id,
            "username": self.username,
            "last_active_at": self.last_active_at.isoformat(),
            "support_attribute": self.support_attribute,
            "assist_available": self.assist_available,
        }


class AssistRewardPolicy:
    """助战奖励策略"""

    CURRENCY_NAME = "通用助战币"
    REWARD_PER_DROP = 1000

    @classmethod
    def build_reward_payload(cls, owner_name: str) -> Dict[str, object]:
        """构建助战奖励的掉落payload。"""
        return {
            "item_id": "assist_currency",
            "name": f"{owner_name}的助战奖励",
            "item_type": "currency",
            "quantity": cls.REWARD_PER_DROP,
            "rarity": "legendary",
            "quality": "S",
            "icon": "/assets/drops/assist_currency.png",
            "classifications": {
                "category": "assist",
                "label": cls.CURRENCY_NAME,
            },
            "stats": {},
            "description": "启用助战时获取的通用货币",
        }


class FriendSystem:
    """好友系统：无限好友、助战开关"""

    def __init__(self, player_id: str):
        self.player_id = player_id
        self._friends: Dict[str, FriendProfile] = {}
        self.assist_enabled: bool = False

    def add_friend(self, friend_id: str, username: str) -> FriendProfile:
        profile = FriendProfile(friend_id=friend_id, username=username)
        self._friends[friend_id] = profile
        return profile

    def remove_friend(self, friend_id: str) -> bool:
        return self._friends.pop(friend_id, None) is not None

    def get_friend(self, friend_id: str) -> Optional[FriendProfile]:
        return self._friends.get(friend_id)

    def list_friends(self) -> List[Dict[str, object]]:
        return [friend.to_dict() for friend in self._friends.values()]

    def friend_count(self) -> int:
        return len(self._friends)

    def set_assist_mode(self, enabled: bool) -> None:
        self.assist_enabled = enabled

    def is_assist_enabled(self) -> bool:
        return self.assist_enabled

    def touch_friend(self, friend_id: str) -> None:
        friend = self._friends.get(friend_id)
        if friend:
            friend.last_active_at = datetime.utcnow()


_friend_system_registry: Dict[str, FriendSystem] = {}


def get_friend_system(player_id: str) -> FriendSystem:
    """获取或创建玩家的好友系统"""
    if player_id not in _friend_system_registry:
        _friend_system_registry[player_id] = FriendSystem(player_id)
    return _friend_system_registry[player_id]
