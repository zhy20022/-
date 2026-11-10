export const STAR_MULTIPLIERS = [1, 1.2, 1.45, 1.7, 2] as const;
export const EQUIPMENT_SLOTS = ['HEAD', 'CHEST', 'SHOULDERS', 'GLOVES', 'LEGS', 'BOOTS', 'RING', 'NECKLACE'];
export function characterStar(equipment?: Record<string, unknown>) {
  const value = Number(equipment?.star || 1);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 1;
}
export function starCost(star: number) {
  return star < 5 ? star * 5 : 0;
}
export function normalizeEquipmentSlot(slot: string) {
  const aliases: Record<string, string> = { ACCESSORY: 'RING', HELMET: 'HEAD', 头盔: 'HEAD', 胸甲: 'CHEST', 肩甲: 'SHOULDERS', 手套: 'GLOVES', 护腿: 'LEGS', 靴子: 'BOOTS', 饰品: 'RING', 戒指: 'RING', 项链: 'NECKLACE' };
  return aliases[slot] || slot.toUpperCase();
}

export function characterStats(character: { level: number; professionType: string; equipment: Record<string, unknown> }) {
  const professions: Record<string, number[]> = {
    PHYSICAL_TANK: [2000, 80, 200, 50, 150], PHYSICAL_MELEE_DPS: [1200, 180, 100, 50, 80],
    PHYSICAL_RANGED_DPS: [1000, 160, 80, 50, 80], MAGIC_TANK: [1800, 60, 120, 80, 220],
    MAGIC_MELEE_DPS: [1100, 70, 90, 190, 100], MAGIC_RANGED_DPS: [900, 50, 70, 170, 100],
    HEALER: [1000, 60, 80, 150, 120], SUPPORT: [1100, 70, 90, 130, 110],
  };
  const keys = ['hp', 'attack', 'defense', 'magic_attack', 'magic_defense'];
  const base = professions[character.professionType] || [1000, 100, 100, 100, 100];
  const multiplier = STAR_MULTIPLIERS[characterStar(character.equipment) - 1];
  const baseStats = Object.fromEntries(keys.map((key, i) => [key, Math.round(Math.floor(base[i] * (1 + (character.level - 1) * 0.05)) * multiplier)]));
  const bonus = Object.fromEntries(keys.map(key => [key, 0]));
  const seen = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    const id = row.itemId || row.item_id;
    if (typeof id === 'string') {
      if (seen.has(id)) return;
      seen.add(id);
      const payload = (row.itemData || row.item_data || row) as Record<string, unknown>;
      for (const [key, amount] of Object.entries(payload.stats || {})) {
        const name = key.replace(/_bonus$/, '');
        if (keys.includes(name) && typeof amount === 'number' && Number.isFinite(amount)) bonus[name] += Math.max(0, Math.floor(amount));
      }
      return;
    }
    Object.values(row).forEach(visit);
  };
  visit(character.equipment);
  return { base_stats: baseStats, equipment_bonus: bonus, stats: Object.fromEntries(keys.map(key => [key, baseStats[key] + bonus[key]])) };
}
