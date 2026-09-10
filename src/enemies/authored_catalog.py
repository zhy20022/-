"""Explicit, versioned monster effects. Numbers are first-pass tuning, not lore.

Durations count subsequent successful casts by the affected holder. Components
are independent: support skills never implicitly deal a basic attack.
"""

from copy import deepcopy


def effect(kind, target="single", value=0, **extra):
    return dict(kind=kind, target=target, value=value, **extra)


def damage(target="single", value=1.0, **extra):
    return effect("damage", target, value, school=extra.pop("school", "mixed"), **extra)


def stat(names, value, target="self", **extra):
    return effect("stat", target, value, stats=names.split(), casts=2, **extra)


def dot(target="all", value=.35):
    return effect("dot", target, value, casts=2)


def heal(value=.04, target="self"):
    return effect("heal", target, value)


def shield(value=.15, target="self"):
    return effect("shield", target, value, casts=2)


def skill(name, *effects, **extra):
    return dict(name=name, effects=list(effects), **extra)


def monster(name, skills, **extra):
    return dict(name=name, phases=[skills], **extra)


def phased(name, *phases):
    return dict(name=name, phases=list(phases))


def group(name, members, mode="independent", **extra):
    return dict(name=name, members=members, mode=mode, **extra)


# Keys are monster elements, not dungeon elements.
EXPERIENCE = {
    "WATER": [monster("霜玉蟾", [skill("玄珠凝霜", damage(), stat("magic_defense", -.15, "single"))]),
              monster("沧溟伥鬼", [skill("伥鬼拖足", damage(), stat("defense", -.15, "single"))])],
    "EARTH": [monster("石灵丸", [skill("滚石冲撞", damage(), stat("defense", -.15, "single"))]),
              monster("黄牙土狈", [skill("地鸣共振", damage("all", .6), stat("magic_defense", -.15, "all"))])],
    "THUNDER": [monster("雷珠精", [skill("雷殛弹射", damage(), stat("defense", -.15, "single"))]),
                monster("雷纹蝠", [skill("雷网封锁", damage("all", .6), stat("magic_defense", -.15, "all"))])],
    "WIND": [monster("风狸子", [skill("风缚爪击", damage(), stat("defense", -.15, "single"))]),
             monster("青翎雏鸾", [skill("风障鸣音", damage("all", .6), stat("magic_defense", -.15, "all"))])],
    "FIRE": [monster("赤火蚁", [], death_skill=skill("火油爆裂", damage("all", .8))),
             monster("丹焰稚雀", [skill("丹火弹幕", damage("all", .6), stat("defense", -.15, "all"))])],
    "WOOD": [monster("参芝灵", [skill("灵孢播种", effect("hot", "allies", .015, casts=2), stat("defense", .15, "allies"))]),
             monster("枯木蟒", [skill("荆棘囚笼", dot("single", .3), stat("magic_defense", -.15, "single"))])],
    "LIGHT": [monster("流萤曜精", [skill("耀光侵蚀", dot("random", .3), stat("attack", -.15, "single"))]),
              monster("三足乌雏", [skill("烈日辉光", heal(.02, "allies"), stat("magic_defense", -.15, "all"))])],
    "DARK": [monster("影魅", [skill("噬影咒", dot("single", .3), stat("defense", -.15, "single"))]),
             monster("魑魅散", [skill("暗语低喃", damage(), stat("magic_attack", -.15, "all"))])],
}

