const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('../node_modules/typescript')

function runtime() {
  const session = { player: { id: 'synthetic-player' } }
  const calls = []
  let response = { status: 200, data: [] }
  let failure
  const module = { exports: {} }
  const api = {
    ensureOnlineSession: async player => {
      assert.equal(player.player_id, session.player.id)
      return session
    },
    onlineApi: { get: async url => {
      calls.push(url)
      if (failure) throw failure
      return response
    } },
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(
    path.join(__dirname, '../src/services/onlineInventoryAdapter.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    module, exports: module.exports,
    require(name) {
      if (name === './seasons') return { getSeasonNumber: item => Number(item.season || 1) }
      assert.equal(name, './onlineApi')
      return api
    },
  })
  return {
    ...module.exports, calls, player: { player_id: session.player.id },
    respond: data => { failure = undefined; response = data },
    reject: error => { failure = error },
  }
}

test('Nest bare inventory array and legacy items envelope preserve IDs, quantities and grouping', async () => {
  const app = runtime()
  const rows = [
    { id: 'exp', itemConfigId: 'character_exp_crystal', itemType: 'material', quantity: 17 },
    { id: 'gear', itemType: 'equipment', locked: true, payload: { enhancementLevel: 3 } },
    { id: 'future', itemType: 'unknown', quantity: 2 },
  ]
  for (const data of [rows, { items: rows }, { success: true, items: rows }]) {
    app.respond({ status: 200, data })
    const result = await app.loadOnlineInventory(app.player)
    assert.equal(result.rows, rows)
    assert.equal(result.inventory.materials[0].count, 17)
    assert.equal(result.inventory.equipment[0].is_locked, true)
    assert.equal(result.inventory.equipment[0].level, 3)
    assert.equal(result.inventory.items[0].item_id, 'future')
  }
  assert(app.calls.every(url => url === '/inventory/synthetic-player'))
})

test('successful empty inventory/materials remain legitimate empty data', async () => {
  const app = runtime()
  for (const data of [[], { items: [] }]) {
    app.respond({ status: 200, data })
    assert.equal((await app.loadOnlineInventory(app.player)).rows.length, 0)
  }
  app.respond({ status: 200, data: { success: true, materials: [] } })
  assert.equal(Object.keys((await app.loadOnlineMaterials(app.player)).materials).length, 0)
})

test('HTTP 200 business failure, even with rows, and resolved HTTP 500 reject for both readers', async () => {
  const app = runtime()
  for (const reader of ['loadOnlineInventory', 'loadOnlineMaterials']) {
    for (const response of [
      { status: 200, data: { success: false } },
      { status: 200, data: { success: false, items: [], materials: [] } },
      { status: 500, data: { success: true, items: [], materials: [] } },
    ]) {
      app.respond(response)
      await assert.rejects(app[reader](app.player), /request failed/)
    }
  }
})

test('malformed payload is an error, not an empty inventory or material balance', async () => {
  const app = runtime()
  for (const reader of ['loadOnlineInventory', 'loadOnlineMaterials']) {
    for (const data of [null, {}, { items: {}, materials: {} }, { items: 'invalid', materials: 'invalid' }]) {
      app.respond({ status: 200, data })
      await assert.rejects(app[reader](app.player), /Invalid online/)
    }
  }
})

test('network rejection propagates; a subsequent retry maps authoritative material balances', async () => {
  const app = runtime()
  const failure = new Error('synthetic network failure')
  for (const reader of ['loadOnlineInventory', 'loadOnlineMaterials']) {
    app.reject(failure)
    await assert.rejects(app[reader](app.player), error => error === failure)
  }
  app.respond({ status: 200, data: { success: true, materials: [
    { itemId: 'material-row', itemConfigId: 'equipment_set', materialType: 'EQUIPMENT_SET', attributeType: 'WATER', count: 8 },
  ] } })
  const result = await app.loadOnlineMaterials(app.player)
  assert.equal(result.materials['material-row'].count, 8)
  assert.equal(result.materials['material-row'].material_type, 'EQUIPMENT_SET')
  assert.equal(result.materials['material-row'].attribute_type, 'WATER')
  assert.equal(app.calls.at(-1), '/workshop/synthetic-player/materials')
})
