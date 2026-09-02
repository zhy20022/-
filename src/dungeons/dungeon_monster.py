"""
副本怪物配置系统
配置副本中的怪物生成、出现顺序、Boss等
"""

from enum import Enum
from typing import List, Dict, Any, Optional
from .dungeon import Dungeon, DungeonType
from ..attributes.attribute import AttributeType
import random


class MonsterType(Enum):
    """怪物类型"""
    SINGLE = "单体小怪"      # 单个小怪
    GROUP_3 = "群体小怪3个"  # 3个小怪一组
    GROUP_5 = "群体小怪5个"  # 5个小怪一组


class BossType(Enum):
    """Boss类型"""
    SINGLE = "单体boss"          # 一个boss分3个阶段
    TWIN_SEPARATE = "双子boss分离"  # 两个boss不共血量，附加2个阶段
    TWIN_SHARED = "双子boss共血"    # 两个boss共血量，附加2个阶段
    COUNCIL_SEQUENTIAL = "议会boss顺序"  # 3个boss一个接一个的逐个激活模式
    COUNCIL_SHARED = "议会boss共血"      # 3个boss为共血量不同技能


class MonsterSpawner:
    """怪物生成器"""
    
    def __init__(self, dungeon: Dungeon):
        """
        初始化怪物生成器
        
        Args:
            dungeon: 副本
        """
        self.dungeon = dungeon
        
        # 根据属性克制关系，副本里的怪物属性一定是被该属性的角色克制的
        # 例如：火副本里的怪物和boss一定是木属性的
        self.monster_attribute = self._get_counter_attribute(dungeon.attribute_type)
        
        # 怪物生成配置
        self.spawn_times: List[float] = []
        self.boss_spawn_times: List[float] = []
        self._configure_spawn_times()
    
    def _get_counter_attribute(self, attribute_type: AttributeType) -> AttributeType:
        """
        获取被克制的属性（怪物属性）
        
        根据相克关系：
        风克火 -> 火副本的怪物是木属性
        火克木 -> 木副本的怪物是风属性
        木克风 -> 风副本的怪物是火属性
        雷克水 -> 水副本的怪物是土属性
        水克土 -> 土副本的怪物是雷属性
        土克雷 -> 雷副本的怪物是水属性
        光暗互克 -> 光副本的怪物是暗属性，暗副本的怪物是光属性
        """
        counter_map = {
            AttributeType.FIRE: AttributeType.WOOD,      # 火克木，所以火副本的怪物是木
            AttributeType.WOOD: AttributeType.WIND,      # 木克风，所以木副本的怪物是风
            AttributeType.WIND: AttributeType.FIRE,      # 风克火，所以风副本的怪物是火
            AttributeType.THUNDER: AttributeType.WATER,  # 雷克水，所以雷副本的怪物是水
            AttributeType.WATER: AttributeType.EARTH,    # 水克土，所以水副本的怪物是土
            AttributeType.EARTH: AttributeType.THUNDER,  # 土克雷，所以土副本的怪物是雷
            AttributeType.LIGHT: AttributeType.DARK,     # 光暗互克
            AttributeType.DARK: AttributeType.LIGHT      # 光暗互克
        }
        return counter_map.get(attribute_type, AttributeType.FIRE)
    
    def _configure_spawn_times(self):
        """配置怪物生成时间"""
        if self.dungeon.dungeon_type == DungeonType.SINGLE:
            # 1人本：从第0s开始每3s随机刷新一波小怪，共持续20波
            interval = float(self.dungeon.monster_config.get("spawn_interval", 3.0))
            wave_count = int(self.dungeon.monster_config.get("spawn_wave_count", 20))
            start_time = float(self.dungeon.monster_config.get("spawn_start_time", 0.0))
            self.spawn_times = [start_time + i * interval for i in range(wave_count)]
            self.boss_spawn_times = []
        
        elif self.dungeon.dungeon_type == DungeonType.SQUAD:
            # 5人本：第1分钟从第0s开始每1s随机刷新一波小怪，共持续60波
            self.spawn_times = [i * 1.0 for i in range(60)]  # 0, 1, 2, ..., 59秒
            # 2:00, 2:15, 2:30, 2:45出一个随机boss
            self.boss_spawn_times = [120.0, 135.0, 150.0, 165.0]
        
        elif self.dungeon.dungeon_type == DungeonType.TEAM:
            # 20人本：第1分钟从第0s开始每1s随机刷新一波小怪，共持续60波
            self.spawn_times = [i * 1.0 for i in range(60)]  # 0, 1, 2, ..., 59秒
            # 2:00, 2:15, 2:30, 2:45出一个随机boss，3:15再出两个随机boss
            self.boss_spawn_times = [120.0, 135.0, 150.0, 165.0, 195.0, 195.0]  # 3:15 = 195秒
        
        elif self.dungeon.dungeon_type == DungeonType.SERVER_BOSS:
            # 世界boss本：持续3分钟的boss战
            self.spawn_times = []
            self.boss_spawn_times = [0.0]  # 开始就出现boss
    
    def get_monster_spawns(self, current_time: float, last_check_time: float = 0.0) -> List[Dict[str, Any]]:
        """
        获取当前时间应该生成的怪物
        
        Args:
            current_time: 当前时间（秒）
            last_check_time: 上次检查时间（秒）
            
        Returns:
            怪物生成列表
        """
        spawns = []
        
        # 检查小怪生成（只生成在last_check_time和current_time之间的）
        for spawn_time in self.spawn_times:
            if last_check_time < spawn_time <= current_time:
                monster_type = self._get_random_monster_type()
                spawns.append({
                    "type": "monster",
                    "monster_type": monster_type.value,  # 转换为字符串
                    "attribute": self.monster_attribute,
                    "spawn_time": spawn_time
                })
        
        # 检查Boss生成
        for boss_time in self.boss_spawn_times:
            if last_check_time < boss_time <= current_time:
                boss_type = self._get_random_boss_type()
                spawns.append({
                    "type": "boss",
                    "boss_type": boss_type,
                    "attribute": self.monster_attribute,
                    "spawn_time": boss_time
                })
        
        return spawns
    
    def _get_random_monster_type(self) -> MonsterType:
        """随机获取怪物类型"""
        allowed = (self.dungeon.monster_config or {}).get("allowed_monster_types")
        if allowed:
            candidates = []
            for value in allowed:
                if isinstance(value, MonsterType):
                    candidates.append(value)
                elif str(value) in MonsterType.__members__:
                    candidates.append(MonsterType[str(value)])
            if candidates:
                return random.choice(candidates)
        # 随机选择：单体小怪、3个小怪一组、5个小怪一组
        return random.choice([
            MonsterType.SINGLE,
            MonsterType.GROUP_3,
            MonsterType.GROUP_5
        ])
    
    def _get_random_boss_type(self) -> str:
        """随机获取Boss类型（返回字符串，便于后续扩展）"""
        configured_boss = (self.dungeon.monster_config or {}).get("boss_config") or {}
        if configured_boss.get("boss_type"):
            return configured_boss["boss_type"]

        if self.dungeon.dungeon_type == DungeonType.SQUAD:
            # 5人本：随机boss（单体、双子、议会）
            boss_types = [
                "SINGLE",
                "TWIN_SEPARATE",
                "TWIN_SHARED",
                "COUNCIL_SEQUENTIAL",
                "COUNCIL_SHARED"
            ]
            return random.choice(boss_types)
        elif self.dungeon.dungeon_type == DungeonType.TEAM:
            # 20人本：随机boss（单体、双子、议会）
            boss_types = [
                "SINGLE",
                "TWIN_SEPARATE",
                "TWIN_SHARED",
                "COUNCIL_SEQUENTIAL",
                "COUNCIL_SHARED"
            ]
            return random.choice(boss_types)
        elif self.dungeon.dungeon_type == DungeonType.SERVER_BOSS:
            # 世界boss本：特殊机制boss
            return "SINGLE"  # 暂时使用单体boss，后续扩展
        
        return "SINGLE"
    
    def get_total_monster_count(self) -> int:
        """获取总怪物数量（估算）"""
        if self.dungeon.dungeon_type == DungeonType.SINGLE:
            # 1人本：20波，每波平均2个小怪 = 40个小怪
            return 20 * 2
        
        elif self.dungeon.dungeon_type == DungeonType.SQUAD:
            # 5人本：60波小怪 + 4个boss
            return 60 * 2 + 4
        
        elif self.dungeon.dungeon_type == DungeonType.TEAM:
            # 20人本：60波小怪 + 6个boss
            return 60 * 2 + 6
        
        elif self.dungeon.dungeon_type == DungeonType.SERVER_BOSS:
            # 世界boss本：1个boss
            return 1
        
        return 0
