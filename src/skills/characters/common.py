"""Small stateless helpers; character-specific rules stay in their group."""
from ...combat.authored_monsters import states, modifiers


def alive(units):
    return [u for u in units if u.is_alive() and not getattr(u, 'mechanic_inactive', False)]


def mark_layers(unit, name, owner_id=None):
    return [s for s in states(unit) if s.get('kind') == 'mark' and s.get('name') == name
            and (owner_id is None or s.get('owner_id') == owner_id)]


def add_mark(unit, name, owner, count=1, cap=None, remaining=2, **extra):
    owner_id = owner.character.character_id
    existing = mark_layers(unit, name, owner_id)
    count = count if cap is None else min(count, max(0, cap - len(existing)))
    for _ in range(count):
        states(unit).append(dict(kind='mark', name=name, value=1, remaining=remaining,
            owner_id=owner_id, source_skill=f'{owner_id}:{name}', unique_mark=True, **extra))


def stat(unit, owner, name, stats, value, remaining=2, **extra):
    states(unit).append(dict(kind='stat', name=name, stats=stats, value=value,
        remaining=remaining, owner_id=owner.character.character_id,
        source_skill=f'{owner.character.character_id}:{name}', **extra))


def shield(unit, owner, skill_id, amount, remaining=2, **extra):
    source = f'{owner.character.character_id}:{skill_id}'
    unit.cast_effects = [s for s in states(unit) if not (s['kind'] == 'shield' and s.get('source_skill') == source)]
    item = dict(kind='shield', name=skill_id, source_skill=source, amount=max(0, amount),
                initial_amount=max(0, amount), remaining=remaining, owner=owner, **extra)
    states(unit).append(item)
    return item
