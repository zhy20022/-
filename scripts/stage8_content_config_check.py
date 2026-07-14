"""Stage 8 content configuration smoke check."""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.attributes.attribute import Attribute, AttributeType  # noqa: E402
from src.characters.character import Character  # noqa: E402
from src.classes.profession import ProfessionType, get_profession  # noqa: E402
from src.skills.skill_database import CONTENT_PATH, SkillDatabase  # noqa: E402
from src.skills.skill_learning import SkillLearningSystem  # noqa: E402
from src.versions.version import GameVersion  # noqa: E402


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    require(CONTENT_PATH.exists(), f"missing skill config: {CONTENT_PATH}")
    db = SkillDatabase()
    for attribute_type in AttributeType:
        skills = db.get_skills_for_attribute(attribute_type)
        require(len(skills) == 10, f"{attribute_type.name} expected 10 configured skills, got {len(skills)}")
        require(sum(1 for skill in skills if skill.skill_tier.name == "LOW") == 5, f"{attribute_type.name} low skill count mismatch")
        require(sum(1 for skill in skills if skill.skill_tier.name == "MID") == 4, f"{attribute_type.name} mid skill count mismatch")
        require(sum(1 for skill in skills if skill.skill_tier.name == "HIGH") == 1, f"{attribute_type.name} high skill count mismatch")

    character = Character(
        character_id="stage8_config_character",
        name="Stage8 Config Character",
        profession=get_profession(ProfessionType.PHYSICAL_MELEE_DPS),
        attribute=Attribute(AttributeType.FIRE),
        version=GameVersion("stage8", "Stage 8", "Content", 1, datetime.now(UTC)),
        level=1,
    )
    learning = SkillLearningSystem(character)
    db.initialize_character_skills(character, learning)
    require(len(learning.learned_skills) == 5, f"level 1 expected 5 initial skills, got {len(learning.learned_skills)}")
    print("[OK] stage 8 skill content config check passed")


if __name__ == "__main__":
    main()
