"""Explicit effects for tanks 1, 2, 9, 10, 18, 25 and 26.

The caller owns skill use and cast clocks. Conversion and crit immunity are
pre-calculation engine concerns; see docs/tanks-first-questions.md.
"""
import random

from ...combat.authored_monsters import states
from ...combat.skill_system import Skill, SkillLogic, SkillTier
from .common import add_mark, mark_layers, shield, stat
from .registry import sync_max_health


IDS = {
    1: 'char_001_water_physical_tank',
    2: 'char_002_water_magic_tank',
    9: 'char_009_earth_physical_tank',
    10: 'char_010_earth_magic_tank',
    18: 'char_018_thunder_magic_tank',
    25: 'char_025_wind_physical_tank',
    26: 'char_026_wind_magic_tank',
}
CONFIG_IDS: set[str] = set(IDS.values())
READY_CONFIG_IDS: set[str] = set(CONFIG_IDS)
PRESSURE_SKILL = Skill('tanks_first:water_pressure', 'Water pressure settlement',
                       SkillLogic.A, SkillTier.LOW)


def _number(unit):
    config = getattr(unit.character, 'character_config_id', None)
    return next((n for n, value in IDS.items() if value == config), None)


def _items(unit, key):
    return [s for s in states(unit) if s.get('tank_key') == key]


def _state(unit, key, kind='mark', remaining=2, **extra):
    item = dict(kind=kind, name=key, tank_key=key, remaining=remaining,
                owner_id=unit.character.character_id,
                source_skill=f'{unit.character.character_id}:{key}', **extra)
    if kind == 'mark':
        item['unique_mark'] = True
    states(unit).append(item)
    return item


def _pool(unit, key):
    existing = _items(unit, key)
    return existing[0] if existing else _state(unit, key, remaining=None, amount=0)


def _remove(unit, key):
    unit.cast_effects = [s for s in states(unit) if s.get('tank_key') != key]


def _buff(unit, key, stats, value, remaining=2, **extra):
    stat(unit, unit, key, stats, value, remaining, tank_key=key, **extra)
    return states(unit)[-1]


def _heal(battle, unit, amount):
    if not unit.is_alive():
        return
    old = unit.current_health
    unit.heal(int(amount), 0)
    gained = max(0, unit.current_health - old)
    if gained:
        battle.threat_system.add_threat_from_heal(unit, unit, gained)
        battle._log('Tank recovery', 'heal', {
            'caster_id': unit.character.character_id,
            'target_id': unit.character.character_id, 'amount': gained})


def attach(battle, unit):
    number = _number(unit)
    if number not in IDS or getattr(unit, '_tanks_first_attached', False):
        return
    unit._tanks_first_attached = True
    unit._tanks_first_casts = 0
    unit._tanks_first_magic_hit = False
    unit._tanks_first_spring_ready = 0
    unit._tanks_first_pressure_sources = []
    if number == 9:
        _state(unit, 'rock_armor', remaining=None, level=0, value=.02)
    elif number == 26:
        _pool(unit, 'wind_storage')
        _buff(unit, 'wind_magic_growth', ['magic_defense'], 0, None, unique_mark=True)
        _buff(unit, 'wind_physical_decay', ['defense'], 0, None, unique_mark=True)


