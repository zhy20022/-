"""Boss skill slot templates.

Bosses use the same 9-slot rhythm as characters: 5 low, 3 mid, 1 high.
The skills are intentionally generic for the first version so concrete bosses
can later swap individual skill ids without changing combat code.
"""

from copy import deepcopy
from typing import Any, Dict, List, Optional

from ..combat.skill_system import Skill, SkillLogic, SkillTargetType, SkillTier


BOSS_SKILL_SLOT_TEMPLATE: Dict[str, List[str]] = {
    "low": [
        "boss_low_strike_1",
        "boss_low_strike_2",
        "boss_low_sunder_1",
        "boss_low_pressure_1",
        "boss_low_pressure_2",
    ],
    "mid": [
        "boss_mid_cleave_1",
        "boss_mid_burst_1",
        "boss_mid_mark_1",
    ],
    "high": [
        "boss_high_signature_1",
    ],
}


def _make_skill(
    skill_id: str,
    name: str,
    logic: SkillLogic,
    tier: SkillTier,
    cooldown: float,
    multiplier: float,
    target_type: SkillTargetType,
    target_count: int = 1,
    physical_ratio: float = 1.0,
    magical_ratio: float = 0.0,
    description: str = "",
    priority_target: str = "highest_health",
    is_heal: bool = False,
    heal_ratio: float = 0.0,
    status_effects: Optional[List[Dict[str, Any]]] = None,
    effect_tags: Optional[List[str]] = None,
    telegraph: str = "",
    cast_hint: str = "",
    impact_hint: str = "",
) -> Skill:
    return Skill(
        skill_id=skill_id,
        name=name,
        skill_logic=logic,
        skill_tier=tier,
        cooldown=cooldown,
        skill_multiplier=multiplier,
        physical_damage_ratio=physical_ratio,
        magical_damage_ratio=magical_ratio,
        target_type=target_type,
        target_count=target_count,
        priority_target=priority_target,
        description=description,
        is_heal=is_heal,
        heal_ratio=heal_ratio,
        status_effects=status_effects,
        effect_tags=effect_tags,
        telegraph=telegraph,
        cast_hint=cast_hint,
        impact_hint=impact_hint,
    )


