"""First-pass Boss mechanic templates."""

from copy import deepcopy
from typing import Any, Dict


BOSS_MECHANIC_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "SINGLE": {
        "mechanic_id": "single_basic",
        "boss_count": 1,
        "shared_health": False,
        "sequential_activation": False,
        "mutual_strengthen": False,
        "description": "Single boss. Dungeon timer is the only hard failure pressure.",
    },
    "TWIN_SHARED": {
        "mechanic_id": "twin_shared_health",
        "boss_count": 2,
        "shared_health": True,
        "sequential_activation": False,
        "mutual_strengthen": False,
        "description": "Twin bosses share one health pool.",
    },
    "TWIN_SEPARATE": {
        "mechanic_id": "twin_mutual_strengthen",
        "boss_count": 2,
        "shared_health": False,
        "sequential_activation": False,
        "mutual_strengthen": True,
        "strengthen_multiplier": 1.5,
        "description": "Twin bosses have separate health. Survivors strengthen when one dies.",
    },
    "COUNCIL_SHARED": {
        "mechanic_id": "council_shared_health",
        "boss_count": 3,
        "shared_health": True,
        "sequential_activation": False,
        "mutual_strengthen": False,
        "description": "Council bosses share health but can carry different skill slots.",
    },
    "COUNCIL_SEQUENTIAL": {
        "mechanic_id": "council_sequential_activation",
        "boss_count": 3,
        "shared_health": False,
        "sequential_activation": True,
        "mutual_strengthen": False,
        "description": "Council bosses are prepared as a one-by-one activation template.",
    },
}


def get_boss_mechanic_template(boss_type: str) -> Dict[str, Any]:
    return deepcopy(BOSS_MECHANIC_TEMPLATES.get(boss_type, BOSS_MECHANIC_TEMPLATES["SINGLE"]))


def get_boss_mechanic_templates() -> Dict[str, Dict[str, Any]]:
    return deepcopy(BOSS_MECHANIC_TEMPLATES)
