import type { LegacyInventoryItem } from './onlineInventoryAdapter'

export type MaterialCategory = 'overview' | 'breakthrough' | 'experience' | 'equipment' | 'avatar-fragments'

const aliases: Record<string, string> = {
  CHARACTER_EXP: 'experience', character_exp_crystal: 'experience', demo_exp_crystal: 'experience',
  EXCLUSIVE_ITEM: 'exclusive', exclusive_material: 'exclusive', 专属道具材料: 'exclusive',
  EQUIPMENT_SET: 'equipment', equipment_material: 'equipment', 套装材料: 'equipment',
  ILLUSTRATION_PIECE: 'fragment', illustration_piece: 'fragment', 立绘拼图碎片: 'fragment',
  generic_battle_material: 'shared',
}

export const getMaterialKind = (item: LegacyInventoryItem) => {
  const keys = [
    item.material_type, item.itemConfigId, item.item_data?.materialType,
    item.item_data?.material_type, item.item_subtype, item.item_id,
  ]
  for (const key of keys) if (key && aliases[key]) return aliases[key]
  return 'other'
}

export const matchesMaterialCategory = (item: LegacyInventoryItem, category: MaterialCategory) => {
  const kind = getMaterialKind(item)
  switch (category) {
    case 'breakthrough': return ['exclusive', 'equipment', 'shared'].includes(kind)
    case 'experience': return kind === 'experience'
    case 'equipment': return ['equipment', 'shared'].includes(kind) || ['weapon', 'equipment'].includes(item.item_type)
    case 'avatar-fragments': return kind === 'fragment'
    default: return true
  }
}

export const equipmentSlotForMode = (slot: string, formalOnline: boolean) => formalOnline && slot === 'HELMET' ? 'HEAD' : slot

export const materialUsage = (item: LegacyInventoryItem, illustrationExchangeAvailable = true) => {
  const kind = getMaterialKind(item)
  const labels: Record<string, string> = {
    experience: '角色经验', exclusive: '专属制作与原有专武突破', equipment: '套装制作、装备强化与突破',
    fragment: illustrationExchangeAvailable ? '现有立绘兑换' : '立绘碎片；兑换暂未开放',
    shared: '专属制作、套装制作及装备强化共用库存', other: '用途未标注',
  }
  return labels[kind]
}
