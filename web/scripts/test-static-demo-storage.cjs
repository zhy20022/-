const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('../node_modules/typescript')

const root = path.resolve(__dirname, '..')
const key = 'gamer_static_demo_state'
const compile = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const poolModule = { exports: {} }
vm.runInNewContext(compile(path.join(root, 'src/data/characterPool.ts')), {
  exports: poolModule.exports, module: poolModule
})
const source = compile(path.join(root, 'src/services/staticDemoApi.ts'))

function createStorage() {
  const values = new Map()
  return {
    values, gets: 0, sets: 0, removes: 0, writeAttempts: 0, removeAttempts: 0,
    failReads: false, failWrites: false, failRemoves: false,
    getItem(k) {
      this.gets++
      if (this.failReads) throw new Error('StorageReadError')
      return values.get(k) ?? null
    },
    setItem(k, value) {
      this.writeAttempts++
      if (this.failWrites) throw new Error('QuotaExceededError')
      this.sets++
      values.set(k, value)
    },
    removeItem(k) {
      this.removeAttempts++
      if (this.failRemoves) throw new Error('StorageRemoveError')
      this.removes++
      values.delete(k)
    }
  }
}

function runtime(storage = createStorage(), staticMode = true, { characterPool = poolModule.exports, json } = {}) {
  const originalAdapter = () => 'original'
  const axios = { defaults: { adapter: originalAdapter } }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, exports: module.exports, localStorage: storage, Error,
    ...(json ? { JSON: json } : {}),
    require(name) {
      if (name === 'axios') return { default: axios }
      if (name === '../data/characterPool') return characterPool
      if (name === '../config') return { isStaticDemoMode: () => staticMode }
      throw new Error(`Unexpected import: ${name}`)
    }
  })
  module.exports.installStaticDemoApi()
  return {
    storage, axios, originalAdapter,
    async request(url, method = 'get', data) {
      return axios.defaults.adapter({ url, method, data })
    }
  }
}

async function canonical() {
  const app = runtime()
  for (let i = 0; i < 2; i++) {
    const result = await app.request('/api/player/info')
    assert.equal(result.status, 200)
    assert.equal(result.data.success, true)
  }
  return app
}

const read = (app) => JSON.parse(app.storage.values.get(key))

test('canonical reads, previews, snapshots and fallback do not rewrite the save', async () => {
  const app = await canonical()
  const before = app.storage.sets
  const raw = app.storage.values.get(key)
  const id = read(app).characters[0].character_id
  for (const url of [
    '/api/player/info', '/api/characters', '/api/inventory', '/api/materials',
    '/api/materials/transactions', '/api/dungeons', '/api/gacha/status',
    '/api/social/assist-mode', '/api/unknown', '/api/dungeons/water_type_single_001',
    `/api/characters/${id}/exp-preview`, '/api/battle/missing/snapshot'
  ]) {
    assert.equal((await app.request(url)).data.success, true)
  }
  await app.request('/api/auth/logout', 'post')
  assert.equal(app.storage.sets, before)
  assert.equal(app.storage.values.get(key), raw)
})

test('writes persist immediately, and a fresh module restores them', async () => {
  const app = await canonical()
  const before = app.storage.sets
  await app.request('/api/auth/login', 'post', { username: 'restored-player' })
  assert.equal(app.storage.sets, before + 1)
  const id = read(app).characters[0].character_id
  const crystals = read(app).inventory[0].count
  const used = await app.request(`/api/characters/${id}/use-exp`, 'post', { amount: 10 })
  assert.equal(used.data.success, true)
  assert.equal(read(app).inventory[0].count, crystals - 10)
  const restored = runtime(app.storage)
  assert.equal((await restored.request('/api/player/info')).data.player.username, 'restored-player')
  assert.equal(read(restored).characters[0].exp, 10)
})

test('missing legacy fields and character fields are repaired once', async () => {
  const app = await canonical()
  const old = read(app)
  const expToNext = old.characters[0].exp_to_next_level
  delete old.battles
  delete old.gachaHistory
  delete old.inventory
  delete old.characters[0].stats
  delete old.characters[0].max_level
  delete old.characters[0].exp_to_next_level
  old.customExtension = { preserve: true }
  app.storage.values.set(key, JSON.stringify(old))
  const before = app.storage.sets
  assert.equal((await app.request('/api/characters')).data.success, true)
  assert.equal(app.storage.sets, before + 1)
  const repaired = read(app)
  assert.deepEqual(repaired.battles, {})
  assert.deepEqual(repaired.gachaHistory, [])
  assert.equal(repaired.characters[0].max_level, 100)
  assert.equal(repaired.characters[0].exp_to_next_level, expToNext)
  assert.ok(repaired.characters[0].stats)
  assert.equal(repaired.inventory[0].count, 3000)
  assert.equal(repaired.customExtension.preserve, true)
  await app.request('/api/characters')
  assert.equal(app.storage.sets, before + 1)
})

