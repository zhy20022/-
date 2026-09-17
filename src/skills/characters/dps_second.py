"""Authored late-roster DPS effects; the caller owns the cast lifecycle."""
from copy import copy

from ...combat.authored_monsters import states
from .common import alive, stat


_IDS = {
    35: 'char_035_fire_physical_melee_dps',
    36: 'char_036_fire_magic_melee_dps',
    37: 'char_037_fire_physical_ranged_dps',
    43: 'char_043_wood_physical_melee_dps',
    44: 'char_044_wood_magic_melee_dps',
    45: 'char_045_wood_physical_ranged_dps',
    46: 'char_046_wood_magic_ranged_dps',
    52: 'char_052_light_magic_melee_dps',
    53: 'char_053_light_physical_ranged_dps',
    54: 'char_054_light_magic_ranged_dps',
    59: 'char_059_dark_physical_melee_dps',
    60: 'char_060_dark_magic_melee_dps',
    61: 'char_061_dark_physical_ranged_dps',
    62: 'char_062_dark_magic_ranged_dps',
}
CONFIG_IDS = set(_IDS.values())
IMPLEMENTED_SLOTS = {config: {1, 2, 3} for config in CONFIG_IDS}
COMPLETE_CONFIG_IDS = {key for key, slots in IMPLEMENTED_SLOTS.items()
                       if slots == {1, 2, 3}}
READY_CONFIG_IDS = set(COMPLETE_CONFIG_IDS)
_NUMBERS = {value: key for key, value in _IDS.items()}
_MAGICAL = {36, 44, 46, 52, 54, 60, 62}


def _layers(unit, name, owner):
    return [s for s in states(unit) if s['kind'] == 'mark'
            and s.get('name') == name
            and s.get('owner_id') == owner.character.character_id]


def _mark(unit, caster, skill, name, count=1, cap=None, remaining=2,
          modifier=None):
    count = count if cap is None else min(count, max(0, cap - len(_layers(unit, name, caster))))
    for _ in range(count):
        serial = getattr(caster, '_dps_second_mark_serial', 0) + 1
        caster._dps_second_mark_serial = serial
        link = f'{caster.character.character_id}:dps_second:{serial}'
        states(unit).append(dict(kind='mark', name=name, value=1,
            remaining=remaining, unique_mark=True,
            owner_id=caster.character.character_id, source_skill=skill.skill_id,
            dps_second_link=link))
        if modifier:
            key, value = modifier
            stat(unit, caster, name, [key], value, remaining=remaining,
                 unique_mark=True, dps_second_link=link)


def _remove(unit, name, caster, count=None):
    layers = _layers(unit, name, caster)
    removed = layers if count is None else layers[:count]
    links = {s['dps_second_link'] for s in removed if 'dps_second_link' in s}
    unit.cast_effects = [s for s in states(unit)
                         if not any(s is layer for layer in removed)
                         and s.get('dps_second_link') not in links]
    return len(removed)


def _hit(battle, caster, skill, target, ratio, number, **extra):
    if not target.is_alive() or ratio <= 0:
        return
    # Keep the registered skill immutable; each segment can have different rules.
    from ..authored_characters import damage
    segment = copy(skill)
    segment.authored_effect = dict(skill.authored_effect,
        damageType='magical' if number in _MAGICAL else 'physical', **extra)
    damage(battle, caster, segment, target, ratio)


def _hits(battle, caster, skill, targets, ratio, count, number):
    for _ in range(count):
        for target in targets:
            _hit(battle, caster, skill, target, ratio, number)


def before_damage(unit, physical, magical, context):
    """Permanent venom amplifies incoming damage, but cannot modify true damage."""
    if not context.get('is_true'):
        count = sum(s['kind'] == 'mark' and s.get('name') == '蛛毒'
                    for s in states(unit))
        physical *= 1 + .1 * count
        magical *= 1 + .1 * count
    return physical, magical


