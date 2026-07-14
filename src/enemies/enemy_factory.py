"""
敌人工厂
根据副本类型、难度、时间等生成敌人
"""

from typing import List, Dict, Any, Optional
from .enemy import Enemy, EnemyType
from ..attributes.attribute import AttributeType
from ..dungeons.dungeon import Dungeon, DungeonType
from ..classes.profession import Profession, ProfessionType, get_profession
import random


class EnemyFactory:
    """敌人工厂"""
    
    @staticmethod
    def _get_counter_attribute(attribute_type: AttributeType) -> AttributeType:
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
    
    # 基础属性配置（根据副本类型）
    BASE_STATS = {
        DungeonType.SINGLE: {
            "base_hp": 500,
            "base_attack": 50,
            "base_defense": 25,
            "base_magic_attack": 30,
            "base_magic_defense": 20
        },
        DungeonType.SQUAD: {
            "base_hp": 1000,
            "base_attack": 100,
            "base_defense": 50,
            "base_magic_attack": 60,
            "base_magic_defense": 40
        },
        DungeonType.TEAM: {
            "base_hp": 2000,
            "base_attack": 200,
            "base_defense": 100,
            "base_magic_attack": 120,
            "base_magic_defense": 80
        }
    }
    
    # 怪物等级配置（根据副本类型）
    ENEMY_LEVELS = {
        DungeonType.SINGLE: 10,
        DungeonType.SQUAD: 20,
        DungeonType.TEAM: 30
    }
    
    # 兜底难度倍率。实际优先读取副本配置。
    DIFFICULTY_MULTIPLIER = 1.0
    
    @staticmethod
    def create_enemy(
        dungeon: Dungeon,
        enemy_type: EnemyType,
        current_time: float = 0.0,
        enemy_index: int = 0
    ) -> List[Enemy]:
        """
        创建敌人
        
        Args:
            dungeon: 副本
            enemy_type: 敌人类型
            current_time: 当前时间（秒，用于计算时间倍率）
            enemy_index: 敌人索引（用于生成唯一ID）
            
        Returns:
            敌人列表（单体返回1个，群体返回3个或5个）
        """
        # 获取基础属性
        base_stats = EnemyFactory.BASE_STATS.get(dungeon.dungeon_type, EnemyFactory.BASE_STATS[DungeonType.SINGLE])
        
        # 获取怪物等级
        level = EnemyFactory.ENEMY_LEVELS.get(dungeon.dungeon_type, 10)
        
        # 计算时间倍率（每秒+1%）
        time_multiplier = 1.0 + (current_time * 0.01)
        
        # 应用难度倍率
        difficulty_multiplier = float(
            dungeon.monster_config.get(
                "stat_multiplier",
                getattr(dungeon, "get_monster_multiplier", lambda: EnemyFactory.DIFFICULTY_MULTIPLIER)()
            )
        )
        
        # 计算最终属性
        total_multiplier = time_multiplier * difficulty_multiplier
        
        base_hp = int(base_stats["base_hp"] * total_multiplier)
        base_attack = int(base_stats["base_attack"] * total_multiplier)
        base_defense = int(base_stats["base_defense"] * total_multiplier)
        base_magic_attack = int(base_stats["base_magic_attack"] * total_multiplier)
        base_magic_defense = int(base_stats["base_magic_defense"] * total_multiplier)
        
        enemies = []
        
        # 获取怪物属性（根据属性克制关系，怪物属性是被角色克制的属性）
        # 直接计算，避免循环导入
        monster_attribute = EnemyFactory._get_counter_attribute(dungeon.attribute_type)
        
        if enemy_type == EnemyType.SINGLE:
            # 单体小怪
            enemy = Enemy(
                enemy_id=f"{dungeon.dungeon_id}_enemy_{enemy_index}",
                name=f"{monster_attribute.value}系小怪",
                attribute_type=monster_attribute,  # 怪物的属性是被角色克制的属性
                level=level,
                base_hp=base_hp,
                base_attack=base_attack,
                base_defense=base_defense,
                base_magic_attack=base_magic_attack,
                base_magic_defense=base_magic_defense,
                profession=None,  # 小怪没有职业
                is_boss=False
            )
            enemies.append(enemy)
        
        elif enemy_type == EnemyType.GROUP_3:
            # 群体小怪3个（相同属性，总血量与单体小怪持平）
            group_hp = base_hp // 3  # 每个小怪的血量是总血量的1/3
            for i in range(3):
                enemy = Enemy(
                    enemy_id=f"{dungeon.dungeon_id}_enemy_group3_{enemy_index}_{i}",
                    name=f"{monster_attribute.value}系小怪（群体）",
                    attribute_type=monster_attribute,
                    level=level,
                    base_hp=group_hp,
                    base_attack=base_attack,
                    base_defense=base_defense,
                    base_magic_attack=base_magic_attack,
                    base_magic_defense=base_magic_defense,
                    profession=None,  # 小怪没有职业
                    is_boss=False
                )
                enemies.append(enemy)
        
        elif enemy_type == EnemyType.GROUP_5:
            # 群体小怪5个（相同属性，总血量与单体小怪持平）
            group_hp = base_hp // 5  # 每个小怪的血量是总血量的1/5
            for i in range(5):
                enemy = Enemy(
                    enemy_id=f"{dungeon.dungeon_id}_enemy_group5_{enemy_index}_{i}",
                    name=f"{monster_attribute.value}系小怪（群体）",
                    attribute_type=monster_attribute,
                    level=level,
                    base_hp=group_hp,
                    base_attack=base_attack,
                    base_defense=base_defense,
                    base_magic_attack=base_magic_attack,
                    base_magic_defense=base_magic_defense,
                    profession=None,  # 小怪没有职业
                    is_boss=False
                )
                enemies.append(enemy)
        
        return enemies
    
    @staticmethod
    def create_boss(
        dungeon: Dungeon,
        boss_type: str,
        current_time: float = 0.0,
        boss_index: int = 0,
        profession: Optional[Profession] = None
    ) -> Enemy:
        """
        创建Boss
        
        Args:
            dungeon: 副本
            boss_type: Boss类型（如：single, twin_separate等）
            current_time: 当前时间（秒）
            boss_index: Boss索引
            profession: Boss职业（如果为None，随机选择）
            
        Returns:
            Boss敌人
        """
        # 获取基础属性（Boss属性是小怪的5倍）
        base_stats = EnemyFactory.BASE_STATS.get(dungeon.dungeon_type, EnemyFactory.BASE_STATS[DungeonType.SINGLE])
        
        # 获取Boss等级
        level = EnemyFactory.ENEMY_LEVELS.get(dungeon.dungeon_type, 10)
        
        # 计算时间倍率
        time_multiplier = 1.0 + (current_time * 0.01)
        
        # Boss倍率（Boss属性是小怪的5倍）
        boss_multiplier = 5.0
        
        # 应用难度倍率
        difficulty_multiplier = float(
            dungeon.monster_config.get(
                "stat_multiplier",
                getattr(dungeon, "get_monster_multiplier", lambda: EnemyFactory.DIFFICULTY_MULTIPLIER)()
            )
        )
        
        # 计算最终属性
        total_multiplier = time_multiplier * difficulty_multiplier * boss_multiplier
        
        base_hp = int(base_stats["base_hp"] * total_multiplier)
        base_attack = int(base_stats["base_attack"] * total_multiplier)
        base_defense = int(base_stats["base_defense"] * total_multiplier)
        base_magic_attack = int(base_stats["base_magic_attack"] * total_multiplier)
        base_magic_defense = int(base_stats["base_magic_defense"] * total_multiplier)
        
        # 获取怪物属性（根据属性克制关系）
        monster_attribute = EnemyFactory._get_counter_attribute(dungeon.attribute_type)
        
        # 如果职业为None，随机选择职业（暂时待定，使用随机）
        if profession is None:
            profession_types = list(ProfessionType)
            profession = get_profession(random.choice(profession_types))
        
        # 创建Boss
        boss = Enemy(
            enemy_id=f"{dungeon.dungeon_id}_boss_{boss_index}",
            name=f"{monster_attribute.value}系Boss",
            attribute_type=monster_attribute,  # Boss的属性也是被角色克制的属性
            level=level,
            base_hp=base_hp,
            base_attack=base_attack,
            base_defense=base_defense,
            base_magic_attack=base_magic_attack,
            base_magic_defense=base_magic_defense,
            profession=profession,  # Boss有职业
            is_boss=True
        )
        
        return boss


def create_enemy(
    dungeon: Dungeon,
    enemy_type: EnemyType,
    current_time: float = 0.0,
    enemy_index: int = 0
) -> List[Enemy]:
    """创建敌人（便捷函数）"""
    return EnemyFactory.create_enemy(dungeon, enemy_type, current_time, enemy_index)


def create_boss(
    dungeon: Dungeon,
    boss_type: str,
    current_time: float = 0.0,
    boss_index: int = 0,
    profession: Optional[Profession] = None
) -> Enemy:
    """创建Boss（便捷函数）"""
    return EnemyFactory.create_boss(dungeon, boss_type, current_time, boss_index, profession)
