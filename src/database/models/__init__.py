"""
数据模型模块
定义所有数据库表结构
"""

from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

from .player import PlayerModel
from .character import CharacterModel
from .dungeon_progress import DungeonProgressModel
from .material import MaterialModel
from .gold import GoldModel
from .inventory import InventoryItemModel
from .quest_progress import QuestProgressModel, QuestStatusEnum
from .achievement_progress import AchievementProgressModel
from .event_rotation_history import EventRotationHistoryModel, RotationReasonEnum
from .player_statistics import PlayerStatisticsModel
from .monster_kill import MonsterKillModel
from .battle_soul import BattleSoulModel
from .material_transaction import MaterialTransactionModel
from .shop_purchase import ShopPurchaseModel
from .gacha import GachaStateModel, GachaHistoryModel
from .multiplayer import (
    MultiplayerRewardSettlementModel,
    MultiplayerRoomChatModel,
    MultiplayerRoomInvitationModel,
    MultiplayerRoomMemberModel,
    MultiplayerRoomModel,
    TeamDungeonClearRecordModel,
)
from .world_boss import (
    WorldBossAnnouncementModel,
    WorldBossChestModel,
    WorldBossDamageRecordModel,
    WorldBossLayerHistoryModel,
    WorldBossLayerProgressModel,
    WorldBossRankingModel,
    WorldBossSeasonModel,
    WorldBossSettlementModel,
)

__all__ = [
    'Base',
    'PlayerModel',
    'CharacterModel',
    'DungeonProgressModel',
    'MaterialModel',
    'GoldModel',
    'InventoryItemModel',
    'QuestProgressModel',
    'QuestStatusEnum',
    'AchievementProgressModel',
    'EventRotationHistoryModel',
    'RotationReasonEnum',
    'PlayerStatisticsModel',
    'MonsterKillModel',
    'BattleSoulModel',
    'MaterialTransactionModel',
    'ShopPurchaseModel',
    'GachaStateModel',
    'GachaHistoryModel',
    'MultiplayerRoomModel',
    'MultiplayerRoomMemberModel',
    'MultiplayerRoomChatModel',
    'MultiplayerRoomInvitationModel',
    'MultiplayerRewardSettlementModel',
    'TeamDungeonClearRecordModel',
    'WorldBossAnnouncementModel',
    'WorldBossChestModel',
    'WorldBossDamageRecordModel',
    'WorldBossLayerHistoryModel',
    'WorldBossLayerProgressModel',
    'WorldBossRankingModel',
    'WorldBossSeasonModel',
    'WorldBossSettlementModel'
]
