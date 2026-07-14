"""
战斗管理器
实现半即时制战斗、技能循环释放、战斗速度控制等
"""

from enum import Enum
from typing import List, Dict, Any, Optional
import time

from .battle_unit import BattleUnit
from .damage_calculator import DamageCalculator
from .skill_system import Skill, SkillLogic, SkillManager, SkillTargetType, SkillTier
from .status_system import StatusManager
from .ai_system import AISystem
from .threat_system import ThreatSystem
from ..characters.character import Character


class BattleState(Enum):
    """战斗状态"""
    NOT_STARTED = "未开始"
    IN_PROGRESS = "进行中"
    VICTORY = "胜利"
    DEFEAT = "失败"
    PAUSED = "暂停"


class BattleSpeed(Enum):
    """战斗速度"""
    X1 = 1.0
    X2 = 2.0
    X4 = 4.0


class BattleResult:
    """战斗结果"""
    
    def __init__(
        self,
        is_victory: bool,
        duration: float,
        player_units: List[BattleUnit],
        enemy_units: List[BattleUnit],
        rewards: Dict[str, Any] = None
    ):
        """
        初始化战斗结果
        
        Args:
            is_victory: 是否胜利
            duration: 战斗持续时间
            player_units: 玩家单位列表
            enemy_units: 敌人单位列表
            rewards: 奖励
        """
        self.is_victory = is_victory
        self.duration = duration
        self.player_units = player_units
        self.enemy_units = enemy_units
        self.rewards = rewards or {}


