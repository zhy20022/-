import { LegacyPlayerRef, ensureOnlineSession, onlineApi } from './onlineApi'
import { getSeasonNumber } from './seasons'

export interface LegacyInventoryItem {
  season?: number
  item_id: string
  itemConfigId?: string
  material_type?: string
  attribute_type?: string | null
  item_type: string
  item_subtype: string | null
  item_name: string
  item_data: Record<string, any>
  count: number
  level: number
  is_locked: boolean
  is_equipped: boolean
  can_equip?: boolean
  slot?: string
  is_current_character_equipped?: boolean
}

export const mapOnlineInventoryItem = (item: any): LegacyInventoryItem => {
  const payload = item.payload || item.itemData || item.item_data || {}
  return {
    season: getSeasonNumber({ ...payload, ...item }),
    item_id: item.id || item.itemId || item.item_id,
    itemConfigId: item.itemConfigId,
    material_type: item.materialType || item.material_type || payload.materialType || payload.material_type,
    attribute_type: item.attributeType || item.attribute_type || payload.attributeType || payload.attribute_type || null,
    item_type: item.itemType || item.item_type || 'item',
    item_subtype: payload.subtype || item.itemSubtype || item.item_subtype || null,
    item_name: payload.name || item.itemName || item.item_name || item.itemConfigId || 'Item',
    item_data: { ...payload, exclusive_info: payload.exclusiveInfo || payload.exclusive_info },
    count: Number(item.quantity ?? item.count ?? 1),
    level: Number(payload.enhancementLevel ?? item.level ?? 0),
    is_locked: Boolean(item.locked ?? item.is_locked),
    is_equipped: Boolean(item.isEquipped ?? item.is_equipped),
    can_equip: item.canEquip ?? item.can_equip,
    slot: item.slot || payload.slot,
    is_current_character_equipped: Boolean(item.isCurrentCharacterEquipped ?? item.is_current_character_equipped),
  }
}

export const groupOnlineInventory = (rows: any[]) => {
  const mapped = rows.map(mapOnlineInventoryItem)
  return {
    materials: mapped.filter((item) => ['material', 'fragment'].includes(item.item_type)),
    weapons: mapped.filter((item) => item.item_type === 'weapon'),
    equipment: mapped.filter((item) => item.item_type === 'equipment'),
    items: mapped.filter((item) => !['material', 'fragment', 'weapon', 'equipment'].includes(item.item_type)),
  }
}

export const loadOnlineInventory = async (player: LegacyPlayerRef | null | undefined) => {
  const session = await ensureOnlineSession(player)
  const response = await onlineApi.get(`/inventory/${session.player.id}`)
  if (response.status >= 400 || response.data?.success === false) {
    throw new Error('Online inventory request failed')
  }
  const rows = Array.isArray(response.data) ? response.data : response.data?.items
  if (!Array.isArray(rows)) throw new Error('Invalid online inventory response')
  return { session, rows, inventory: groupOnlineInventory(rows) }
}

export const loadOnlineMaterials = async (player: LegacyPlayerRef | null | undefined) => {
  const session = await ensureOnlineSession(player)
  const response = await onlineApi.get(`/workshop/${session.player.id}/materials`)
  if (response.status >= 400 || response.data?.success === false) {
    throw new Error('Online materials request failed')
  }
  const rows = response.data?.materials
  if (!Array.isArray(rows)) throw new Error('Invalid online materials response')
  return {
    session,
    materials: Object.fromEntries(rows.map((row: any) => [row.itemId, {
      material_type: row.materialType || row.itemConfigId,
      attribute_type: row.attributeType || null,
      count: Number(row.count || 0),
    }])),
  }
}

export const mapOnlineEnhancementPreview = (preview: any) => ({
  current_level: Number(preview.currentLevel || 0),
  next_level: Number(preview.nextLevel || 0),
  max_level: Number(preview.maxLevel || 50),
  success_rate: Number(preview.successRate || 0),
  requires_breakthrough: Boolean(preview.requiresBreakthrough),
  action: preview.action || 'enhance',
  costs: {
    gold: preview.costs?.gold || { required: 0, owned: 0, enough: false },
    material: {
      material_type: preview.costs?.material?.materialType || 'EQUIPMENT_SET',
      required: Number(preview.costs?.material?.required || 0),
      owned: Number(preview.costs?.material?.owned || 0),
      enough: Boolean(preview.costs?.material?.enough),
    },
  },
})