def cast(battle, caster, skill, allies, enemies) -> bool:
    number = _number(caster)
    slot = skill.authored_effect.get('slot')
    if number not in IDS or slot not in (1, 2, 3):
        return False
    attach(battle, caster)
    if number == 1:
        if slot in (1, 2):
            key = 'soft_force' if slot == 1 else 'inner_breath'
            # Independent windows share the explicit cap, never compound HP.
            _buff(caster, key, ['hp'], 0, unique_mark=True, amount=0)
        else:
            shield(caster, caster, 'mountain_step',
                   (caster.max_health - caster.current_health) * .4,
                   tank_key='mountain_shield', expiry_heal=.5)
            _state(caster, 'mountain_stance', value=.25)
    elif number == 2:
        if slot == 1:
            _state(caster, 'abyss_stance')
            _pool(caster, 'water_pressure')
        elif slot == 2:
            _buff(caster, 'still_water', ['crit_immune_magical'], 1)
        else:
            _pool(caster, 'water_pressure')['amount'] = 0
            caster._tanks_first_pressure_sources.clear()
    elif number == 9:
        rng = getattr(battle, 'rng', random)
        if slot == 1:
            if len(_items(caster, 'mountain_blessing')) < 5 and rng.random() < .25:
                _buff(caster, 'mountain_blessing', ['hp'], .15, None, unique_mark=True)
                sync_max_health(caster)
        elif slot == 2:
            armor = _items(caster, 'rock_armor')[0]
            if armor['level'] < 3 and rng.random() < .2:
                armor['level'] += 1
                armor['value'] = .02 * (armor['level'] + 1)
        else:
            shield(caster, caster, 'jade_guard', caster.max_health * .05)
    elif number == 10:
        if slot == 1:
            _state(caster, 'earth_mother_guard', value=.25)
        elif slot == 2:
            # The text specifies an on-damage passive, not one stack per cast.
            pass
        else:
            caster.cast_effects = [s for s in states(caster)
                                   if s.get('name') != 'earth_silt']
            _state(caster, 'earth_return', kind='hot', value=.12)
    elif number == 18:
        if slot == 1:
            _buff(caster, 'draw_thunder', ['magic_defense'], .2)
        elif slot == 2:
            ratio = .18 if caster._tanks_first_magic_hit else .12
            _heal(battle, caster, caster.max_health * ratio)
        else:
            item = shield(caster, caster, 'thunder_cocoon', caster.max_health * .3,
                          tank_key='thunder_cocoon')
            _remove(caster, 'cocoon_resistance')
            buff = _buff(caster, 'cocoon_resistance', ['magic_defense'], .15,
                         bound_shield=True)
            buff['source_skill'] = item['source_skill']
    elif number == 25:
        if slot == 1:
            shield(caster, caster, 'flowing_shield', caster.max_health * .4,
                   tank_key='flowing_shield')
            _buff(caster, 'stagnant_air', ['attack'], -.15)
        elif slot == 2:
            _state(caster, 'listen_breath', value=.4)
            _buff(caster, 'turbulence', ['magic_defense'], -.15)
        else:
            _remove(caster, 'stagnant_air')
            _remove(caster, 'turbulence')
            _heal(battle, caster, caster.max_health * .15)
            for item in _items(caster, 'flowing_shield'):
                item['amount'] *= .5
            for item in _items(caster, 'listen_breath'):
                item['value'] *= .5
    elif number == 26:
        if slot == 2:
            pool = _pool(caster, 'wind_storage')
            amount, pool['amount'] = pool['amount'], 0
            _heal(battle, caster, amount * 1.2)
            caster._tanks_first_active_spring = True
        elif slot == 3:
            _state(caster, 'reverse_wind', kind='damage_conversion', school='magical')
            _buff(caster, 'reverse_wind_defense', ['magic_defense'], .5)
    return True


def _store_hp(unit, key, amount, cap):
    windows = _items(unit, key)
    if not windows:
        return 0
    base = max(1, unit.max_health - getattr(unit, '_temporary_hp_bonus', 0))
    stored = sum(s['amount'] for s in windows)
    added = min(max(0, amount), max(0, base * cap - stored))
    windows[-1]['amount'] += added
    windows[-1]['value'] = windows[-1]['amount'] / base
    sync_max_health(unit)
    return added


def before_damage(unit, physical, magical, context):
    number = _number(unit)
    if number not in IDS or getattr(unit, '_tanks_first_settling', False):
        return physical, magical
    battle = context.get('battle') or getattr(unit, '_battle', None)
    attach(battle, unit)
    true = context.get('is_true', False)
    source = context.get('source')
    attribute = getattr(getattr(getattr(source, 'character', None), 'attribute', None),
                        'attribute_type', None)
    element = context.get('element') or getattr(attribute, 'name', None)
    if number == 1:
        if not true:
            reduction = min(1, sum(s['value'] for s in _items(unit, 'mountain_stance')))
            physical, magical = physical * (1 - reduction), magical * (1 - reduction)
            if _items(unit, 'soft_force') and element == 'EARTH':
                prevented = (physical + magical) * .4
                physical, magical = physical * .6, magical * .6
                _store_hp(unit, 'soft_force', prevented * .3, .15)
        if context.get('is_attack', True) and _items(unit, 'inner_breath'):
            total = physical + magical
            stored = _store_hp(unit, 'inner_breath', total * .2, .1)
            if total:
                physical, magical = physical * (1 - stored / total), magical * (1 - stored / total)
    elif number == 2 and _items(unit, 'abyss_stance'):
        total = physical + magical
        pool = _pool(unit, 'water_pressure')
        stored = min(total, max(0, unit.max_health - pool['amount']))
        pool['amount'] += stored
        if stored:
            unit._tanks_first_pressure_sources.append([source, stored])
        if total:
            physical, magical = physical * (1 - stored / total), magical * (1 - stored / total)
    elif number == 9 and not true:
        reduction = _items(unit, 'rock_armor')[0]['value']
        physical, magical = physical * (1 - reduction), magical * (1 - reduction)
    elif number == 10:
        if magical > 0:
            context['_earth_silt_hit'] = True
        if not true:
            reduction = min(1, sum(s['value'] for s in _items(unit, 'earth_mother_guard')))
            physical *= 1 - reduction
            magical *= (1 - reduction) * (1 - .02 * len(mark_layers(unit, 'earth_silt')))
    elif number == 18 and magical > 0 and context.get('is_attack', True):
        unit._tanks_first_magic_hit = True
    elif number == 25 and not true and element == 'FIRE':
        reduction = min(1, sum(s['value'] for s in _items(unit, 'listen_breath')))
        physical, magical = physical * (1 - reduction), magical * (1 - reduction)
    elif number == 26:
        reverse = bool(_items(unit, 'reverse_wind'))
        original = min(physical + magical, context.get('original_physical', physical))
        pool = _pool(unit, 'wind_storage')
        stored = min(original * (.9 if reverse else .75),
                     max(0, unit.max_health * .5 - pool['amount']))
        pool['amount'] += stored
        if reverse:
            # Defense recalculation must already have happened in the engine.
            physical, magical = 0, max(0, physical + magical - stored)
        else:
            physical = max(0, physical - stored)
    # Avoid truncating exact integral results such as 1000 * .75 * .6 to 449.
    return max(0, round(physical, 9)), max(0, round(magical, 9))


