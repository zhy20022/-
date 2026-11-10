const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('../node_modules/typescript')
const moduleContext = { exports: {}, require() { throw new Error('Unexpected runtime dependency') } }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/materialCatalog.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, moduleContext)
const catalog = moduleContext.exports

test('material aliases use real IDs/types, not translated names', () => {
  assert.equal(catalog.getMaterialKind({ material_type: 'CHARACTER_EXP' }), 'experience')
  assert.equal(catalog.getMaterialKind({ itemConfigId: 'character_exp_crystal' }), 'experience')
  assert.equal(catalog.getMaterialKind({ material_type: 'EXCLUSIVE_ITEM' }), 'exclusive')
  assert.equal(catalog.getMaterialKind({ material_type: 'EQUIPMENT_SET' }), 'equipment')
  assert.equal(catalog.getMaterialKind({ material_type: 'ILLUSTRATION_PIECE' }), 'fragment')
  assert.equal(catalog.getMaterialKind({ item_name: '经验材料', itemConfigId: 'unknown' }), 'other')
})

test('shared inventory referenced by multiple uses, never duplicated or consumed by helpers', () => {
  const row = { item_id: 'same', itemConfigId: 'generic_battle_material', count: 17, item_type: 'material' }
  const before = JSON.stringify(row)
  for (const category of ['overview', 'breakthrough', 'equipment']) assert(catalog.matchesMaterialCategory(row, category))
  assert(!catalog.matchesMaterialCategory(row, 'experience'))
  assert.equal([row].filter(item => catalog.matchesMaterialCategory(item, 'overview')).length, 1)
  assert.equal(JSON.stringify(row), before)
})

test('consumable/unknown inventory preserved; actual equipment and mode-specific HEAD supported', () => {
  for (const type of ['consumable', 'unknown', 'weapon', 'equipment']) {
    assert(catalog.matchesMaterialCategory({ item_type: type }, 'overview'))
  }
  assert(catalog.matchesMaterialCategory({ item_type: 'weapon' }, 'equipment'))
  assert.equal(catalog.equipmentSlotForMode('HELMET', true), 'HEAD')
  assert.equal(catalog.equipmentSlotForMode('HELMET', false), 'HELMET')
  for (const slot of ['CHEST', 'GLOVES', 'LEGS', 'BOOTS', 'ACCESSORY']) {
    assert.equal(catalog.equipmentSlotForMode(slot, true), slot)
  }
})

test('illustration fragments never alias character fragments or claim unavailable online exchange', () => {
  const illustration = { itemConfigId: 'illustration_piece', count: 3 }
  assert(catalog.matchesMaterialCategory(illustration, 'avatar-fragments'))
  assert.equal(catalog.materialUsage(illustration, false), '立绘碎片；兑换暂未开放')
  assert.equal(catalog.materialUsage(illustration, true), '现有立绘兑换')
  for (const itemConfigId of ['character_fragment', 'character_shard', 'config_shard']) {
    const item = { itemConfigId, count: 7 }
    assert.equal(catalog.matchesMaterialCategory(item, 'avatar-fragments'), false)
    assert(catalog.matchesMaterialCategory(item, 'overview'))
    assert.equal(item.count, 7)
  }
})