test('inventory and dungeon configuration migration remains durable', async () => {
  const app = await canonical()
  const old = read(app)
  old.inventory[0].material_type = 'demo_exp_crystal'
  old.inventory[0].item_name = 'legacy'
  old.inventory[0].count = 47
  old.dungeons[0].recommendation.recommended_level = 999
  old.dungeons[0].progress.completion_count = '7'
  delete old.dungeons[0].progress.total_attempts
  old.dungeons.pop()
  app.storage.values.set(key, JSON.stringify(old))
  const before = app.storage.sets
  assert.equal((await app.request('/api/inventory')).data.success, true)
  assert.equal(app.storage.sets, before + 1)
  const repaired = read(app)
  assert.equal(repaired.inventory[0].material_type, 'CHARACTER_EXP')
  assert.equal(repaired.inventory[0].count, 47)
  assert.equal(repaired.dungeons.length, 26)
  assert.equal(repaired.dungeons[0].recommendation.recommended_level, 1)
  assert.equal(repaired.dungeons[0].progress.completion_count, 7)
  assert.equal(repaired.dungeons[0].progress.total_attempts, 0)
  await app.request('/api/dungeons')
  assert.equal(app.storage.sets, before + 1)
})

test('malformed JSON uses the existing remove-and-default recovery policy', async () => {
  const app = runtime()
  app.storage.values.set(key, '{broken JSON')
  const result = await app.request('/api/player/info')
  assert.equal(result.status, 200)
  assert.equal(result.data.success, true)
  assert.equal(app.storage.removes, 1)
  assert.equal(app.storage.sets, 1)
  assert.equal(read(app).player.gold, 100000)
})

test('a failed migration write reports failure without deleting valid JSON', async () => {
  const app = await canonical()
  const old = read(app)
  delete old.battles
  const raw = JSON.stringify(old)
  app.storage.values.set(key, raw)
  app.storage.failWrites = true
  const result = await app.request('/api/player/info')
  assert.equal(result.status, 500)
  assert.equal(result.data.success, false)
  assert.match(result.data.message, /QuotaExceededError/)
  assert.equal(app.storage.removes, 0)
  assert.equal(app.storage.removeAttempts, 0)
  assert.equal(app.storage.values.get(key), raw)
})

for (const transient of [true, false]) {
  test(`valid save survives a ${transient ? 'transient' : 'persistent'} normalization dependency exception`, async () => {
    const initial = await canonical()
    const state = read(initial)
    state.player.gold = 123456
    const raw = JSON.stringify(state)
    initial.storage.values.set(key, raw)
    const beforeWrites = initial.storage.writeAttempts
    let failures = 0
    const pool = new Proxy(poolModule.exports.CHARACTER_POOL, {
      get(target, property, receiver) {
        if (property === '0' && (!transient || failures === 0)) {
          failures++
          throw new Error('NormalizationDependencyError')
        }
        return Reflect.get(target, property, receiver)
      }
    })
    const app = runtime(initial.storage, true, {
      characterPool: { ...poolModule.exports, CHARACTER_POOL: pool }
    })
    const result = await app.request('/api/player/info')
    assert.equal(result.status, 500)
    assert.equal(result.data.success, false)
    assert.equal(result.data.message, 'NormalizationDependencyError')
    assert.equal(app.storage.values.get(key), raw)
    assert.equal(app.storage.removes, 0)
    assert.equal(app.storage.removeAttempts, 0)
    assert.equal(app.storage.writeAttempts, beforeWrites)
    if (transient) {
      const retry = await app.request('/api/player/info')
      assert.equal(retry.status, 200)
      assert.equal(retry.data.success, true)
      assert.equal(retry.data.player.gold, 123456)
      assert.equal(app.storage.values.get(key), raw)
    }
  })
}

test('valid JSON with incompatible data fails normalization without resetting the save', async () => {
  for (const value of [null, false, 0, 'text', { characters: [null] }]) {
    const app = runtime()
    const raw = JSON.stringify(value)
    app.storage.values.set(key, raw)
    const result = await app.request('/api/player/info')
    assert.equal(result.status, 500)
    assert.equal(result.data.success, false)
    assert.equal(app.storage.values.get(key), raw)
    assert.equal(app.storage.removeAttempts, 0)
    assert.equal(app.storage.writeAttempts, 0)
  }
})

