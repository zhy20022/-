"""
副本数据库
存储所有副本的定义数据
"""

import json
from copy import deepcopy
from pathlib import Path
from typing import Dict, List, Optional

from .dungeon import DIFFICULTY_CONFIG, Dungeon, DungeonDifficulty, DungeonType
from ..attributes.attribute import AttributeType


EXPERIENCE_REWARD_BY_DIFFICULTY = {
    DungeonDifficulty.NORMAL: 531,
    DungeonDifficulty.HARD: 1381,
    DungeonDifficulty.NIGHTMARE: 2960,
}

BOSS_CONFIG_FILE = Path(__file__).resolve().parents[2] / "data" / "boss_configs.json"


class DungeonDatabase:
    """副本数据库"""

    def __init__(self):
        self.dungeons: Dict[str, Dungeon] = {}
        self._initialize_dungeons()
        self._load_saved_boss_configs()

    def _initialize_dungeons(self):
        attributes = [
            AttributeType.WATER,
            AttributeType.EARTH,
            AttributeType.THUNDER,
            AttributeType.WIND,
            AttributeType.FIRE,
            AttributeType.WOOD,
            AttributeType.LIGHT,
            AttributeType.DARK,
        ]

        attr_name_map = {
            AttributeType.FIRE: "火",
            AttributeType.WOOD: "木",
            AttributeType.WIND: "风",
            AttributeType.WATER: "水",
            AttributeType.EARTH: "土",
            AttributeType.THUNDER: "雷",
            AttributeType.LIGHT: "光",
            AttributeType.DARK: "暗",
        }

        attr_id_map = {
            AttributeType.FIRE: "fire",
            AttributeType.WOOD: "wood",
            AttributeType.WIND: "wind",
            AttributeType.WATER: "water",
            AttributeType.EARTH: "earth",
            AttributeType.THUNDER: "lightning",
            AttributeType.LIGHT: "holy",
            AttributeType.DARK: "shadow",
        }

        for attr in attributes:
            attr_name = attr_name_map[attr]
            attr_id = attr_id_map[attr]

            self._add_difficulty_variants(
                base_dungeon_id=f"{attr_id}_type_single_001",
                name=f"{attr_name}系经验本",
                attribute_type=attr,
                dungeon_type=DungeonType.SINGLE,
                description=f"{attr_name}系角色进行升级、产出{attr_name}属性经验",
                duration=60.0,
                reward_config={
                    "type": "experience",
                    "base_exp": 10,
                    "half_exp": 5,
                    "kill_exp": 0.1,
                },
            )

            self._add_difficulty_variants(
                base_dungeon_id=f"{attr_id}_type_squad_001",
                name=f"{attr_name}系专属道具本",
                attribute_type=attr,
                dungeon_type=DungeonType.SQUAD,
                description=f"{attr_name}系角色刷专属道具、产出{attr_name}属性专属道具材料",
                duration=120.0,
                reward_config={
                    "type": "exclusive_material",
                    "base_material": 20,
                    "rewards": {
                        30: 0.1,
                        60: 0.2,
                        90: 0.5,
                        120: 1.0,
                    },
                    "boss_reward": 0.25,
                },
            )

            self._add_difficulty_variants(
                base_dungeon_id=f"{attr_id}_type_team_001",
                name=f"{attr_name}系装备本",
                attribute_type=attr,
                dungeon_type=DungeonType.TEAM,
                description=f"{attr_name}系角色刷当前版本装备、产出{attr_name}属性装备材料",
                duration=180.0,
                reward_config={
                    "type": "equipment_material",
                    "base_material": 1,
                    "boss_drop_rate": 0.05,
                    "boss_reward": 1,
                },
            )

            self._add_difficulty_variants(
                base_dungeon_id=f"{attr_id}_type_server_001",
                name=f"{attr_name}系立绘本",
                attribute_type=attr,
                dungeon_type=DungeonType.SERVER_BOSS,
                description="解锁角色立绘、产出立绘拼图碎片",
                duration=180.0,
                reward_config={
                    "type": "illustration_piece",
                    "reward_type": "server_wide",
                },
            )

    def _add_difficulty_variants(
        self,
        base_dungeon_id: str,
        name: str,
        attribute_type: AttributeType,
        dungeon_type: DungeonType,
        description: str,
        duration: float,
        reward_config: Dict,
        monster_config: Optional[Dict] = None,
    ):
        for difficulty in DungeonDifficulty:
            config = DIFFICULTY_CONFIG[difficulty]
            dungeon_id = (
                base_dungeon_id
                if difficulty == DungeonDifficulty.NORMAL
                else f"{base_dungeon_id}_{config['key']}"
            )
            variant_reward = deepcopy(reward_config)
            if variant_reward.get("type") == "experience":
                final_exp = EXPERIENCE_REWARD_BY_DIFFICULTY[difficulty]
                variant_reward["base_exp"] = round(final_exp / config["reward_multiplier"], 2)
                variant_reward.pop("half_exp", None)
                variant_reward.pop("kill_exp", None)
                variant_reward["character_exp_per_kill"] = round((final_exp * 0.003) / config["reward_multiplier"], 2)
                variant_reward["target_full_clear_exp"] = final_exp
            variant_reward["reward_multiplier"] = config["reward_multiplier"]
            variant_monster = deepcopy(monster_config or {})
            variant_monster["stat_multiplier"] = config["monster_multiplier"]
            display_name = name if difficulty == DungeonDifficulty.NORMAL else f"{name}·{difficulty.value}"
            self.dungeons[dungeon_id] = Dungeon(
                dungeon_id=dungeon_id,
                name=display_name,
                attribute_type=attribute_type,
                dungeon_type=dungeon_type,
                description=description,
                duration=duration,
                reward_config=variant_reward,
                monster_config=variant_monster,
                difficulty=difficulty,
                base_dungeon_id=base_dungeon_id,
            )

    def _load_saved_boss_configs(self):
        if not BOSS_CONFIG_FILE.exists():
            return
        try:
            with BOSS_CONFIG_FILE.open("r", encoding="utf-8") as config_file:
                saved_configs = json.load(config_file)
        except (OSError, json.JSONDecodeError):
            return

        for dungeon_id, boss_config in saved_configs.items():
            dungeon = self.dungeons.get(dungeon_id)
            if dungeon and isinstance(boss_config, dict):
                dungeon.monster_config["boss_config"] = deepcopy(boss_config)

    def save_boss_config(self, dungeon_id: str, boss_config: Dict) -> Optional[Dungeon]:
        dungeon = self.get_dungeon(dungeon_id)
        if not dungeon:
            return None

        dungeon.monster_config["boss_config"] = deepcopy(boss_config)
        saved_configs: Dict[str, Dict] = {}
        if BOSS_CONFIG_FILE.exists():
            try:
                with BOSS_CONFIG_FILE.open("r", encoding="utf-8") as config_file:
                    saved_configs = json.load(config_file)
            except (OSError, json.JSONDecodeError):
                saved_configs = {}

        BOSS_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        saved_configs[dungeon_id] = deepcopy(boss_config)
        with BOSS_CONFIG_FILE.open("w", encoding="utf-8") as config_file:
            json.dump(saved_configs, config_file, ensure_ascii=False, indent=2)

        return dungeon

    def get_dungeon(self, dungeon_id: str) -> Optional[Dungeon]:
        return self.dungeons.get(dungeon_id)

    def get_dungeons_by_attribute(
        self,
        attribute_type: AttributeType,
        include_difficulties: bool = False,
    ) -> List[Dungeon]:
        return [
            dungeon for dungeon in self.dungeons.values()
            if dungeon.attribute_type == attribute_type
            and (include_difficulties or dungeon.difficulty == DungeonDifficulty.NORMAL)
        ]

    def get_dungeons_by_type(
        self,
        dungeon_type: DungeonType,
        include_difficulties: bool = False,
    ) -> List[Dungeon]:
        return [
            dungeon for dungeon in self.dungeons.values()
            if dungeon.dungeon_type == dungeon_type
            and (include_difficulties or dungeon.difficulty == DungeonDifficulty.NORMAL)
        ]

    def get_all_dungeons(self, include_difficulties: bool = False) -> List[Dungeon]:
        if include_difficulties:
            return list(self.dungeons.values())
        return [
            dungeon for dungeon in self.dungeons.values()
            if dungeon.difficulty == DungeonDifficulty.NORMAL
        ]


_dungeon_database = None


def get_dungeon_database() -> DungeonDatabase:
    global _dungeon_database
    if _dungeon_database is None:
        _dungeon_database = DungeonDatabase()
    return _dungeon_database


def get_dungeon_by_id(dungeon_id: str) -> Optional[Dungeon]:
    return get_dungeon_database().get_dungeon(dungeon_id)


def get_all_dungeons(include_difficulties: bool = False) -> List[Dungeon]:
    return get_dungeon_database().get_all_dungeons(include_difficulties=include_difficulties)


def get_dungeon(dungeon_id: str) -> Optional[Dungeon]:
    return get_dungeon_by_id(dungeon_id)


def save_dungeon_boss_config(dungeon_id: str, boss_config: Dict) -> Optional[Dungeon]:
    return get_dungeon_database().save_boss_config(dungeon_id, boss_config)
