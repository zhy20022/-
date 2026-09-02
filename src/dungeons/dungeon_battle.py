"""
副本战斗流程
管理副本的战斗流程：进入副本、战斗触发、多场战斗、完成退出等
"""

from typing import List, Dict, Any, Optional, Callable
from enum import Enum
from collections import defaultdict
import time
import uuid

from .dungeon import Dungeon, DungeonType, ATTRIBUTE_ID_MAP
from .dungeon_monster import MonsterSpawner
from .dungeon_reward import RewardCalculator, DungeonReward
from .dungeon_item import DungeonItemManager, DungeonItem, ItemType
from ..combat.battle import Battle, BattleState, BattleSpeed
from ..combat.battle_unit import BattleUnit
from ..characters.character import Character
from ..social.friend_system import AssistRewardPolicy


def distribute_quantity_evenly(total: int, recipient_count: int) -> List[int]:
    """将数量平均分配给多个目标（尽量均匀，前面多分配余数）。"""
    if recipient_count <= 0:
        return []
    if total <= 0:
        return [0] * recipient_count
    base = total // recipient_count
    remainder = total % recipient_count
    distribution = []
    for index in range(recipient_count):
        amount = base + (1 if index < remainder else 0)
        distribution.append(amount)
    return distribution


class DungeonBattleState(Enum):
    """副本战斗状态"""
    NOT_STARTED = "未开始"
    PREPARING = "准备中"      # 选择角色、调整技能槽、装备
    COUNTDOWN = "倒计时"      # 3秒倒计时
    IN_BATTLE = "战斗中"
    COMPLETED = "已完成"
    FAILED = "失败"
    REWARD = "奖励结算"
    FINISHED = "结束"


