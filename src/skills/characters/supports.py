"""Authored healer/support effects. Cast lifecycle belongs to the caller.

Unresolved authored choices use battle.support_rules, never guessed odds.
See docs/support-questions.md for that explicit integration contract.
"""

import random

from .common import alive, states, modifiers, stat, shield, add_mark, mark_layers
from .registry import sync_max_health


CONFIG_IDS: set[str] = {
    'char_007_water_healer', 'char_015_earth_healer', 'char_016_earth_support',
    'char_023_thunder_healer', 'char_024_thunder_support', 'char_031_wind_healer',
    'char_032_wind_support', 'char_039_fire_healer', 'char_040_fire_support',
    'char_047_wood_healer', 'char_048_wood_support', 'char_055_light_healer',
    'char_056_light_support', 'char_063_dark_healer', 'char_064_dark_support',
}
READY_CONFIG_IDS = set(CONFIG_IDS)

SU_CLEANSE_STATS = {'attack', 'magic_attack', 'defense', 'magic_defense',
                    'element_in_FIRE', 'element_out_WIND'}
SU_CLEANSE_NAMES = {'物攻降低', '法攻降低', '物防降低', '法防降低', '火系补正', '风系降低'}


def _id(unit):
    return unit.character.character_id


def _power(unit, name='attack'):
    return max(0, getattr(unit.character, name) + modifiers(unit).get(name, 0))


def _cross(caster, target, party):
    return len(party) > 5 and party.index(caster) // 5 != party.index(target) // 5


def _scale(caster, target, party):
    return .5 if _cross(caster, target, party) else 1


def _heal(battle, caster, target, amount):
    if not target.is_alive():
        return 0
    before = target.current_health
    target.heal(int(max(0, amount)), 0)
    restored = max(0, target.current_health - before)
    if getattr(battle, 'threat_system', None):
        battle.threat_system.add_threat_from_heal(caster, target, restored)
    return restored


def _hot(target, caster, name, *, amount=None, value=None, **extra):
    item = dict(kind='hot', name=name, remaining=2, owner=caster,
                owner_id=_id(caster), source_skill=f'{_id(caster)}:{name}', **extra)
    if amount is not None:
        item['amount'] = amount
    if value is not None:
        item['value'] = value
    states(target).append(item)
    return item


def _negative(item):
    if (item.get('unique_mark') or item.get('permanent')
            or item.get('remaining') is None or item.get('dispellable') is False):
        return False
    if item['kind'] == 'dot' or item.get('negative'):
        return True
    if item['kind'] != 'stat':
        return False
    return any((item['value'] > 0 if name.startswith('element_in_') else item['value'] < 0)
               for name in item.get('stats', []))


def _legacy_negative(unit):
    from ...combat.status_system import StatusType
    manager = getattr(unit, 'status_manager', None)
    return [s for s in getattr(manager, 'status_effects', [])
            if s.status_type in {StatusType.DEBUFF, StatusType.DOT}
            and not getattr(s, 'unique_mark', False) and not getattr(s, 'permanent', False)
            and getattr(s, 'dispellable', True)]


def _negative_count(unit):
    return sum(_negative(s) for s in states(unit)) + len(_legacy_negative(unit))


def _cleanse(unit, count=None, restricted=False):
    removed = 0
    for item in list(states(unit)):
        if _negative(item) and (count is None or removed < count):
            if restricted:
                keys = item.get('stats', [])
                eligible = [k for k in keys if k in SU_CLEANSE_STATS
                            and (item['value'] > 0 if k == 'element_in_FIRE' else item['value'] < 0)]
                if item['kind'] != 'stat' or not eligible:
                    continue
                kept = [k for k in keys if k not in eligible]
                if kept:
                    item['stats'] = kept
                else:
                    unit.cast_effects.remove(item)
            else:
                unit.cast_effects.remove(item)
            removed += 1
    for item in _legacy_negative(unit):
        if count is None or removed < count:
            if restricted:
                from ...combat.status_system import StatusType
                if item.status_type != StatusType.DEBUFF:
                    continue
                if (item.name not in SU_CLEANSE_NAMES and item.effect_type not in
                        {'attack_boost', 'magic_attack_boost', 'defense_boost', 'magic_defense_boost',
                         'element_in_FIRE', 'element_out_WIND'}):
                    continue
            unit.status_manager.remove_status(item.status_id)
            removed += 1


