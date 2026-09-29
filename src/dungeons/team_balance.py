"""Versioned team dungeon schedule and encounter-wide stat budgets."""
import json
from copy import deepcopy
from pathlib import Path

TEAM_BALANCE = json.loads(
    (Path(__file__).resolve().parents[2] / 'data/content/team-dungeon-balance.json')
    .read_text(encoding='utf-8')
)


def team_config(kind):
    return TEAM_BALANCE.get(kind.name, {})


def tuned_encounter(definition, tuning):
    """Keep skill structure intact while calibrating shield/heal magnitudes."""
    result = deepcopy(definition)

    def visit(value):
        if isinstance(value, dict):
            kind = value.get('kind')
            if kind in ('shield', 'heal') and 'value' in value:
                value['value'] *= tuning.get(kind, 1)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(result)
    return result