def _boss_skill_library() -> Dict[str, Skill]:
    return {
        "boss_low_strike_1": _make_skill(
            "boss_low_strike_1", "重击 I", SkillLogic.A, SkillTier.LOW, 2.0, 1.0, SkillTargetType.SINGLE,
            description="稳定单体物理打击。",
            effect_tags=["单体", "物理"],
            telegraph="Boss抬手锁定当前最高血量目标。",
            cast_hint="Boss发动重击。",
        ),
        "boss_low_strike_2": _make_skill(
            "boss_low_strike_2", "重击 II", SkillLogic.A, SkillTier.LOW, 2.0, 1.1, SkillTargetType.SINGLE,
            physical_ratio=0.7,
            magical_ratio=0.3,
            description="混合伤害的单体打击。",
            effect_tags=["单体", "混合"],
            telegraph="Boss武器泛起异色光芒，准备一次混合打击。",
            cast_hint="Boss发动强化重击。",
        ),
        "boss_low_sunder_1": _make_skill(
            "boss_low_sunder_1", "碎甲", SkillLogic.A, SkillTier.LOW, 3.0, 0.9, SkillTargetType.SINGLE,
            description="造成单体伤害，并短时间降低目标防御。",
            status_effects=[{
                "status_id": "boss_sundered",
                "name": "碎甲",
                "status_type": "减益",
                "duration": 6,
                "value": 18,
                "effect_type": "defense_boost",
                "description": "防御降低，后续物理伤害提高。"
            }],
            effect_tags=["单体", "破防"],
            telegraph="Boss瞄准护甲薄弱处。",
            cast_hint="Boss发动碎甲。",
            impact_hint="目标防御被削弱。",
        ),
        "boss_low_pressure_1": _make_skill(
            "boss_low_pressure_1", "压迫 I", SkillLogic.A, SkillTier.LOW, 3.0, 0.85, SkillTargetType.MULTIPLE, 2,
            description="攻击2名低血量目标，并附加短持续伤害。",
            priority_target="lowest_health",
            status_effects=[{
                "status_id": "boss_pressure_dot",
                "name": "压迫",
                "status_type": "持续伤害",
                "duration": 4,
                "value": 25,
                "effect_type": "dot",
                "description": "每秒受到少量持续伤害。"
            }],
            effect_tags=["多目标", "持续伤害"],
            telegraph="Boss气势压下，低血量单位会被优先波及。",
            cast_hint="Boss释放压迫。",
        ),
        "boss_low_pressure_2": _make_skill(
            "boss_low_pressure_2", "压迫 II", SkillLogic.A, SkillTier.LOW, 3.0, 0.95, SkillTargetType.MULTIPLE, 2,
            magical_ratio=0.5,
            physical_ratio=0.5,
            description="攻击2名低血量目标，伤害更高。",
            priority_target="lowest_health",
            effect_tags=["多目标", "混合"],
            telegraph="Boss聚集范围压力，低血量单位会被优先波及。",
            cast_hint="Boss释放强化压迫。",
        ),
        "boss_mid_cleave_1": _make_skill(
            "boss_mid_cleave_1", "横扫", SkillLogic.B, SkillTier.MID, 5.0, 1.2, SkillTargetType.MULTIPLE, 3,
            description="攻击3个目标。",
            effect_tags=["多目标", "物理"],
            telegraph="Boss摆开架势，准备横扫多个目标。",
            cast_hint="Boss发动横扫。",
        ),
        "boss_mid_burst_1": _make_skill(
            "boss_mid_burst_1", "聚能爆发", SkillLogic.B, SkillTier.MID, 6.0, 1.4, SkillTargetType.SINGLE,
            physical_ratio=0.2,
            magical_ratio=0.8,
            description="高倍率单体法术爆发。",
            effect_tags=["单体", "法术", "爆发"],
            telegraph="Boss开始聚能，下一击会造成高额法术伤害。",
            cast_hint="Boss释放聚能爆发。",
        ),
        "boss_mid_mark_1": _make_skill(
            "boss_mid_mark_1", "群体标记", SkillLogic.C, SkillTier.MID, 8.0, 0.75, SkillTargetType.ALL,
            magical_ratio=1.0,
            physical_ratio=0.0,
            description="攻击全体并降低目标双防。",
            status_effects=[
                {
                    "status_id": "boss_marked_defense",
                    "name": "标记-破防",
                    "status_type": "减益",
                    "duration": 8,
                    "value": 12,
                    "effect_type": "defense_boost",
                    "description": "防御降低。"
                },
                {
                    "status_id": "boss_marked_magic_defense",
                    "name": "标记-破法",
                    "status_type": "减益",
                    "duration": 8,
                    "value": 12,
                    "effect_type": "magic_defense_boost",
                    "description": "魔法防御降低。"
                }
            ],
            effect_tags=["全体", "标记", "破防"],
            telegraph="Boss展开标记领域，全体单位即将承压。",
            cast_hint="Boss释放群体标记。",
            impact_hint="全体防御与魔法防御降低。",
        ),
        "boss_high_signature_1": _make_skill(
            "boss_high_signature_1", "终式", SkillLogic.C, SkillTier.HIGH, 12.0, 1.8, SkillTargetType.ALL,
            physical_ratio=0.5,
            magical_ratio=0.5,
            description="Boss的高层签名技，攻击全体并附加持续伤害。",
            status_effects=[{
                "status_id": "boss_signature_burn",
                "name": "终式余波",
                "status_type": "持续伤害",
                "duration": 5,
                "value": 45,
                "effect_type": "dot",
                "description": "终式残留能量持续造成伤害。"
            }],
            effect_tags=["全体", "混合", "持续伤害", "高层"],
            telegraph="Boss进入高层技能节奏，终式即将覆盖全场。",
            cast_hint="Boss释放终式。",
            impact_hint="终式余波附着在目标身上。",
        ),
        "boss_low_arcane_jab_1": _make_skill(
            "boss_low_arcane_jab_1", "秘术刺击", SkillLogic.A, SkillTier.LOW, 2.5, 1.0, SkillTargetType.SINGLE,
            physical_ratio=0.0,
            magical_ratio=1.0,
            description="低层单体法术伤害，用于法系Boss。",
            effect_tags=["单体", "法术"],
            telegraph="Boss指尖汇聚秘术光点。",
            cast_hint="Boss释放秘术刺击。",
        ),
        "boss_mid_siphon_1": _make_skill(
            "boss_mid_siphon_1", "自愈汲取", SkillLogic.B, SkillTier.MID, 7.0, 1.0, SkillTargetType.SINGLE,
            description="治疗当前低血量Boss单位。",
            is_heal=True,
            heal_ratio=1.15,
            effect_tags=["治疗", "续航"],
            telegraph="Boss身上浮现回流纹路，准备自愈。",
            cast_hint="Boss释放自愈汲取。",
        ),
        "boss_high_annihilation_1": _make_skill(
            "boss_high_annihilation_1", "歼灭指令", SkillLogic.C, SkillTier.HIGH, 14.0, 2.1, SkillTargetType.MULTIPLE, 3,
            magical_ratio=0.7,
            physical_ratio=0.3,
            priority_target="lowest_health",
            description="高层多目标斩杀技能，优先压低血量单位。",
            effect_tags=["多目标", "斩杀", "高层"],
            telegraph="Boss锁定低血量目标，歼灭指令即将落下。",
            cast_hint="Boss释放歼灭指令。",
        ),
    }


