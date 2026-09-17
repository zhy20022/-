from copy import copy
from unittest.mock import patch

from tests.test_authored_characters import AuthoredCharacterTests
from src.combat.authored_monsters import states
from src.skills.authored_characters import damage, library


def encounter():
    battle, caster, enemies = AuthoredCharacterTests().damage_encounter('char_051_light_physical_melee_dps', 1)
    target = enemies[0]
    target.character.defense = target.character.magic_defense = 100
    battle.damage_calculator.base_crit_rate = 0
    skill = copy(library(caster.character)['char_051_light_physical_melee_dps:1'])
    return battle, caster, target, skill


def test_penetration_and_percent_health_damage_have_no_attack_floor():
    battle, caster, target, skill = encounter()
    skill.authored_effect = dict(skill.authored_effect, ignore_defense=1)
    assert damage(battle, caster, skill, target, 1) == 100
    skill.authored_effect = dict(skill.authored_effect, health_ratio='max')
    assert damage(battle, caster, skill, target, .03) == int(target.max_health * .03)


def test_true_damage_ignores_mitigation_but_still_consumes_shield():
    battle, caster, target, skill = encounter()
    states(target).extend([
        dict(kind='stat', stats=['damage_reduction'], value=.9, remaining=2),
        dict(kind='shield', amount=50, remaining=2),
    ])
    skill.authored_effect = dict(skill.authored_effect, true_damage=True)
    assert damage(battle, caster, skill, target, 1) == 50


def test_crit_rate_bonus_and_immunity_are_applied():
    battle, caster, target, skill = encounter()
    states(caster).append(dict(kind='stat', stats=['crit_rate'], value=1, remaining=2))
    with patch('random.random', return_value=.99):
        assert damage(battle, caster, skill, target, 1) == 75
        states(target).append(dict(kind='stat', stats=['crit_immune_physical'], value=1, remaining=2))
        assert damage(battle, caster, skill, target, 1) == 50


def test_zero_multiplier_does_not_deal_minimum_damage():
    battle, caster, target, skill = encounter()
    assert damage(battle, caster, skill, target, 0) == 0


def test_battle_end_effects_run_only_once():
    battle, _, _, _ = encounter()
    with patch('src.skills.characters.registry.hook') as hook:
        battle._handle_timeout()
        battle.get_result()
        battle.get_result()
        assert sum(call.args[0] == 'battle_end' for call in hook.call_args_list) == 1


def test_damage_total_does_not_subtract_immediate_break_healing():
    from src.skills.characters.common import shield
    battle, caster, target, skill = encounter()
    target.current_health = 1000
    shield(target, target, 'break-heal', 10, support_break_heal=100)
    assert damage(battle, caster, skill, target, 1) == 40
    assert target.current_health == 1060
    assert battle.battle_log[-1]['payload']['amount'] == 40


def test_mark_count_excludes_linked_stat_companions():
    from src.skills.characters.common import mark_layers
    _, _, target, _ = encounter()
    states(target).extend([
        dict(kind='mark', name='test', remaining=2),
        dict(kind='stat', name='test', stats=['defense'], value=-.1, remaining=2),
    ])
    assert len(mark_layers(target, 'test')) == 1


def test_spell_damage_uses_magic_attack_and_magic_modifiers_only():
    battle, caster, target, skill = encounter()
    caster.character.attack = 100
    caster.character.magic_attack = 400
    skill.authored_effect = dict(skill.authored_effect, damageType='magical')
    assert damage(battle, caster, skill, target, 1) == 200
    states(caster).append(dict(kind='stat', stats=['magic_attack'], value=.25, remaining=2))
    assert damage(battle, caster, skill, target, 1) == 250
    states(caster).append(dict(kind='stat', stats=['attack'], value=1, remaining=2))
    assert damage(battle, caster, skill, target, 1) == 250