def _question(battle, key):
    questions = getattr(battle, 'support_questions', None)
    if questions is None:
        battle.support_questions = questions = set()
    questions.add(key)


def _revive(battle, caster, party, local_ratio, remote_ratio):
    used = getattr(battle, '_support_revives', None)
    if used is None:
        battle._support_revives = used = set()
    if _id(caster) in used:
        return False
    dead = [u for u in party if u is not caster and u.is_dead()]
    if not dead:
        return False

    def priority(unit):
        profession = getattr(unit.character, 'profession', None)
        kind = getattr(getattr(profession, 'profession_type', None), 'name', '')
        return (0 if kind in {'PHYSICAL_TANK', 'MAGIC_TANK'} else 1,
                getattr(unit, 'death_time', float('inf')),
                getattr(unit, 'death_serial', party.index(unit)))

    target = min(dead, key=priority)
    ratio = remote_ratio if _cross(caster, target, party) else local_ratio
    target.current_health = max(1, int(target.max_health * ratio))
    target._sync_legacy_health_fields()
    used.add(_id(caster))
    return True


def cast(battle, caster, skill, allies, enemies) -> bool:
    config_id = getattr(caster.character, 'character_config_id', None)
    if config_id not in CONFIG_IDS:
        return False
    slot = skill.authored_effect['slot']
    if slot not in (1, 2, 3):
        return False
    number = int(config_id.split('_')[1])
    friends, foes = alive(allies), alive(enemies)
    if not friends:
        return True
    low = min(friends, key=lambda u: u.current_health)
    high = max(friends, key=lambda u: u.current_health)
    strong = max(friends, key=_power)
    attack = _power(caster)
    name = skill.name

    def buff(targets, keys, value, **extra):
        for target in targets:
            stat(target, caster, name, keys, value, **extra)
            if 'hp' in keys:
                sync_max_health(target)

    def heal_all(ratio):
        for target in friends:
            _heal(battle, caster, target, attack * ratio * _scale(caster, target, allies))

    if number == 7:
        if slot == 1:
            shield(low, caster, skill.skill_id, caster.max_health * .08,
                   support_break_hot_value=.02, support_break_name='润脉')
        elif slot == 2:
            for target in friends:
                _hot(target, caster, '沐泽', amount=_power(caster, 'magic_attack') * .25
                     * _scale(caster, target, allies))
            buff(friends, ['healing_received'], .1)
        else:
            critical = low.current_health < low.max_health * .3
            # Snapshot remaining ticks before either the burst or state removal.
            hots = [s for s in states(low) if s['kind'] == 'hot'
                    and s.get('name') in {'沐泽', '润脉'}]
            cashout = sum(s.get('amount', low.max_health * s.get('value', 0))
                          * max(0, s.get('remaining', 0)) for s in hots)
            _heal(battle, caster, low, low.max_health * .4)
            _heal(battle, caster, low, cashout)
            low.cast_effects = [s for s in states(low) if not any(s is h for h in hots)]
            if critical:
                add_mark(low, '溟心庇佑', caster, support_survive=True)
    elif number == 15:
        if slot == 1:
            _heal(battle, caster, low, attack * 2)
            for target in allies:
                if target is not low:
                    target.cast_effects = [s for s in states(target)
                        if not (s.get('support_harden') and s.get('owner_id') == _id(caster))]
            buff([low], ['defense'], .15, support_harden=True)
        elif slot == 2:
            heal_all(1.2)
            buff(friends, ['element_in_THUNDER'], -.2, support_hit_expire=True)
        else:
            for target in friends:
                scale = _scale(caster, target, allies)
                shield(target, caster, skill.skill_id, attack * scale,
                       support_break_heal=attack * 1.8 * scale)
    elif number == 16:
        keys, value = {1: (['defense', 'magic_defense'], -.15),
                       2: (['element_in_EARTH'], .25),
                       3: (['attack', 'magic_attack'], -.15)}[slot]
        buff(foes, keys, value)
    elif number == 23:
        if slot == 1:
            _heal(battle, caster, low, attack * 2.2)
        elif slot == 2:
            heal_all(1.2)
            buff(friends, ['attack'], .15)
        else:
            heal_all(1.8)
            _revive(battle, caster, allies, .4, .25)
    elif number == 24:
        if slot == 1:
            buff(foes, ['defense'], -.1)
        elif slot == 2:
            buff(friends, ['attack'], .1)
        else:
            buff(friends, ['attack', 'defense'], .2)
            buff(foes, ['attack', 'defense'], -.2)
    elif number == 31:
        if slot == 1:
            _hot(low, caster, name, amount=attack * 2)
        elif slot == 2:
            for target in friends:
                _hot(target, caster, name, amount=attack * 1.2 * _scale(caster, target, allies))
            local = [u for u in friends if not _cross(caster, u, allies)]
            remote = sorted((u for u in friends if _cross(caster, u, allies)),
                            key=lambda u: (-_negative_count(u), u.current_health))[:5]
            for target in local + remote:
                _cleanse(target, 1, restricted=True)
        else:
            for target in friends:
                scale = _scale(caster, target, allies)
                shield(target, caster, skill.skill_id, attack * .8 * scale,
                       support_break_hot_amount=attack * 1.2 * scale, support_break_name=name)
    elif number in {32, 40}:
        if slot == 1:
            buff(friends, ['hp'], .2 if number == 32 else .15)
        elif slot == 2:
            buff(friends, ['defense', 'magic_defense'], .2)
        elif number == 32:
            buff([strong], ['attack', 'magic_attack'], .2)
        else:
            buff(friends, ['attack'], .25)
            buff(foes, ['defense'], -.2)
    elif number == 39:
        if slot == 1:
            _heal(battle, caster, low, attack * 1.8)
        elif slot == 2:
            for target in friends:
                scale = _scale(caster, target, allies)
                shield(target, caster, skill.skill_id, attack * scale,
                       support_tick_heal=attack * .3 * scale)
        else:
            heal_all(2.5)
            for target in friends:
                if not _cross(caster, target, allies):
                    _cleanse(target)
    elif number == 47:
        if slot == 1:
            buff([strong], ['attack'], .2)
        elif slot == 2:
            buff([high], ['defense'], .25)
        else:
            buff(friends, ['hp', 'attack', 'magic_attack', 'defense', 'magic_defense'], .15)
    elif number == 48:
        page_index = random.randrange(9)
        page = '枯' if page_index < 4 else '荣' if page_index < 8 else '莲子'
        lotus = page == '莲子'
        battle._log(f'{caster.character.name}翻到{page}页', 'mechanic', {
            'caster_id': _id(caster), 'skill_id': skill.skill_id, 'page': page,
        })
        for target in friends:
            for mark in (['枯', '荣'] if lotus else [page]):
                add_mark(target, mark, caster, cap=3, remaining=4,
                         stats=['defense', 'magic_defense'] if mark == '枯'
                         else ['attack', 'magic_attack'])
                # Mark layers retain their own duration and cannot be dispelled.
                for layer in mark_layers(target, mark, _id(caster)):
                    layer['value'] = .05
            if lotus:
                scale = _scale(caster, target, allies)
                dry = len(mark_layers(target, '枯', _id(caster)))
                lush = len(mark_layers(target, '荣', _id(caster)))
                shield(target, caster, config_id + ':3',
                       attack * .15 * dry * scale)
                _hot(target, caster, '枯荣共鸣', amount=attack * .12 * lush * scale)
    elif number == 55:
        if slot == 1:
            for target in friends:
                _hot(target, caster, name, amount=attack * .4 * _scale(caster, target, allies))
        elif slot == 2:
            _heal(battle, caster, low, attack * 2.2)
        else:
            if _revive(battle, caster, allies, .3, .2):
                return True
            heal_all(1.5)
            for target in friends:
                _hot(target, caster, '光脉连结', amount=attack * .25 * _scale(caster, target, allies))
            if _id(caster) not in getattr(battle, '_support_revives', set()):
                add_mark(caster, '破虚', caster, support_revive_window=True)
                if not hasattr(battle, '_support_parties'):
                    battle._support_parties = {}
                battle._support_parties[_id(caster)] = (caster, list(allies))
    elif number == 56:
        if slot == 1:
            _hot(low, caster, name, amount=attack * .15)
            stat(low, caster, '晞', ['healing_received'], .8)
        elif slot == 2:
            target = max(friends, key=lambda u: u.max_health)
            stat(target, caster, '晓', ['defense', 'magic_defense'], .5)
        else:
            for target in friends:
                scale = _scale(caster, target, allies)
                shield(target, caster, skill.skill_id, attack * 2 * scale)
                if any(s.get('name') in {'晞', '晓'} for s in states(target)):
                    _heal(battle, caster, target, attack * .5 * scale)
    elif number == 63:
        for target in friends:
            if slot == 1:
                shield(target, caster, skill.skill_id, target.max_health * (.2 if len(allies) > 5 else .5))
                target.shield_mode = 'split'
            elif slot == 2:
                target.shield_mode = 'priority'
            else:
                states(target).append(dict(kind='support_conversion', name=name, remaining=2,
                                           owner=caster, owner_id=_id(caster),
                                           scale=_scale(caster, target, allies)))
                target.shield_mode = 'priority'
    elif number == 64:
        if slot == 1:
            buff(foes, ['element_in_DARK'], .2)
        elif slot == 2:
            def priority(unit):
                profession = getattr(getattr(unit.character, 'profession', None), 'profession_type', None)
                dark_dps = (unit.character.attribute.attribute_type.name == 'DARK'
                            and getattr(profession, 'name', '').endswith('_DPS'))
                return (not dark_dps, -_power(unit))
            buff(sorted(friends, key=priority)[:2], ['element_out_DARK'], .2)
        else:
            buff(friends, ['element_in_LIGHT'], -.2)
    return True


