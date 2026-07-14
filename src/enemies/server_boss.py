"""
全服Boss系统
实现全服伤害统计、每周结算等
"""

from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from enum import Enum
from .boss import Boss
from ..dungeons.dungeon import Dungeon
from ..attributes.attribute import AttributeType


class DamageRecord:
    """伤害记录"""
    
    def __init__(
        self,
        player_id: str,
        character_id: str,
        damage: float,
        timestamp: datetime = None
    ):
        """
        初始化伤害记录
        
        Args:
            player_id: 玩家ID
            character_id: 角色ID
            damage: 伤害值
            timestamp: 时间戳
        """
        self.player_id = player_id
        self.character_id = character_id
        self.damage = damage
        self.timestamp = timestamp or datetime.now()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "player_id": self.player_id,
            "character_id": self.character_id,
            "damage": self.damage,
            "timestamp": self.timestamp.isoformat()
        }


class ServerBoss:
    """全服Boss"""
    
    def __init__(
        self,
        dungeon: Dungeon,
        boss: Boss,
        max_hp: float = float('inf')  # 无限血量
    ):
        """
        初始化全服Boss
        
        Args:
            dungeon: 副本
            boss: Boss对象
            max_hp: 最大血量（无限血量）
        """
        self.dungeon = dungeon
        self.boss = boss
        self.max_hp = max_hp  # 无限血量，只统计伤害
        self.current_hp = max_hp
        
        # 伤害统计（累计统计）
        self.damage_records: Dict[str, List[DamageRecord]] = {}  # {player_id: [DamageRecord]}
        self.player_max_damage: Dict[str, float] = {}  # {player_id: max_damage}
        
        # 伤害排名（前100名）
        self.damage_ranking: List[Dict[str, Any]] = []
    
    def record_damage(self, player_id: str, character_id: str, damage: float):
        """
        记录伤害（累计统计）
        
        Args:
            player_id: 玩家ID
            character_id: 角色ID
            damage: 伤害值
        """
        # 创建伤害记录
        record = DamageRecord(player_id, character_id, damage)
        
        # 添加到记录列表
        if player_id not in self.damage_records:
            self.damage_records[player_id] = []
        self.damage_records[player_id].append(record)
        
        # 更新最大伤害
        if player_id not in self.player_max_damage:
            self.player_max_damage[player_id] = 0.0
        
        # 记录本周最高一次伤害
        if damage > self.player_max_damage[player_id]:
            self.player_max_damage[player_id] = damage
        
        # 更新排名
        self._update_ranking()
    
    def _update_ranking(self):
        """更新伤害排名（前100名）"""
        # 按最大伤害排序
        sorted_players = sorted(
            self.player_max_damage.items(),
            key=lambda x: x[1],
            reverse=True
        )
        
        # 取前100名
        self.damage_ranking = [
            {
                "player_id": player_id,
                "max_damage": damage,
                "rank": i + 1
            }
            for i, (player_id, damage) in enumerate(sorted_players[:100])
        ]
    
    def get_player_rank(self, player_id: str) -> Optional[int]:
        """获取玩家排名"""
        for rank_info in self.damage_ranking:
            if rank_info["player_id"] == player_id:
                return rank_info["rank"]
        return None
    
    def get_player_max_damage(self, player_id: str) -> float:
        """获取玩家最大伤害"""
        return self.player_max_damage.get(player_id, 0.0)
    
    def get_ranking(self, limit: int = 100) -> List[Dict[str, Any]]:
        """获取伤害排名"""
        return self.damage_ranking[:limit]
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "dungeon_id": self.dungeon.dungeon_id,
            "boss": self.boss.to_dict(),
            "total_players": len(self.player_max_damage),
            "total_damage": sum(self.player_max_damage.values()),
            "ranking": self.damage_ranking[:10]  # 只返回前10名
        }


