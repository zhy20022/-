"""Authored DPS characters 3-30. Cast lifecycle belongs to the caller."""
from copy import copy
import random
from types import SimpleNamespace

from ...combat.authored_monsters import states
from .common import alive, stat


def _layers(unit, name, owner):
    return [s for s in states(unit) if s['kind'] == 'mark' and s['name'] == name
            and s.get('owner_id') == owner.character.character_id]


def _mark(unit, owner, skill, name, count=1, cap=None, remaining=2,
          stats=(), value=0, **extra):
    old = _layers(unit, name, owner)
    count = count if cap is None else min(count, max(0, cap - len(old)))
    for _ in range(count):
        item = dict(kind='mark', name=name, unique_mark=True, value=1,
                    owner_id=owner.character.character_id,
                    source_skill=f'{owner.character.character_id}:{skill.skill_id}',
                    remaining=remaining, **extra)
        states(unit).append(item)
        if stats:
            # Paired modifiers share the layer's lifetime and dispel protection.
            stat(unit, owner, name, list(stats), value, remaining,
                 unique_mark=True, dps_first_mark=True)


def _clear(unit, name, owner, count=None):
    selected = _layers(unit, name, owner)
    selected = selected if count is None else selected[:count]
    for item in selected:
        unit.cast_effects.remove(item)
        companion = next((s for s in states(unit) if s.get('dps_first_mark')
                          and s['name'] == name and s.get('owner_id') == owner.character.character_id
                          and s.get('remaining') == item.get('remaining')), None)
        if companion is not None:
            unit.cast_effects.remove(companion)
    return len(selected)


def _hit(battle, caster, skill, target, ratio, school='physical', **extra):
    from ..authored_characters import damage
    if not target.is_alive() or getattr(target, 'mechanic_inactive', False):
        return 0
    hit = copy(skill)
    hit.authored_effect = dict(skill.authored_effect, damageType=school, **extra)
    return damage(battle, caster, hit, target, round(ratio, 12))


def _single(enemies):
    return max(enemies, key=lambda u: u.current_health)


def _han(b, c, s, a, e):
    slot = s.authored_effect['slot']
    targets = e if slot == 2 else [_single(e)]
    for t in targets:
        for hit in range(2 if slot in (1, 2) else 1):
            if not t.is_alive():
                break
            had = bool(_layers(t, '水蚀印记', c))
            _hit(b, c, s, t, {1: .9, 2: 1.1, 3: 2}[slot],
                 ignore_defense=.2 if _layers(c, '断潮', c) else 0)
            if _layers(t, '破甲', c):
                _mark(t, c, s, '水蚀印记', cap=3)
            if slot == 1:
                if had:
                    _hit(b, c, s, t, .005, true_damage=True, health_ratio='current')
                _mark(t, c, s, '水蚀印记', cap=3)
            elif slot == 2:
                if hit == 0:
                    _mark(t, c, s, '水蚀印记', cap=3)
                elif _layers(t, '水蚀印记', c):
                    _mark(t, c, s, '破甲', stats=('defense',), value=-.2)
            else:
                count = _clear(t, '水蚀印记', c)
                for _ in range(count):
                    _hit(b, c, s, t, 1.5,
                         ignore_defense=.2 if _layers(c, '断潮', c) else 0)
                if count >= 2:
                    _mark(c, c, s, '断潮')


def _lin(b, c, s, a, e):
    slot = s.authored_effect['slot']
    for t in e:
        diluted, wet = len(_layers(t, '稀释', c)), len(_layers(t, '打湿', c))
        ratio = .8 if slot != 3 else 1.5 + .15 * (diluted + wet)
        _hit(b, c, s, t, ratio * (1 + .15 * diluted), 'magical')
        if slot == 1:
            _mark(t, c, s, '稀释', cap=2)
        elif slot == 2:
            _mark(t, c, s, '打湿', cap=2, stats=('magic_defense',), value=-.3)


def _sheng(b, c, s, a, e):
    slot = s.authored_effect['slot']
    for t in ([_single(e)] if slot == 1 else e):
        wet = bool(_layers(t, '浸水', c))
        _hit(b, c, s, t, 1.6 if slot == 1 else 1.2 if slot == 2 else 2.8 if wet else 2.5)
        if slot == 2 and wet:
            _hit(b, c, s, t, .2)
        if slot != 3:
            _mark(t, c, s, '浸水')


def _jing(b, c, s, a, e):
    slot = s.authored_effect['slot']
    for t in e:
        count = len(_layers(t, '蜃痕', c))
        if slot == 1:
            _hit(b, c, s, t, .45, 'magical')
            _mark(t, c, s, '蜃痕', cap=2)
        elif slot == 2 and count:
            _mark(t, c, s, '随引幻影', pulse='mirage', pulse_skill=s.skill_id,
                  pulse_name=s.name, pulse_slot=slot)
        elif slot == 3:
            _clear(t, '蜃痕', c)
            _hit(b, c, s, t, (1.2 if count >= 2 else 1.1) + .8 * count, 'magical')
            if count >= 2:
                _hit(b, c, s, t, .8, 'magical')