def on_shield_break(unit, shield):
    owner = shield.get('owner')
    if owner is None:
        return
    name = shield.get('support_break_name', shield['name'])
    if 'support_break_hot_value' in shield:
        _hot(unit, owner, name, value=shield['support_break_hot_value'])
    if 'support_break_hot_amount' in shield:
        _hot(unit, owner, name, amount=shield['support_break_hot_amount'])
    if 'support_break_heal' in shield:
        # Damage absorption happens before HP deduction; heal after the hit.
        unit._support_pending_heals = getattr(unit, '_support_pending_heals', [])
        unit._support_pending_heals.append((owner, shield['support_break_heal']))


def after_damage(unit, context):
    if context.get('is_attack', True):
        unit.cast_effects = [s for s in states(unit) if not s.get('support_hit_expire')]
    if context.get('old_health', 0) > 0 and unit.is_dead():
        guards = [s for s in states(unit) if s.get('support_survive')]
        if guards:
            unit.current_health = 1
            unit._sync_legacy_health_fields()
            unit.cast_effects.remove(guards[0])
    pending = getattr(unit, '_support_pending_heals', [])
    unit._support_pending_heals = []
    for owner, amount in pending:
        _heal(context.get('battle', getattr(unit, '_battle', None)), owner, unit, amount)


