"""Effects for tanks 33/34/41/42/49/50/57/58; see the questions document.

The caller owns the cast lifecycle. Resource pools are persistent marks, never
duration-bearing storage modes. Leaf rules follow the user's latest ruling.
"""
from copy import copy

from .common import alive, modifiers, shield, states, stat


CONFIG_IDS = {
    'char_033_fire_physical_tank', 'char_034_fire_magic_tank',
    'char_041_wood_physical_tank', 'char_042_wood_magic_tank',
    'char_049_light_physical_tank', 'char_050_light_magic_tank',
    'char_057_dark_physical_tank', 'char_058_dark_magic_tank',
}
READY_CONFIG_IDS = set(CONFIG_IDS)
GROUP = 'tanks_second'
HEAT = '\u707c\u70ed'
BIND = '\u707c\u7f1a'
CALAMITY = '\u5384\u6d41'
LEAVES = '\u843d\u53f6\u503c'
PERSUADE = '\u611f\u5316'
BLESS = '\u52a0\u6301'
BLOOD = '\u6de4\u8840'
BRUISE = '\u6de4\u9752'


def _id(unit):
    return getattr(unit.character, 'character_config_id', None)


def _has(unit, key):
    return any(s.get('tank_key') == key for s in states(unit))


def _remove(unit, key):
    unit.cast_effects = [s for s in states(unit) if s.get('tank_key') != key]


def _effect(unit, name, kind='mark', remaining=2, **extra):
    item = dict(kind=kind, name=name, value=0, remaining=remaining,
                owner_id=unit.character.character_id, group=GROUP,
                source_skill=f'{unit.character.character_id}:{name}', **extra)
    if kind == 'mark':
        item['unique_mark'] = True
    states(unit).append(item)
    return item


def _pool(unit, name):
    item = next((s for s in states(unit) if s.get('group') == GROUP
                 and s.get('name') == name and s.get('resource')), None)
    return item if item is not None else _effect(unit, name, remaining=None, resource=True)


def _stat(unit, owner, name, names, value, **extra):
    stat(unit, owner, name, names, value, group=GROUP, **extra)


def _mode(unit, key, value, remaining):
    _remove(unit, key)
    item = _effect(unit, key, remaining=remaining, tank_key=key)
    item['value'] = value
    return item


def _layers(target, owner, name, **extra):
    layers = [s for s in states(target) if s.get('name') == name
              and s.get('owner_id') == owner.character.character_id]
    if len(layers) < 3:
        item = _effect(target, name, remaining=7, **extra)
        item['owner_id'] = owner.character.character_id
        item['source_skill'] = f'{owner.character.character_id}:{name}'
        item['value'] = .1


def attach(battle, unit):
    if _id(unit) not in CONFIG_IDS:
        return
    if getattr(unit, '_tanks_second_battle', None) is battle:
        return
    unit.cast_effects = [s for s in states(unit) if s.get('group') != GROUP]
    unit._tanks_second_battle = battle
    unit._tanks_second_settled = False
    roster = getattr(battle, '_tanks_second_units', None)
    if roster is None:
        roster = battle._tanks_second_units = []
    if not any(u is unit for u in roster):
        roster.append(unit)


def _hit(battle, caster, skill, target, ratio, physical=False, amount=None):
    attacker = copy(caster.character)
    buffs = dict(modifiers(caster))
    if amount is not None:
        attacker.attack = attacker.magic_attack = amount
        buffs['attack'] = buffs['magic_attack'] = 0
    result = battle.damage_calculator.calculate_damage(
        attacker, target.character, 0, physical, ratio, buffs, modifiers(target))
    raw = result['final_damage']
    dealt = target.take_damage(raw if physical else 0, 0 if physical else raw, source=caster)
    details = dict(physical_damage=dealt if physical else 0,
                   magical_damage=0 if physical else dealt,
                   physical_result=result if physical else {},
                   magical_result={} if physical else result)
    if dealt:
        battle._record_damage(caster, target, dealt, details, skill, 'skill')
        battle.threat_system.add_threat_from_damage(caster, target, dealt)
    battle._log(f'{target.character.name}受到{dealt}伤害', 'damage', {
        'caster_id': caster.character.character_id, 'target_id': target.character.character_id,
        'skill_id': skill.skill_id, 'amount': dealt, 'raw_amount': raw,
        'is_crit': result['is_crit'],
    })
    if target.is_dead():
        battle._on_enemy_killed(target)
    return dealt


def _fixed_magic(battle, caster, skill, target, amount):
    # Reuse the standard calculator with a copied attack basis, not true damage.
    if amount <= 0:
        return
    _hit(battle, caster, skill, target, 1, amount=amount)