def _heng(b, c, s, a, e):
    slot = s.authored_effect['slot']
    for t in ([_single(e)] if slot == 1 else e):
        cracked = any(x['name'] == '裂甲' for x in states(t))
        _hit(b, c, s, t, (1.8 * (1.4 if cracked else 1)) if slot == 1
             else 1.3 if slot == 2 else 3.2 if cracked else 2.8)
        if slot == 2:
            stat(t, c, '裂甲', ['defense'], -.15)


def _mo(b, c, s, a, e):
    slot = s.authored_effect['slot']
    for t in (e if slot == 3 else [_single(e)]):
        health = t.current_health / t.max_health
        ratio = 1.7 if slot == 1 else (1.8 if health < .4 else 1.5) if slot == 2 else (3.8 if health < .4 or health > .6 else 2.6)
        dealt = _hit(b, c, s, t, ratio, 'magical')
        if slot == 1:
            old = c.current_health
            c.heal(int(dealt * (.35 if health > .6 else .25)), 0)
            b.threat_system.add_threat_from_heal(c, c, max(0, c.current_health - old))
        elif slot == 2:
            stat(t, c, '贯刺破甲', ['defense'], -.2)


def _shi(b, c, s, a, e):
    slot = s.authored_effect['slot']
    for t in (e if slot == 3 else [_single(e)]):
        names = {x['name'] for x in states(t)}
        ratio = 1.6 if slot == 1 else 1.5 if slot == 2 else 2.4 * (1 + .15 * len(names & {'蚀骨', '炽火'}))
        _hit(b, c, s, t, ratio)
        if slot == 1:
            stat(t, c, '蚀骨', ['defense'], -.2)
        elif slot == 2:
            stat(t, c, '炽火', ['element_in_EARTH'], .2)


def _zhong(b, c, s, a, e):
    slot = s.authored_effect['slot']
    for t in ([_single(e)] if slot == 1 else e):
        marked = bool(_layers(t, '脉痕', c))
        _hit(b, c, s, t, 1.6 if slot == 1 else 1.3 * (1.1 if marked else 1) if slot == 2 else 2.6, 'magical')
        if slot == 1:
            _mark(t, c, s, '脉痕', stats=('magic_defense',), value=-.15)
        elif slot == 3 and marked:
            _hit(b, c, s, t, .6, 'magical')
            _clear(t, '脉痕', c)


def _yin(b, c, s, a, e):
    slot, t = s.authored_effect['slot'], _single(e)
    for _ in range(3 if slot == 2 else 1):
        if not t.is_alive():
            break
        _hit(b, c, s, t, {1: 1.6, 2: 1, 3: 2.8}[slot])
        if slot == 1 or (slot == 2 and random.random() < .75):
            _mark(t, c, s, '雷印', cap=3, stats=('element_in_THUNDER',), value=.05)
    if slot == 3:
        ratio = min(.03, .015 * len(_layers(t, '雷印', c)))
        if ratio:
            _hit(b, c, s, t, ratio, ignore_defense=1, health_ratio='max')