SQUAD = {
    "WATER": [monster("沧鳞玄蛟", [skill("沧浪吐息", damage("all", .85)), skill("水环缚灵", dot("single", .5), stat("attack", -.2, "single")), skill("玄蛟汲水", heal(), effect("cleanse", "self", 1))]),
              phased("沧溟甲螈", [skill("玄甲护体", shield(.3), recovery=8), skill("潮汐拍击", damage(), stat("magic_attack", -.2, "single"))], [skill("赤筋绞杀", damage(value=1.8), stat("defense", -.25, "single"))])],
    "EARTH": [monster("负岳巨犀", [skill("搬山掷岳", damage(value=1.8)), skill("踏地震慑", damage("all", .8), stat("attack", -.2, "all")), skill("岩丘之肤", stat("defense", .3))]),
              phased("荒骸牛", [skill("旱魃之息", stat("magic_attack", -.2, "all"))], [skill("裂地冲撞", damage("all")), skill("枯木逢春（伪）", stat("defense", -.25), stat("attack", .5))])],
    "THUNDER": [monster("雷翎玄鹄", [skill("五雷齐降", damage("random", .4, hits=5)), skill("雷印咒杀", stat("attack", -.25, "single")), skill("御雷之羽", stat("magic_attack", .3))]),
                phased("雷毛犼", [skill("雷毛护体", stat("defense", .3))], [skill("行雷之体", dot()), skill("雷暴狂热", stat("defense", -.25), stat("magic_attack", .5))])],
    "WIND": [monster("八风玄禽", [skill("八风齐斩", damage("all", .85)), skill("巽风蚀骨", stat("attack defense", -.2, "single")), skill("御风而行", stat("magic_attack", .3))]),
             phased("云兽风兽", [skill("云遮眼", stat("magic_attack", -.2, "single"))], [skill("巽风斩", damage("all", .35, hits=3)), skill("风兽之怒", stat("attack", .4))])],
    "FIRE": [monster("赤鳞火蛟", [skill("火丹流星", damage(value=1.8)), skill("火蛟翻身", damage(), stat("magic_defense", -.2, "single")), skill("燃血之怒", stat("magic_attack", .5, scaling="missing_health"))]),
             phased("祸斗獒", [skill("食火", effect("absorb_fire", "self", .5, casts=2), stat("magic_defense", .3))], [skill("炎獒扑杀", damage("random", 1.8)), skill("焚身领域", dot(), stat("attack", -.2, "all"))])],
    "WOOD": [monster("苍木灵鹤", [skill("树种催生", damage(value=1.2)), skill("青木之息", stat("defense magic_defense", .25)), skill("寄生之种", effect("dot", "single", .45, casts=2, drain=True), stat("magic_attack", -.2, "single"))]),
             phased("通天建木", [skill("通天根须", stat("attack", -.2, "all"))], [skill("万木穿刺", damage(value=1.8)), skill("枯木逢春", heal(.08), effect("cleanse", "self", 999))])],
    "LIGHT": [monster("日曜灵鹤", [skill("日轮冲击", damage("all", .85)), skill("耀光烙印", stat("magic_defense", -.2, "single")), skill("光速之翼", stat("attack", .3))]),
              phased("破妄相（白泽）", [skill("照世", stat("defense", -.2, "all"))], [skill("破邪之光", damage(value=1, versus_dark=3)), skill("光速反应", stat("magic_attack", .5))])],
    "DARK": [monster("惑心翼虎", [skill("暗影扑杀", damage(value=1.8)), skill("蛊惑之言", stat("attack", -.2, "single")), skill("噬善之影", effect("steal", "single", 1), stat("magic_defense", .25))]),
             phased("九首蛇婴", [skill("暗蚀毒雾", stat("magic_defense", -.2, "all"))], [skill("九首乱射", damage("all", .35, hits=3)), skill("蛇蜕之术", shield(), heal(.04))])],
}