def _spring(battle, unit):
    casts = unit._tanks_first_casts
    if (unit.is_alive() and unit.current_health < unit.max_health * .2
            and casts >= unit._tanks_first_spring_ready
            and not _items(unit, 'spring_healing')):
        _buff(unit, 'spring_healing', ['healing_received'], .3)
        unit._tanks_first_spring_ready = casts + 2


def after_damage(unit, context):
    number = _number(unit)
    if getattr(unit, '_tanks_first_settling', False):
        return
    if (number == 10 and unit.is_alive() and context.get('_earth_silt_hit')
            and context.get('dealt', 0) > 0):
        add_mark(unit, 'earth_silt', unit, cap=20, remaining=None)
    elif number == 26:
        _spring(context.get('battle'), unit)


def _release_pressure(battle, unit, *, final=False):
    pool = _pool(unit, 'water_pressure')
    payment = pool['amount'] if final else int(pool['amount'] * .35)
    if payment <= 0 or not unit.is_alive():
        return
    queue = unit._tanks_first_pressure_sources
    total = pool['amount']
    shares = [(source, amount / total) for source, amount in queue]
    for entry in queue:
        entry[1] *= 1 - payment / total
    pool['amount'] -= payment
    if final:
        queue.clear()
    old = unit.current_health
    # One settlement hit, with no re-storage, defense calculation or HP restore.
    unit._tanks_first_settling = True
    try:
        unit.take_damage(0, payment, is_attack=False, is_true=True,
                         source=shares[0][0] if len(shares) == 1 else None)
    finally:
        unit._tanks_first_settling = False
    dealt = max(0, old - unit.current_health)
    allocated = 0
    for index, (source, share) in enumerate(shares):
        credit = dealt - allocated if index == len(shares) - 1 else int(dealt * share)
        allocated += credit
        if source is not None and credit:
            battle._record_damage(source, unit, credit,
                                  {'physical_damage': 0, 'magical_damage': credit},
                                  PRESSURE_SKILL, 'delayed_damage')
    battle._log('Water pressure settlement', 'damage', {
        'target_id': unit.character.character_id, 'amount': dealt,
        'raw_amount': payment, 'source': 'water_pressure'})


def after_cast(battle, unit, before):
    number = _number(unit)
    if number not in IDS:
        return
    attach(battle, unit)
    unit._tanks_first_casts += 1
    if number == 1:
        for item in before:
            if item.get('remaining') != 0:
                continue
            key = item.get('tank_key')
            if key == 'soft_force' and item.get('amount', 0) > 0:
                shield(unit, unit, 'soft_force_release', item['amount'])
            elif key == 'inner_breath' and item.get('amount', 0) > 0:
                _state(unit, 'breath_recovery', kind='hot', value=.02)
            elif key == 'mountain_shield' and item.get('amount', 0) > 0:
                _heal(battle, unit, item['amount'] * .5)
        sync_max_health(unit)
    elif number == 2 and any(s.get('tank_key') == 'abyss_stance' for s in before):
        if unit.is_alive():
            _release_pressure(battle, unit, final=not _items(unit, 'abyss_stance'))
    elif number == 18:
        unit._tanks_first_magic_hit = False
        if not _items(unit, 'thunder_cocoon'):
            _remove(unit, 'cocoon_resistance')
    elif number == 26:
        _items(unit, 'wind_magic_growth')[0]['value'] = min(.3, unit._tanks_first_casts * .02)
        _items(unit, 'wind_physical_decay')[0]['value'] = -min(.2, unit._tanks_first_casts * .01)
        if not getattr(unit, '_tanks_first_active_spring', False):
            _spring(battle, unit)
        unit._tanks_first_active_spring = False


def on_shield_break(unit, item):
    if item.get('tank_key') == 'thunder_cocoon':
        _remove(unit, 'cocoon_resistance')
