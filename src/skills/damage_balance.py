"""Versioned damage-ratio reductions, applied before defense and damage floors."""
import json
from pathlib import Path

PATH = Path(__file__).resolve().parents[2] / "data/content/dps-damage-balance.json"
PROFILES = json.loads(PATH.read_text(encoding="utf-8"))["characters"]


def damage_scale(battle, caster):
    config_id = getattr(caster.character, "character_config_id", "")
    profile = PROFILES.get(config_id)
    if not profile:
        return 1.0
    # Count opponents, not hits or the remaining targets partway through an AoE.
    snapshot = getattr(caster, "_damage_balance_target_count", None)
    opponents = battle.enemy_units if caster in battle.player_units else battle.player_units
    count = snapshot if snapshot is not None else sum(
        u.is_alive() and not getattr(u, "mechanic_inactive", False) for u in opponents)
    points = sorted((int(k), v) for k, v in profile["targetScales"].items())
    count = max(1, count)
    for index, (right, value) in enumerate(points):
        if count <= right:
            if index == 0:
                return value
            left, previous = points[index - 1]
            # Interpolate the total target budget, not per-target damage.
            budget = left * previous + (right * value - left * previous) * (count - left) / (right - left)
            return budget / count
    last_count, last_scale = points[-1]
    # Pure single-target profiles must not weaken merely because more enemies spawn.
    return 1.0 if last_scale == 1 else last_scale * last_count / count