def after_cast(battle, unit, before):
    sync_max_health(unit)
    if not unit.is_alive():
        return
    for item in before:
        if item.get('support_tick_heal') and item.get('amount', 0) > 0:
            # Include a shield that just expired on this second subsequent cast.
            if any(s is item for s in states(unit)) or item.get('remaining') == 0:
                _heal(battle, item['owner'], unit, item['support_tick_heal'])
        if item['kind'] == 'support_conversion':
            if not (any(s is item for s in states(unit)) or item.get('remaining') == 0):
                continue
            shields = [s for s in before if s['kind'] == 'shield'
                       and (any(current is s for current in states(unit)) or s.get('remaining') == 0)]
            amount = sum(s['amount'] for s in shields)
            for current in shields:
                current['amount'] = 0
            unit.cast_effects = [s for s in states(unit) if not any(s is old for old in shields)]
            _heal(battle, item['owner'], unit, amount * item.get('scale', 1))


def on_death(battle, unit):
    for caster, party in getattr(battle, '_support_parties', {}).values():
        if unit not in party or unit is caster or not caster.is_alive():
            continue
        if any(s.get('support_revive_window') for s in states(caster)):
            _revive(battle, caster, party, .3, .2)


def battle_end(battle):
    battle._support_revives = set()
    battle._support_parties = {}
    for unit in list(getattr(battle, 'player_units', [])) + list(getattr(battle, 'enemy_units', [])):
        unit._support_pending_heals = []
        unit.shield_mode = 'priority'
