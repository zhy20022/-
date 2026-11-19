"""Effects of a bound exclusive weapon, resolved as part of its owner's skill."""
from copy import copy

from ...combat.authored_monsters import states
from . import dps_first as first, dps_second as second
from .common import alive, mark_layers, shield, stat


def enabled(unit):
    config = getattr(unit.character, 'character_config_id', None)
    weapon = getattr(unit.character, 'exclusive_weapon', None)
    return unit.is_player and config and getattr(weapon, 'authored_config_id', None) == config


def number(unit):
    return int(unit.character.character_config_id.split('_')[1])


def marks(unit, label, owner):
    return mark_layers(unit, label, owner.character.character_id)


def status(unit, owner, label, keys, amount):
    unit.cast_effects = [item for item in states(unit) if not (
        item.get('name') == label and item.get('owner_id') == owner.character.character_id)]
    stat(unit, owner, label, keys, amount)


def ward(unit, owner, label, amount):
    if unit.is_alive():
        shield(unit, owner, f'exclusive:{label}', int(amount), 2)


def heal(unit, amount):
    if unit.is_alive():
        unit.heal(int(amount), 0)


def before_cast(battle, caster, skill, enemies):
    n, slot = number(caster), skill.authored_effect['slot']
    targets = sorted(alive(enemies), key=lambda t: t.current_health, reverse=True)
    primary = targets[0] if targets else None
    before = dict(targets=targets)
    if n == 6 and slot == 2 and primary:
        before['mirages'] = marks(primary, '随引幻影', caster)
    if n == 11 and slot == 3 and primary:
        before['prepared'] = any(item.get('name') == '裂甲' for item in states(primary))
    if n == 22 and slot == 3 and primary:
        layers = len(marks(primary, '迓', caster))
        seen = getattr(caster, '_exclusive_starter_targets', set())
        if 0 < layers < 3 and primary not in seen:
            first._mark(primary, caster, skill, '迓', cap=3, stats=('element_in_THUNDER',), value=.05)
            caster._exclusive_starter_targets = seen | {primary}
    if n == 30 and slot == 3:
        before['prepared'] = bool(marks(caster, '转折', caster))
    if n == 36 and slot == 3 and primary:
        before['prepared'] = len(marks(primary, '火毒', caster)) >= 6
    if n in (13, 28) and slot == 3 and primary:
        labels = {13: ('蚀骨', '炽火'), 28: ('气滞', '风压')}[n]
        owned = {item.get('name') for item in states(primary)
                 if item.get('owner_id') == caster.character.character_id}
        before['prepared'] = owned.issuperset(labels)
    if slot == 3 and n in (3, 43, 44, 45, 46, 60, 61):
        label = {3: '水蚀印记', 43: '青痕', 44: '朱砂印', 45: '花痕',
                 46: '絮蚀', 60: '太阴引', 61: '丝线'}[n]
        before['marked'] = {t for t in targets if len(marks(t, label, caster)) >= (2 if n == 61 else 1)}
    if n == 51 and slot == 3:
        before['damage'] = total_damage(battle, caster)
    if n in (57, 58) and slot == 3:
        from . import tanks_second as tanks
        if n == 57:
            record = next((s for s in states(caster) if s.get('tank_key') == 'bone_record'), None)
            armor = record['armor'] if record else None
            before['repair'] = bool(armor and armor['initial_amount'] > armor['amount'])
            before['hp'] = caster.current_health
        else:
            pool = sum(tanks._pool(caster, key)['value'] for key in (tanks.BLOOD, tanks.BRUISE))
            before['pool'] = pool
            ward(caster, caster, 'clear-buffer', min(pool * .2, caster.max_health * .15))
    return before


def total_damage(battle, caster):
    return battle.damage_stats.get(caster.character.character_id, {}).get('total_damage', 0)


