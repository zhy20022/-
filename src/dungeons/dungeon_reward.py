"""Dungeon reward calculation."""

from typing import Any, Dict
from .dungeon import Dungeon, DungeonType
import random


class DungeonReward:
    """A calculated dungeon reward payload."""

    def __init__(
        self,
        reward_type: str,
        rewards: Dict[str, Any] = None
    ):
        self.reward_type = reward_type
        self.rewards = rewards or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "reward_type": self.reward_type,
            "rewards": self.rewards
        }


class RewardCalculator:
    """Calculates dungeon rewards from battle results."""

    @staticmethod
    def calculate_reward(
        dungeon: Dungeon,
        duration: float,
        monsters_killed: int,
        groups_killed: int = 0,
        bosses_killed: int = 0,
        is_completed: bool = False,
        team_performance: Dict[str, Any] = None
    ) -> DungeonReward:
        reward_config = dungeon.reward_config

        if dungeon.dungeon_type == DungeonType.SINGLE:
            reward = RewardCalculator._calculate_experience_reward(
                duration, monsters_killed, groups_killed, reward_config, is_completed
            )
        elif dungeon.dungeon_type == DungeonType.SQUAD:
            reward = RewardCalculator._calculate_exclusive_material_reward(
                duration, bosses_killed, reward_config
            )
        elif dungeon.dungeon_type == DungeonType.TEAM:
            reward = RewardCalculator._calculate_equipment_material_reward(
                duration, bosses_killed, reward_config, is_completed, team_performance
            )
        elif dungeon.dungeon_type == DungeonType.SERVER_BOSS:
            reward = RewardCalculator._calculate_illustration_reward(reward_config)
        else:
            return DungeonReward("unknown", {})

        return RewardCalculator._apply_reward_multiplier(reward, dungeon.get_reward_multiplier())

    @staticmethod
    def _apply_reward_multiplier(reward: DungeonReward, multiplier: float) -> DungeonReward:
        if multiplier == 1.0:
            return reward

        scaled = {}
        unscaled_keys = {"time_ratio", "duration_threshold"}
        for key, value in reward.rewards.items():
            if key in unscaled_keys:
                scaled[key] = value
            elif isinstance(value, bool):
                scaled[key] = value
            elif isinstance(value, int):
                scaled[key] = max(1, int(round(value * multiplier))) if value > 0 else 0
            elif isinstance(value, float):
                scaled[key] = round(value * multiplier, 2)
            else:
                scaled[key] = value
        scaled["difficulty_multiplier"] = multiplier
        return DungeonReward(reward.reward_type, scaled)

    @staticmethod
    def _calculate_experience_reward(
        duration: float,
        monsters_killed: int,
        groups_killed: int,
        reward_config: Dict[str, Any],
        is_completed: bool = False
    ) -> DungeonReward:
        full_exp = reward_config.get("base_exp", 531)
        character_exp_per_kill = reward_config.get("character_exp_per_kill", 0)

        threshold_ratio = 0.0
        threshold_seconds = 0
        if is_completed or duration >= 60.0:
            threshold_ratio = 1.0
            threshold_seconds = 60
        elif duration >= 45.0:
            threshold_ratio = 0.65
            threshold_seconds = 45
        elif duration >= 30.0:
            threshold_ratio = 0.40
            threshold_seconds = 30
        elif duration >= 15.0:
            threshold_ratio = 0.15
            threshold_seconds = 15

        time_exp = round(full_exp * threshold_ratio, 2)
        kill_units = monsters_killed + (groups_killed // 5)
        kill_character_exp = round(kill_units * character_exp_per_kill, 2)

        return DungeonReward("experience", {
            "exp": time_exp,
            "time_exp": time_exp,
            "base_exp": full_exp,
            "full_exp": full_exp,
            "time_ratio": threshold_ratio,
            "duration_threshold": threshold_seconds,
            "kill_character_exp": kill_character_exp,
            "character_exp_per_kill": character_exp_per_kill
        })

    @staticmethod
    def _calculate_exclusive_material_reward(
        duration: float,
        bosses_killed: int,
        reward_config: Dict[str, Any]
    ) -> DungeonReward:
        base_material = reward_config.get("base_material", 20)
        rewards = reward_config.get("rewards", {})
        boss_reward_ratio = reward_config.get("boss_reward", 0.25)

        material_count = 0
        if duration >= 120.0:
            material_count += int(base_material * rewards.get(120, 1.0))
        elif duration >= 90.0:
            material_count += int(base_material * rewards.get(90, 0.5))
        elif duration >= 60.0:
            material_count += int(base_material * rewards.get(60, 0.2))
        elif duration >= 30.0:
            material_count += int(base_material * rewards.get(30, 0.1))

        boss_material = int(base_material * boss_reward_ratio)
        material_count += bosses_killed * boss_material

        return DungeonReward("exclusive_material", {
            "material_count": material_count,
            "time_reward": material_count - (bosses_killed * boss_material),
            "boss_reward": bosses_killed * boss_material
        })

    @staticmethod
    def _calculate_equipment_material_reward(
        duration: float,
        bosses_killed: int,
        reward_config: Dict[str, Any],
        is_completed: bool = False,
        team_performance: Dict[str, Any] = None
    ) -> DungeonReward:
        base_material = reward_config.get("base_material", 1)
        boss_drop_rate = reward_config.get("boss_drop_rate", 0.05)
        team_performance = team_performance or {}

        material_count = 0
        if duration >= 180.0:
            material_count += base_material

        for _ in range(bosses_killed):
            if random.random() < boss_drop_rate:
                material_count += 1

        phase_reached = int(team_performance.get("phase_reached", 0) or 0)
        role_score = int(team_performance.get("role_profile", {}).get("score", 0) or 0)
        pressure_peak = int(team_performance.get("pressure_peak", 0) or 0)
        reward_tier = str(team_performance.get("reward_tier") or "C")
        clear_bonus = base_material * 2 if is_completed else 0
        phase_bonus = max(0, phase_reached - 1) * base_material
        role_bonus = base_material if role_score >= 85 else 0
        pressure_bonus = base_material if is_completed and pressure_peak and pressure_peak <= 75 else 0
        tier_bonus = {"S": 3, "A": 2, "B": 1}.get(reward_tier, 0) * base_material
        material_count += clear_bonus + phase_bonus + role_bonus + pressure_bonus + tier_bonus

        return DungeonReward("equipment_material", {
            "material_count": material_count,
            "time_reward": base_material if duration >= 180.0 else 0,
            "boss_drops": material_count - (base_material if duration >= 180.0 else 0) - clear_bonus - phase_bonus - role_bonus - pressure_bonus - tier_bonus,
            "clear_bonus": clear_bonus,
            "phase_bonus": phase_bonus,
            "role_bonus": role_bonus,
            "pressure_bonus": pressure_bonus,
            "tier_bonus": tier_bonus,
            "reward_tier": reward_tier,
            "team_performance": team_performance
        })

    @staticmethod
    def _calculate_illustration_reward(reward_config: Dict[str, Any]) -> DungeonReward:
        return DungeonReward("illustration_piece", {
            "illustration_pieces": 1,
            "reward_type": "server_wide"
        })
