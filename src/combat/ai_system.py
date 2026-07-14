"""
AI系统
实现优先级AI和目标选择逻辑
"""

from enum import Enum
from typing import List, Optional, Dict, Any
from .battle_unit import BattleUnit
from .skill_system import Skill, SkillTargetType


class AIPriority(Enum):
    """AI优先级"""
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4


class AISystem:
    """AI系统"""
    
    def __init__(self, battle_unit: BattleUnit):
        """
        初始化AI系统
        
        Args:
            battle_unit: 战斗单位（怪物）
        """
        self.battle_unit = battle_unit
    
    def choose_action(self, available_skills: List[Skill], enemies: List[BattleUnit], allies: List[BattleUnit]) -> Optional[Skill]:
        """
        选择行动（使用优先级AI）
        
        Args:
            available_skills: 可用技能列表
            enemies: 敌人列表
            allies: 盟友列表
            
        Returns:
            选择的技能
        """
        if not available_skills:
            return None
        
        # 1. 如果HP低于30%，优先使用治疗技能
        if self.battle_unit.get_total_health_percentage() < 0.3:
            heal_skill = self._find_heal_skill(available_skills)
            if heal_skill and heal_skill.can_use():
                return heal_skill
        
        # 2. 如果有低血量的盟友，优先使用治疗技能
        low_health_ally = self._find_low_health_ally(allies)
        if low_health_ally:
            heal_skill = self._find_heal_skill(available_skills)
            if heal_skill and heal_skill.can_use():
                return heal_skill
        
        # 3. 如果有敌人有Buff，优先使用驱散技能（如果有）
        buffed_enemy = self._find_buffed_enemy(enemies)
        if buffed_enemy:
            dispel_skill = self._find_dispel_skill(available_skills)
            if dispel_skill and dispel_skill.can_use():
                return dispel_skill
        
        # 4. 优先攻击低血量敌人
        low_health_enemy = self._find_low_health_enemy(enemies)
        if low_health_enemy:
            attack_skill = self._find_attack_skill(available_skills)
            if attack_skill and attack_skill.can_use():
                return attack_skill
        
        # 5. 默认使用攻击技能
        attack_skill = self._find_attack_skill(available_skills)
        if attack_skill:
            return attack_skill
        
        # 6. 如果没有攻击技能，返回第一个可用技能
        for skill in available_skills:
            if skill.can_use():
                return skill
        
        return None
    
    def choose_target(
        self,
        skill: Skill,
        enemies: List[BattleUnit],
        allies: List[BattleUnit]
    ) -> List[BattleUnit]:
        """
        选择目标
        
        Args:
            skill: 技能
            enemies: 敌人列表
            allies: 盟友列表
            
        Returns:
            目标列表
        """
        if skill.target_type == SkillTargetType.SINGLE:
            # 单体技能：优先攻击血量最多的怪物
            if enemies:
                alive_enemies = [enemy for enemy in enemies if enemy.is_alive()]
                return [max(alive_enemies, key=lambda e: e.current_health)] if alive_enemies else []
        
        elif skill.target_type == SkillTargetType.ALL:
            # 全体技能：覆盖场上所有怪物
            if skill.is_heal:
                return allies  # 如果是治疗，目标是盟友
            else:
                return enemies  # 如果是攻击，目标是敌人
        
        elif skill.target_type == SkillTargetType.MULTIPLE:
            # 指定目标数：根据优先级选择
            targets = []
            if skill.is_heal:
                # 治疗技能：优先选择低血量盟友
                sorted_allies = sorted(allies, key=lambda a: a.get_total_health_percentage())
                targets = sorted_allies[:skill.target_count]
            else:
                # 攻击技能：根据priority_target选择
                if skill.priority_target == "lowest_health":
                    # 优先攻击血量最少的敌人
                    sorted_enemies = sorted(enemies, key=lambda e: e.get_total_health_percentage())
                    targets = sorted_enemies[:skill.target_count]
                elif skill.priority_target == "highest_health":
                    # 优先攻击血量最多的敌人
                    sorted_enemies = sorted(enemies, key=lambda e: e.get_total_health_percentage(), reverse=True)
                    targets = sorted_enemies[:skill.target_count]
                elif skill.priority_target == "nearest":
                    # 优先攻击距离最近的敌人（简化：选择第一个敌人）
                    targets = enemies[:skill.target_count]
            
            return targets
        
        return []
    
    def _find_heal_skill(self, skills: List[Skill]) -> Optional[Skill]:
        """查找治疗技能"""
        for skill in skills:
            if skill.is_heal:
                return skill
        return None
    
    def _find_attack_skill(self, skills: List[Skill]) -> Optional[Skill]:
        """查找攻击技能"""
        for skill in skills:
            if not skill.is_heal:
                return skill
        return None
    
    def _find_dispel_skill(self, skills: List[Skill]) -> Optional[Skill]:
        """查找驱散技能（暂未实现，返回None）"""
        # TODO: 实现驱散技能查找
        return None
    
    def _find_low_health_ally(self, allies: List[BattleUnit], threshold: float = 0.5) -> Optional[BattleUnit]:
        """查找低血量盟友"""
        for ally in allies:
            if ally.is_alive() and ally.get_total_health_percentage() < threshold:
                return ally
        return None
    
    def _find_low_health_enemy(self, enemies: List[BattleUnit]) -> Optional[BattleUnit]:
        """查找低血量敌人"""
        alive_enemies = [e for e in enemies if e.is_alive()]
        if not alive_enemies:
            return None
        return min(alive_enemies, key=lambda e: e.get_total_health_percentage())
    
    def _find_buffed_enemy(self, enemies: List[BattleUnit]) -> Optional[BattleUnit]:
        """查找有Buff的敌人"""
        for enemy in enemies:
            if enemy.is_alive() and enemy.status_manager:
                # 检查是否有Buff
                for status in enemy.status_manager.status_effects:
                    if status.status_type.value == "增益":
                        return enemy
        return None







