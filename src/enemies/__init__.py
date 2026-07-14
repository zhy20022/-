"""
敌人/怪物系统模块
实现怪物生成、Boss系统等
"""

from .enemy import Enemy, EnemyType
from .enemy_factory import EnemyFactory, create_enemy, create_boss
from .boss import Boss, BossType, BossPhase
from .server_boss import ServerBoss, ServerBossManager, DamageRecord

__all__ = [
    'Enemy',
    'EnemyType',
    'EnemyFactory',
    'create_enemy',
    'create_boss',
    'Boss',
    'BossType',
    'BossPhase',
    'ServerBoss',
    'ServerBossManager',
    'DamageRecord'
]





