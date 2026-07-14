"""
战斗系统模块
实现半即时制战斗、技能系统、状态系统等核心功能
"""

from .battle import Battle, BattleState, BattleResult
from .battle_unit import BattleUnit, HealthType
from .damage_calculator import DamageCalculator
from .skill_system import Skill, SkillLogic, SkillTier, SkillSlot
from .status_system import StatusEffect, StatusType, StatusManager
from .ai_system import AISystem, AIPriority
from .threat_system import ThreatSystem

__all__ = [
    'Battle',
    'BattleState',
    'BattleResult',
    'BattleUnit',
    'HealthType',
    'DamageCalculator',
    'Skill',
    'SkillLogic',
    'SkillTier',
    'SkillSlot',
    'StatusEffect',
    'StatusType',
    'StatusManager',
    'AISystem',
    'AIPriority',
    'ThreatSystem'
]







