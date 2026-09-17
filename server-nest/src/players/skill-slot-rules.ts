export type SkillSlots = { low: string[]; mid: string[]; high: string[] };
export const SKILL_SLOT_RULES = {
  low: { min: 3, max: 5, allowed: ['A', 'B'] },
  mid: { min: 2, max: 4, allowed: ['A', 'B', 'C'] },
  high: { min: 1, max: 3, allowed: ['B', 'C'] },
  total: 9, availableFromLevel: 1, uniqueSkills: false,
  authoredSkillLogic: { '1': 'A', '2': 'B', '3': 'C' },
};

export function skillSlotError(slots: SkillSlots, skills: Array<{ skillId: string; logic: string }>): string | null {
  const counts = { A: 0, B: 0, C: 0 };
  const catalog = new Map(skills.map(skill => [skill.skillId, skill.logic]));
  if (slots.low.length + slots.mid.length + slots.high.length !== 9) return '技能槽总数必须为9';
  if (slots.low.length < slots.mid.length || slots.mid.length < slots.high.length) return '技能槽数量必须满足底≥中≥高';
  for (const tier of ['low', 'mid', 'high'] as const) {
    const rule = SKILL_SLOT_RULES[tier];
    if (slots[tier].length < rule.min || slots[tier].length > rule.max) return `${tier}技能槽数量超出范围`;
    for (const id of slots[tier]) {
      const logic = catalog.get(id);
      if (!logic || !rule.allowed.includes(logic)) return `${tier}存在不允许的技能`;
      counts[logic as keyof typeof counts]++;
    }
  }
  if (counts.A < 5 || counts.B > 5 || counts.C > 3) return 'A技能至少5槽，B最多5槽，C最多3槽';
  return null;
}
