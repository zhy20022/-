"""Export only complete authored handlers for both Nest and the battle worker."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.skills.characters.registry import modules


def main():
    path = ROOT / 'data/content/authored-character-skills.json'
    current = json.loads(path.read_text(encoding='utf-8'))
    definitions = {key: effects for key, effects in current['characters'].items()
                   if all(effect['kind'] != 'custom' for effect in effects)}
    catalog = json.loads((ROOT / 'data/content/characters.json').read_text(encoding='utf-8-sig'))
    rows = {row['id']: row for row in catalog['characters']}
    pending = []
    for module in modules():
        ready = getattr(module, 'READY_CONFIG_IDS', getattr(module, 'COMPLETE_CONFIG_IDS', set()))
        for config in sorted(module.CONFIG_IDS):
            if config not in ready:
                pending.append(config)
                continue
            skills = rows[config]['skills']
            if {skill['slot'] for skill in skills} != {1, 2, 3}:
                raise ValueError(f'Incomplete authored source: {config}')
            definitions[config] = [dict(slot=skill['slot'], name=skill['name'],
                kind='custom', description=skill['effect']) for skill in skills]
            if config == 'char_061_dark_physical_ranged_dps':
                definitions[config][0]['description'] = definitions[config][0]['description'].replace('物理穿透伤害', '物理伤害')
            if config == 'char_001_water_physical_tank':
                definitions[config][1]['description'] += '内息达到上限后的溢出伤害正常承受；状态结束时，有内息才获得回复效果，后续两次自身施法结束时各回复自身最大生命值2%，没有内息则不回血。'
            elif config == 'char_027_wind_physical_melee_dps':
                definitions[config][2]['description'] = '释放剑气：阴阳息总计只有0至1层时，对敌方单体造成100%攻击力的风属性物理伤害；同时有阴息和阳息时，对敌方单体造成420%攻击力的风属性物理伤害；只有两层阳息时，对敌方全体造成300%攻击力的风属性物理伤害；只有两层阴息时，对敌方全体造成250%攻击力的风属性物理伤害并使物防降低20%，持续至目标后续两次施法结束。消耗本次分支的阴阳息及已积蓄的剑气增伤、暴击增益。'
            elif config == 'char_002_water_magic_tank':
                definitions[config][0]['description'] = '进入「纳渊」状态，持续至自身后续两次技能释放结束。将承受的物理、法术伤害暂存为「水压」，上限为自身最大生命值100%，溢出部分正常承受；真实伤害不参与暂存。状态生效期间，每次后续施法结束释放剩余水压的35%；纳渊结束时一次性结算全部剩余水压，并停止吸收新伤害。水压结算允许护盾承担，不重复暂存。技能3可在施法后结算前清空水压。'
            elif config == 'char_058_dark_magic_tank':
                definitions[config][1]['description'] = '将当前「淤血」储量的40%转化为永久「淤青」，不要求淤血达到上限。有实际转化时扣除自身最大生命值5%；下一次造成伤害的技能对每个命中目标额外造成相当于淤青导致的生命上限减少量20%的暗属性法术伤害，同一技能对同一目标只触发一次。'
                definitions[config][2]['description'] = '先扣除自身当前生命上限20%的生命值；若仍存活，将全部「淤血」与「淤青」清空，恢复淤青扣除的生命上限并回复等量生命，对敌方全体造成相当于清空储量2.5倍的暗属性法术伤害。'
            elif config == 'char_060_dark_magic_melee_dps':
                definitions[config][1]['description'] = '对敌方单体连续攻击三次，每次造成50%法攻的暗属性法术伤害并施加1层「太阴蚀」，合计3层。每层使目标暗系弱化10%，独立持续至目标后续两次技能释放结束。'
            elif config == 'char_064_dark_support':
                definitions[config][1]['description'] = '优先选择存活的暗系输出队友，再按攻击力从高到低补足两名目标；不足两名存活队友时对现有目标生效。使目标暗系增强20%，持续至各目标后续两次技能释放结束。'
            elif config == 'char_044_wood_magic_melee_dps':
                definitions[config][2]['description'] = '引爆目标身上的朱砂印，每层造成100%攻击力的木属性法术伤害，并清空印记；随后对敌方全体造成80%攻击力的木属性法术伤害。目标没有朱砂印时，本次技能不造成任何伤害。'
            elif config == 'char_047_wood_healer':
                definitions[config][2]['description'] = '使己方全体的生命上限、物攻、法攻、物防、法防各提升15%，持续至各目标后续两次技能释放结束。'
            elif config == 'char_048_wood_support':
                description = '每次施法随机翻页：枯页4/9，荣页4/9，莲子页1/9，执行所翻页的效果。枯页为全体增加1层枯印记，每层物防、法防提升5%；荣页为全体增加1层荣印记，每层物攻、法攻提升5%。各印记上限3层，每层独立持续至目标后续四次施法结束。莲子页同时增加枯、荣各1层，并按各目标的枯层数生成每层相当于施法者攻击力15%的护盾，按荣层数在后续两次施法结束时各回复每层相当于施法者攻击力12%的生命。跨小队护盾和治疗效果为50%。'
                for effect in definitions[config]:
                    effect['description'] = description
    path.write_text(json.dumps({'characters': definitions, 'pendingCharacters': sorted(pending)},
                              ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'enabledCharacters': len(definitions), 'pendingCharacters': pending}))


if __name__ == '__main__':
    main()