def get_boss_skill_library_payload() -> Dict[str, Dict[str, Any]]:
    return {skill_id: skill.to_dict() for skill_id, skill in _boss_skill_library().items()}


def normalize_boss_skill_slots(skill_slots: Optional[Dict[str, List[str]]] = None) -> Dict[str, List[str]]:
    slots = deepcopy(skill_slots or BOSS_SKILL_SLOT_TEMPLATE)
    return {
        "low": list(slots.get("low", [])),
        "mid": list(slots.get("mid", [])),
        "high": list(slots.get("high", [])),
    }


def validate_boss_skill_slots(skill_slots: Dict[str, List[str]]) -> Dict[str, Any]:
    normalized = normalize_boss_skill_slots(skill_slots)
    library = _boss_skill_library()
    all_ids = normalized["low"] + normalized["mid"] + normalized["high"]
    missing = [skill_id for skill_id in all_ids if skill_id not in library]
    if missing:
        return {"valid": False, "message": f"Unknown boss skills: {', '.join(missing)}"}
    if len(normalized["low"]) != 5 or len(normalized["mid"]) != 3 or len(normalized["high"]) != 1:
        return {"valid": False, "message": "Boss skill slots must be low 5, mid 3, high 1."}
    return {"valid": True, "message": "ok", "skill_slots": normalized}


def build_boss_skill_loadout(
    boss_type: str,
    role_index: int = 0,
    skill_slots: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, Any]:
    """Return a fresh 9-slot boss skill loadout."""
    library = _boss_skill_library()
    slots = normalize_boss_skill_slots(skill_slots)

    # Council members keep the same 9-slot shape but lean into different mid
    # skills so the shared-health council template can later feel distinct.
    if boss_type == "COUNCIL_SHARED":
        if role_index % 3 == 1:
            slots["mid"] = ["boss_mid_burst_1", "boss_mid_cleave_1", "boss_mid_mark_1"]
        elif role_index % 3 == 2:
            slots["mid"] = ["boss_mid_mark_1", "boss_mid_cleave_1", "boss_mid_burst_1"]

    return {
        "skill_slots": slots,
        "skill_library": {skill_id: deepcopy(skill) for skill_id, skill in library.items()},
        "total_slots": sum(len(ids) for ids in slots.values()),
    }