def after_cast(battle, c, s, allies, enemies, before):
    from ..authored_characters import damage

    n, slot = number(c), s.authored_effect['slot']
    targets = before['targets']
    size = len(targets)
    primary = targets[0] if targets else None
    others = alive(targets[1:])
    prepared = before.get('prepared')
    marked = before.get('marked', set())
    profession = c.character.profession.profession_type.name
    magical = profession.startswith('MAGIC_')
    attack = c.character.magic_attack if magical else c.character.attack
    segment = copy(s)
    segment.authored_effect = dict(s.authored_effect, damageType='magical' if magical else 'physical')

    def hit(target, ratio):
        if target and target.is_alive() and not getattr(target, 'mechanic_inactive', False) and ratio > 0:
            damage(battle, c, segment, target, round(ratio, 12))

    if not profession.endswith('_DPS'):
        role_bonus(c, slot, allies, enemies, before)
    elif n == 3 and slot == 3:
        for t in [t for t in others if t in marked][:4]:
            hit(t, .75)
            first._clear(t, '水蚀印记', c, 1)
    elif n == 4 and slot == 3:
        for t in targets[:5]:
            hit(t, 1.8 if size == 1 else .4)
    elif n == 5 and slot == 3 and primary and marks(primary, '浸水', c):
        hit(primary, 1.8 if size == 1 else 1.2)
    elif n == 6 and slot == 2 and primary:
        if any(all(layer is not prev for prev in before['mirages'])
               for layer in marks(primary, '随引幻影', c)):
            hit(primary, 4.05 if size == 2 else 1.6)
    elif n == 11 and slot == 3 and not prepared:
        hit(primary, .55)
    elif n == 12 and slot == 3:
        for t in targets:
            if .4 <= t.current_health / t.max_health <= .6:
                hit(t, .8)
    elif n in (13, 28) and slot == 3 and prepared:
        for t in others[:4]:
            hit(t, .8 if n == 13 else 1.2)
    elif n == 14 and slot == 2:
        for t in alive(enemies):
            if not marks(t, '脉痕', c):
                first._mark(t, c, s, '脉痕', cap=1, stats=('magic_defense',), value=-.15)
    elif n == 19 and slot == 3:
        for t in sorted(others, key=lambda t: t.current_health, reverse=True)[:3]:
            hit(t, 1.2)
    elif n == 20 and slot == 3 and size > 6:
        for t in sorted(alive(enemies), key=lambda t: t.current_health, reverse=True)[:6]:
            hit(t, 1)
    elif n == 21 and slot in (1, 2):
        seen = getattr(c, '_exclusive_arrow_targets', set())
        for t in alive(targets[:1] if slot == 1 else targets):
            if t not in seen:
                first._mark(t, c, s, '雷痕', count=2, remaining=None)
                seen.add(t)
        c._exclusive_arrow_targets = seen
    elif n == 27 and slot in (1, 2):
        hit(primary, .8)
    elif n == 29 and slot == 3 and 2 <= size <= 3:
        hit(primary, .5)
    elif n == 30 and slot == 3:
        if not prepared:
            hit(primary, 1)
        elif size == 2:
            hit(primary, .5)
    elif n == 36 and slot == 3 and prepared:
        for t in others[:2]:
            hit(t, .85)
    elif n == 37 and slot == 3 and size <= 2:
        hit(primary, .6)
    elif n == 38 and slot == 3 and 3 <= size <= 5:
        hit(primary, 3)
    elif n == 43 and slot == 3:
        for t in sorted((t for t in others if t in marked), key=lambda t: t.current_health, reverse=True)[:4]:
            hit(t, 1.5)
            second._remove(t, '青痕', c, 1)
    elif n == 44 and slot == 3 and primary:
        if primary not in marked:
            hit(primary, 1.5)
        elif primary.is_alive():
            retained = 4 if size == 2 else 2
            second._mark(primary, c, s, '朱砂印', count=retained, cap=retained, remaining=None)
    elif n == 45 and slot == 3 and primary in marked:
        for t in [t for t in others if t in marked][:3]:
            hit(t, .75)
            second._remove(t, '花痕', c, 1)
    elif n == 46 and slot == 3:
        for t in alive(targets[:5]):
            if t in marked:
                second._mark(t, c, s, '絮蚀', count=2 if size == 3 else 1, cap=5, remaining=None)
    elif n == 51 and slot == 3:
        dealt = total_damage(battle, c) - before['damage']
        fallback = max(others, key=lambda t: t.current_health, default=None)
        hit(primary if primary and primary.is_alive() else fallback, min(1.8, dealt * .2 / max(1, attack)))
        ward(c, c, 'lance', c.max_health * .06)
    elif n == 52:
        if slot == 2:
            c._exclusive_sun_targets = sorted(others, key=lambda t: t.current_health, reverse=True)[:4]
        elif slot == 3:
            for t in getattr(c, '_exclusive_sun_targets', ()):
                hit(t, 1)
            c._exclusive_sun_targets = []
    elif n == 53 and slot == 3:
        if size < 5:
            hit(primary, (5 - size) * .5)
        elif size > 5:
            for t in alive(targets[5:])[:5]:
                hit(t, .6)
    elif n == 54:
        if slot == 1:
            c._exclusive_dew = min(3, getattr(c, '_exclusive_dew', 0) + 1)
        elif slot == 3:
            hit(primary, .8 * getattr(c, '_exclusive_dew', 0))
            c._exclusive_dew = 0
    elif n == 59 and any(t.is_dead() for t in targets):
        for t in sorted(alive(enemies), key=lambda t: t.current_health, reverse=True)[:4]:
            hit(t, .8)
        heal(c, c.max_health * .05)
    elif n == 60 and slot == 3 and primary in marked and others:
        second._mark(max(others, key=lambda t: t.current_health), c, s, '太阴引', cap=3)
    elif n == 61 and slot == 3:
        for t in alive(targets):
            if t in marked:
                second._mark(t, c, s, '丝线', cap=10, remaining=None)
    elif n == 62 and slot == 1 and primary:
        seen = getattr(c, '_exclusive_paper_targets', set())
        if primary not in seen:
            hit(primary, .7)
            c._exclusive_paper_targets = seen | {primary}