def cast(battle, caster, skill, allies, enemies):
    config = str(getattr(caster.character, 'character_config_id', ''))
    number = _NUMBERS.get(config)
    slot = skill.authored_effect['slot']
    if slot not in IMPLEMENTED_SLOTS.get(config, set()):
        raise ValueError(f'Unimplemented authored skill: {config}:{slot}')
    targets = alive(enemies)
    if not targets:
        return False
    primary = max(targets, key=lambda unit: unit.current_health)

    if number == 35:
        if slot == 1:
            _hit(battle, caster, skill, primary, 2.6, number)
            _mark(caster, caster, skill, '龙爪印', cap=9, remaining=None,
                  modifier=('crit_rate', .02))
        elif slot == 2:
            _hits(battle, caster, skill, targets, 2, 1, number)
            _mark(caster, caster, skill, '龙首印', cap=3, remaining=None,
                  modifier=('crit_damage', .1))
        else:
            ratio, ignore = 2.5, 0
            if len(_layers(caster, '龙爪印', caster)) >= 9:
                _remove(caster, '龙爪印', caster, 9)
                ratio = 15
            elif len(_layers(caster, '龙首印', caster)) >= 3:
                _remove(caster, '龙首印', caster, 3)
                ratio, ignore = 15, .3
            _hit(battle, caster, skill, primary, ratio, number, ignore_defense=ignore)
    elif number == 36:
        if slot == 1:
            _hit(battle, caster, skill, primary, .8, number)
            _mark(primary, caster, skill, '蛛毒', cap=10, remaining=None)
        elif slot == 2:
            _hit(battle, caster, skill, primary, .8, number)
            if _remove(primary, '蛛毒', caster, 1):
                _mark(primary, caster, skill, '火毒', 2, cap=20, remaining=None,
                      modifier=('healing_received', -.02))
        else:
            count = len(_layers(primary, '火毒', caster))
            _hit(battle, caster, skill, primary, 2 * (2 + .25 * count), number,
                 ignore_defense=.3 if count >= 20 else 0)
    elif number == 37:
        ratio, count = {1: (1.8, 1), 2: (2.6, 1), 3: (1.2, 4)}[slot]
        _hits(battle, caster, skill, [primary] if slot == 1 else targets, ratio, count, number)
    elif number == 43:
        if slot == 1:
            _hit(battle, caster, skill, primary, 1.8, number)
            _mark(caster, caster, skill, '根脉')
        elif slot == 2:
            for target in targets:
                _hit(battle, caster, skill, target, 1.3, number)
                _mark(target, caster, skill, '青痕')
        else:
            count = len(_layers(caster, '根脉', caster)) + len(_layers(primary, '青痕', caster))
            _hit(battle, caster, skill, primary, 2 + 1.5 * count, number)
    elif number == 44:
        if slot == 1:
            _hit(battle, caster, skill, primary, 1.6, number)
            _mark(primary, caster, skill, '朱砂印')
        elif slot == 2:
            stat(primary, caster, skill.name, ['defense', 'magic_defense'], -.25)
        else:
            count = len(_layers(primary, '朱砂印', caster))
            if count:
                _remove(primary, '朱砂印', caster)
                _hit(battle, caster, skill, primary, count, number)
                for target in targets:
                    _hit(battle, caster, skill, target, .8, number)
    elif number == 45:
        if slot == 1:
            _hit(battle, caster, skill, primary, 1.2, number)
            _mark(primary, caster, skill, '花痕', 3, cap=10)
        elif slot == 2:
            _hits(battle, caster, skill, targets, .8, 3, number)
            for target in targets:
                _mark(target, caster, skill, '花痕', cap=10)
        else:
            count = len(_layers(primary, '花痕', caster))
            _hit(battle, caster, skill, primary, .8 * count, number)
            _remove(primary, '花痕', caster)
    elif number == 46:
        if slot in (1, 2):
            for target in targets:
                _hit(battle, caster, skill, target, .8, number)
                if slot == 2:
                    stat(target, caster, skill.name, ['magic_defense'], -.15)
                _mark(target, caster, skill, '絮蚀', 2 if slot == 1 else 1, cap=5)
        else:
            selected = sorted(targets, key=lambda unit: unit.current_health, reverse=True)[:5]
            for target in selected:
                count = len(_layers(target, '絮蚀', caster))
                _hit(battle, caster, skill, target, .8 + .2 * count, number)
                _remove(target, '絮蚀', caster)
    elif number == 52:
        if slot == 1:
            _hits(battle, caster, skill, [primary], .5, 4, number)
            _mark(primary, caster, skill, '圣火烙印', modifier=('element_in_LIGHT', .1))
        elif slot == 2:
            for target in targets:
                _hit(battle, caster, skill, target, 1.4, number)
                _mark(target, caster, skill, '灼魂', modifier=('magic_defense', -.15))
        else:
            _hit(battle, caster, skill, primary, 1.7, number)
            _hits(battle, caster, skill, [primary], .6, 4, number)
            _hit(battle, caster, skill, primary,
                 2 if primary.current_health < .2 * primary.max_health else 1.5, number)
    elif number == 53:
        if slot == 3:
            selected = sorted(targets, key=lambda unit: unit.current_health, reverse=True)[:5]
            _hits(battle, caster, skill, selected, .3, 10, number)
        else:
            _hits(battle, caster, skill, targets, 1.7 if slot == 1 else .7,
                  1 if slot == 1 else 3, number)
    elif number == 54:
        ratio, count = {1: (1.6, 1), 2: (.8, 3), 3: (2.8, 1)}[slot]
        _hits(battle, caster, skill, [primary] if slot == 1 else targets, ratio, count, number)
    elif number == 59:
        if slot == 1:
            primary = min(targets, key=lambda unit: unit.current_health)
        ratio, count = {1: (2.5, 1), 2: (1.8, 1), 3: (.9, 6)}[slot]
        _hits(battle, caster, skill, targets if slot == 2 else [primary], ratio, count, number)
    elif number == 60:
        if slot == 1:
            _hit(battle, caster, skill, primary, .6, number)
            stat(primary, caster, skill.name, ['magic_attack'], -.15)
            stat(caster, caster, skill.name, ['magic_attack'], .15)
        elif slot == 2:
            for _ in range(3):
                if not primary.is_alive():
                    break
                _hit(battle, caster, skill, primary, .5, number)
                if primary.is_alive():
                    _mark(primary, caster, skill, '太阴引', 1,
                          modifier=('element_in_DARK', .1))
        else:
            count = len(_layers(primary, '太阴引', caster))
            _hit(battle, caster, skill, primary, 3.5 + .4 * count, number)
            _remove(primary, '太阴引', caster)
    elif number == 61:
        for target in ([primary] if slot == 1 else targets):
            if slot in (1, 2):
                # Author ruling: slot 1 is ordinary physical damage, no penetration.
                _hit(battle, caster, skill, target, 2 if slot == 1 else 1.5, number)
                _mark(target, caster, skill, '丝线', cap=10, remaining=None)
            else:
                count = min(10, len(_layers(target, '丝线', caster)))
                _hit(battle, caster, skill, target, .8 * count, number)
                _remove(target, '丝线', caster)
    elif number == 62:
        ratio = {1: 1, 2: .8, 3: 1.2}[slot]
        _hits(battle, caster, skill, [primary] if slot == 1 else targets, ratio, 3, number)
    return True
