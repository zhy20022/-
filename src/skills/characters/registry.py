"""Character dispatch and lifecycle integration shared by authored groups."""
from importlib import import_module, util
from functools import lru_cache

GROUPS = ('dps_first', 'dps_second', 'supports', 'tanks_first', 'tanks_second')


@lru_cache(maxsize=1)
def modules():
    return [import_module(f'{__package__}.{name}') for name in GROUPS
            if util.find_spec(f'{__package__}.{name}') is not None]


def find_handler(config_id):
    return next((module for module in modules() if config_id in module.CONFIG_IDS), None)


def hook(name, *args):
    for module in modules():
        callback = getattr(module, name, None)
        if callback:
            callback(*args)


def before_damage(unit, physical, magical, context):
    for module in modules():
        callback = getattr(module, 'before_damage', None)
        if callback:
            result = callback(unit, physical, magical, context)
            if result is not None:
                physical, magical = result
    return max(0, physical), max(0, magical)


def sync_max_health(unit):
    from ...combat.authored_monsters import states
    previous = getattr(unit, '_temporary_hp_bonus', 0)
    base = max(1, unit.max_health - previous)
    ratio = sum(item.get('value', 0) for item in states(unit)
                if item['kind'] == 'stat' and 'hp' in item.get('stats', []))
    bonus = int(base * max(-.99, ratio))
    unit.max_health = max(1, base + bonus)
    unit._temporary_hp_bonus = bonus
    unit.current_health = min(unit.current_health, unit.max_health)
    unit._sync_legacy_health_fields()
