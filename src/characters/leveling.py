"""Shared character leveling rules."""

from functools import lru_cache
from typing import Any, Dict


MAX_CHARACTER_LEVEL = 100
TOTAL_EXP_TO_MAX_LEVEL = 100_000
MIN_EXP_PER_LEVEL = 100


@lru_cache(maxsize=1)
def level_exp_table() -> Dict[int, int]:
    """Return exp required for each level-up, keyed by current level."""
    levels = list(range(1, MAX_CHARACTER_LEVEL))
    base_total = MIN_EXP_PER_LEVEL * len(levels)
    remaining = TOTAL_EXP_TO_MAX_LEVEL - base_total
    weights = [level ** 1.45 for level in levels]
    weight_total = sum(weights)

    table: Dict[int, int] = {}
    assigned = 0
    for level, weight in zip(levels, weights):
        cost = MIN_EXP_PER_LEVEL + round((weight / weight_total) * remaining)
        table[level] = cost
        assigned += cost

    diff = TOTAL_EXP_TO_MAX_LEVEL - assigned
    table[MAX_CHARACTER_LEVEL - 1] += diff
    return table


def get_exp_for_next_level(level: int) -> int:
    if level >= MAX_CHARACTER_LEVEL:
        return 0
    return level_exp_table().get(max(1, level), 0)


def get_total_exp_before_level(level: int) -> int:
    capped_level = min(max(1, level), MAX_CHARACTER_LEVEL)
    return sum(level_exp_table().get(current, 0) for current in range(1, capped_level))


def get_exp_progress(level: int, exp: int) -> float:
    required = get_exp_for_next_level(level)
    if required <= 0:
        return 1.0
    return max(0.0, min(1.0, exp / required))


def get_exp_required_to_level(level: int, exp: int, target_level: int) -> int:
    current_level = max(1, min(int(level or 1), MAX_CHARACTER_LEVEL))
    capped_target = max(current_level, min(int(target_level or current_level), MAX_CHARACTER_LEVEL))
    current_total = get_total_exp_before_level(current_level) + max(0, int(exp or 0))
    target_total = get_total_exp_before_level(capped_target)
    return max(0, target_total - current_total)


def apply_character_exp(level: int, exp: int, amount: int) -> Dict[str, Any]:
    before_level = max(1, min(int(level or 1), MAX_CHARACTER_LEVEL))
    before_exp = max(0, int(exp or 0))
    remaining_exp = before_exp + max(0, int(amount or 0))
    current_level = before_level
    leveled_up = False

    while current_level < MAX_CHARACTER_LEVEL:
        required = get_exp_for_next_level(current_level)
        if required <= 0 or remaining_exp < required:
            break
        remaining_exp -= required
        current_level += 1
        leveled_up = True

    if current_level >= MAX_CHARACTER_LEVEL:
        remaining_exp = 0

    return {
        "gained_exp": max(0, int(amount or 0)),
        "before_level": before_level,
        "after_level": current_level,
        "before_exp": before_exp,
        "after_exp": remaining_exp,
        "leveled_up": leveled_up,
        "exp_to_next_level": get_exp_for_next_level(current_level),
        "max_level": MAX_CHARACTER_LEVEL,
        "total_exp_to_max_level": TOTAL_EXP_TO_MAX_LEVEL,
    }
