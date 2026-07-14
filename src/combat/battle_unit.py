"""
Battle unit.

The combat system now uses one HP pool. Legacy physical/magical HP fields are
kept as aliases so older tests and API consumers do not break while the UI is
moved to the single-health display.
"""

from enum import Enum
from typing import Any, Dict

from ..characters.character import Character


class HealthType(Enum):
    """Legacy health categories kept for compatibility."""

    PHYSICAL = "物理血量"
    MAGICAL = "魔法血量"


class BattleUnit:
    """A combat participant."""

    def __init__(self, character: Character, is_player: bool = True):
        self.character = character
        self.is_player = is_player

        self._init_health()
        self.current_energy = 100
        self.threat_value: Dict[str, float] = {}

        self.status_manager = None
        self.skill_manager = None
        self.ai_system = None
        self.exclusive_weapon_state = {"last_cast_time": -999.0}

        self._initialize_skills()

    def _initialize_skills(self):
        """Initialize skill manager and learned skills."""
        from ..skills.skill_config import SkillConfig
        from .skill_system import SkillManager

        if self.character.skill_learning_system is None:
            self.character.skill_learning_system = SkillConfig.initialize_character_skills(self.character)

        if self.skill_manager is None:
            self.skill_manager = SkillManager(self)

    def _init_health(self):
        """Initialize the single HP pool."""
        self.max_health = max(int(getattr(self.character, "hp", 1) or 1), 1)
        self.current_health = self.max_health
        self._sync_legacy_health_fields()

    def _sync_legacy_health_fields(self):
        """Expose old dual-HP attributes as single-HP compatibility aliases."""
        self.max_physical_health = self.max_health
        self.current_physical_health = self.current_health
        self.max_magical_health = 0
        self.current_magical_health = 0

    def take_damage(self, physical_damage: int, magical_damage: int):
        """Apply all incoming damage to the single HP pool."""
        total_damage = max(0, int(physical_damage or 0)) + max(0, int(magical_damage or 0))
        self.current_health = max(0, self.current_health - total_damage)
        self._sync_legacy_health_fields()

    def heal(self, physical_heal: int, magical_heal: int):
        """Restore HP in the single HP pool."""
        total_heal = max(0, int(physical_heal or 0)) + max(0, int(magical_heal or 0))
        self.current_health = min(self.max_health, self.current_health + total_heal)
        self._sync_legacy_health_fields()

    def is_alive(self) -> bool:
        """A unit is alive while its single HP pool is above zero."""
        return self.current_health > 0

    def is_dead(self) -> bool:
        return not self.is_alive()

    def get_health_percentage(self) -> Dict[HealthType, float]:
        """Return legacy percentage map."""
        return {
            HealthType.PHYSICAL: self.get_total_health_percentage(),
            HealthType.MAGICAL: 0,
        }

    def get_total_health_percentage(self) -> float:
        return self.current_health / self.max_health if self.max_health > 0 else 0

    def add_threat(self, enemy_id: str, threat_amount: float):
        if enemy_id not in self.threat_value:
            self.threat_value[enemy_id] = 0
        self.threat_value[enemy_id] += threat_amount

    def get_threat(self, enemy_id: str) -> float:
        return self.threat_value.get(enemy_id, 0)

    def decay_threat(self, decay_rate: float = 0.95):
        for enemy_id in self.threat_value:
            self.threat_value[enemy_id] *= decay_rate

    def to_dict(self) -> Dict[str, Any]:
        skill_slots = None
        if self.skill_manager:
            skill_slots = {
                "low": [skill.to_dict() for skill in self.skill_manager.low_tier_slots.skills],
                "mid": [skill.to_dict() for skill in self.skill_manager.mid_tier_slots.skills],
                "high": [skill.to_dict() for skill in self.skill_manager.high_tier_slots.skills],
                "total": (
                    len(self.skill_manager.low_tier_slots.skills)
                    + len(self.skill_manager.mid_tier_slots.skills)
                    + len(self.skill_manager.high_tier_slots.skills)
                ),
            }
        return {
            "character_id": self.character.character_id,
            "character_name": self.character.name,
            "is_player": self.is_player,
            "spawn_category": getattr(self, "spawn_category", None),
            "boss_type": getattr(self, "boss_type_code", None),
            "boss_mechanic": getattr(self, "boss_mechanic", None),
            "boss_group_id": getattr(self, "boss_group_id", None),
            "exclusive_weapon": self._exclusive_weapon_payload(),
            "skill_slots": skill_slots,
            "health": {
                "current": self.current_health,
                "max": self.max_health,
            },
            "physical_health": {
                "current": self.current_physical_health,
                "max": self.max_physical_health,
            },
            "magical_health": {
                "current": self.current_magical_health,
                "max": self.max_magical_health,
            },
            "is_alive": self.is_alive(),
            "health_percentage": self.get_health_percentage(),
        }

    def _exclusive_weapon_payload(self) -> Dict[str, Any] | None:
        weapon = getattr(self.character, "exclusive_weapon", None)
        if not weapon:
            return None
        special_skill = getattr(weapon, "special_skill", None) or {}
        return {
            "weapon_id": weapon.weapon_id,
            "name": weapon.name,
            "attack_bonus": weapon.attack_bonus,
            "magic_attack_bonus": weapon.magic_attack_bonus,
            "special_skill": special_skill,
            "last_cast_time": self.exclusive_weapon_state.get("last_cast_time")
        }

    def __str__(self) -> str:
        status = "存活" if self.is_alive() else "死亡"
        return f"{self.character.name} [{status}] - HP: {self.current_health}/{self.max_health}"
