"""
数据库系统模块
实现PostgreSQL数据库连接、数据模型、数据操作等
"""

from .database import Database, get_database, init_database
from .models.player import PlayerModel
from .models.character import CharacterModel
from .models.dungeon_progress import DungeonProgressModel
from .models.material import MaterialModel
from .models.gold import GoldModel
from .models.inventory import InventoryItemModel
from .models.quest_progress import QuestProgressModel, QuestStatusEnum
from .models.achievement_progress import AchievementProgressModel
from .models.material_transaction import MaterialTransactionModel
from .models.shop_purchase import ShopPurchaseModel
from .models.gacha import GachaStateModel, GachaHistoryModel
from .models.multiplayer import (
    MultiplayerRewardSettlementModel,
    MultiplayerRoomChatModel,
    MultiplayerRoomInvitationModel,
    MultiplayerRoomMemberModel,
    MultiplayerRoomModel,
    TeamDungeonClearRecordModel,
)
from .models.world_boss import (
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
    'Database',
    'get_database',
    'init_database',
    'PlayerModel',
    'CharacterModel',
    'DungeonProgressModel',
    'MaterialModel',
    'GoldModel',
    'InventoryItemModel',
    'QuestProgressModel',
    'QuestStatusEnum',
    'AchievementProgressModel',
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
