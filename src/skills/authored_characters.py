"""Explicitly implemented character skills, independent of generic templates."""
import json
from copy import copy
from pathlib import Path

from ..combat.skill_system import Skill, SkillLogic, SkillTier
from ..combat.authored_monsters import begin_cast, end_cast, modifiers, states

DEFINITIONS = json.loads((Path(__file__).resolve().parents[2] / 'data/content/authored-character-skills.json').read_text(encoding='utf-8'))['characters']


def library(character, include_drafts=False):
    config_id = getattr(character, 'character_config_id', character.character_id)
    result = {}
    effects = DEFINITIONS.get(config_id, [])
    if include_drafts and not effects:
        catalog = json.loads((Path(__file__).resolve().parents[2] / 'data/content/characters.json').read_text(encoding='utf-8-sig'))
        row = next((item for item in catalog['characters'] if item['id'] == config_id), None)
        effects = [] if row is None else [dict(slot=item['slot'], name=item['name'],
            kind='custom', description=item['effect']) for item in row['skills']]
    for effect in effects:
        skill_id = f"{config_id}:{effect['slot']}"
        skill = Skill(skill_id, effect['name'], SkillLogic['ABC'[effect['slot'] - 1]],
                      SkillTier.LOW, description=effect['description'])
        skill.authored_effect = effect
        result[skill_id] = skill
    return result


def damage(battle, caster, skill, target, ratio):
    if target.is_dead():
        return 0
    effect = skill.authored_effect
    physical = effect['damageType'] == 'physical'
    attacker = copy(caster.character)
    buffs = modifiers(caster)
    buffs['ignore_defense'] = buffs.get('ignore_defense', 0) + effect.get('ignore_defense', 0)
    defenses = modifiers(target)
    if any(s['kind'] == 'magical_crit_immunity' for s in states(target)):
        defenses['crit_immune_magical'] = 1
    health_basis = effect.get('health_ratio')
    if health_basis:
        base = target.current_health if health_basis == 'current' else target.max_health
        attacker.attack = attacker.magic_attack = base
        buffs['attack'] = buffs['magic_attack'] = 0
        buffs['no_damage_floor'] = True
    is_true = bool(effect.get('true_damage'))
    if is_true:
        stat_name = 'attack' if physical else 'magic_attack'
        raw = int(max(0, (getattr(attacker, stat_name) + buffs.get(stat_name, 0)) * ratio))
        result = {'final_damage': raw, 'is_crit': False, 'is_physical': physical}
    else:
        result = battle.damage_calculator.calculate_damage(attacker, target.character, 0,
            physical, ratio, buffs, defenses)
        raw = result['final_damage']
    if not is_true and attacker.attribute.attribute_type.name == 'FIRE':
        absorption = min(1, sum(s['value'] for s in states(target) if s['kind'] == 'absorb_fire'))
        if absorption:
            target.heal(int(raw * absorption), 0)
            raw = int(raw * (1 - absorption))
    dealt = target.take_damage(raw if physical else 0, 0 if physical else raw, source=caster, is_true=is_true)
    details = {'physical_damage': dealt if physical else 0, 'magical_damage': 0 if physical else dealt,
               'physical_result': result if physical else {}, 'magical_result': {} if physical else result}
    if dealt:
        battle._record_damage(caster, target, dealt, details, skill, 'skill')
        battle.threat_system.add_threat_from_damage(caster, target, dealt)
    battle._log(f'{target.character.name} 受到 {dealt} 伤害', 'damage', {
        'caster_id': caster.character.character_id, 'target_id': target.character.character_id,
        'skill_id': skill.skill_id, 'amount': dealt, 'raw_amount': raw, 'is_crit': result['is_crit'],
    })
    if target.is_dead():
        battle._log(f'{target.character.name} 被击败', 'death')
        battle._on_enemy_killed(target)
    return dealt


