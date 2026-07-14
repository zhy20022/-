"""Persistent world boss ranking, layer and reward models."""

from datetime import datetime
import uuid

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, JSON, String

from . import Base


class WorldBossDamageRecordModel(Base):
    """One submitted or battle-generated world boss score."""

    __tablename__ = "world_boss_damage_records"

    record_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    dungeon_id = Column(String(80), nullable=False, index=True)
    season_id = Column(String(30), nullable=False, index=True)
    player_id = Column(String(50), ForeignKey("players.player_id"), nullable=False, index=True)
    username = Column(String(80), nullable=False)
    battle_id = Column(String(50), nullable=True, index=True)
    damage = Column(Integer, default=0)
    duration = Column(Float, default=0.0)
    character_ids = Column(JSON, default=[])
    source = Column(String(30), default="battle")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    def to_dict(self) -> dict:
        return {
            "record_id": self.record_id,
            "dungeon_id": self.dungeon_id,
            "season_id": self.season_id,
            "player_id": self.player_id,
            "username": self.username,
            "battle_id": self.battle_id,
            "damage": self.damage,
            "duration": self.duration,
            "character_ids": self.character_ids or [],
            "source": self.source,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class WorldBossRankingModel(Base):
    """Per-player best and total world boss score in a season."""

    __tablename__ = "world_boss_rankings"

    ranking_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    dungeon_id = Column(String(80), nullable=False, index=True)
    season_id = Column(String(30), nullable=False, index=True)
    player_id = Column(String(50), ForeignKey("players.player_id"), nullable=False, index=True)
    username = Column(String(80), nullable=False)
    max_damage = Column(Integer, default=0)
    total_damage = Column(Integer, default=0)
    attempts = Column(Integer, default=0)
    best_battle_id = Column(String(50), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_world_boss_rank_player", "dungeon_id", "season_id", "player_id", unique=True),
        Index("idx_world_boss_rank_score", "dungeon_id", "season_id", "max_damage", "total_damage"),
    )

    def to_dict(self, rank: int | None = None) -> dict:
        payload = {
            "ranking_id": self.ranking_id,
            "dungeon_id": self.dungeon_id,
            "season_id": self.season_id,
            "player_id": self.player_id,
            "username": self.username,
            "max_damage": self.max_damage,
            "total_damage": self.total_damage,
            "attempts": self.attempts,
            "best_battle_id": self.best_battle_id,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if rank is not None:
            payload["rank"] = rank
        return payload


class WorldBossLayerProgressModel(Base):
    """Global layer progress for one world boss dungeon season."""

    __tablename__ = "world_boss_layer_progress"

    progress_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    dungeon_id = Column(String(80), nullable=False, index=True)
    season_id = Column(String(30), nullable=False, index=True)
    current_layer = Column(Integer, default=1)
    cleared_layers = Column(Integer, default=0)
    current_layer_damage = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_world_boss_layer_once", "dungeon_id", "season_id", unique=True),
    )

    def to_dict(self) -> dict:
        return {
            "progress_id": self.progress_id,
            "dungeon_id": self.dungeon_id,
            "season_id": self.season_id,
            "current_layer": self.current_layer,
            "cleared_layers": self.cleared_layers,
            "current_layer_damage": self.current_layer_damage,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class WorldBossSeasonModel(Base):
    """Global world boss season lifecycle row."""

    __tablename__ = "world_boss_seasons"

    season_uid = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    season_id = Column(String(30), nullable=False, index=True)
    status = Column(String(20), default="active", index=True)
    started_at = Column(DateTime, default=datetime.utcnow, index=True)
    ends_at = Column(DateTime, nullable=True, index=True)
    settled_at = Column(DateTime, nullable=True, index=True)
    summary_payload = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_world_boss_season_once", "season_id", unique=True),
    )

    def to_dict(self) -> dict:
        return {
            "season_uid": self.season_uid,
            "season_id": self.season_id,
            "status": self.status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "ends_at": self.ends_at.isoformat() if self.ends_at else None,
            "settled_at": self.settled_at.isoformat() if self.settled_at else None,
            "summary_payload": self.summary_payload or {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class WorldBossLayerHistoryModel(Base):
    """Append-only history row for every globally cleared world boss layer."""

    __tablename__ = "world_boss_layer_history"

    history_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    dungeon_id = Column(String(80), nullable=False, index=True)
    season_id = Column(String(30), nullable=False, index=True)
    layer = Column(Integer, nullable=False)
    tier = Column(Integer, nullable=False)
    cleared_by_player_id = Column(String(50), ForeignKey("players.player_id"), nullable=True, index=True)
    cleared_by_username = Column(String(80), nullable=True)
    trigger_damage = Column(Integer, default=0)
    chests_granted = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("idx_world_boss_layer_history_once", "dungeon_id", "season_id", "layer", unique=True),
    )

    def to_dict(self) -> dict:
        return {
            "history_id": self.history_id,
            "dungeon_id": self.dungeon_id,
            "season_id": self.season_id,
            "layer": self.layer,
            "tier": self.tier,
            "cleared_by_player_id": self.cleared_by_player_id,
            "cleared_by_username": self.cleared_by_username,
            "trigger_damage": self.trigger_damage,
            "chests_granted": self.chests_granted,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class WorldBossAnnouncementModel(Base):
    """Persistent world boss announcement shown on the world boss page."""

    __tablename__ = "world_boss_announcements"

    announcement_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    season_id = Column(String(30), nullable=True, index=True)
    dungeon_id = Column(String(80), nullable=True, index=True)
    announcement_type = Column(String(30), default="system", index=True)
    title = Column(String(120), nullable=False)
    message = Column(String(500), nullable=False)
    payload = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    def to_dict(self) -> dict:
        return {
            "announcement_id": self.announcement_id,
            "season_id": self.season_id,
            "dungeon_id": self.dungeon_id,
            "announcement_type": self.announcement_type,
            "title": self.title,
            "message": self.message,
            "payload": self.payload or {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class WorldBossChestModel(Base):
    """Per-player chest granted by each globally cleared world boss layer."""

    __tablename__ = "world_boss_chests"

    chest_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    dungeon_id = Column(String(80), nullable=False, index=True)
    season_id = Column(String(30), nullable=False, index=True)
    player_id = Column(String(50), ForeignKey("players.player_id"), nullable=False, index=True)
    username = Column(String(80), nullable=False)
    layer = Column(Integer, nullable=False)
    tier = Column(Integer, nullable=False)
    status = Column(String(20), default="unopened", index=True)
    reward_payload = Column(JSON, default=dict)
    opened_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("idx_world_boss_chest_once", "dungeon_id", "season_id", "player_id", "layer", unique=True),
        Index("idx_world_boss_chest_player", "dungeon_id", "season_id", "player_id", "status"),
    )

    def to_dict(self) -> dict:
        return {
            "chest_id": self.chest_id,
            "dungeon_id": self.dungeon_id,
            "season_id": self.season_id,
            "player_id": self.player_id,
            "username": self.username,
            "layer": self.layer,
            "tier": self.tier,
            "status": self.status,
            "reward_payload": self.reward_payload or {},
            "opened_at": self.opened_at.isoformat() if self.opened_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class WorldBossSettlementModel(Base):
    """World boss weekly reward payout record."""

    __tablename__ = "world_boss_settlements"

    settlement_id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    dungeon_id = Column(String(80), nullable=False, index=True)
    season_id = Column(String(30), nullable=False, index=True)
    player_id = Column(String(50), ForeignKey("players.player_id"), nullable=False, index=True)
    username = Column(String(80), nullable=False)
    rank = Column(Integer, nullable=False)
    max_damage = Column(Integer, default=0)
    total_damage = Column(Integer, default=0)
    reward_material_type = Column(String(50), nullable=False)
    reward_attribute_type = Column(String(50), nullable=True)
    reward_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("idx_world_boss_settlement_once", "dungeon_id", "season_id", "player_id", unique=True),
    )

    def to_dict(self) -> dict:
        return {
            "settlement_id": self.settlement_id,
            "dungeon_id": self.dungeon_id,
            "season_id": self.season_id,
            "player_id": self.player_id,
            "username": self.username,
            "rank": self.rank,
            "max_damage": self.max_damage,
            "total_damage": self.total_damage,
            "reward_material_type": self.reward_material_type,
            "reward_attribute_type": self.reward_attribute_type,
            "reward_count": self.reward_count,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