def _zhe(b, c, s, a, e):
    slot = s.authored_effect['slot']
    for t in ([_single(e)] if slot == 1 else e):
        if slot != 3:
            _hit(b, c, s, t, 1.2 if slot == 1 else .8)
            _mark(t, c, s, '雷痕', remaining=None)
        else:
            count = len(_layers(t, '雷痕', c))
            for _ in range(count):
                _hit(b, c, s, t, 1.5)
            _clear(t, '雷痕', c, (count + 1) // 2)


def _xi(b, c, s, a, e):
    slot = s.authored_effect['slot']
    for t in ([_single(e)] if slot == 2 else e):
        if slot == 1:
            _mark(t, c, s, '迓', cap=3, stats=('element_in_THUNDER',), value=.05)
            _hit(b, c, s, t, .4, 'magical')
        elif slot == 2:
            _hit(b, c, s, t, 1.8, 'magical')
            _mark(t, c, s, '迓', count=2, cap=3, stats=('element_in_THUNDER',), value=.05)
        else:
            count = _clear(t, '迓', c)
            if count:
                _hit(b, c, s, t, 2.2 * count, 'magical')
            if count >= 3:
                _mark(t, c, s, '天刑', pulse='punishment', pulse_skill=s.skill_id,
                      pulse_name=s.name, pulse_slot=slot)


def _chun(b, c, s, a, e):
    slot = s.authored_effect['slot']
    if slot in (1, 2):
        _mark(c, c, s, '阳息' if slot == 1 else '阴息', cap=2, remaining=None)
        _mark(c, c, s, '剑气增伤' if slot == 1 else '剑气暴击', remaining=None)
        return
    yang, yin = len(_layers(c, '阳息', c)), len(_layers(c, '阴息', c))
    if (yang and yin) or yang + yin < 2:
        targets, ratio, armor = [_single(e)], 4.2 if yang and yin else 1, False
        _clear(c, '阳息', c)
        _clear(c, '阴息', c)
    elif yang >= 2:
        targets, ratio, armor = e, 3, False
        _clear(c, '阳息', c)
    elif yin >= 2:
        targets, ratio, armor = e, 2.5, True
        _clear(c, '阴息', c)
    ratio *= 1 + .2 * _clear(c, '剑气增伤', c)
    crit = .15 * _clear(c, '剑气暴击', c)
    temporary = dict(kind='stat', name='剑气暴击结算', stats=['crit_rate'], value=crit, remaining=None)
    states(c).append(temporary)
    try:
        for t in targets:
            _hit(b, c, s, t, ratio)
            if armor:
                stat(t, c, '裂穹寒渊', ['defense'], -.2)
    finally:
        c.cast_effects = [x for x in states(c) if x is not temporary]


def _wei(b, c, s, a, e):
    slot, t = s.authored_effect['slot'], _single(e)
    count = len(_layers(t, '气滞', c)) + len(_layers(t, '风压', c))
    _hit(b, c, s, t, {1: 1.5, 2: 1.6, 3: 2.2}[slot], 'magical')
    if slot == 1:
        _mark(t, c, s, '气滞', stats=('magic_defense',), value=-.15)
    elif slot == 2:
        _mark(t, c, s, '风压', stats=('element_in_WIND',), value=.2)
    else:
        for _ in range(count):
            _hit(b, c, s, t, .6, 'magical')


def _mu(b, c, s, a, e):
    slot = s.authored_effect['slot']
    ratios = {1: (1.8, 1.2), 2: (1.5,), 3: (.8, .9, 1, 1.1, 1.2, 1.3)}[slot]
    targets = [_single(e)] if slot == 1 else e
    for ratio in ratios:
        for t in targets:
            _hit(b, c, s, t, ratio)


def _shi_zhi(b, c, s, a, e):
    slot = s.authored_effect['slot']
    empowered = False
    if slot == 2 and _layers(c, '递进', c):
        _clear(c, '递进', c)
        _mark(c, c, s, '转折', cap=1, remaining=None)
        empowered = True
    elif slot == 3 and _layers(c, '转折', c):
        _clear(c, '转折', c)
        empowered = True
    for _ in range(3 if slot == 3 else 1):
        for t in e:
            _hit(b, c, s, t, {1: 1.3, 2: 1.4, 3: .9}[slot] * (1.4 if empowered else 1), 'magical')
    if slot == 1:
        _mark(c, c, s, '递进', cap=1, remaining=None)


DISPATCH = {
    'char_003_water_physical_melee_dps': _han,
    'char_004_water_magic_melee_dps': _lin,
    'char_005_water_physical_ranged_dps': _sheng,
    'char_006_water_magic_ranged_dps': _jing,
    'char_011_earth_physical_melee_dps': _heng,
    'char_012_earth_magic_melee_dps': _mo,
    'char_013_earth_physical_ranged_dps': _shi,
    'char_014_earth_magic_ranged_dps': _zhong,
    'char_019_thunder_physical_melee_dps': _yin,
    'char_021_thunder_physical_ranged_dps': _zhe,
    'char_022_thunder_magic_ranged_dps': _xi,
    'char_027_wind_physical_melee_dps': _chun,
    'char_028_wind_magic_melee_dps': _wei,
    'char_029_wind_physical_ranged_dps': _mu,
    'char_030_wind_magic_ranged_dps': _shi_zhi,
}
CONFIG_IDS = set(DISPATCH)
IMPLEMENTED_SLOTS = {config: {1, 2, 3} for config in CONFIG_IDS}
COMPLETE_CONFIG_IDS = set(CONFIG_IDS)
READY_CONFIG_IDS = set(COMPLETE_CONFIG_IDS)


def cast(battle, caster, skill, allies, enemies):
    handler = DISPATCH[caster.character.character_config_id]
    targets = alive(enemies)
    self_cast = handler is _chun and skill.authored_effect['slot'] in (1, 2)
    if not caster.is_alive() or (not targets and not self_cast):
        return False
    handler(battle, caster, skill, allies, targets)
    return True


def after_cast(battle, unit, before):
    # before still contains the final pulse after the parent expires its state.
    for item in before:
        pulse = item.get('pulse')
        if pulse not in ('mirage', 'punishment') or not unit.is_alive():
            continue
        owner = next((u for u in battle.player_units + battle.enemy_units
                      if u.character.character_id == item.get('owner_id')), None)
        if owner is None:
            continue
        skill = SimpleNamespace(skill_id=item['pulse_skill'], name=item['pulse_name'],
                                authored_effect={'slot': item['pulse_slot'], 'name': item['pulse_name']})
        _hit(battle, owner, skill, unit, .6 if pulse == 'mirage' else .5, 'magical')
        if pulse == 'mirage' and unit.is_alive():
            _mark(unit, owner, skill, '蜃痕', cap=2)
