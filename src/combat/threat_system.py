"""
仇恨值系统
实现坦克吸引仇恨的机制
"""

from typing import Dict, List
from .battle_unit import BattleUnit


class ThreatSystem:
    """仇恨值系统"""
    
    def __init__(self):
        """初始化仇恨值系统"""
        pass
    
    def add_threat_from_damage(self, attacker: BattleUnit, target: BattleUnit, damage: float, multiplier: float = 1.0):
        """
        从伤害产生仇恨
        
        Args:
            attacker: 攻击者
            target: 目标
            threat_amount: 仇恨值增加量
        """
        # 造成伤害时增加仇恨
        threat_amount = damage * multiplier
        target.add_threat(attacker.character.character_id, threat_amount)
    
    def add_threat_from_heal(self, healer: BattleUnit, target: BattleUnit, heal_amount: float, multiplier: float = 0.5):
        """
        从治疗产生仇恨（对治疗者产生仇恨）
        
        Args:
            healer: 治疗者
            target: 被治疗者
            heal_amount: 治疗量
        """
        # 治疗时对治疗者产生仇恨（怪物会优先攻击治疗者）
        threat_amount = heal_amount * multiplier
        healer.add_threat(target.character.character_id, threat_amount)
    
    def add_threat_from_taunt(self, taunter: BattleUnit, target: BattleUnit, threat_amount: float = 1000.0):
        """
        嘲讽技能产生大量仇恨
        
        Args:
            taunter: 使用嘲讽的单位（通常是坦克）
            target: 目标
            threat_amount: 仇恨值
        """
        target.add_threat(taunter.character.character_id, threat_amount)
    
    def get_highest_threat_target(self, unit: BattleUnit, enemies: List[BattleUnit]) -> BattleUnit:
        """
        获取仇恨值最高的目标
        
        Args:
            unit: 单位（怪物）
            enemies: 敌人列表
            
        Returns:
            仇恨值最高的敌人
        """
        if not enemies:
            return None
        
        highest_threat = -1
        highest_target = None
        
        for enemy in enemies:
            if enemy.is_alive():
                threat = unit.get_threat(enemy.character.character_id)
                # 如果敌人是坦克，额外增加仇恨值
                if enemy.character.profession.is_tank():
                    threat *= 1.5  # 坦克职业增加50%仇恨值
                
                if threat > highest_threat:
                    highest_threat = threat
                    highest_target = enemy
        
        # 如果没有仇恨值，随机选择一个目标
        if highest_target is None:
            alive_enemies = [e for e in enemies if e.is_alive()]
            if alive_enemies:
                return alive_enemies[0]
        
        return highest_target
    
    def decay_threat(self, unit: BattleUnit, decay_rate: float = 0.95):
        """
        衰减仇恨值（每个回合/每过一段时间）
        
        Args:
            unit: 单位
            decay_rate: 衰减率（0-1之间）
        """
        unit.decay_threat(decay_rate)







