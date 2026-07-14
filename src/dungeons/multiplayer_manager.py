"""
多人副本房间管理
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import threading
import time
import uuid

from ..database import get_database
from ..database.models.character import CharacterModel
from ..database.models.multiplayer import MultiplayerRoomMemberModel, MultiplayerRoomModel


ROOM_STATE_FILE = Path(__file__).resolve().parents[2] / "data" / "multiplayer_rooms.json"
RECONNECT_TIMEOUT_SECONDS = 180


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _datetime_to_iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _load_character_snapshots(character_ids: List[str]) -> Dict[str, Dict[str, object]]:
    """Load lightweight character details for room composition hints."""
    unique_ids = [str(char_id) for char_id in dict.fromkeys(character_ids) if char_id]
    if not unique_ids:
        return {}
    db = get_database()
    session = db.get_session()
    try:
        rows = session.query(CharacterModel).filter(
            CharacterModel.character_id.in_(unique_ids)
        ).all()
        return {
            row.character_id: {
                "character_id": row.character_id,
                "name": row.name,
                "level": row.level,
                "attribute_type": row.attribute_type,
                "profession_type": row.profession_type,
                "player_id": row.player_id,
            }
            for row in rows
        }
    except Exception:
        return {}
    finally:
        session.close()


@dataclass
class RoomMember:
    """房间成员信息"""

    player_id: str
    username: str
    character_ids: List[str] = field(default_factory=list)
    is_ready: bool = False
    connection_status: str = "online"
    disconnected_at: Optional[str] = None
    reconnect_deadline: Optional[str] = None
    reconnect_remaining_seconds: Optional[int] = None

    def to_dict(self) -> Dict[str, object]:
        reconnect_remaining_seconds = self.reconnect_remaining_seconds
        deadline = _parse_iso_datetime(self.reconnect_deadline)
        if deadline:
            reconnect_remaining_seconds = max(0, int((deadline - datetime.utcnow()).total_seconds()))
        return {
            "player_id": self.player_id,
            "username": self.username,
            "character_ids": self.character_ids,
            "is_ready": self.is_ready,
            "connection_status": self.connection_status,
            "disconnected_at": self.disconnected_at,
            "reconnect_deadline": self.reconnect_deadline,
            "reconnect_remaining_seconds": reconnect_remaining_seconds,
        }


@dataclass
class MultiplayerRoom:
    """多人副本房间"""

    room_id: str
    dungeon_id: str
    dungeon_type: str
    leader_id: str
    capacity: int
    max_characters_per_member: int
    members: Dict[str, RoomMember] = field(default_factory=dict)
    status: str = "waiting"  # waiting -> in_battle -> finished
    created_at: float = field(default_factory=lambda: time.time())
    updated_at: float = field(default_factory=lambda: time.time())
    battle_id: Optional[str] = None

    def is_full(self) -> bool:
        return len(self.members) >= self.capacity

    def all_ready(self) -> bool:
        return bool(self.members) and all(
            member.is_ready and member.character_ids for member in self.members.values()
        )

    def to_dict(self) -> Dict[str, object]:
        character_snapshots = _load_character_snapshots([
            character_id
            for member in self.members.values()
            for character_id in member.character_ids
        ])
        members = []
        for member in self.members.values():
            member_payload = member.to_dict()
            member_payload["selected_characters"] = [
                character_snapshots.get(character_id, {
                    "character_id": character_id,
                    "name": character_id,
                })
                for character_id in member.character_ids
            ]
            members.append(member_payload)
        return {
            "room_id": self.room_id,
            "dungeon_id": self.dungeon_id,
            "dungeon_type": self.dungeon_type,
            "leader_id": self.leader_id,
            "capacity": self.capacity,
            "max_characters_per_member": self.max_characters_per_member,
            "status": self.status,
            "battle_id": self.battle_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "members": members,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "MultiplayerRoom":
        room = cls(
            room_id=str(data.get("room_id") or uuid.uuid4()),
            dungeon_id=str(data.get("dungeon_id") or ""),
            dungeon_type=str(data.get("dungeon_type") or ""),
            leader_id=str(data.get("leader_id") or ""),
            capacity=int(data.get("capacity") or 1),
            max_characters_per_member=int(data.get("max_characters_per_member") or 1),
            status=str(data.get("status") or "waiting"),
            created_at=float(data.get("created_at") or time.time()),
            updated_at=float(data.get("updated_at") or time.time()),
            battle_id=data.get("battle_id") if data.get("battle_id") else None,
        )
        members = data.get("members", [])
        if isinstance(members, list):
            for member_data in members:
                if not isinstance(member_data, dict):
                    continue
                player_id = str(member_data.get("player_id") or "")
                if not player_id:
                    continue
                room.members[player_id] = RoomMember(
                    player_id=player_id,
                    username=str(member_data.get("username") or "未知玩家"),
                    character_ids=[str(char_id) for char_id in member_data.get("character_ids", [])],
                    is_ready=bool(member_data.get("is_ready", False)),
                    connection_status=str(member_data.get("connection_status") or "online"),
                    disconnected_at=member_data.get("disconnected_at"),
                    reconnect_deadline=member_data.get("reconnect_deadline"),
                    reconnect_remaining_seconds=member_data.get("reconnect_remaining_seconds"),
                )
        return room


class MultiplayerRoomManager:
    """房间管理器（内存版）"""

    def __init__(self):
        self._rooms: Dict[str, MultiplayerRoom] = {}
        self._lock = threading.Lock()
        self._load_from_disk()

    def _touch(self, room: MultiplayerRoom) -> MultiplayerRoom:
        room.updated_at = time.time()
        return room

    def _persist_locked(self):
        db = get_database()
        session = db.get_session()
        try:
            existing_room_ids = set()
            for room in self._rooms.values():
                existing_room_ids.add(room.room_id)
                model = session.query(MultiplayerRoomModel).filter(
                    MultiplayerRoomModel.room_id == room.room_id
                ).first()
                if not model:
                    model = MultiplayerRoomModel(room_id=room.room_id)
                    session.add(model)
                model.dungeon_id = room.dungeon_id
                model.dungeon_type = room.dungeon_type
                model.leader_id = room.leader_id
                model.capacity = room.capacity
                model.max_characters_per_member = room.max_characters_per_member
                model.status = room.status
                model.battle_id = room.battle_id
                model.created_at = datetime.fromtimestamp(room.created_at)
                model.updated_at = datetime.fromtimestamp(room.updated_at)

                existing_member_ids = set()
                for member in room.members.values():
                    existing_member_ids.add(member.player_id)
                    member_model = session.query(MultiplayerRoomMemberModel).filter(
                        MultiplayerRoomMemberModel.room_id == room.room_id,
                        MultiplayerRoomMemberModel.player_id == member.player_id
                    ).first()
                    if not member_model:
                        member_model = MultiplayerRoomMemberModel(
                            member_id=str(uuid.uuid4()),
                            room_id=room.room_id,
                            player_id=member.player_id
                        )
                        session.add(member_model)
                    member_model.username = member.username
                    member_model.character_ids = member.character_ids
                    member_model.is_ready = member.is_ready
                    member_model.connection_status = member.connection_status or "online"
                    member_model.disconnected_at = _parse_iso_datetime(member.disconnected_at)
                    member_model.reconnect_deadline = _parse_iso_datetime(member.reconnect_deadline)

                session.query(MultiplayerRoomMemberModel).filter(
                    MultiplayerRoomMemberModel.room_id == room.room_id,
                    ~MultiplayerRoomMemberModel.player_id.in_(existing_member_ids)
                ).delete(synchronize_session=False)

            session.query(MultiplayerRoomMemberModel).filter(
                ~MultiplayerRoomMemberModel.room_id.in_(existing_room_ids)
            ).delete(synchronize_session=False)
            session.query(MultiplayerRoomModel).filter(
                ~MultiplayerRoomModel.room_id.in_(existing_room_ids)
            ).delete(synchronize_session=False)
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def _load_from_disk(self):
        self._load_from_database()
        if self._rooms:
            return
        if not ROOM_STATE_FILE.exists():
            return
        try:
            with ROOM_STATE_FILE.open("r", encoding="utf-8") as room_file:
                payload = json.load(room_file)
            rooms = payload.get("rooms", []) if isinstance(payload, dict) else []
            for room_data in rooms:
                if not isinstance(room_data, dict):
                    continue
                room = MultiplayerRoom.from_dict(room_data)
                if room.room_id and room.members:
                    self._rooms[room.room_id] = room
        except (OSError, json.JSONDecodeError, ValueError, TypeError):
            self._rooms = {}
        if self._rooms:
            try:
                with self._lock:
                    self._persist_locked()
            except Exception:
                pass

    def _load_from_database(self):
        db = get_database()
        session = db.get_session()
        try:
            rooms = session.query(MultiplayerRoomModel).all()
            for room_model in rooms:
                room = MultiplayerRoom(
                    room_id=room_model.room_id,
                    dungeon_id=room_model.dungeon_id,
                    dungeon_type=room_model.dungeon_type,
                    leader_id=room_model.leader_id,
                    capacity=room_model.capacity or 1,
                    max_characters_per_member=room_model.max_characters_per_member or 1,
                    status=room_model.status or "waiting",
                    created_at=room_model.created_at.timestamp() if room_model.created_at else time.time(),
                    updated_at=room_model.updated_at.timestamp() if room_model.updated_at else time.time(),
                    battle_id=room_model.battle_id,
                )
                member_models = session.query(MultiplayerRoomMemberModel).filter(
                    MultiplayerRoomMemberModel.room_id == room.room_id
                ).all()
                for member_model in member_models:
                    member_payload = member_model.to_dict()
                    room.members[member_model.player_id] = RoomMember(
                        player_id=member_model.player_id,
                        username=member_model.username,
                        character_ids=list(member_model.character_ids or []),
                        is_ready=bool(member_model.is_ready),
                        connection_status=member_payload.get("connection_status", "online"),
                        disconnected_at=member_payload.get("disconnected_at"),
                        reconnect_deadline=member_payload.get("reconnect_deadline"),
                        reconnect_remaining_seconds=member_payload.get("reconnect_remaining_seconds"),
                    )
                if room.members:
                    self._rooms[room.room_id] = room
        finally:
            session.close()

    def create_room(
        self,
        dungeon_id: str,
        dungeon_type: str,
        leader_id: str,
        leader_name: str,
        capacity: int,
        max_characters_per_member: int,
    ) -> MultiplayerRoom:
        with self._lock:
            room_id = str(uuid.uuid4())
            room = MultiplayerRoom(
                room_id=room_id,
                dungeon_id=dungeon_id,
                dungeon_type=dungeon_type,
                leader_id=leader_id,
                capacity=capacity,
                max_characters_per_member=max_characters_per_member,
            )
            room.members[leader_id] = RoomMember(
                player_id=leader_id,
                username=leader_name,
                character_ids=[],
                is_ready=False,
            )
            self._rooms[room_id] = room
            self._persist_locked()
            return room

    def delete_room_if_empty(self, room_id: str):
        with self._lock:
            room = self._rooms.get(room_id)
            if room and not room.members:
                self._rooms.pop(room_id, None)
                self._persist_locked()

    def get_room(self, room_id: str) -> Optional[MultiplayerRoom]:
        return self._rooms.get(room_id)

    def list_rooms(self) -> List[MultiplayerRoom]:
        return list(self._rooms.values())

    def get_player_room(self, player_id: str) -> Optional[MultiplayerRoom]:
        return next((room for room in self._rooms.values() if player_id in room.members), None)

    def _choose_next_leader(self, room: MultiplayerRoom) -> Optional[str]:
        online_member = next(
            (
                member.player_id
                for member in room.members.values()
                if member.connection_status != "offline"
            ),
            None,
        )
        if online_member:
            return online_member
        return next(iter(room.members.keys()), None)

    def add_or_update_member(
        self,
        room_id: str,
        player_id: str,
        username: str,
        character_ids: List[str],
    ) -> MultiplayerRoom:
        with self._lock:
            room = self._rooms.get(room_id)
            if not room:
                raise ValueError("房间不存在")

            member = room.members.get(player_id)
            if member:
                member.character_ids = character_ids
                member.is_ready = False
            else:
                if room.is_full():
                    raise ValueError("房间已满")
                room.members[player_id] = RoomMember(
                    player_id=player_id,
                    username=username,
                    character_ids=character_ids,
                    is_ready=False,
                )
            self._touch(room)
            self._persist_locked()
            return room

    def remove_member(self, room_id: str, player_id: str):
        with self._lock:
            room = self._rooms.get(room_id)
            if not room:
                return
            room.members.pop(player_id, None)
            if not room.members:
                self._rooms.pop(room_id, None)
            else:
                if player_id == room.leader_id:
                    next_leader = self._choose_next_leader(room)
                    if next_leader:
                        room.leader_id = next_leader
                self._touch(room)
            self._persist_locked()

    def set_member_ready(
        self,
        room_id: str,
        player_id: str,
        is_ready: bool,
        character_ids: Optional[List[str]] = None,
    ) -> MultiplayerRoom:
        with self._lock:
            room = self._rooms.get(room_id)
            if not room:
                raise ValueError("房间不存在")
            member = room.members.get(player_id)
            if not member:
                raise ValueError("成员不存在")
            if character_ids is not None:
                member.character_ids = character_ids
            member.is_ready = is_ready
            self._touch(room)
            self._persist_locked()
            return room

    def cleanup_expired_disconnects(self) -> Dict[str, List[object]]:
        """Remove offline members after the reconnect window and transfer leader if needed."""
        with self._lock:
            updated_rooms: List[MultiplayerRoom] = []
            removed_room_ids: List[str] = []
            now = datetime.utcnow()

            for room_id, room in list(self._rooms.items()):
                if room.status != "waiting":
                    continue

                changed = False
                expired_player_ids: List[str] = []
                for player_id, member in list(room.members.items()):
                    if member.connection_status != "offline":
                        continue
                    deadline = _parse_iso_datetime(member.reconnect_deadline)
                    if deadline and deadline <= now:
                        expired_player_ids.append(player_id)
                    elif deadline:
                        member.reconnect_remaining_seconds = max(0, int((deadline - now).total_seconds()))

                for player_id in expired_player_ids:
                    room.members.pop(player_id, None)
                    changed = True

                if not changed:
                    continue

                if not room.members:
                    self._rooms.pop(room_id, None)
                    removed_room_ids.append(room_id)
                    continue

                if room.leader_id not in room.members:
                    next_leader = self._choose_next_leader(room)
                    if next_leader:
                        room.leader_id = next_leader

                self._touch(room)
                updated_rooms.append(room)

            if updated_rooms or removed_room_ids:
                self._persist_locked()

            return {
                "updated_rooms": updated_rooms,
                "removed_room_ids": removed_room_ids,
            }

    def transfer_leader(self, room_id: str, current_leader_id: str, target_player_id: str) -> MultiplayerRoom:
        with self._lock:
            room = self._rooms.get(room_id)
            if not room:
                raise ValueError("房间不存在")
            if room.leader_id != current_leader_id:
                raise ValueError("只有房主可以转移房主")
            if target_player_id not in room.members:
                raise ValueError("目标玩家不在房间内")
            room.leader_id = target_player_id
            self._touch(room)
            self._persist_locked()
            return room

    def set_member_connection(self, room_id: str, player_id: str, is_online: bool) -> MultiplayerRoom:
        with self._lock:
            room = self._rooms.get(room_id)
            if not room:
                raise ValueError("房间不存在")
            member = room.members.get(player_id)
            if not member:
                raise ValueError("成员不存在")
            if is_online:
                member.connection_status = "online"
                member.disconnected_at = None
                member.reconnect_deadline = None
                member.reconnect_remaining_seconds = None
            else:
                now = datetime.utcnow()
                deadline = now + timedelta(seconds=RECONNECT_TIMEOUT_SECONDS)
                member.connection_status = "offline"
                member.disconnected_at = _datetime_to_iso(now)
                member.reconnect_deadline = _datetime_to_iso(deadline)
                member.reconnect_remaining_seconds = RECONNECT_TIMEOUT_SECONDS
                member.is_ready = False
            self._touch(room)
            self._persist_locked()
            return room

    def mark_in_battle(self, room_id: str, battle_id: str):
        with self._lock:
            room = self._rooms.get(room_id)
            if not room:
                raise ValueError("房间不存在")
            room.status = "in_battle"
            room.battle_id = battle_id
            self._touch(room)
            self._persist_locked()
            return room

    def mark_finished(self, room_id: str):
        with self._lock:
            room = self._rooms.get(room_id)
            if not room:
                return
            room.status = "finished"
            self._touch(room)
            self._persist_locked()
            return room

    def close_room(self, room_id: str) -> Optional[MultiplayerRoom]:
        """Remove a room from active recovery/listing after battle completion."""
        with self._lock:
            room = self._rooms.pop(room_id, None)
            if room:
                room.status = "finished"
                self._persist_locked()
            return room


_ROOM_MANAGER = MultiplayerRoomManager()


def get_room_manager() -> MultiplayerRoomManager:
    """获取多人房间管理器"""
    return _ROOM_MANAGER

