export const EQUIPMENT_SLOTS = [
  ['HEAD', '头'], ['CHEST', '胸'], ['SHOULDERS', '肩'], ['GLOVES', '手'],
  ['LEGS', '腿'], ['BOOTS', '脚'], ['RING', '戒指'], ['NECKLACE', '项链'],
] as const
export const slotKey = (key: string) => ({
  HELMET: 'HEAD', ACCESSORY: 'RING', 头盔: 'HEAD', 胸甲: 'CHEST', 肩甲: 'SHOULDERS',
  手套: 'GLOVES', 护腿: 'LEGS', 靴子: 'BOOTS', 饰品: 'RING', 戒指: 'RING', 项链: 'NECKLACE',
}[key] || key.toUpperCase())
export const equipmentPieces = (equipment: any) => Object.fromEntries(
  Object.entries(equipment?.equipment_set || {}).filter(([, item]) => item && typeof item === 'object')
    .map(([key, item]) => [slotKey(key), item]),
)