TEAM = {
    "WATER": [phased("九首洪蛇", [skill("九浊水炮", damage("random", 1.3), effect("random_attack_down", "single", -.2, casts=2))], [skill("冰火双涡", damage("all", .65))], [skill("灭世浊流", damage("all", .85), stat("magic_defense", .3))]),
              group("玄冥双蛟", [monster("寒渊", [skill("霜寒锁链", damage(value=.3, hits=3), stat("defense", -.05, "single", stacks=3, cap=9))]), monster("沧澜", [skill("水幕天华", shield(.08, "allies"), stat("defense", .2, "allies"), stat("magic_attack", -.2, "all"))])], "shared", fusion=True),
              group("三渊洪鳌", [monster("令符洪鳌", [skill("共负令符", stat("defense magic_defense", .2, "allies"))]), monster("旋涡洪鳌", [skill("玄水旋涡", dot(value=.25), stat("magic_defense", -.15, "all"))]), monster("镇封洪鳌", [skill("水德镇封", stat("attack magic_attack", -.25, "single"))])], "shared")],
    "EARTH": [phased("地岳盘蛇", [skill("落石天降", damage("random", 1.5))], [skill("地刺突袭", damage("all", .65), stat("magic_defense", -.2, "all"))], [skill("地龙翻身", damage("all", .85), stat("defense", .3))]),
              group("负天吞火", [monster("负天", [skill("碑文镇封", damage(), stat("magic_attack", -.2, "single"))]), monster("吞火", [skill("地火喷涌", damage("all", .5), stat("magic_defense", -.2, "all"))])], survivor="all_stats"),
              group("四方妖兽", [monster(name, [skill("四极镇杀", damage("all", .3)), skill("镇岳之印", stat("attack magic_attack", -.15, "all"))]) for name in ["物攻妖兽", "法攻妖兽", "物防妖兽", "法防妖兽"]], rotate=30)],
    "THUNDER": [phased("紫霄雷犀", [skill("雷云压顶", stat("magic_defense", -.05, "all", cap=9))], [skill("雷鞭横扫", damage("all", .7))], [skill("万雷归宗", damage("all", .9), stat("magic_attack", .4), effect("visual", "self", label="雷暴分身"))]),
                group("雷吼与电芒", [monster("雷吼", [skill("天刑引雷", damage(), stat("magic_defense", -.2, "single"))]), monster("电芒", [skill("电光一闪", damage("random", 1.5))])], "shared", common=skill("雷极天刑", damage("all", .6), stat("attack magic_attack", .2, "allies"))),
                group("三霄雷劫", [monster("天罡雷", [skill("破甲雷槌", damage(school="physical"), stat("defense", -.2, "single"))]), monster("地煞雷", [skill("灭法雷池", stat("magic_attack", -.2, "all"))]), monster("心魔雷", [skill("心魔侵蚀", stat("attack", -.25, "single"))])], "sequential")],
    "WIND": [phased("垂天巨鹏", [skill("九万里风", damage("all", .65), stat("defense", -.2, "all"))], [skill("扶摇直上", shield(.15))], [skill("虚风噬体", stat("magic_attack", .3), damage("all", .85))]),
             group("风袋兽与风轮兽", [monster("风袋兽", [skill("风压禁制", stat("attack", -.2, "all"))]), monster("风轮兽", [skill("风轮切割", damage("all", .6))])], survivor="heal75"),
             group("三昧神风", [monster("黑风", [skill("蚀甲黑风", stat("defense", -.2, "all"))]), monster("妖风", [skill("惑心妖风", stat("magic_defense", -.2, "all"))]), monster("罡风", [skill("裂体罡风", stat("attack magic_attack", .3), damage("all", .7))])], "shared")],
    "FIRE": [phased("南明离雀", [skill("南明火柱", damage(value=1.3), stat("healing_received magic_defense", -.2, "single"))], [skill("火羽千针", damage("all", .7))], [skill("火凤旋涡", damage("all", .85), stat("defense magic_defense", .25))]),
             group("赤焰牯与熔岩犼", [monster("赤焰牯", [skill("熔岩喷涌", damage("all", .6))]), monster("熔岩犼", [skill("烈焰印记", damage(), stat("magic_defense", -.2, "single"))])], survivor="fire"),
             group("三昧火灵", [monster("君火", [skill("心火燎原", stat("magic_attack", -.2, "all"))]), monster("臣火", [skill("肾火灼甲", damage(school="physical"), stat("defense", -.2, "single"))]), monster("民火", [skill("气火焚天", dot(value=.3), shield(.1))])], "sequential")],
    "WOOD": [phased("断木元灵", [skill("木叶风暴", damage(value=1.3), stat("defense", -.2, "single"))], [skill("青龙吐息", damage("all", .65), stat("magic_defense", -.2, "all"))], [skill("苍龙七宿", damage("all", .12, hits=7), stat("defense magic_defense", .25))]),
             group("扶桑与若木", [monster("扶桑", [skill("日曜光环", stat("attack", .25, "allies"))]), monster("若木", [skill("月华霜冻", damage(), stat("magic_defense", -.2, "single"), heal(.025))])], "shared", common=skill("日月同辉", damage("all", .6), effect("dispel", "all", 999))),
             group("四季灵木", [monster("春", [skill("万物复苏", heal(.02, "all_monsters"), stat("defense", .15, "all_monsters"))]), monster("夏", [skill("藤蔓狂暴", damage("all", .4), stat("defense", -.15, "all"))]), monster("秋", [skill("落叶斩", damage(value=1.4), stat("magic_attack", -.2, "single"))]), monster("冬", [skill("枯木庇护", shield(.08, "all_monsters"), stat("magic_defense", -.15, "all"))])], "shared")],
    "LIGHT": [phased("十日余烬", [skill("灼光柱", damage("all", .65), stat("magic_defense", -.2, "all"))], [skill("光速俯冲", damage(value=1.8))], [skill("大日印", stat("magic_attack defense", .3), damage("all", .85))]),
              group("阳乌与阴蟾", [monster("阳乌", [skill("纯阳真火", damage(), effect("cleanse", "allies", 1))]), monster("阴蟾", [skill("太阴寒光", damage(), stat("attack", -.15, "all"))])], "independent", common=skill("昼夜交替", damage("all", .6), effect("alternating_defense_down", "all", -.2, casts=2))),
              group("三光星兽", [monster("日曜", [skill("灼热日光", dot(value=.25))]), monster("月华", [skill("清辉治愈", heal(.025, "all_monsters"), stat("magic_defense", .2, "all_monsters"))]), monster("辰明", [skill("星轨狙击", stat("defense magic_defense", -.2, "single"))])], "shared")],
    "DARK": [phased("浑沌无相", [skill("无相之躯", stat("attack", -.2, "all"))], [skill("七窍流血", damage("all", .7), stat("magic_defense", -.2, "all"))], [skill("吞噬黑洞", stat("defense magic_defense", .4), effect("visual", "self", label="吞噬黑洞"))]),
             group("影魍与石魍", [monster("影魍", [skill("暗缚", stat("magic_attack", -.25, "single"))]), monster("石魍", [skill("地刺穿", damage(value=1.4))])], balance_guard=True),
             group("三尸邪神", [monster("上尸", [skill("扰神咒", damage("all", .4), stat("magic_attack", -.15, "all"))]), monster("中尸", [skill("噬气诀", damage("all", .4), stat("defense", -.15, "all"))]), monster("下尸", [skill("腐体毒", damage("all", .4), stat("magic_defense", -.15, "all"))])], "sequential")],
}

