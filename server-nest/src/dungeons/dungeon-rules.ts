export function sweepRequirement(type: string) {
  return type === 'SQUAD' ? 5 : 10;
}

export function sweepClearCount(type: string, progress?: {
  successfulAttempts?: number;
  bestRecord?: Record<string, unknown>;
} | null) {
  if (type === 'SINGLE') return Number(progress?.successfulAttempts || 0);
  return Number(progress?.bestRecord?.[type === 'SQUAD' ? 'soloClears' : 'flawlessCount'] || 0);
}

export function bossMaterialCount(killed: number, spawned: number, success: boolean) {
  const kills = Math.max(0, Math.floor(killed));
  return kills + (success && spawned > 0 && kills >= spawned ? 2 : 0);
}

export const EQUIPMENT_MATERIAL_IDS = ['equipment_material',
  ...['FIRE', 'WOOD', 'WIND', 'WATER', 'EARTH', 'THUNDER', 'LIGHT', 'DARK']
    .map((attribute) => `equipment_material_${attribute.toLowerCase()}`)];

export function dungeonMaterialRewards(type: string, attributeType: string, killed: number, spawned: number, success: boolean) {
  if (type !== 'SQUAD' && type !== 'TEAM') return null;
  const quantity = bossMaterialCount(killed, spawned, success);
  if (!quantity) return [];
  return type === 'SQUAD' ? [{
    itemConfigId: `equipment_material_${attributeType.toLowerCase()}`,
    itemType: 'material', quantity,
    payload: { materialType: 'EQUIPMENT_SET', name: '套装制作材料', attributeType },
  }] : [{
    itemConfigId: 'exclusive_material',
    itemType: 'material', quantity,
    payload: { materialType: 'EXCLUSIVE_ITEM', name: '角色专属道具制作材料', attributeType: null },
  }];
}

export function playbackTime(ticket: Record<string, unknown>, now = Date.now()) {
  const clock = ticket.playback as { elapsed: number; updatedAt: string; speed: number } | undefined;
  return clock
    ? clock.elapsed + Math.max(0, now - Date.parse(clock.updatedAt)) / 1000 * clock.speed
    : Math.max(0, now - Date.parse(String(ticket.serverTime))) / 1000 * 4;
}