class ServerBossManager:
    """全服Boss管理器"""
    
    def __init__(self):
        """初始化全服Boss管理器"""
        self.server_bosses: Dict[str, ServerBoss] = {}  # {dungeon_id: ServerBoss}
        
        # 结算配置
        self.settlement_count = 14  # 每周14次结算
        self.settlement_interval_hours = 12  # 每12小时结算一次
        self.last_settlement_time: Dict[str, datetime] = {}  # {dungeon_id: last_settlement_time}
        self.settlement_count_this_week: Dict[str, int] = {}  # {dungeon_id: count}
        
        # 奖励配置
        self.reward_type = "illustration_piece"  # 立绘拼图碎片
        self.reward_same_for_all = True  # 所有人相同奖励
    
    def create_server_boss(self, dungeon: Dungeon, boss: Boss) -> ServerBoss:
        """
        创建全服Boss
        
        Args:
            dungeon: 副本
            boss: Boss对象
            
        Returns:
            全服Boss对象
        """
        server_boss = ServerBoss(dungeon, boss, max_hp=float('inf'))
        self.server_bosses[dungeon.dungeon_id] = server_boss
        return server_boss
    
    def get_server_boss(self, dungeon_id: str) -> Optional[ServerBoss]:
        """获取全服Boss"""
        return self.server_bosses.get(dungeon_id)
    
    def record_damage(self, dungeon_id: str, player_id: str, character_id: str, damage: float):
        """
        记录伤害
        
        Args:
            dungeon_id: 副本ID
            player_id: 玩家ID
            character_id: 角色ID
            damage: 伤害值
        """
        server_boss = self.get_server_boss(dungeon_id)
        if server_boss:
            server_boss.record_damage(player_id, character_id, damage)
    
    def can_settle(self, dungeon_id: str) -> bool:
        """
        检查是否可以结算
        
        Args:
            dungeon_id: 副本ID
            
        Returns:
            如果可以结算返回True
        """
        # 检查本周结算次数
        count_this_week = self.settlement_count_this_week.get(dungeon_id, 0)
        if count_this_week >= self.settlement_count:
            return False
        
        # 检查结算间隔
        last_settlement = self.last_settlement_time.get(dungeon_id)
        if last_settlement:
            time_since_last = datetime.now() - last_settlement
            if time_since_last < timedelta(hours=self.settlement_interval_hours):
                return False
        
        return True
    
    def settle(self, dungeon_id: str) -> Dict[str, Any]:
        """
        结算（按照本周最高一次伤害统一进行结算）
        
        Args:
            dungeon_id: 副本ID
            
        Returns:
            结算结果
        """
        server_boss = self.get_server_boss(dungeon_id)
        if not server_boss:
            return {}
        
        if not self.can_settle(dungeon_id):
            return {}
        
        # 获取所有玩家的最大伤害
        player_max_damages = server_boss.player_max_damage
        
        # 计算奖励（所有人相同奖励）
        reward_count = 1  # 暂时固定为1个立绘拼图碎片
        
        # 创建结算结果
        settlement_result = {
            "dungeon_id": dungeon_id,
            "settlement_time": datetime.now().isoformat(),
            "total_players": len(player_max_damages),
            "rewards": {
                "type": self.reward_type,
                "count": reward_count,
                "same_for_all": self.reward_same_for_all
            },
            "ranking": server_boss.get_ranking(100)  # 前100名排名
        }
        
        # 更新结算时间
        self.last_settlement_time[dungeon_id] = datetime.now()
        self.settlement_count_this_week[dungeon_id] = self.settlement_count_this_week.get(dungeon_id, 0) + 1
        
        # 重置伤害记录（结算后重置，下次结算使用新的最高伤害）
        # 注意：这里不重置，因为要记录本周最高一次伤害
        
        return settlement_result
    
    def reset_weekly_settlement(self, dungeon_id: str):
        """重置每周结算（每周一0:00调用）"""
        self.settlement_count_this_week[dungeon_id] = 0
        # 注意：不重置伤害记录，因为要记录本周最高一次伤害
    
    def get_settlement_status(self, dungeon_id: str) -> Dict[str, Any]:
        """获取结算状态"""
        return {
            "dungeon_id": dungeon_id,
            "settlement_count_this_week": self.settlement_count_this_week.get(dungeon_id, 0),
            "max_settlement_count": self.settlement_count,
            "last_settlement_time": self.last_settlement_time.get(dungeon_id).isoformat() if self.last_settlement_time.get(dungeon_id) else None,
            "can_settle": self.can_settle(dungeon_id)
        }


# 全局全服Boss管理器实例
_server_boss_manager = None


def get_server_boss_manager() -> ServerBossManager:
    """获取全服Boss管理器实例（单例模式）"""
    global _server_boss_manager
    if _server_boss_manager is None:
        _server_boss_manager = ServerBossManager()
    return _server_boss_manager





