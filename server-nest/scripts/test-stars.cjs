const assert = require('node:assert/strict')
const { test } = require('node:test')
const { PlayersService } = require('../dist/players/players.service')
const { GachaService } = require('../dist/gacha/gacha.service')
const { characterStats, characterStar, normalizeEquipmentSlot, starCost } = require('../dist/players/star-rules')

test('five star doubles base stats, equipment is added once, and legacy slots survive', () => {
  const character = { level: 10, professionType: 'PHYSICAL_TANK', equipment: {} }
  const base = characterStats(character).stats
  const item = { itemId: 'ring', stats: { hp_bonus: 100 } }
  const full = characterStats({ ...character, equipment: { star: 5, equipment_set: { ACCESSORY: item }, duplicate: item } })
  for (const key of Object.keys(base)) assert.equal(full.base_stats[key], base[key] * 2)
  assert.equal(full.stats.hp, base.hp * 2 + 100)
  assert.equal(characterStar({}), 1)
  assert.equal(normalizeEquipmentSlot('ACCESSORY'), 'RING')
  assert.deepEqual([1, 2, 3, 4].map(starCost), [5, 10, 15, 20])
})

test('star upgrades consume only the owned character fragments and preserve equipment', async () => {
  const character = { id: 'owned', characterConfigId: 'hero', level: 1, professionType: 'PHYSICAL_TANK', equipment: { weapon: { itemId: 'weapon' } } }
  const shard = { quantity: 50 }
  const player = { flags: {} }
  const manager = {
    findOne: async (entity, query) => entity.name === 'PlayerCharacterEntity'
      ? query.where.id === 'owned' ? character : null
      : entity.name === 'InventoryItemEntity' ? shard : player,
    save: async row => row,
  }
  const execute = async (_id, _op, _key, _payload, callback) => callback({ manager, player })
  const service = new PlayersService({}, {}, {}, {}, {}, { execute })
  await assert.rejects(service.starUp('p', 'foreign', 'k'), /not found/)
  for (const star of [2, 3, 4, 5]) {
    const result = await service.starUp('p', 'owned', 'k' + star)
    assert.equal(result.character.star, star)
    assert.equal(character.equipment.weapon.itemId, 'weapon')
  }
  assert.equal(shard.quantity, 0)
  await assert.rejects(service.starUp('p', 'owned', 'max'), /五星/)
  character.equipment.star = 1
  await assert.rejects(service.starUp('p', 'owned', 'poor'), /碎片不足/)
})

test('each duplicate grants one shard even if the stack already holds many', async () => {
  const existing = { id: 'owned' }
  let granted
  const service = new GachaService({}, { grant: async (_id, items) => { granted = items[0]; return [{ ...items[0], quantity: 99 }] } }, {}, {}, {}, {}, {})
  const result = await service.applyEntry({ findOne: async () => existing }, 'p',
    { type: 'character', characterConfigId: 'hero', rarity: 'epic' }, new Map([['hero', { name: 'Hero' }]]))
  assert.equal(granted.quantity, 1)
  assert.equal(result.convertedTo.quantity, 1)
  assert.equal(result.shardsGranted, 1)
})
