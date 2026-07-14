"""Config-driven skill database."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..attributes.attribute import AttributeType
from ..combat.skill_system import Skill, SkillLogic, SkillTargetType, SkillTier
from .skill_learning import SkillUnlockCondition, UnlockType


CONTENT_PATH = Path(__file__).resolve().parents[2] / "data" / "content" / "skills.json"


DEFAULT_SKILL_TEMPLATES: List[Dict[str, Any]] = [
    {
        "id_suffix": "low_a_1",
        "name_template": "{attribute} Low A Skill 1",
        "logic": "A",
        "tier": "LOW",
        "unlock": {"type": "INITIAL"},
        "skill_multiplier": 1.0,
        "physical_damage_ratio": 1.0,
        "magical_damage_ratio": 0.0,
        "target_type": "SINGLE",
        "description_template": "{attribute} low-tier single-target physical opener.",
    },
    {
        "id_suffix": "low_a_2",
        "name_template": "{attribute} Low A Skill 2",
        "logic": "A",
        "tier": "LOW",
        "unlock": {"type": "INITIAL"},
        "skill_multiplier": 1.1,
        "physical_damage_ratio": 1.0,
        "magical_damage_ratio": 0.0,
        "target_type": "SINGLE",
        "description_template": "{attribute} low-tier single-target physical strike.",
    },
    {
        "id_suffix": "low_a_3",
        "name_template": "{attribute} Low A Skill 3",
        "logic": "A",
        "tier": "LOW",
        "unlock": {"type": "INITIAL"},
        "skill_multiplier": 1.2,
        "physical_damage_ratio": 1.0,
        "magical_damage_ratio": 0.0,
        "target_type": "SINGLE",
        "description_template": "{attribute} low-tier single-target finisher.",
    },
    {
        "id_suffix": "low_b_1",
        "name_template": "{attribute} Low B Skill 1",
        "logic": "B",
        "tier": "LOW",
        "unlock": {"type": "INITIAL"},
        "skill_multiplier": 1.2,
        "physical_damage_ratio": 0.8,
        "magical_damage_ratio": 0.2,
        "target_type": "SINGLE",
        "description_template": "{attribute} low-tier mixed damage skill.",
    },
    {
        "id_suffix": "low_b_2",
        "name_template": "{attribute} Low B Skill 2",
        "logic": "B",
        "tier": "LOW",
        "unlock": {"type": "INITIAL"},
        "skill_multiplier": 1.3,
        "physical_damage_ratio": 0.8,
        "magical_damage_ratio": 0.2,
        "target_type": "SINGLE",
        "description_template": "{attribute} low-tier stronger mixed damage skill.",
    },
    {
        "id_suffix": "mid_a_1",
        "name_template": "{attribute} Mid A Skill 1",
        "logic": "A",
        "tier": "MID",
        "unlock": {"type": "LEVEL", "required_level": 2},
        "skill_multiplier": 1.5,
        "physical_damage_ratio": 1.0,
        "magical_damage_ratio": 0.0,
        "target_type": "ALL",
        "description_template": "{attribute} mid-tier area physical sweep.",
    },
    {
        "id_suffix": "mid_a_2",
        "name_template": "{attribute} Mid A Skill 2",
        "logic": "A",
        "tier": "MID",
        "unlock": {"type": "LEVEL", "required_level": 2},
        "skill_multiplier": 1.7,
        "physical_damage_ratio": 1.0,
        "magical_damage_ratio": 0.0,
        "target_type": "ALL",
        "description_template": "{attribute} mid-tier stronger area physical sweep.",
    },
    {
        "id_suffix": "mid_b_1",
        "name_template": "{attribute} Mid B Skill",
        "logic": "B",
        "tier": "MID",
        "unlock": {"type": "LEVEL", "required_level": 2},
        "skill_multiplier": 1.3,
        "physical_damage_ratio": 0.7,
        "magical_damage_ratio": 0.3,
        "target_type": "MULTIPLE",
        "target_count": 2,
        "description_template": "{attribute} mid-tier two-target mixed strike.",
    },
    {
        "id_suffix": "mid_c_1",
        "name_template": "{attribute} Mid C Skill",
        "logic": "C",
        "tier": "MID",
        "unlock": {"type": "LEVEL", "required_level": 2},
        "skill_multiplier": 2.0,
        "physical_damage_ratio": 0.5,
        "magical_damage_ratio": 0.5,
        "target_type": "SINGLE",
        "description_template": "{attribute} mid-tier burst strike.",
    },
    {
        "id_suffix": "high_b_1",
        "name_template": "{attribute} High B Skill",
        "logic": "B",
        "tier": "HIGH",
        "unlock": {"type": "LEVEL", "required_level": 4},
        "skill_multiplier": 2.5,
        "physical_damage_ratio": 0.6,
        "magical_damage_ratio": 0.4,
        "target_type": "SINGLE",
        "telegraph": "High impact cast",
        "cast_hint": "Preparing a high-tier strike",
        "impact_hint": "Heavy impact",
        "description_template": "{attribute} high-tier burst skill.",
    },
]


class SkillDatabase:
    """Stores all skills and expands content templates by attribute."""

    def __init__(self, content_path: Path = CONTENT_PATH):
        self.content_path = content_path
        self.skills: Dict[str, Skill] = {}
        self.unlock_conditions: Dict[str, SkillUnlockCondition] = {}
        self.skills_by_attribute: Dict[AttributeType, List[str]] = {}
        self._initialize_skills()

    def _load_templates(self) -> List[Dict[str, Any]]:
        try:
            if self.content_path.exists():
                with self.content_path.open("r", encoding="utf-8") as file:
                    payload = json.load(file)
                templates = payload.get("templates") or []
                if templates:
                    return templates
        except Exception as exc:
            print(f"[WARN] failed to load skill config {self.content_path}: {exc}")
        return DEFAULT_SKILL_TEMPLATES

    def _initialize_skills(self) -> None:
        templates = self._load_templates()
        for attr_type in AttributeType:
            self.skills_by_attribute[attr_type] = []
            self._create_skills_for_attribute(attr_type, templates)

    def _create_skills_for_attribute(self, attribute_type: AttributeType, templates: List[Dict[str, Any]]) -> None:
        attr_token = attribute_type.value
        attr_label = attribute_type.name.title()
        for template in templates:
            suffix = str(template["id_suffix"])
            skill = Skill(
                skill_id=f"{attr_token}_{suffix}",
                name=str(template.get("name_template", "{attribute} Skill")).format(attribute=attr_label),
                skill_logic=SkillLogic[str(template.get("logic", "A"))],
                skill_tier=SkillTier[str(template.get("tier", "LOW"))],
                cooldown=float(template.get("cooldown", 0.0) or 0.0),
                skill_multiplier=float(template.get("skill_multiplier", 1.0) or 1.0),
                physical_damage_ratio=float(template.get("physical_damage_ratio", 1.0) or 0.0),
                magical_damage_ratio=float(template.get("magical_damage_ratio", 0.0) or 0.0),
                target_type=SkillTargetType[str(template.get("target_type", "SINGLE"))],
                target_count=int(template.get("target_count", 1) or 1),
                priority_target=str(template.get("priority_target", "highest_health")),
                description=str(template.get("description_template", "")).format(attribute=attr_label),
                is_heal=bool(template.get("is_heal", False)),
                heal_ratio=float(template.get("heal_ratio", 0.0) or 0.0),
                status_effects=list(template.get("status_effects") or []),
                effect_tags=list(template.get("effect_tags") or []),
                telegraph=str(template.get("telegraph", "")),
                cast_hint=str(template.get("cast_hint", "")),
                impact_hint=str(template.get("impact_hint", "")),
            )
            self._register_skill(skill, attribute_type, self._build_unlock_condition(template.get("unlock") or {}))

    def _build_unlock_condition(self, payload: Dict[str, Any]) -> SkillUnlockCondition:
        unlock_type = UnlockType[str(payload.get("type", "INITIAL"))]
        return SkillUnlockCondition(
            unlock_type,
            required_level=int(payload.get("required_level", 1) or 1),
            required_materials=dict(payload.get("required_materials") or {}),
            required_gold=int(payload.get("required_gold", 0) or 0),
            prerequisite_skills=list(payload.get("prerequisite_skills") or []),
        )

    def _register_skill(self, skill: Skill, attribute_type: AttributeType, unlock_condition: SkillUnlockCondition) -> None:
        self.skills[skill.skill_id] = skill
        self.unlock_conditions[skill.skill_id] = unlock_condition
        self.skills_by_attribute[attribute_type].append(skill.skill_id)

    def get_skills_for_attribute(self, attribute_type: AttributeType) -> List[Skill]:
        skill_ids = self.skills_by_attribute.get(attribute_type, [])
        return [self.skills[skill_id] for skill_id in skill_ids if skill_id in self.skills]

    def get_skill(self, skill_id: str) -> Optional[Skill]:
        return self.skills.get(skill_id)

    def get_unlock_condition(self, skill_id: str) -> Optional[SkillUnlockCondition]:
        return self.unlock_conditions.get(skill_id)

    def initialize_character_skills(self, character, skill_learning_system) -> None:
        attribute_skills = self.get_skills_for_attribute(character.attribute.attribute_type)
        for skill in attribute_skills:
            unlock_condition = self.get_unlock_condition(skill.skill_id)
            if unlock_condition:
                skill_learning_system.register_skill(skill, unlock_condition)
        skill_learning_system.auto_learn_skills()


_skill_database: Optional[SkillDatabase] = None


def get_skill_database() -> SkillDatabase:
    global _skill_database
    if _skill_database is None:
        _skill_database = SkillDatabase()
    return _skill_database


def get_skill_by_id(skill_id: str) -> Optional[Skill]:
    return get_skill_database().get_skill(skill_id)


def get_skills_by_logic(attribute_type: AttributeType, logic: SkillLogic) -> List[Skill]:
    all_skills = get_skill_database().get_skills_for_attribute(attribute_type)
    return [skill for skill in all_skills if skill.skill_logic == logic]