class DungeonBattleFlow:
    """副本战斗流程"""
    
    def __init__(
        self,
        dungeon: Dungeon,
        player_characters: List[Character],
        is_multiplayer: bool = False,
        player_roster: Optional[List[Dict[str, Any]]] = None,
        character_owner_map: Optional[Dict[str, Dict[str, str]]] = None,
        assist_enabled: bool = False
    ):
        """
        初始化副本战斗流程
        
        Args:
            dungeon: 副本
            player_characters: 玩家角色列表
            is_multiplayer: 是否多人模式
        """
        self.dungeon = dungeon
        self.player_characters = player_characters
        self.is_multiplayer = is_multiplayer
        
        # 战斗状态
        self.state = DungeonBattleState.NOT_STARTED
        self.current_time = 0.0
        self.start_time = 0.0
        
        # 倒计时
        self.countdown_time = 3.0
        self.countdown_started = False
        
        # 战斗相关
        self.battle: Optional[Battle] = None
        self.monster_spawner = MonsterSpawner(dungeon)
        self.item_manager = DungeonItemManager(dungeon)
        self.reward_calculator = RewardCalculator()
        
        # 玩家准备状态（多人模式）
        self.players_ready: Dict[str, bool] = {}
        self.all_players_ready = False
        
        # 4倍速相关
        self.players_agree_4x: Dict[str, bool] = {}
        self.can_use_4x = False
        
        # 战斗统计
        self.monsters_killed = 0
        self.single_monsters_killed = 0
        self.group_monsters_killed = 0
        self.groups_killed = 0
        self.bosses_killed = 0
        self.duration = 0.0
        self.last_spawn_check_time = -0.001  # 上次检查生成时间，允许0秒首波生成
        self.is_successful = False
        self.boss_mechanic_groups: Dict[str, Dict[str, Any]] = {}
        
        # 奖励
        self.rewards: Optional[DungeonReward] = None
        
        # 连续战斗
        self.continuous_battle_count = 1
        self.continuous_battle_results: List[Dict[str, Any]] = []
        
        # 掉落数据
        self.player_roster = player_roster or []
        self.character_owner_map = character_owner_map or self._build_character_owner_map()
        self.player_display_map = self._build_player_display_map()
        self._drop_sequence = 0
        self.drop_events: List[Dict[str, Any]] = []
        self.player_drop_buckets: Dict[str, Dict[str, Any]] = {}
        self._rarity_counts = defaultdict(int)
        self._type_counts = defaultdict(int)
        self._drop_callback: Optional[Callable[[Dict[str, Any]], None]] = None
        self._drop_assignment_order = self._build_drop_assignment_order()
        self._drop_assignment_index = 0
        self._reward_drops_committed = False
        self.assist_enabled = assist_enabled
        self.assist_currency_total = 0
        self.team_phases = self._build_team_phases()
        self.team_phase_index = 0
        self.team_phase_name = self.team_phases[0]["name"] if self.team_phases else None
        self.team_phase_reported_index = -1
        self.team_pressure = 0
        self.team_pressure_peak = 0
        self.team_pressure_samples: List[float] = []
        self.team_pressure_events: List[Dict[str, Any]] = []
        self.team_last_pressure_tick = -999.0
        self.team_role_profile = self._build_team_role_profile()
    
    def _build_character_owner_map(self) -> Dict[str, Dict[str, str]]:
        mapping: Dict[str, Dict[str, str]] = {}
        for entry in self.player_roster:
            player_id = entry.get("player_id")
            player_name = entry.get("player_name")
            for char_id in entry.get("character_ids", []):
                mapping[char_id] = {
                    "player_id": player_id,
                    "player_name": player_name
                }
        return mapping
    
    def _build_player_display_map(self) -> Dict[str, Dict[str, Any]]:
        display_map: Dict[str, Dict[str, Any]] = {}
        for entry in self.player_roster:
            player_id = entry.get("player_id") or f"player_{len(display_map)}"
            display_map[player_id] = {
                "player_id": player_id,
                "player_name": entry.get("player_name") or "未知玩家"
            }
        return display_map
    
    def _build_drop_assignment_order(self) -> List[Dict[str, Any]]:
        order: List[Dict[str, Any]] = []
        if self.player_roster:
            for entry in self.player_roster:
                player_id = entry.get("player_id")
                order.append({
                    "player_id": player_id,
                    "player_name": entry.get("player_name") or "未知玩家"
                })
        else:
            # 默认单人
            order.append({
                "player_id": None,
                "player_name": "单人挑战者"
            })
        return order

    def _is_team_dungeon(self) -> bool:
        return self.dungeon.dungeon_type == DungeonType.TEAM

    def _build_team_phases(self) -> List[Dict[str, Any]]:
        if self.dungeon.dungeon_type != DungeonType.TEAM:
            return []
        return [
            {"index": 0, "name": "Gate Breach", "start": 0.0, "base_pressure": 14, "reward_weight": 1},
            {"index": 1, "name": "Add Control", "start": 60.0, "base_pressure": 30, "reward_weight": 2},
            {"index": 2, "name": "Boss Chain", "start": 120.0, "base_pressure": 48, "reward_weight": 3},
            {"index": 3, "name": "Final Clash", "start": 195.0, "base_pressure": 68, "reward_weight": 4},
        ]

    def _classify_team_role(self, character: Character) -> str:
        profession = getattr(character, "profession", None)
        profession_type = getattr(profession, "profession_type", None)
        profession_name = getattr(profession_type, "name", "")
        profession_value = getattr(profession_type, "value", "")
        text = f"{profession_name} {profession_value}".lower()
        if callable(getattr(profession, "is_tank", None)) and profession.is_tank():
            return "tank"
        if "healer" in text or "heal" in text:
            return "healer"
        if "support" in text:
            return "support"
        if callable(getattr(profession, "is_dps", None)) and profession.is_dps():
            return "dps"
        return "dps"

    def _build_team_role_profile(self) -> Dict[str, Any]:
        if not self._is_team_dungeon():
            return {}
        counts = {"tank": 0, "healer": 0, "support": 0, "dps": 0}
        by_player: Dict[str, Dict[str, Any]] = {}
        for character in self.player_characters:
            role = self._classify_team_role(character)
            counts[role] = counts.get(role, 0) + 1
            owner = self.character_owner_map.get(character.character_id, {})
            player_id = owner.get("player_id") or "solo"
            player_name = owner.get("player_name") or "Solo"
            row = by_player.setdefault(player_id, {
                "player_id": player_id,
                "player_name": player_name,
                "tank": 0,
                "healer": 0,
                "support": 0,
                "dps": 0,
                "characters": 0,
            })
            row[role] = row.get(role, 0) + 1
            row["characters"] += 1

        ideal_ranges = {
            "tank": (3, 4),
            "healer": (3, 5),
            "support": (2, 4),
            "dps": (9, 12),
        }
        score = 100
        notes = []
        for role, (low, high) in ideal_ranges.items():
            value = counts.get(role, 0)
            if value < low:
                penalty = (low - value) * 12
                score -= penalty
                notes.append(f"{role}_short_{low - value}")
            elif value > high:
                penalty = (value - high) * 6
                score -= penalty
                notes.append(f"{role}_over_{value - high}")

        total = sum(counts.values())
        if total < 20:
            score -= (20 - total) * 8
            notes.append(f"roster_short_{20 - total}")

        score = max(0, min(100, score))
        if score >= 90:
            rating = "S"
        elif score >= 78:
            rating = "A"
        elif score >= 62:
            rating = "B"
        else:
            rating = "C"
        return {
            "score": score,
            "rating": rating,
            "counts": counts,
            "ideal": ideal_ranges,
            "notes": notes,
            "players": list(by_player.values()),
        }

    def _current_team_phase(self) -> Dict[str, Any]:
        if not self.team_phases:
            return {}
        phase = self.team_phases[0]
        for candidate in self.team_phases:
            if self.current_time >= candidate["start"]:
                phase = candidate
        return phase

    def _update_team_pressure(self, delta_time: float):
        if not self._is_team_dungeon() or not self.battle:
            return
        phase = self._current_team_phase()
        if phase:
            self.team_phase_index = int(phase["index"])
            self.team_phase_name = phase["name"]
            if self.team_phase_index != self.team_phase_reported_index:
                self.team_phase_reported_index = self.team_phase_index
                self.battle._log(
                    f"[Team Phase] {self.team_phase_name} started.",
                    "team_phase",
                    {"phase": phase, "role_profile": self.team_role_profile}
                )

        alive_players = [unit for unit in self.battle.player_units if unit.is_alive()]
        dead_players = max(0, len(self.battle.player_units) - len(alive_players))
        alive_enemies = [unit for unit in self.battle.enemy_units if unit.is_alive()]
        active_bosses = [
            unit for unit in alive_enemies
            if getattr(unit, "spawn_category", None) == "boss" and not getattr(unit, "mechanic_inactive", False)
        ]
        role_score = int((self.team_role_profile or {}).get("score", 70) or 70)
        role_buffer = max(0, role_score - 70) * 0.25
        raw_pressure = (
            float(phase.get("base_pressure", 0) if phase else 0)
            + len(alive_enemies) * 1.8
            + len(active_bosses) * 9.0
            + dead_players * 3.5
            - role_buffer
        )
        self.team_pressure = int(max(0, min(100, round(raw_pressure))))
        self.team_pressure_peak = max(self.team_pressure_peak, self.team_pressure)
        self.team_pressure_samples.append(self.team_pressure)

        if self.team_pressure >= 80 and self.current_time - self.team_last_pressure_tick >= 10.0:
            self.team_last_pressure_tick = self.current_time
            damage_ratio = 0.02 if self.team_pressure < 90 else 0.035
            total_damage = 0
            for unit in alive_players:
                damage = max(1, int(unit.max_health * damage_ratio))
                unit.take_damage(damage, 0)
                total_damage += damage
            event = {
                "time": round(self.current_time, 1),
                "pressure": self.team_pressure,
                "damage": total_damage,
                "phase": self.team_phase_name,
            }
            self.team_pressure_events.append(event)
            self.battle._log(
                f"[Team Pressure] pressure {self.team_pressure}, raid-wide damage {total_damage}.",
                "team_pressure",
                event
            )

    def get_team_status(self) -> Optional[Dict[str, Any]]:
        if not self._is_team_dungeon():
            return None
        phase = self._current_team_phase()
        if phase:
            self.team_phase_index = int(phase["index"])
            self.team_phase_name = phase["name"]
        sample_count = len(self.team_pressure_samples)
        average_pressure = (
            round(sum(self.team_pressure_samples) / sample_count, 1)
            if sample_count > 0 else 0
        )
        return {
            "phase_index": self.team_phase_index,
            "phase_name": self.team_phase_name,
            "phase_count": len(self.team_phases),
            "phase_reached": self.team_phase_index + 1 if self.team_phases else 0,
            "phases": self.team_phases,
            "pressure": self.team_pressure,
            "pressure_peak": self.team_pressure_peak,
            "pressure_average": average_pressure,
            "pressure_events": self.team_pressure_events[-8:],
            "role_profile": self.team_role_profile,
            "current_phase": phase,
        }

    def get_team_performance(self) -> Optional[Dict[str, Any]]:
        status = self.get_team_status()
        if not status:
            return None
        role_score = int(status.get("role_profile", {}).get("score", 0) or 0)
        pressure_peak = int(status.get("pressure_peak", 0) or 0)
        pressure_average = float(status.get("pressure_average", 0) or 0)
        phase_reached = int(status.get("phase_reached", 0) or 0)
        clear_bonus = 18 if self.is_successful else 0
        performance_score = (
            role_score * 0.35
            + max(0, 100 - pressure_peak) * 0.25
            + max(0, 100 - pressure_average) * 0.15
            + min(25, phase_reached * 6)
            + clear_bonus
        )
        performance_score = int(max(0, min(100, round(performance_score))))
        if performance_score >= 90:
            tier = "S"
        elif performance_score >= 78:
            tier = "A"
        elif performance_score >= 62:
            tier = "B"
        else:
            tier = "C"
        status["performance_score"] = performance_score
        status["reward_tier"] = tier
        status["success"] = bool(self.is_successful)
        return status
    
    def enter_dungeon(self):
        """进入副本"""
        self.state = DungeonBattleState.PREPARING
        print(f"进入副本：{self.dungeon.get_display_name()}")
    
    def prepare_character(
        self,
        character: Character,
        skill_slots: List[Dict[str, Any]] = None,
        equipment: Dict[str, Any] = None
    ):
        """
        准备角色（调整角色、技能槽部署、专属道具、装备）
        
        Args:
            character: 角色
            skill_slots: 技能槽配置
            equipment: 装备配置
        """
        # TODO: 实现角色准备逻辑（技能槽部署、装备等）
        pass
    
    def set_player_ready(self, player_id: str, is_ready: bool = True):
        """
        设置玩家准备状态
        
        Args:
            player_id: 玩家ID
            is_ready: 是否准备就绪
        """
        self.players_ready[player_id] = is_ready
        self._check_all_ready()
    
    def set_assist_mode(self, enabled: bool):
        """设置助战模式"""
        self.assist_enabled = enabled
    
    def _check_all_ready(self):
        """检查是否所有玩家都准备就绪"""
        if not self.is_multiplayer:
            # 单人模式：直接准备就绪
            self.all_players_ready = True
            return
        
        # 多人模式：检查所有玩家是否准备
        if all(self.players_ready.values()) and len(self.players_ready) > 0:
            self.all_players_ready = True
    
    def register_drop_callback(self, callback: Callable[[Dict[str, Any]], None]):
        """注册掉落事件回调（用于实时推送）"""
        self._drop_callback = callback
    
    def start_battle(self):
        """开始战斗"""
        if not self.all_players_ready:
            print("还有玩家未准备就绪")
            return
        
        self.state = DungeonBattleState.COUNTDOWN
        self.countdown_started = True
        self.countdown_time = 3.0
        print("3秒倒计时开始...")
    
    def update(self, delta_time: float):
        """
        更新副本战斗流程
        
        Args:
            delta_time: 时间增量（秒）
        """
        if self.state == DungeonBattleState.COUNTDOWN:
            # 倒计时
            self.countdown_time -= delta_time
            if self.countdown_time <= 0:
                self._start_actual_battle()
        
        elif self.state == DungeonBattleState.IN_BATTLE:
            # 战斗中
            if self.battle:
                self.battle.update(delta_time)
                self.current_time += delta_time
                self.duration = self.current_time
                
                # 生成怪物
                self._spawn_monsters()
                self._update_boss_mechanics()
                self._update_team_pressure(delta_time)
                
                # 检查是否超时
                if self.current_time >= self.dungeon.duration:
                    self._on_timeout()
                    return
                
                # 检查战斗状态
                if self.battle.state == BattleState.VICTORY:
                    if self._has_pending_spawns():
                        self.battle.state = BattleState.IN_PROGRESS
                    else:
                        self._on_battle_victory()
                elif self.battle.state == BattleState.DEFEAT:
                    self._on_battle_defeat()
    
    def _start_actual_battle(self):
        """开始实际战斗"""
        self.state = DungeonBattleState.IN_BATTLE
        self.start_time = time.time()
        self.current_time = 0.0
        
        # 创建战斗单位
        player_units = []
        for char in self.player_characters:
            unit = BattleUnit(char, is_player=True)
            owner_info = self.character_owner_map.get(char.character_id)
            if owner_info:
                unit.owner_info = owner_info
            else:
                unit.owner_info = {
                    "player_id": None,
                    "player_name": "单人挑战者"
                }
            player_units.append(unit)
        enemy_units = []  # 怪物将在生成时添加
        
        # 创建战斗
        battle_speed = BattleSpeed.X4 if self.can_use_4x else BattleSpeed.X1
        self.battle = Battle(
            player_units=player_units,
            enemy_units=enemy_units,
            max_duration=self.dungeon.duration + 1.0,
            battle_speed=battle_speed
        )
        
        # 设置敌人死亡回调
        self.battle.set_enemy_killed_callback(self._on_enemy_killed)
        
        self.battle.start()
        self._spawn_monsters()
        print("战斗开始！")
    
    def _spawn_monsters(self):
        """生成怪物"""
        # 获取需要生成的怪物（只生成在last_spawn_check_time和current_time之间的）
        spawns = self.monster_spawner.get_monster_spawns(
            self.current_time,
            self.last_spawn_check_time
        )
        
        for spawn in spawns:
            if spawn["type"] == "monster":
                # 生成小怪
                self._spawn_monster(spawn)
            elif spawn["type"] == "boss":
                # 生成Boss
                self._spawn_boss(spawn)
        
        # 更新上次检查时间
        self.last_spawn_check_time = self.current_time
    
    def _has_pending_spawns(self) -> bool:
        """是否还有未来波次，避免清完当前波后过早结束副本。"""
        for spawn_time in self.monster_spawner.spawn_times:
            if spawn_time > self.current_time:
                return True
        for boss_time in self.monster_spawner.boss_spawn_times:
            if boss_time > self.current_time:
                return True
        return False
    
    def _spawn_monster(self, spawn_info: Dict[str, Any]):
        """生成小怪"""
        from ..enemies.enemy_factory import EnemyFactory
        from ..enemies.enemy import EnemyType
        
        # 获取怪物类型
        monster_type_str = spawn_info.get("monster_type", "SINGLE")
        if monster_type_str in {"SINGLE", EnemyType.SINGLE, EnemyType.SINGLE.value}:
            enemy_type = EnemyType.SINGLE
        elif monster_type_str in {"GROUP_3", EnemyType.GROUP_3, EnemyType.GROUP_3.value}:
            enemy_type = EnemyType.GROUP_3
        elif monster_type_str in {"GROUP_5", EnemyType.GROUP_5, EnemyType.GROUP_5.value}:
            enemy_type = EnemyType.GROUP_5
        else:
            enemy_type = EnemyType.SINGLE
        
        # 生成怪物
        enemies = EnemyFactory.create_enemy(
            dungeon=self.dungeon,
            enemy_type=enemy_type,
            current_time=self.current_time,
            enemy_index=len([u for u in self.battle.enemy_units if not u.is_player])
        )
        
        # 添加到战斗
        for enemy in enemies:
            if self.battle:
                enemy.battle_unit.spawn_category = "monster"
                enemy.battle_unit.spawn_name = enemy.name
                enemy.battle_unit.exp_kill_unit_type = "single" if enemy_type == EnemyType.SINGLE else "group"
                enemy.battle_unit.exp_group_size = 1 if enemy_type == EnemyType.SINGLE else (3 if enemy_type == EnemyType.GROUP_3 else 5)
                self.battle.add_enemy_unit(enemy.battle_unit)
                print(f"生成怪物: {enemy.name}")
        
        # 注意：击杀统计在敌人死亡时更新，这里只是生成
    
    def _spawn_boss(self, spawn_info: Dict[str, Any]):
        """生成Boss"""
        from ..enemies.enemy_factory import EnemyFactory
        from ..enemies.boss import Boss, BossType
        from ..enemies.boss_mechanics import get_boss_mechanic_template
        from ..enemies.boss_skill_config import build_boss_skill_loadout

        configured_boss = (self.dungeon.monster_config or {}).get("boss_config") or {}
        boss_type_str = configured_boss.get("boss_type") or spawn_info.get("boss_type", "SINGLE")
        boss_type_enum = BossType.__members__.get(boss_type_str, BossType.SINGLE)
        mechanic = get_boss_mechanic_template(boss_type_str)
        boss_count = int(mechanic.get("boss_count", 1))
        group_id = f"{boss_type_str}_{int(self.current_time * 1000)}_{len(self.boss_mechanic_groups)}"
        group_units = []
        base_boss_index = len([
            unit for unit in self.battle.enemy_units
            if not unit.is_player and getattr(unit, "spawn_category", None) == "boss"
        ]) if self.battle else 0

        for role_index in range(boss_count):
            boss_enemy = EnemyFactory.create_boss(
                dungeon=self.dungeon,
                boss_type=boss_type_str,
                current_time=self.current_time,
                boss_index=base_boss_index + role_index
            )
            if boss_count > 1:
                boss_enemy.name = f"{boss_enemy.name}-{role_index + 1}"
                boss_enemy.character.name = boss_enemy.name

            loadout = build_boss_skill_loadout(
                boss_type_str,
                role_index,
                configured_boss.get("skill_slots")
            )
            boss_enemy.character.boss_skill_slots = loadout["skill_slots"]
            boss_enemy.character.boss_skill_library = loadout["skill_library"]

            boss = Boss(
                enemy=boss_enemy,
                boss_type=boss_type_enum,
                phases=[],
                special_skills=[]
            )

            if self.battle:
                unit = boss.enemy.battle_unit
                unit.spawn_category = "boss"
                unit.spawn_name = boss.enemy.name
                unit.boss_type_code = boss_type_str
                unit.boss_mechanic = {
                    "mechanic_id": mechanic.get("mechanic_id"),
                    "shared_health": bool(mechanic.get("shared_health")),
                    "mutual_strengthen": bool(mechanic.get("mutual_strengthen")),
                    "sequential_activation": bool(mechanic.get("sequential_activation")),
                    "skill_slot_total": loadout["total_slots"],
                    "active": (not bool(mechanic.get("sequential_activation"))) or role_index == 0,
                }
                unit.boss_group_id = group_id
                unit.mechanic_role_index = role_index
                unit.mechanic_inactive = bool(mechanic.get("sequential_activation")) and role_index > 0
                self.battle.add_enemy_unit(unit)
                group_units.append(unit)
                print(f"生成Boss: {boss.enemy.name} ({boss_type_enum.value})")

        if group_units:
            if mechanic.get("shared_health"):
                shared_max = sum(unit.max_health for unit in group_units)
                for unit in group_units:
                    unit.max_health = shared_max
                    unit.current_health = shared_max
                    unit._sync_legacy_health_fields()
            self.boss_mechanic_groups[group_id] = {
                "boss_type": boss_type_str,
                "mechanic": mechanic,
                "units": group_units,
                "shared_current": group_units[0].current_health if mechanic.get("shared_health") else None,
                "shared_max": group_units[0].max_health if mechanic.get("shared_health") else None,
                "last_health": {unit.character.character_id: unit.current_health for unit in group_units},
                "strengthened": set(),
                "active_index": 0,
                "active_reported_index": 0 if mechanic.get("sequential_activation") else None,
            }
            if self.battle:
                self.battle._log(
                    f"【Boss机制】{mechanic.get('description', boss_type_str)}",
                    "boss_mechanic",
                    {
                        "boss_type": boss_type_str,
                        "mechanic_id": mechanic.get("mechanic_id"),
                        "boss_count": len(group_units),
                    }
                )
                if mechanic.get("shared_health"):
                    self.battle._log(
                        f"【Boss机制】{len(group_units)}名Boss共享同一血量池。",
                        "boss_mechanic",
                        {"boss_type": boss_type_str, "shared_health": True}
                    )
                if mechanic.get("sequential_activation"):
                    self.battle._log(
                        f"【Boss机制】{group_units[0].character.name}进入主导状态，其余议会成员暂不行动。",
                        "boss_mechanic",
                        {"boss_type": boss_type_str, "active_index": 0}
                    )

        # 注意：bosses_killed是击杀数量，不是生成数量
        # 这里不增加，只有在Boss被击杀时才增加

    def _update_boss_mechanics(self):
        """Apply first-pass multi-boss mechanics."""
        for group in self.boss_mechanic_groups.values():
            mechanic = group.get("mechanic", {})
            units = group.get("units", [])
            if not units:
                continue

            if mechanic.get("shared_health"):
                lost = 0
                last_health = group.setdefault("last_health", {})
                for unit in units:
                    previous = last_health.get(unit.character.character_id, unit.current_health)
                    if unit.current_health < previous:
                        lost += previous - unit.current_health
                if lost > 0:
                    group["shared_current"] = max(0, int(group.get("shared_current") or 0) - lost)
                shared_current = int(group.get("shared_current") or 0)
                for unit in units:
                    unit.current_health = shared_current
                    unit._sync_legacy_health_fields()
                    last_health[unit.character.character_id] = shared_current

            if mechanic.get("mutual_strengthen"):
                strengthened = group.setdefault("strengthened", set())
                dead_count = sum(1 for unit in units if unit.is_dead())
                if dead_count > 0:
                    multiplier = float(mechanic.get("strengthen_multiplier", 1.5))
                    for unit in units:
                        if unit.is_alive() and unit.character.character_id not in strengthened:
                            unit.character.attack = int(unit.character.attack * multiplier)
                            unit.character.magic_attack = int(unit.character.magic_attack * multiplier)
                            unit.boss_mechanic["strengthened"] = True
                            strengthened.add(unit.character.character_id)
                            if self.battle:
                                self.battle._log(
                                    f"【Boss机制】{unit.character.name}因同伴倒下而强化，攻击能力提升。",
                                    "boss_mechanic",
                                    {
                                        "boss_type": group.get("boss_type"),
                                        "unit_id": unit.character.character_id,
                                        "multiplier": multiplier,
                                    }
                                )

            if mechanic.get("sequential_activation"):
                active_index = int(group.get("active_index", 0))
                while active_index < len(units) and units[active_index].is_dead():
                    active_index += 1
                group["active_index"] = active_index
                if (
                    active_index < len(units)
                    and active_index != group.get("active_reported_index")
                    and units[active_index].is_alive()
                ):
                    group["active_reported_index"] = active_index
                    if self.battle:
                        self.battle._log(
                            f"【Boss机制】{units[active_index].character.name}接替主导，开始行动。",
                            "boss_mechanic",
                            {
                                "boss_type": group.get("boss_type"),
                                "active_index": active_index,
                                "unit_id": units[active_index].character.character_id,
                            }
                        )
                for index, unit in enumerate(units):
                    is_active = index == active_index and unit.is_alive()
                    unit.mechanic_inactive = (not is_active) and unit.is_alive()
                    if unit.boss_mechanic:
                        unit.boss_mechanic["active"] = is_active

            for unit in units:
                if unit.is_dead() and not getattr(unit, "mechanic_death_reported", False):
                    self._on_enemy_killed(unit)
    
    def _on_battle_victory(self):
        """战斗胜利"""
        self.is_successful = True
        self.state = DungeonBattleState.COMPLETED
        self._calculate_rewards()
        self.state = DungeonBattleState.REWARD
        print("战斗胜利！")
    
    def _on_battle_defeat(self):
        """战斗失败"""
        self.is_successful = False
        self.state = DungeonBattleState.FAILED
        self._calculate_rewards()  # 即使失败也可能有奖励（坚持时间奖励）
        self.state = DungeonBattleState.REWARD
        print("战斗失败！")
    
    def _on_timeout(self):
        """战斗超时"""
        alive_enemies = [
            unit for unit in (self.battle.enemy_units if self.battle else [])
            if unit.is_alive()
        ]
        self.is_successful = len(alive_enemies) == 0 and not self._has_pending_spawns()
        self.state = DungeonBattleState.COMPLETED if self.is_successful else DungeonBattleState.FAILED
        self._calculate_rewards()
        self.state = DungeonBattleState.REWARD
        print("副本通过！" if self.is_successful else "副本超时，仍有敌方单位存活！")
    
    def _calculate_rewards(self):
        """计算奖励"""
        # 检查是否通关（击杀所有怪物）
        # 通过条件：坚持到时间结束
        # 通关条件：击杀所有怪物
        is_completed = self.is_successful
        
        self.rewards = self.reward_calculator.calculate_reward(
            dungeon=self.dungeon,
            duration=self.duration,
            monsters_killed=self.single_monsters_killed,
            groups_killed=self.group_monsters_killed,
            bosses_killed=self.bosses_killed,
            is_completed=is_completed,
            team_performance=self.get_team_performance()
        )
        self._append_reward_drops()
    
    def set_player_agree_4x(self, player_id: str, agree: bool = True):
        """
        设置玩家是否同意4倍速
        
        Args:
            player_id: 玩家ID
            agree: 是否同意
        """
        self.players_agree_4x[player_id] = agree
        self._check_4x_speed()
    
    def _check_4x_speed(self):
        """检查是否可以使用4倍速"""
        if not self.is_multiplayer:
            return
        
        # 检查所有玩家是否都同意
        required_players = set(self.players_ready.keys())
        if required_players and all(self.players_agree_4x.get(player_id, False) for player_id in required_players):
            self.can_use_4x = True
            if self.battle:
                self.battle.set_battle_speed(BattleSpeed.X4)
        else:
            self.can_use_4x = False
    
    def finish_reward(self):
        """完成奖励结算"""
        self.state = DungeonBattleState.FINISHED
        
        # 记录连续战斗结果
        if self.continuous_battle_count > 1:
            self.continuous_battle_results.append({
                "duration": self.duration,
                "rewards": self.rewards.to_dict() if self.rewards else {},
                "is_completed": self.state == DungeonBattleState.COMPLETED
            })
    
    def _on_enemy_killed(self, enemy_unit: BattleUnit):
        """敌人被击杀时的回调"""
        if getattr(enemy_unit, "mechanic_death_reported", False):
            return
        enemy_unit.mechanic_death_reported = True
        # 更新击杀统计
        character_name = enemy_unit.character.name
        
        if "Boss" in character_name:
            # Boss被击杀
            self.bosses_killed += 1
            print(f"Boss被击杀！当前Boss击杀数: {self.bosses_killed}")
        elif "群体" in character_name:
            self.monsters_killed += 1
            self.group_monsters_killed += 1
        else:
            # 单体小怪被击杀
            self.monsters_killed += 1
            self.single_monsters_killed += 1
        
        self._maybe_generate_runtime_drop(enemy_unit)
    
    def can_retry(self) -> bool:
        """检查是否可以重试"""
        return self.state == DungeonBattleState.FINISHED
    
    def set_continuous_battle_count(self, count: int):
        """设置连续战斗次数"""
        self.continuous_battle_count = count
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "dungeon_id": self.dungeon.dungeon_id,
            "state": self.state.value,
            "duration": self.duration,
            "monsters_killed": self.monsters_killed,
            "single_monsters_killed": self.single_monsters_killed,
            "group_monsters_killed": self.group_monsters_killed,
            "bosses_killed": self.bosses_killed,
            "rewards": self.rewards.to_dict() if self.rewards else {},
            "is_completed": self.state == DungeonBattleState.COMPLETED,
            "team_status": self.get_team_status()
        }
    
    def get_damage_summary(self) -> Dict[str, Any]:
        """Return combat damage grouped by character and player owner."""
        if not self.battle:
            return {
                "total_damage": 0,
                "characters": [],
                "players": [],
            }

        battle_summary = self.battle.get_damage_summary()
        player_buckets: Dict[str, Dict[str, Any]] = {}
        characters = []
        fallback_owner = self._drop_assignment_order[0] if self._drop_assignment_order else self._get_owner_descriptor(None)

        for character_row in battle_summary.get("characters", []):
            character_payload = dict(character_row)
            owner = self.character_owner_map.get(character_payload.get("character_id")) or fallback_owner
            player_id = owner.get("player_id") or "solo"
            player_name = owner.get("player_name") or "玩家"
            character_payload["player_id"] = player_id
            character_payload["player_name"] = player_name
            characters.append(character_payload)

            bucket = player_buckets.setdefault(player_id, {
                "player_id": player_id,
                "player_name": player_name,
                "total_damage": 0,
                "hits": 0,
                "crit_count": 0,
                "characters": [],
            })
            bucket["total_damage"] += int(character_payload.get("total_damage", 0) or 0)
            bucket["hits"] += int(character_payload.get("hits", 0) or 0)
            bucket["crit_count"] += int(character_payload.get("crit_count", 0) or 0)
            bucket["characters"].append(character_payload)

        players = list(player_buckets.values())
        players.sort(key=lambda item: item.get("total_damage", 0), reverse=True)
        return {
            "total_damage": battle_summary.get("total_damage", 0),
            "characters": characters,
            "players": players,
        }

    def get_drop_summary(self) -> Dict[str, Any]:
        """获取掉落汇总（用于结算与前端展示）"""
        player_summary = []
        for bucket in self.player_drop_buckets.values():
            player_summary.append({
                "player_id": bucket.get("player_id"),
                "player_name": bucket.get("player_name"),
                "total_items": bucket["totals"]["items"],
                "total_quantity": bucket["totals"]["quantity"],
                "drops": bucket["drops"]
            })
        return {
            "events": self.drop_events,
            "players": player_summary,
            "stats": {
                "total_events": len(self.drop_events),
                "rarity": dict(self._rarity_counts),
                "types": dict(self._type_counts)
            },
            "assist": {
                "enabled": self.assist_enabled,
                "currency_per_drop": AssistRewardPolicy.REWARD_PER_DROP if self.assist_enabled else 0,
                "total_currency": self.assist_currency_total
            }
        }
    
    def _get_owner_descriptor(self, player_id: Optional[str]) -> Dict[str, Any]:
        if player_id and player_id in self.player_display_map:
            return self.player_display_map[player_id]
        if player_id:
            return {"player_id": player_id, "player_name": "未知玩家"}
        return {"player_id": None, "player_name": "未分配"}
    
    def _get_next_owner_descriptor(self) -> Dict[str, Any]:
        if not self._drop_assignment_order:
            return self._get_owner_descriptor(None)
        owner = self._drop_assignment_order[self._drop_assignment_index % len(self._drop_assignment_order)]
        self._drop_assignment_index += 1
        return owner
    
    def _record_drop_event(
        self,
        item_payload: Dict[str, Any],
        owner: Optional[Dict[str, Any]] = None,
        source: str = "reward",
        is_real_time: bool = False
    ) -> Dict[str, Any]:
        """将掉落事件加入队列并触发回调"""
        self._drop_sequence += 1
        owner_descriptor = owner or self._get_next_owner_descriptor()
        if self.assist_enabled and source in ("monster", "boss"):
            item_payload = AssistRewardPolicy.build_reward_payload(owner_descriptor.get("player_name", "助战者"))
            self.assist_currency_total += AssistRewardPolicy.REWARD_PER_DROP
        entry = {
            "sequence": self._drop_sequence,
            "drop_id": str(uuid.uuid4()),
            "item": item_payload,
            "owner": owner_descriptor,
            "source": source,
            "is_real_time": is_real_time
        }
        self.drop_events.append(entry)
        
        owner_key = owner_descriptor.get("player_id") or "__unassigned__"
        bucket = self.player_drop_buckets.setdefault(owner_key, {
            "player_id": owner_descriptor.get("player_id"),
            "player_name": owner_descriptor.get("player_name"),
            "drops": [],
            "totals": {"items": 0, "quantity": 0}
        })
        bucket["drops"].append(entry)
        bucket["totals"]["items"] += 1
        bucket["totals"]["quantity"] += item_payload.get("quantity", 1)
        
        self._rarity_counts[item_payload.get("rarity", "unknown")] += 1
        self._type_counts[item_payload.get("item_type", "unknown")] += 1
        
        if self._drop_callback:
            self._drop_callback(entry)
        
        return entry
    
    def _convert_item_to_payload(self, item: DungeonItem) -> Dict[str, Any]:
        data = item.to_dict()
        item_type = "equipment" if item.item_type == ItemType.ACCESSORY else "prop"
        return {
            "item_id": data["item_id"],
            "name": data["name"],
            "item_type": item_type,
            "quantity": 1,
            "rarity": data.get("rarity", "rare"),
            "quality": data.get("quality", "A"),
            "icon": data.get("icon"),
            "classifications": data.get("classifications", {}),
            "stats": data.get("attribute_bonus", {}),
            "description": data.get("description")
        }
    
    def _build_material_payload(self, category: str, quantity: int) -> Dict[str, Any]:
        attribute_value = self.dungeon.attribute_type.value
        attr_slug = ATTRIBUTE_ID_MAP.get(self.dungeon.attribute_type, self.dungeon.attribute_type.name.lower())
        name_map = {
            "exclusive_material": f"{attribute_value}系专属材料",
            "equipment_material": f"{attribute_value}系套装材料",
            "illustration_piece": "立绘碎片"
        }
        rarity_map = {
            "exclusive_material": "epic",
            "equipment_material": "legendary",
            "illustration_piece": "rare"
        }
        quality_map = {
            "exclusive_material": "A",
            "equipment_material": "S",
            "illustration_piece": "B"
        }
        return {
            "item_id": f"{attr_slug}_{category}",
            "name": name_map.get(category, "未知材料"),
            "item_type": "material",
            "quantity": quantity,
            "rarity": rarity_map.get(category, "rare"),
            "quality": quality_map.get(category, "A"),
            "icon": f"/assets/drops/{attr_slug}_{category}.png",
            "classifications": {
                "category": category,
                "attribute": attribute_value,
                "set": f"{attribute_value}系列"
            },
            "stats": {},
            "description": "副本结算奖励"
        }
    
    def _distribute_material_reward(self, category: str, total_quantity: int):
        if total_quantity <= 0:
            return
        owners = self._drop_assignment_order or [{"player_id": None, "player_name": "未分配"}]
        shares = distribute_quantity_evenly(total_quantity, len(owners))
        for owner, share in zip(owners, shares):
            if share <= 0:
                continue
            payload = self._build_material_payload(category, share)
            self._record_drop_event(payload, owner=owner, source="reward", is_real_time=False)
    
    def _append_reward_drops(self):
        if not self.rewards or self._reward_drops_committed:
            return
        reward_dict = self.rewards.to_dict()
        reward_type = reward_dict.get("reward_type")
        detail = reward_dict.get("rewards", {})
        if reward_type == "exclusive_material":
            self._distribute_material_reward("exclusive_material", int(detail.get("material_count", 0)))
        elif reward_type == "equipment_material":
            self._distribute_material_reward("equipment_material", int(detail.get("material_count", 0)))
        elif reward_type == "illustration_piece":
            self._distribute_material_reward("illustration_piece", int(detail.get("illustration_pieces", 0)))
        self._reward_drops_committed = True
    
    def _maybe_generate_runtime_drop(self, enemy_unit: BattleUnit):
        monster_type = getattr(enemy_unit, "spawn_category", "monster")
        drop = self.item_manager.drop_item_on_monster_kill("boss" if monster_type == "boss" else "monster")
        if not drop:
            return
        payload = self._convert_item_to_payload(drop)
        self._record_drop_event(payload, source=monster_type, is_real_time=True)


class DungeonBattle:
    """副本战斗（简化版，用于快速集成）"""
    
    @staticmethod
    def create_dungeon_battle(
        dungeon: Dungeon,
        player_characters: List[Character],
        is_multiplayer: bool = False
    ) -> DungeonBattleFlow:
        """
        创建副本战斗
        
        Args:
            dungeon: 副本
            player_characters: 玩家角色列表
            is_multiplayer: 是否多人模式
            
        Returns:
            副本战斗流程
        """
        return DungeonBattleFlow(dungeon, player_characters, is_multiplayer)