WORLD = {
    "WATER": monster("不冻渊主", [skill("冰眼玄光", damage(value=1.8)), skill("万古冰川", damage("all", .6)), skill("玄冰甲胄", effect("shield", "self", .12), stat("defense magic_defense", .4, bound_shield=True)), skill("归海之息", heal(.04)), skill("渊主之怒", stat("attack magic_attack", .3, permanent=True), below=.5, once=True), skill("髓冷咒印", stat("defense magic_defense", -.2, "single")), skill("惊涛拍击", damage("all", .5), stat("attack", -.2, "all")), skill("深海重压", damage("all", .7)), skill("闭目·永冻劫", effect("hp_damage", "single", .6))]),
    "EARTH": monster("天柱残魄", [skill("撑天之手", damage(value=1.8)), skill("灭世滚石", dot(value=.3)), skill("磐石之躯", shield(.18)), skill("地脉汲取", heal(.04)), skill("天柱屹立", stat("defense magic_defense", .3)), skill("重力枷锁", stat("defense", -.2, "single")), skill("息壤侵蚀", stat("magic_defense", -.2, "all")), skill("山河倾倒", stat("attack", -.2, "all")), skill("不周之怒", damage("all", .9), effect("dispel", "all", 999))]),
    "THUNDER": monster("万雷妖仙", [skill("雷剑诛邪", damage(value=1.8)), skill("万雷朝宗", damage("all", .6)), skill("紫霄雷衣", shield(.12)), skill("雷元淬体", heal(.04), effect("cleanse", "self", 999)), skill("雷帝降临", stat("magic_attack magic_defense", .3)), skill("雷印镇魂", stat("defense magic_defense", -.2, "single")), skill("感电侵蚀", stat("attack", -.2, "single")), skill("渡劫九重", damage("random", .6, hits=3)), skill("神霄灭世", damage("all", 1))]),
    "WIND": monster("风后九章", [skill("风神切", damage(value=.6, hits=3)), skill("八门风阵", damage("all", .6)), skill("太虚之风", shield(.15)), skill("风气流转", heal(.04)), skill("风后遗泽", stat("attack magic_attack", .3)), skill("风缚阵", stat("defense", -.2, "single")), skill("乱流领域", stat("magic_defense", -.2, "all")), skill("虚空裂隙", stat("attack", -.2, "all")), skill("九章·风灾", dot(value=.45))]),
    "FIRE": monster("离火庭王", [skill("洪荒火种", damage(value=1.8)), skill("离火燎原", dot(value=.3)), skill("薪火之盾", effect("health_cost", "self", .05), shield(.2)), skill("火中取粟", heal(.04)), skill("燧皇之志", stat("magic_attack magic_defense", .3)), skill("灼骨之焰", stat("defense magic_defense", -.2, "single")), skill("烈焰枷锁", stat("attack", -.2, "single")), skill("薪尽火传", damage("all", .7)), skill("焚天煮海", damage("all", 1))]),
    "WOOD": monster("万木祖庭", [skill("青木灭绝光线", damage(value=1.8)), skill("藤海潮生", damage("all", .6)), skill("树界降诞", shield(.12)), skill("根扎九幽", heal(.06)), skill("万木之灵", stat("defense magic_defense", .05, permanent=True, cap=999999)), skill("噬灵根须", stat("magic_attack", -.2, "single")), skill("枯荣诅咒", stat("defense magic_defense", -.2, "single")), skill("召唤木灵", effect("visual", "self", label="木灵"), effect("hot", "self", .015, casts=2)), skill("青木大阵", damage("all", .3, hits=3))]),
    "LIGHT": monster("十日耀君", [skill("光鞭御日", damage(value=.6, hits=3)), skill("十日凌空", damage("all", .6)), skill("金乌之羽", shield(.12)), skill("日耀再生", heal(.04)), skill("天帝威能", stat("attack magic_attack", .05, permanent=True, cap=999999)), skill("光之锁链", stat("defense", -.2, "single")), skill("天光破妄", stat("magic_defense", -.2, "all"), effect("dispel", "all", 999)), skill("天光压制", stat("attack magic_attack", -.4, "single")), skill("大日归墟", damage("all", 1))]),
    "DARK": monster("幽都冥主", [skill("幽冥鬼爪", damage(value=1.8)), skill("万鬼噬心", damage("all", .6)), skill("永夜之袍", shield(.12), effect("cleanse", "self", 999)), skill("噬魂夺魄", effect("corpse_heal", "self", .02)), skill("幽都之主", stat("attack magic_attack", .3)), skill("九幽寒气", stat("defense magic_defense", -.2, "single")), skill("幽冥烙印", stat("attack", -.2, "single"), damage(value=1.5)), skill("六道轮回", effect("visual", "self", label="六道召唤"), damage("all", .4), damage(value=.8), effect("dispel", "all", 999)), skill("万古长夜", damage("all", .3, hits=3))]),
}

DUNGEON_TO_MONSTER = dict(FIRE="WOOD", WOOD="WIND", WIND="FIRE", WATER="EARTH", EARTH="THUNDER", THUNDER="WATER", LIGHT="DARK", DARK="LIGHT")


def encounters(dungeon_type, dungeon_attribute):
    element = DUNGEON_TO_MONSTER[dungeon_attribute]
    table = {"SINGLE": EXPERIENCE, "SQUAD": SQUAD, "TEAM": TEAM, "SERVER_BOSS": WORLD}[dungeon_type]
    entries = table[element]
    if isinstance(entries, dict):
        entries = [entries]
    result = deepcopy(entries)
    for entry in result:
        entry["element"] = element
        entry["interval"] = {"SINGLE": 6, "SQUAD": 4, "TEAM": 5, "SERVER_BOSS": 4}[dungeon_type]
    return result