def _health_loss(battle, unit, amount):
    # Health costs/deferred repayment must not feed storage or consume shields.
    old = unit.current_health
    unit.current_health = max(0, old - max(0, int(amount)))
    unit._sync_legacy_health_fields()
    if old > 0 and unit.is_dead():
        from .registry import hook
        unit.death_time = battle.current_time
        unit.death_serial = getattr(unit, 'death_serial', 0) + 1
        hook('on_death', battle, unit)
        unit._sync_legacy_health_fields()
        if unit.is_dead():
            battle._on_enemy_killed(unit)


def cast(battle, caster, skill, allies, enemies) -> bool:
    config = _id(caster)
    slot = skill.authored_effect.get('slot')
    if config not in CONFIG_IDS or slot not in (1, 2, 3) or not caster.is_alive():
        return False
    attach(battle, caster)
    enemies = alive(enemies)
    name = skill.name
    if config == 'char_033_fire_physical_tank':
        if slot == 1:
            _stat(caster, caster, HEAT, ['defense'], .05, tank_key='heat')
        elif slot == 2:
            _mode(caster, 'fire_thorns', 1, 2)
        elif any(any(s.get('name') == BIND for s in states(e)) for e in enemies):
            _stat(caster, caster, name, ['defense'], .1)
            _stat(caster, caster, name, ['element_in_WOOD'], -.06)
    elif config == 'char_034_fire_magic_tank':
        _remove(caster, 'calamity_mode')
        if slot in (1, 2):
            _mode(caster, 'calamity_mode', .35 if slot == 1 else .8, 1)
        else:
            pool = _pool(caster, CALAMITY)
            amount = min(pool['value'], pool['value'] * (.35 + int(pool['value'] // 100) * .01))
            pool['value'] -= amount
            caster.heal(int(amount), 0)
            _stat(caster, caster, name, ['magic_defense'], .25)
    elif config == 'char_041_wood_physical_tank':
        if slot == 1:
            _mode(caster, 'hardwood', 1, 2)
        elif slot == 2:
            _stat(caster, caster, name, ['element_in_WIND'], -.45)
        else:
            hot = _effect(caster, name, kind='hot')
            hot['value'] = .15
            _stat(caster, caster, name, ['defense'], .2)
    elif config == 'char_042_wood_magic_tank':
        if slot == 1:
            pool = _pool(caster, LEAVES)
            consumed = min(pool['value'], caster.max_health * .25)
            pool['value'] -= consumed
            caster.heal(int(consumed), 0)
        elif slot == 2:
            pool = _pool(caster, LEAVES)
            if pool['value'] > 0:
                _stat(caster, caster, name, ['magic_defense'], pool['value'] / caster.max_health)
            pool['value'] = 0
        else:
            for target in alive(allies):
                _stat(target, caster, name, ['magic_defense'], .25)
    elif config == 'char_049_light_physical_tank':
        if slot == 1:
            for target in alive(allies):
                _stat(target, caster, name, ['defense'], .2)
        elif slot == 2:
            if not enemies:
                return False
            target = enemies[0]
            _hit(battle, caster, skill, target, 2, physical=True)
            if target.is_alive():
                _stat(target, caster, name, ['attack'], -.2)
        else:
            _stat(caster, caster, name, ['element_in_DARK'], -.5)
    elif config == 'char_050_light_magic_tank':
        if slot == 1:
            if not enemies:
                return False
            target = enemies[0]
            _hit(battle, caster, skill, target, 1.5)
            if target.is_alive():
                _layers(target, caster, PERSUADE, tank_key='persuade')
        elif slot == 2:
            _layers(caster, caster, BLESS, stats=['magic_defense'])
        else:
            caster.heal(int(caster.max_health * .15), 0)
    elif config == 'char_057_dark_physical_tank':
        if slot == 1:
            _stat(caster, caster, name, ['defense'], .25)
        elif slot == 2:
            armor = shield(caster, caster, skill.skill_id, int(caster.max_health * .2),
                           group=GROUP, tank_key='bone_armor')
            _remove(caster, 'bone_record')
            _effect(caster, 'bone_record', tank_key='bone_record', armor=armor)
        else:
            record = next((s for s in states(caster) if s.get('tank_key') == 'bone_record'), None)
            if record:
                item = record['armor']
                missing = max(0, item['initial_amount'] - item['amount'])
                item['amount'] += missing * .6
                if not any(s is item for s in states(caster)) and item['amount'] > 0:
                    states(caster).append(item)
            _health_loss(battle, caster, caster.max_health * .1)
    elif config == 'char_058_dark_magic_tank':
        if slot == 1:
            _mode(caster, 'blood_mode', .4, 2)
        elif slot == 2:
            blood = _pool(caster, BLOOD)
            converted = blood['value'] * .4
            if converted > 0:
                blood['value'] -= converted
                _pool(caster, BRUISE)['value'] += converted
                old_max = caster.max_health
                _stat(caster, caster, BRUISE, ['hp'], -.05, remaining=None,
                      unique_mark=True, tank_key='bruise_hp_loss')
                from .registry import sync_max_health
                sync_max_health(caster)
                _pool(caster, 'bruise_hp_lost')['value'] += old_max - caster.max_health
                _mode(caster, 'pending_dark_attack', 1, None)
        else:
            total = _pool(caster, BLOOD)['value'] + _pool(caster, BRUISE)['value']
            _pool(caster, BLOOD)['value'] = _pool(caster, BRUISE)['value'] = 0
            _health_loss(battle, caster, caster.max_health * .2)
            if caster.is_dead():
                return True
            old_max = caster.max_health
            _remove(caster, 'bruise_hp_loss')
            from .registry import sync_max_health
            sync_max_health(caster)
            caster.heal(max(0, caster.max_health - old_max), 0)
            _pool(caster, 'bruise_hp_lost')['value'] = 0
            for target in enemies:
                _fixed_magic(battle, caster, skill, target, total * 2.5)
    return True


def before_damage(unit, physical, magical, context) -> tuple:
    source = context.get('source')
    if source is not None and not context.get('is_true'):
        reduction = min(1, sum(s['value'] for s in states(source)
                               if s.get('tank_key') == 'persuade'))
        physical, magical = physical * (1 - reduction), magical * (1 - reduction)
    config = _id(unit)
    if config not in CONFIG_IDS or not unit.is_alive() or getattr(unit, '_tanks_second_settled', False):
        return physical, magical
    key, name, cap = None, None, None
    if config == 'char_034_fire_magic_tank':
        key, name = 'calamity_mode', CALAMITY
    elif config == 'char_042_wood_magic_tank':
        pool = _pool(unit, LEAVES)
        stored = min(max(0, magical) * .3, max(0, unit.max_health * .5 - pool['value']))
        pool['value'] += stored
        return physical, round(magical - stored, 10)
    elif config == 'char_058_dark_magic_tank':
        key, name, cap = 'blood_mode', BLOOD, unit.max_health * .5
    mode = next((s for s in states(unit) if s.get('tank_key') == key), None) if key else None
    total = physical + magical
    if mode is not None and total > 0:
        pool = _pool(unit, name)
        stored = total * mode['value']
        if cap is not None:
            stored = min(stored, max(0, cap - pool['value']))
        pool['value'] += stored
        physical = round(physical * (1 - stored / total), 10)
        magical = round(magical * (1 - stored / total), 10)
    return physical, magical


def before_skill(battle, caster, skill):
    if _id(caster) != 'char_058_dark_magic_tank':
        return
    caster._bruise_skill = dict(skill=skill, targets=set(), applying=False,
        amount=_pool(caster, 'bruise_hp_lost')['value'] * .2
        if _has(caster, 'pending_dark_attack') else 0)


def after_skill(battle, caster, skill):
    caster.__dict__.pop('_bruise_skill', None)


def after_damage(unit, context):
    config = _id(unit)
    source = context.get('source')
    bonus = getattr(source, '_bruise_skill', None)
    if (bonus and bonus['amount'] > 0 and not bonus['applying']
            and context.get('is_attack') and source.is_alive()
            and source.is_player != unit.is_player
            and context.get('physical', 0) + context.get('magical', 0) > 0
            and unit.character.character_id not in bonus['targets']):
        bonus['targets'].add(unit.character.character_id)
        _remove(source, 'pending_dark_attack')
        if unit.is_alive():
            bonus['applying'] = True
            try:
                _fixed_magic(context['battle'], source, bonus['skill'], unit, bonus['amount'])
            finally:
                bonus['applying'] = False
    if not context.get('is_attack') or context.get('is_true'):
        return
    if config == 'char_033_fire_physical_tank' and source is not None:
        if source.is_player != unit.is_player and source.is_alive() and _has(unit, 'heat') and _has(unit, 'fire_thorns'):
            _stat(source, unit, BIND, ['attack'], -.2)
    elif config == 'char_041_wood_physical_tank' and unit.is_alive():
        if context.get('physical', 0) > 0 and _has(unit, 'hardwood'):
            _stat(unit, unit, 'hardwood_health', ['hp'], .2)
            from .registry import sync_max_health
            sync_max_health(unit)


def after_cast(battle, unit, before):
    if _id(unit) != 'char_057_dark_physical_tank':
        return
    record = next((s for s in states(unit) if s.get('tank_key') == 'bone_record'), None)
    if record:
        record['armor']['remaining'] = record['remaining']
    else:
        _remove(unit, 'bone_armor')


def on_death(battle, unit):
    # A death is not a battle end: retain outstanding blood for final settlement.
    pass


def on_shield_break(unit, shield):
    if shield.get('tank_key') == 'bone_armor':
        shield['amount'] = 0


def battle_end(battle):
    for unit in getattr(battle, '_tanks_second_units', []):
        if getattr(unit, '_tanks_second_settled', False):
            continue
        unit._tanks_second_settled = True
        if _id(unit) == 'char_058_dark_magic_tank':
            pool = _pool(unit, BLOOD)
            amount, pool['value'] = pool['value'], 0
            _remove(unit, 'blood_mode')
            _health_loss(battle, unit, amount)
