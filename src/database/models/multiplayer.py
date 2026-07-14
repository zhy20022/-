"""
Multiplayer room persistence models.
"""

from datetime import datetime
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, JSON, String, Text

from . import Base


class MultiplayerRoomModel(Base):
    """Persistent multiplayer room snapshot."""

    __tablename__ = "multiplayer_rooms"

    room_id = Column(String(50), primary_key=True)
    dungeon_id = Column(String(80), nullable=False, index=True)
    dungeon_type = Column(String(50), nullable=False)
    leader_id = Column(String(50), ForeignKey("players.player_id"), nullable=False, index=True)
    capacity = Column(Integer, default=1)
    max_characters_per_member = Column(Integer, default=1)
    status = Column(String(30), default="waiting", index=True)
    battle_id = Column(String(50), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "room_id": self.room_id,
            "dungeon_id": self.dungeon_id,
            "dungeon_type": self.dungeon_type,
            "leader_id": self.leader_id,
            "capacity": self.capacity,
            "max_characters_per_member": self.max_characters_per_member,
            "status": self.status,
            "battle_id": self.battle_id,
            "created_at": self.created_at.timestamp() if self.created_at else None,
            "updated_at": self.updated_at.timestamp() if self.updated_at else None,
        }


class MultiplayerRoomMemberModel(Base):
    """Persistent multiplayer room member state."""

    __tablename__ = "multiplayer_room_members"

    member_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(50), ForeignKey("multiplayer_rooms.room_id"), nullable=False, index=True)
    player_id = Column(String(50), ForeignKey("players.player_id"), nullable=False, index=True)
    username = Column(String(80), nullable=False)
    character_ids = Column(JSON, default=[])
    is_ready = Column(Boolean, default=False)
    connection_status = Column(String(20), default="online")
    disconnected_at = Column(DateTime, nullable=True)
    reconnect_deadline = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_multiplayer_member_room_player", "room_id", "player_id", unique=True),
    )

    def to_dict(self) -> dict:
        now = datetime.utcnow()
        remaining = None
        if self.reconnect_deadline:
            remaining = max(0, int((self.reconnect_deadline - now).total_seconds()))
        return {
            "player_id": self.player_id,
            "username": self.username,
            "character_ids": self.character_ids or [],
            "is_ready": self.is_ready,
            "connection_status": self.connection_status or "online",
            "disconnected_at": self.disconnected_at.isoformat() if self.disconnected_at else None,
            "reconnect_deadline": self.reconnect_deadline.isoformat() if self.reconnect_deadline else None,
            "reconnect_remaining_seconds": remaining,
        }


class MultiplayerRoomChatModel(Base):
    """Room chat message."""

    __tablename__ = "multiplayer_room_chats"

    message_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(50), ForeignKey("multiplayer_rooms.room_id"), nullable=False, index=True)
    player_id = Column(String(50), ForeignKey("players.player_id"), nullable=False, index=True)
    username = Column(String(80), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    def to_dict(self) -> dict:
        return {
            "message_id": self.message_id,
            "room_id": self.room_id,
            "player_id": self.player_id,
            "username": self.username,
            "message": self.message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class MultiplayerRoomInvitationModel(Base):
    """Room invitation."""

    __tablename__ = "multiplayer_room_invitations"

    invitation_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(50), ForeignKey("multiplayer_rooms.room_id"), nullable=False, index=True)
    inviter_id = Column(String(50), ForeignKey("players.player_id"), nullable=False, index=True)
    invitee_id = Column(String(50), ForeignKey("players.player_id"), nullable=False, index=True)
    invitee_username = Column(String(80), nullable=False)
    status = Column(String(20), default="pending", index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "invitation_id": self.invitation_id,
            "room_id": self.room_id,
            "inviter_id": self.inviter_id,
            "invitee_id": self.invitee_id,
            "invitee_username": self.invitee_username,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class MultiplayerRewardSettlementModel(Base):
    """Per-player multiplayer settlement record."""

    __tablename__ = "multiplayer_reward_settlements"

    settlement_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    battle_id = Column(String(50), nullable=False, index=True)
    room_id = Column(String(50), nullable=True, index=True)
    dungeon_id = Column(String(80), nullable=False, index=True)
    player_id = Column(String(50), ForeignKey("players.player_id"), nullable=False, index=True)
    success = Column(Boolean, default=False)
    materials_awarded = Column(JSON, default=[])
    character_updates = Column(JSON, default={})
    drop_summary = Column(JSON, default={})
    progress_summary = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("idx_multiplayer_settlement_battle_player", "battle_id", "player_id", unique=True),
    )

    def to_dict(self) -> dict:
        return {
            "settlement_id": self.settlement_id,
            "battle_id": self.battle_id,
            "room_id": self.room_id,
            "dungeon_id": self.dungeon_id,
            "player_id": self.player_id,
            "success": self.success,
            "materials_awarded": self.materials_awarded or [],
            "character_updates": self.character_updates or {},
            "drop_summary": self.drop_summary or {},
            "progress_summary": self.progress_summary or {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class TeamDungeonClearRecordModel(Base):
    """Team dungeon performance and clear history."""

    __tablename__ = "team_dungeon_clear_records"

    record_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    battle_id = Column(String(50), nullable=False, index=True)
    room_id = Column(String(50), nullable=True, index=True)
    dungeon_id = Column(String(80), nullable=False, index=True)
    success = Column(Boolean, default=False, index=True)
    duration = Column(Integer, default=0)
    phase_reached = Column(Integer, default=0)
    phase_count = Column(Integer, default=0)
    pressure_peak = Column(Integer, default=0)
    pressure_average = Column(Integer, default=0)
    role_score = Column(Integer, default=0)
    performance_score = Column(Integer, default=0)
    reward_tier = Column(String(10), default="C")
    participants = Column(JSON, default=[])
    performance_payload = Column(JSON, default={})
    rewards = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("idx_team_clear_dungeon_success", "dungeon_id", "success", "created_at"),
    )

    def to_dict(self) -> dict:
        return {
            "record_id": self.record_id,
            "battle_id": self.battle_id,
            "room_id": self.room_id,
            "dungeon_id": self.dungeon_id,
            "success": self.success,
            "duration": self.duration,
            "phase_reached": self.phase_reached,
            "phase_count": self.phase_count,
            "pressure_peak": self.pressure_peak,
            "pressure_average": self.pressure_average,
            "role_score": self.role_score,
            "performance_score": self.performance_score,
            "reward_tier": self.reward_tier,
            "participants": self.participants or [],
            "performance_payload": self.performance_payload or {},
            "rewards": self.rewards or {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