test('serialization failure after normalization preserves the original save', async () => {
  const initial = await canonical()
  const old = read(initial)
  delete old.battles
  const raw = JSON.stringify(old)
  initial.storage.values.set(key, raw)
  const beforeWrites = initial.storage.writeAttempts
  let parses = 0
  let serializations = 0
  const app = runtime(initial.storage, true, {
    json: {
      parse(value) { parses++; return JSON.parse(value) },
      stringify() { serializations++; throw new Error('SerializationError') }
    }
  })
  const result = await app.request('/api/player/info')
  assert.equal(result.status, 500)
  assert.equal(result.data.success, false)
  assert.equal(result.data.message, 'SerializationError')
  assert.equal(parses, 1)
  assert.equal(serializations, 1)
  assert.equal(app.storage.values.get(key), raw)
  assert.equal(app.storage.removeAttempts, 0)
  assert.equal(app.storage.writeAttempts, beforeWrites)
})

test('storage read failure reports failure without creating or removing a save', async () => {
  const app = await canonical()
  const raw = app.storage.values.get(key)
  const beforeWrites = app.storage.writeAttempts
  app.storage.failReads = true
  const result = await app.request('/api/player/info')
  assert.equal(result.status, 500)
  assert.equal(result.data.success, false)
  assert.equal(result.data.message, 'StorageReadError')
  assert.equal(app.storage.values.get(key), raw)
  assert.equal(app.storage.writeAttempts, beforeWrites)
  assert.equal(app.storage.removeAttempts, 0)
})

test('storage removal failure does not pretend malformed JSON was recovered', async () => {
  const app = runtime()
  const raw = '{broken JSON'
  app.storage.values.set(key, raw)
  app.storage.failRemoves = true
  const result = await app.request('/api/player/info')
  assert.equal(result.status, 500)
  assert.equal(result.data.success, false)
  assert.equal(result.data.message, 'StorageRemoveError')
  assert.equal(app.storage.values.get(key), raw)
  assert.equal(app.storage.removeAttempts, 1)
  assert.equal(app.storage.removes, 0)
  assert.equal(app.storage.writeAttempts, 0)
})

test('default-state write failure after malformed JSON is reported, not a false success', async () => {
  const app = runtime()
  app.storage.values.set(key, '{broken JSON')
  app.storage.failWrites = true
  const result = await app.request('/api/player/info')
  assert.equal(result.status, 500)
  assert.equal(result.data.success, false)
  assert.equal(result.data.message, 'QuotaExceededError')
  assert.equal(app.storage.removes, 1)
  assert.equal(app.storage.writeAttempts, 1)
  assert.equal(app.storage.sets, 0)
  assert.equal(app.storage.values.has(key), false)
})

test('GET result settles once and remains idempotent after reinitialization', async () => {
  const app = await canonical()
  const state = read(app)
  const id = state.characters[0].character_id
  const created = await app.request('/api/battle/create', 'post', {
    dungeon_id: 'water_type_single_001', character_ids: [id]
  })
  assert.equal(created.status, 200)
  assert.equal(created.data.success, true)
  const battleId = created.data.battle_id
  const started = await app.request(`/api/battle/${battleId}/start`, 'post', { battle_speed: 1 })
  assert.equal(started.status, 200)
  assert.equal(started.data.success, true)
  const result = await app.request(`/api/battle/${battleId}/result`)
  assert.equal(result.status, 200)
  assert.equal(result.data.success, true)
  assert.equal(result.data.result.battle_id, battleId)
  const settled = read(app)
  assert.equal(settled.player.gold, state.player.gold + 100)
  assert.equal(settled.inventory[0].count, state.inventory[0].count + 531)
  assert.equal(settled.characters[0].exp, state.characters[0].exp + 20)
  const completions = state.dungeons.find(d => d.dungeon_id === 'water_type_single_001').progress.completion_count
  assert.equal(settled.dungeons.find(d => d.dungeon_id === 'water_type_single_001').progress.completion_count, completions + 1)
  assert.equal(settled.battles[battleId].settled, true)
  const restored = runtime(app.storage)
  const repeated = await restored.request(`/api/battle/${battleId}/result`)
  assert.equal(repeated.status, 200)
  assert.equal(repeated.data.success, true)
  assert.equal(repeated.data.result.battle_id, battleId)
  const afterRepeat = read(restored)
  assert.equal(afterRepeat.player.gold, settled.player.gold)
  assert.equal(afterRepeat.inventory[0].count, settled.inventory[0].count)
  assert.equal(afterRepeat.characters[0].exp, settled.characters[0].exp)
  assert.equal(afterRepeat.dungeons.find(d => d.dungeon_id === 'water_type_single_001').progress.completion_count, completions + 1)
  assert.deepEqual(afterRepeat, settled)
})