def cast(battle, caster, skill, allies, enemies):
    effect = skill.authored_effect
    if effect['kind'] == 'custom':
        from .characters.registry import find_handler, sync_max_health
        config_id = getattr(caster.character, 'character_config_id', '')
        handler = find_handler(config_id)
        if handler is None:
            raise ValueError(f'No authored handler for {config_id}')
        if caster.is_dead():
            return False
        before = begin_cast(caster)
        # Handlers own effects only; all hits share this single cast lifecycle.
        log_index = len(battle.battle_log)
        if not handler.cast(battle, caster, skill, allies, enemies):
            return False
        skill.use()
        battle._log(f'{caster.character.name} 使用技能 {skill.name}', 'skill', {
            'caster_id': caster.character.character_id, 'skill_id': skill.skill_id,
            'skill_name': skill.name,
        })
        event = battle.battle_log.pop()
        battle.battle_log.insert(log_index, event)
        for unit in allies + enemies:
            sync_max_health(unit)
        end_cast(battle, caster, before)
        return True
    pool = enemies if effect['kind'] == 'damage' else allies
    targets = [unit for unit in pool if unit.is_alive() and not getattr(unit, 'mechanic_inactive', False)]
    enemy_count = len(targets)
    if effect['target'] == 'self':
        targets = [caster] if caster.is_alive() else []
    elif effect['target'] == 'lowest_health':
        targets = sorted(targets, key=lambda unit: unit.current_health)[:1]
    elif effect['target'] == 'highest_health':
        targets = sorted(targets, key=lambda unit: unit.current_health, reverse=True)[:1]
    if not targets:
        return
    before = begin_cast(caster)
    skill.use()
    battle._log(f'{caster.character.name} 使用技能 {skill.name}', 'skill', {
        'caster_id': caster.character.character_id, 'skill_id': skill.skill_id,
        'skill_name': skill.name, 'target_count': len(targets),
    })
    attack = max(0, caster.character.attack + modifiers(caster).get('attack', 0))
    if effect['kind'] == 'damage':
        ratio = effect.get('conditionalRatio', effect['ratio']) if enemy_count <= effect.get('enemyCountMax', -1) else effect['ratio']
        for target in targets:
            for _ in range(effect.get('hits', 1)):
                if not target.is_alive():
                    break
                damage(battle, caster, skill, target, ratio)
        end_cast(battle, caster, before)
        return True
    for target in targets:
        # Party order is the authoritative four squads of five, including dead members.
        cross_squad = len(allies) > 5 and allies.index(caster) // 5 != allies.index(target) // 5
        scale = .5 if effect['target'] == 'all' and cross_squad else 1
        base = caster.max_health if effect.get('scaling') == 'max_health' else attack
        amount = int(base * effect['ratio'] * scale)
        if effect['kind'] == 'heal':
            old = target.current_health
            target.heal(amount, 0)
            amount = max(0, target.current_health - old)
            battle.threat_system.add_threat_from_heal(caster, target, amount)
        elif effect['kind'] == 'shield':
            source = f'{caster.character.character_id}:{skill.skill_id}'
            target.cast_effects = [item for item in states(target) if not (item['kind'] == 'shield' and item.get('source_skill') == source)]
            states(target).append(dict(kind='shield', name=skill.name, source_skill=source,
                                       amount=amount, remaining=effect['casts']))
        elif effect['kind'] in {'stat', 'attack_reduction'}:
            states(target).append(dict(kind=effect['kind'], name=skill.name,
                source_skill=f'{caster.character.character_id}:{skill.skill_id}',
                value=effect['ratio'], stats=effect.get('stats', []), remaining=effect['casts']))
            amount = effect['ratio']
        else:
            raise ValueError(f"Unsupported character effect: {effect['kind']}")
        battle._log(f'{target.character.name}：{skill.name} {amount}', effect['kind'], {
            'caster_id': caster.character.character_id, 'target_id': target.character.character_id,
            'skill_id': skill.skill_id, 'amount': amount,
        })
    end_cast(battle, caster, before)
    return True
