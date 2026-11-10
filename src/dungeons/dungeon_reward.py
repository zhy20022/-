"""Dungeon reward calculation."""

from typing import Any, Dict
from .dungeon import Dungeon, DungeonType


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
                duration, bosses_killed, reward_config, is_completed
            )
        elif dungeon.dungeon_type == DungeonType.TEAM:
            reward = RewardCalculator._calculate_equipment_material_reward(
                duration, bosses_killed, reward_config, is_completed, team_performance
            )
        elif dungeon.dungeon_type == DungeonType.SERVER_BOSS:
            reward = RewardCalculator._calculate_illustration_reward(reward_config)
        else:
            return DungeonReward("unknown", {})

        if dungeon.dungeon_type in (DungeonType.SQUAD, DungeonType.TEAM):
            return reward
        return RewardCalculator._apply_reward_multiplier(reward, dungeon.get_reward_multiplier())

    @staticmethod
    def _apply_reward_multiplier(reward: DungeonReward, multiplier: float) -> DungeonReward:
        if multiplier == 1.0:
            return reward

        scaled = {}
        unscaled_keys = {
            "time_ratio",
            "duration_threshold",
            "gold",
            "kill_character_exp",
            "character_exp_per_single_kill",
            "character_exp_per_five_group_kills",
        }
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
        single_kill_exp = float(
            reward_config.get("character_exp_per_single_kill", reward_config.get("character_exp_per_kill", 0))
        )
        group_kill_exp = float(reward_config.get("character_exp_per_five_group_kills", 1))
        gold = int(reward_config.get("gold", 0) or 0)

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
        single_kill_character_exp = monsters_killed * single_kill_exp
        group_kill_character_exp = (groups_killed // 5) * group_kill_exp
        kill_character_exp = int(round(single_kill_character_exp + group_kill_character_exp))

        return DungeonReward("experience", {
            "exp": time_exp,
            "gold": gold if threshold_ratio >= 1.0 else 0,
            "time_exp": time_exp,
            "base_exp": full_exp,
            "full_exp": full_exp,
            "time_ratio": threshold_ratio,
            "duration_threshold": threshold_seconds,
            "kill_character_exp": kill_character_exp,
            "single_monsters_killed": monsters_killed,
            "group_monsters_killed": groups_killed,
            "character_exp_per_single_kill": single_kill_exp,
            "character_exp_per_five_group_kills": group_kill_exp,
        })

    @staticmethod
    def _calculate_exclusive_material_reward(
        duration: float,
        bosses_killed: int,
        reward_config: Dict[str, Any],
        is_completed: bool = False
    ) -> DungeonReward:
        boss_material = max(0, int(bosses_killed))
        clear_bonus = 2 if is_completed and boss_material else 0
        material_count = boss_material + clear_bonus

        return DungeonReward("exclusive_material", {
            "material_count": material_count,
            "time_reward": 0,
            "boss_reward": boss_material,
            "clear_bonus": clear_bonus,
        })

    @staticmethod
    def _calculate_equipment_material_reward(
        duration: float,
        bosses_killed: int,
        reward_config: Dict[str, Any],
        is_completed: bool = False,
        team_performance: Dict[str, Any] = None
    ) -> DungeonReward:
        boss_material = max(0, int(bosses_killed))
        clear_bonus = 2 if is_completed and boss_material else 0
        return DungeonReward("equipment_material", {
            "material_count": boss_material + clear_bonus,
            "time_reward": 0,
            "boss_drops": boss_material,
            "clear_bonus": clear_bonus,
        })

    @staticmethod
    def _calculate_illustration_reward(reward_config: Dict[str, Any]) -> DungeonReward:
        return DungeonReward("illustration_piece", {
            "illustration_pieces": 1,
            "reward_type": "server_wide"
        })