test('failed settlement writes are failures, and a retry persists rewards exactly once', async () => {
  const app = await canonical()
  const initial = read(app)
  const created = await app.request('/api/battle/create', 'post', {
    dungeon_id: 'water_type_single_001', character_ids: [initial.characters[0].character_id]
  })
  assert.equal(created.status, 200)
  assert.equal(created.data.success, true)
  const battleId = created.data.battle_id
  const started = await app.request(`/api/battle/${battleId}/start`, 'post', { battle_speed: 1 })
  assert.equal(started.status, 200)
  assert.equal(started.data.success, true)
  const raw = app.storage.values.get(key)
  const beforeWrites = app.storage.writeAttempts
  app.storage.failWrites = true
  const failed = await app.request(`/api/battle/${battleId}/result`)
  assert.equal(failed.status, 500)
  assert.equal(failed.data.success, false)
  assert.equal(failed.data.message, 'QuotaExceededError')
  assert.equal(failed.data.result, undefined)
  assert.equal(app.storage.values.get(key), raw)
  assert.equal(app.storage.writeAttempts, beforeWrites + 1)
  assert.equal(app.storage.removeAttempts, 0)

  app.storage.failWrites = false
  const restored = runtime(app.storage)
  const retried = await restored.request(`/api/battle/${battleId}/result`)
  assert.equal(retried.status, 200)
  assert.equal(retried.data.success, true)
  assert.equal(retried.data.result.battle_id, battleId)
  const settled = read(restored)
  assert.equal(settled.player.gold, initial.player.gold + 100)
  assert.equal(settled.inventory[0].count, initial.inventory[0].count + 531)
  assert.equal(settled.characters[0].exp, initial.characters[0].exp + 20)
  assert.equal(settled.dungeons.find(d => d.dungeon_id === 'water_type_single_001').progress.completion_count, 1)
  assert.equal(settled.battles[battleId].settled, true)

  app.storage.failWrites = true
  const failedRepeat = await restored.request(`/api/battle/${battleId}/result`)
  assert.equal(failedRepeat.status, 500)
  assert.equal(failedRepeat.data.success, false)
  assert.equal(failedRepeat.data.message, 'QuotaExceededError')
  assert.equal(failedRepeat.data.result, undefined)
  assert.deepEqual(read(restored), settled)

  app.storage.failWrites = false
  const repeated = await restored.request(`/api/battle/${battleId}/result`)
  assert.equal(repeated.status, 200)
  assert.equal(repeated.data.success, true)
  assert.equal(repeated.data.result.battle_id, battleId)
  assert.deepEqual(read(restored), settled)
})

test('gacha, battle speed/stop and sweep still save on their existing paths', async () => {
  const app = await canonical()
  let before = app.storage.sets
  assert.equal((await app.request('/api/gacha/pull', 'post', { pull_count: 1 })).data.success, true)
  assert.equal(app.storage.sets, before + 1)
  const state = read(app)
  assert.equal(state.gachaHistory.length, 1)
  assert.equal(state.player.gold, 99000)
  const created = await app.request('/api/dungeons/water_type_single_001/start', 'post', {
    character_ids: [state.characters[0].character_id]
  })
  const battleId = created.data.battle_id
  before = app.storage.sets
  await app.request(`/api/battle/${battleId}/speed`, 'post', { battle_speed: 4 })
  await app.request(`/api/battle/${battleId}/stop`, 'post')
  assert.equal(app.storage.sets, before + 2)
  assert.equal(read(app).battles[battleId].battle_speed, 4)
  assert.equal(read(app).battles[battleId].stopped, true)
  const unlocked = read(app)
  const dungeon = unlocked.dungeons.find(d => d.dungeon_id === 'water_type_single_001')
  dungeon.progress.completion_count = 50
  dungeon.progress.sweep_unlocked = true
  app.storage.values.set(key, JSON.stringify(unlocked))
  const swept = await app.request('/api/dungeons/water_type_single_001/sweep', 'post', { count: 2 })
  assert.equal(swept.data.success, true)
  assert.equal(read(app).inventory[0].count, unlocked.inventory[0].count + 1062)
})

test('formal mode does not install the adapter or touch storage', () => {
  const app = runtime(createStorage(), false)
  assert.equal(app.axios.defaults.adapter, app.originalAdapter)
  assert.equal(app.storage.gets, 0)
  assert.equal(app.storage.sets, 0)
})

test('separate modules observe each others saved changes without a memory cache', async () => {
  const first = await canonical()
  const second = runtime(first.storage)
  await first.request('/api/auth/login', 'post', { username: 'first-tab' })
  assert.equal((await second.request('/api/player/info')).data.player.username, 'first-tab')
  await second.request('/api/auth/login', 'post', { username: 'second-tab' })
  assert.equal((await first.request('/api/player/info')).data.player.username, 'second-tab')
})