class Battle:
    """战斗管理器"""
    
    def __init__(
        self,
        player_units: List[BattleUnit],
        enemy_units: List[BattleUnit],
        max_duration: float = 180.0,  # 最大战斗时间（秒），默认3分钟
        battle_speed: BattleSpeed = BattleSpeed.X1
    ):
        """
        初始化战斗
        
        Args:
            player_units: 玩家单位列表
            enemy_units: 敌人单位列表
            max_duration: 最大战斗时间（秒）
            battle_speed: 战斗速度
        """
        self.player_units = player_units
        self.enemy_units = enemy_units
        
        # 战斗状态
        self.state = BattleState.NOT_STARTED
        self.battle_speed = battle_speed
        self.max_duration = max_duration
        self.start_time = 0.0
        self.current_time = 0.0
        self.last_update_time = 0.0
        
        # 伤害计算器
        self.damage_calculator = DamageCalculator()
        
        # 仇恨值系统
        self.threat_system = ThreatSystem()
        
        # 导入必要的类
        from .status_system import StatusManager
        from .skill_system import SkillManager
        from .ai_system import AISystem
        
        # 为每个单位初始化状态管理器和技能管理器
        for unit in self.player_units + self.enemy_units:
            self.initialize_unit_for_battle(unit)
        
        # 战斗日志
        self.battle_log: List[Dict[str, Any]] = []
        self.damage_stats: Dict[str, Dict[str, Any]] = {}
        
        # 扫荡模式（自动战斗）
        self.auto_mode = False
        
        # 敌人死亡回调（用于副本系统）
        self.on_enemy_killed_callback = None
    
    def start(self):
        """开始战斗"""
        self.state = BattleState.IN_PROGRESS
        self.start_time = time.time()
        self.current_time = 0.0
        self.last_update_time = time.time()
        self._log("战斗开始", "system")
    
    def initialize_unit_for_battle(self, unit: BattleUnit):
        """初始化新加入战斗的单位。"""
        from .status_system import StatusManager
        from .skill_system import SkillManager
        from .ai_system import AISystem
        from ..skills.skill_config import SkillConfig
        
        unit.status_manager = StatusManager(unit)
        unit.skill_manager = SkillManager(unit)
        unit.ai_system = AISystem(unit) if not unit.is_player else None
        
        if unit.character.skill_learning_system is None:
            unit.character.skill_learning_system = SkillConfig.initialize_character_skills(unit.character)
        SkillConfig.setup_battle_skills(
            unit.character,
            unit.skill_manager,
            unit.character.skill_learning_system
        )
        if unit.is_player:
            unit.exclusive_weapon_state = {"last_cast_time": -999.0}
    
    def add_enemy_unit(self, unit: BattleUnit):
        """添加动态刷新的敌方单位。"""
        self.initialize_unit_for_battle(unit)
        self.enemy_units.append(unit)
    
    def update(self, delta_time: float = None):
        """
        更新战斗
        
        Args:
            delta_time: 时间增量（秒），如果为None则自动计算
        """
        if self.state != BattleState.IN_PROGRESS:
            return
        
        # 计算时间增量
        if delta_time is None:
            current_real_time = time.time()
            real_delta = current_real_time - self.last_update_time
            delta_time = real_delta * self.battle_speed.value
            self.last_update_time = current_real_time
        
        # 更新战斗时间
        self.current_time += delta_time
        
        # 检查战斗时间是否超时
        if self.current_time >= self.max_duration:
            self._handle_timeout()
            return
        
        # 更新所有单位的状态效果
        for unit in self.player_units + self.enemy_units:
            if not unit.is_alive():
                continue
            
            # 更新状态效果
            status_result = unit.status_manager.update(delta_time)
            
            # 应用HOT/DOT效果
            if status_result["heal"] > 0:
                unit.heal(status_result["heal"], 0)
                self._log(f"{unit.character.name} 受到持续回复 {status_result['heal']} HP", "heal")
            
            if status_result["damage"] > 0:
                unit.take_damage(status_result["damage"], 0)
                self._log(f"{unit.character.name} 受到持续伤害 {status_result['damage']} HP", "dot")
            
            # 更新技能管理器
            unit.skill_manager.update(delta_time)
        
        # 处理技能释放（每1秒释放一次）
        self._process_skill_casting(delta_time)
        
        # 衰减仇恨值（每秒衰减5%）
        if int(self.current_time) % 1 == 0:  # 每秒衰减一次
            for unit in self.player_units + self.enemy_units:
                if unit.is_alive():
                    self.threat_system.decay_threat(unit, 0.95)
        
        # 检查战斗结束条件
        if self._check_victory():
            self.state = BattleState.VICTORY
            self._log("战斗胜利", "system")
        elif self._check_defeat():
            self.state = BattleState.DEFEAT
            self._log("战斗失败", "system")
    
    def _process_skill_casting(self, delta_time: float):
        """处理技能释放"""
        # 处理玩家单位的技能释放（按照底→中→高循环）
        for player_unit in self.player_units:
            if not player_unit.is_alive():
                continue
            
            skill = player_unit.skill_manager.get_next_skill(self.current_time)
            if skill:
                self._cast_skill(player_unit, skill, self.enemy_units, self.player_units)
            self._try_cast_exclusive_weapon_skill(player_unit)
        
        # 处理怪物单位的技能释放（使用AI）
        for enemy_unit in self.enemy_units:
            if not enemy_unit.is_alive():
                continue
            if getattr(enemy_unit, "mechanic_inactive", False):
                continue
            
            # 获取可用技能（简化：使用技能管理器的下一个技能）
            skill = enemy_unit.skill_manager.get_next_skill(self.current_time)
            if skill:
                self._cast_skill(enemy_unit, skill, self.player_units, self.enemy_units)
            else:
                # 如果没有可用技能，使用AI选择
                available_skills = self._get_available_skills(enemy_unit)
                if available_skills:
                    ai_skill = enemy_unit.ai_system.choose_action(
                        available_skills, self.player_units, self.enemy_units
                    )
                    if ai_skill:
                        self._cast_skill(enemy_unit, ai_skill, self.player_units, self.enemy_units)

    def _build_exclusive_weapon_skill(self, caster: BattleUnit) -> Optional[Skill]:
        weapon = getattr(caster.character, "exclusive_weapon", None)
        if not weapon:
            return None
        special_skill = getattr(weapon, "special_skill", None) or {}
        skill_name = special_skill.get("name") or f"{weapon.name}共鸣"
        damage_multiplier = float(special_skill.get("damage_multiplier", 1.5) or 1.5)
        cooldown = float(special_skill.get("cooldown", 12) or 12)
        physical_ratio = float(special_skill.get("physical_damage_ratio", 1.0) or 0.0)
        magical_ratio = float(special_skill.get("magical_damage_ratio", 0.0) or 0.0)
        if "physical_damage_ratio" not in special_skill and "magical_damage_ratio" not in special_skill:
            if caster.character.magic_attack > caster.character.attack:
                physical_ratio, magical_ratio = 0.25, 0.75
            else:
                physical_ratio, magical_ratio = 0.75, 0.25
        target_type_value = special_skill.get("target_type", "SINGLE")
        target_type = SkillTargetType.ALL if target_type_value in {"ALL", "全体"} else SkillTargetType.SINGLE
        return Skill(
            skill_id=f"exclusive_weapon_{weapon.weapon_id}",
            name=skill_name,
            skill_logic=SkillLogic.B,
            skill_tier=SkillTier.HIGH,
            cooldown=cooldown,
            skill_multiplier=damage_multiplier,
            physical_damage_ratio=physical_ratio,
            magical_damage_ratio=magical_ratio,
            target_type=target_type,
            target_count=int(special_skill.get("target_count", 1) or 1),
            is_heal=bool(special_skill.get("is_heal", False)),
            heal_ratio=float(special_skill.get("heal_ratio", 0.0) or 0.0),
            description=special_skill.get("description", "专属武器主动技能"),
            status_effects=special_skill.get("status_effects", []),
            effect_tags=["exclusive_weapon", *(special_skill.get("effect_tags", []) or [])],
            cast_hint=f"【专属武器】{caster.character.name}释放{skill_name}",
            impact_hint=special_skill.get("impact_hint", f"{weapon.name}的专属效果生效")
        )

    def _try_cast_exclusive_weapon_skill(self, caster: BattleUnit):
        if not caster.is_alive():
            return
        state = getattr(caster, "exclusive_weapon_state", None)
        if state is None:
            state = {"last_cast_time": -999.0}
            caster.exclusive_weapon_state = state
        weapon = getattr(caster.character, "exclusive_weapon", None)
        if not weapon:
            return
        skill = self._build_exclusive_weapon_skill(caster)
        if not skill:
            return
        cooldown = max(float(skill.cooldown or 0), 1.0)
        if self.current_time - float(state.get("last_cast_time", -999.0)) < cooldown:
            return
        alive_enemies = [enemy for enemy in self.enemy_units if enemy.is_alive() and not getattr(enemy, "mechanic_inactive", False)]
        if not alive_enemies:
            return
        state["last_cast_time"] = self.current_time
        self._cast_skill(caster, skill, self.enemy_units, self.player_units, source="exclusive_weapon")
    
    def _cast_skill(
        self,
        caster: BattleUnit,
        skill: Skill,
        enemies: List[BattleUnit],
        allies: List[BattleUnit],
        source: str = "skill"
    ):
        """
        释放技能
        
        Args:
            caster: 施法者
            skill: 技能
            enemies: 敌人列表
            allies: 盟友列表
        """
        if not skill.can_use():
            return
        
        # 选择目标
        if skill.is_heal:
            targets = caster.ai_system.choose_target(skill, enemies, allies) if caster.ai_system else allies
        else:
            if caster.is_player:
                # 玩家：优先攻击血量最多的怪物（单体）或所有怪物（全体）
                if skill.target_type == SkillTargetType.SINGLE:
                    alive_enemies = [e for e in enemies if e.is_alive() and not getattr(e, "mechanic_inactive", False)]
                    targets = [max(alive_enemies, key=lambda e: e.current_health)] if alive_enemies else []
                elif skill.target_type == SkillTargetType.ALL:
                    targets = [e for e in enemies if e.is_alive() and not getattr(e, "mechanic_inactive", False)]
                else:  # MULTIPLE
                    sorted_enemies = sorted([e for e in enemies if e.is_alive() and not getattr(e, "mechanic_inactive", False)], 
                                           key=lambda e: e.get_total_health_percentage())
                    targets = sorted_enemies[:skill.target_count]
            else:
                # 怪物：使用AI选择目标
                targets = caster.ai_system.choose_target(skill, enemies, allies)
        
        if not targets:
            return
        
        is_boss_skill = getattr(caster, "spawn_category", None) == "boss"
        is_exclusive_weapon_skill = source == "exclusive_weapon" or "exclusive_weapon" in getattr(skill, "effect_tags", [])
        if is_boss_skill and getattr(skill, "telegraph", ""):
            self._log(
                f"【技能预警】{caster.character.name}：{skill.telegraph}",
                "skill_telegraph",
                {"caster_id": caster.character.character_id, "skill_id": skill.skill_id}
            )

        # 使用技能
        skill.use()
        cast_message = getattr(skill, "cast_hint", "") or f"{caster.character.name} 使用技能 {skill.name}"
        if is_boss_skill:
            cast_message = f"【Boss技能】{cast_message}（{skill.name}）"
        elif is_exclusive_weapon_skill and "【专属武器】" not in cast_message:
            cast_message = f"【专属武器】{cast_message}"
        self._log(
            cast_message,
            "boss_skill" if is_boss_skill else "exclusive_weapon_skill" if is_exclusive_weapon_skill else "skill",
            {
                "caster_id": caster.character.character_id,
                "skill_id": skill.skill_id,
                "skill_name": skill.name,
                "effect_tags": getattr(skill, "effect_tags", []),
                "target_count": len(targets),
            }
        )
        
        # 对每个目标应用技能效果
        for target in targets:
            if not target.is_alive():
                continue
            
            if skill.is_heal:
                # 治疗技能
                heal_amount = int(caster.character.attack * skill.heal_ratio)
                target.heal(heal_amount, 0)
                self._log(
                    f"{target.character.name} 恢复 {heal_amount} HP",
                    "heal",
                    {"target_id": target.character.character_id, "amount": heal_amount}
                )
                
                # 治疗产生仇恨
                self.threat_system.add_threat_from_heal(caster, target, heal_amount)
            else:
                # 攻击技能
                damage_result = self.damage_calculator.calculate_dual_damage(
                    caster.character,
                    target.character,
                    skill.physical_damage_ratio,
                    skill.magical_damage_ratio,
                    skill.skill_multiplier,
                    caster.status_manager.get_stat_modifiers() if caster.status_manager else {},
                    target.status_manager.get_stat_modifiers() if target.status_manager else {}
                )
                
                # 造成伤害
                pre_damage_health = target.current_health
                target.take_damage(
                    damage_result["physical_damage"],
                    damage_result["magical_damage"]
                )
                effective_damage = max(0, int(pre_damage_health - target.current_health))
                if caster.is_player and not target.is_player and effective_damage > 0:
                    self._record_damage(caster, target, effective_damage, damage_result, skill, source)
                
                crit_text = " (暴击!)" if damage_result["physical_result"]["is_crit"] or damage_result["magical_result"]["is_crit"] else ""
                self._log(
                    f"{target.character.name} 受到 {damage_result['total_damage']} 伤害{crit_text}",
                    "damage",
                    {
                        "caster_id": caster.character.character_id,
                        "caster_name": caster.character.name,
                        "target_id": target.character.character_id,
                        "amount": effective_damage or damage_result["total_damage"],
                        "raw_amount": damage_result["total_damage"],
                        "physical_damage": damage_result["physical_damage"],
                        "magical_damage": damage_result["magical_damage"],
                        "is_crit": bool(crit_text),
                        "skill_id": skill.skill_id,
                        "skill_name": skill.name,
                        "source": source,
                    }
                )
                
                # 伤害产生仇恨
                self.threat_system.add_threat_from_damage(
                    caster, target, damage_result["total_damage"]
                )
                
                # 应用状态效果
                for status_effect_data in skill.status_effects:
                    status = self._create_status_effect(status_effect_data)
                    target.status_manager.add_status(status)
                    self._log(
                        f"{target.character.name} 获得状态：{status.name}",
                        "status",
                        {
                            "target_id": target.character.character_id,
                            "status_id": status.status_id,
                            "status_type": status.status_type.value,
                            "duration": status.duration,
                        }
                    )

                if (is_boss_skill or is_exclusive_weapon_skill) and getattr(skill, "impact_hint", ""):
                    self._log(
                        f"【技能效果】{skill.impact_hint}",
                        "exclusive_weapon_effect" if is_exclusive_weapon_skill else "skill_effect",
                        {"skill_id": skill.skill_id, "target_id": target.character.character_id}
                    )
        
        # 检查目标是否死亡
        for target in targets:
            if target.is_dead():
                self._log(f"{target.character.name} 被击败", "death")
                # 触发敌人死亡事件（用于副本系统统计）
                self._on_enemy_killed(target)
    
    def _on_enemy_killed(self, enemy_unit: BattleUnit):
        """敌人死亡时的回调"""
        if self.on_enemy_killed_callback:
            self.on_enemy_killed_callback(enemy_unit)
    
    def set_enemy_killed_callback(self, callback):
        """设置敌人死亡回调"""
        self.on_enemy_killed_callback = callback
    
    def _record_damage(
        self,
        caster: BattleUnit,
        target: BattleUnit,
        amount: int,
        damage_result: Dict[str, Any],
        skill: Skill,
        source: str
    ):
        character_id = caster.character.character_id
        row = self.damage_stats.setdefault(character_id, {
            "character_id": character_id,
            "character_name": caster.character.name,
            "total_damage": 0,
            "physical_damage": 0,
            "magical_damage": 0,
            "hits": 0,
            "crit_count": 0,
            "skills": {},
            "targets": {},
        })
        row["total_damage"] += amount
        row["physical_damage"] += int(damage_result.get("physical_damage", 0) or 0)
        row["magical_damage"] += int(damage_result.get("magical_damage", 0) or 0)
        row["hits"] += 1
        if damage_result.get("physical_result", {}).get("is_crit") or damage_result.get("magical_result", {}).get("is_crit"):
            row["crit_count"] += 1

        skill_bucket = row["skills"].setdefault(skill.skill_id, {
            "skill_id": skill.skill_id,
            "skill_name": skill.name,
            "source": source,
            "damage": 0,
            "hits": 0,
        })
        skill_bucket["damage"] += amount
        skill_bucket["hits"] += 1

        target_id = target.character.character_id
        target_bucket = row["targets"].setdefault(target_id, {
            "target_id": target_id,
            "target_name": target.character.name,
            "damage": 0,
        })
        target_bucket["damage"] += amount

    def get_damage_summary(self) -> Dict[str, Any]:
        characters = []
        for row in self.damage_stats.values():
            payload = dict(row)
            payload["skills"] = list(row.get("skills", {}).values())
            payload["targets"] = list(row.get("targets", {}).values())
            characters.append(payload)
        characters.sort(key=lambda item: item.get("total_damage", 0), reverse=True)
        return {
            "total_damage": sum(item.get("total_damage", 0) for item in characters),
            "characters": characters,
        }

    def _create_status_effect(self, status_data: Dict[str, Any]):
        """创建状态效果（辅助方法）"""
        from .status_system import StatusEffect, StatusType
        
        return StatusEffect(
            status_id=status_data.get("status_id", ""),
            name=status_data.get("name", ""),
            status_type=StatusType(status_data.get("status_type", "增益")),
            duration=status_data.get("duration", 0),
            value=status_data.get("value", 0),
            effect_type=status_data.get("effect_type", ""),
            tick_interval=status_data.get("tick_interval", 1.0),
            description=status_data.get("description", "")
        )
    
    def _get_available_skills(self, unit: BattleUnit) -> List[Skill]:
        """获取可用技能列表"""
        all_skills = (unit.skill_manager.low_tier_slots.skills +
                     unit.skill_manager.mid_tier_slots.skills +
                     unit.skill_manager.high_tier_slots.skills)
        return [s for s in all_skills if s.can_use()]
    
    def _check_victory(self) -> bool:
        """检查是否胜利"""
        # 所有敌人被击败
        return bool(self.enemy_units) and all(enemy.is_dead() for enemy in self.enemy_units)
    
    def _check_defeat(self) -> bool:
        """检查是否失败"""
        # 所有玩家被击败
        return all(player.is_dead() for player in self.player_units)
    
    def _handle_timeout(self):
        """处理超时"""
        # 超时判定为失败
        self.state = BattleState.DEFEAT
        self._log("战斗超时，判定为失败", "system")
    
    def set_battle_speed(self, speed: BattleSpeed):
        """设置战斗速度"""
        self.battle_speed = speed
    
    def set_auto_mode(self, auto: bool):
        """设置自动模式（扫荡）"""
        self.auto_mode = auto
    
    def pause(self):
        """暂停战斗"""
        if self.state == BattleState.IN_PROGRESS:
            self.state = BattleState.PAUSED
    
    def resume(self):
        """恢复战斗"""
        if self.state == BattleState.PAUSED:
            self.state = BattleState.IN_PROGRESS
            self.last_update_time = time.time()
    
    def get_result(self) -> Optional[BattleResult]:
        """获取战斗结果"""
        if self.state not in [BattleState.VICTORY, BattleState.DEFEAT]:
            return None
        
        duration = self.current_time
        is_victory = self.state == BattleState.VICTORY
        
        return BattleResult(
            is_victory=is_victory,
            duration=duration,
            player_units=self.player_units,
            enemy_units=self.enemy_units,
            rewards={}  # 奖励系统稍后实现
        )
    
    def _log(self, message: str, event_type: str = "info", payload: Optional[Dict[str, Any]] = None):
        """记录战斗日志"""
        log_entry = {
            "time": self.current_time,
            "message": message,
            "event_type": event_type,
            "payload": payload or {}
        }
        self.battle_log.append(log_entry)
        print(f"[{self.current_time:.1f}s] {message}")
    
    def get_battle_log(self) -> List[Dict[str, Any]]:
        """获取战斗日志"""
        return self.battle_log
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "state": self.state.value,
            "current_time": self.current_time,
            "max_duration": self.max_duration,
            "battle_speed": self.battle_speed.value,
            "player_units": [u.to_dict() for u in self.player_units],
            "enemy_units": [u.to_dict() for u in self.enemy_units]
        }