def role_bonus(c, slot, allies, enemies, before):
    n = number(c)
    team = alive(allies)
    low = sorted(team, key=lambda t: t.current_health / t.max_health)
    other = [t for t in team if t is not c]
    attack = max(c.character.attack, c.character.magic_attack)
    mh = c.max_health
    if n in (1, 18) and slot == 3 and other:
        ward(min(other, key=lambda t: t.current_health / t.max_health), c, 'ally', mh * .08)
    elif n == 7 and slot == 3:
        for t in low[:5]:
            heal(t, attack * .4)
    elif n in (8, 16, 31, 47, 48, 63, 64) and slot == (1 if n == 31 else 3):
        for index, t in enumerate(allies):
            if t not in team:
                continue
            scale = 1 if index // 5 == allies.index(c) // 5 else .5
            if n == 31:
                heal(t, attack * .4 * scale)
            else:
                amount = t.max_health * .04 if n == 63 else attack * {8: .4, 16: .5, 47: .4, 48: .3, 64: .6}[n]
                ward(t, c, 'team', amount * scale)
    elif n == 15 and slot == 2:
        for t in low[:5]:
            ward(t, c, 'mixed', attack * .3)
    elif n == 17 and slot == 2:
        status(c, c, '专属法防', ['magic_defense'], .15)
    elif n == 23 and slot == 3 and low:
        ward(low[0], c, 'revival-buffer', low[0].max_health * .15)
    elif n == 24:
        if slot == 1:
            for t in alive(enemies)[:1]:
                status(t, c, '专属困局', ['magic_defense'], -.1)
        elif slot == 2:
            for t in team:
                status(t, c, '专属破阵', ['magic_attack'], .1)
    elif n == 32 and slot == 2 and team:
        status(max(team, key=lambda t: t.character.magic_attack), c, '专属法攻鼓舞', ['magic_attack'], .2)
    elif n == 39 and slot == 1 and low and low[0].current_health / low[0].max_health < .35:
        ward(low[0], c, 'emergency', low[0].max_health * .08)
    elif n == 40 and slot == 3:
        for t in team:
            status(t, c, '专属法攻铁花', ['magic_attack'], .12)
    elif n == 50 and slot == 3 and c.current_health / mh < .35:
        ward(c, c, 'persuasion', mh * .08)
    elif n == 55 and slot == 1 and len(low) > 1:
        heal(low[1], attack * .3)
    elif n == 56 and slot == 3:
        for t in low[:3]:
            ward(t, c, 'support-cover', attack * .3)
    elif n == 57 and slot == 3 and not before['repair']:
        heal(c, max(0, before['hp'] - c.current_health))
    elif n == 58 and slot == 3 and before['pool'] >= mh * .2:
        heal(c, mh * .08)
    else:
        rules = {2: (3, .1), 9: (1, .1), 10: (3, .08), 25: (3, .12),
                 33: (1, .12), 34: (3, .1), 41: (3, .08), 42: (3, .08), 49: (3, .15)}
        if n in rules and slot == rules[n][0]:
            ward(c, c, 'self', mh * rules[n][1])
