const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('../node_modules/typescript')
const root = path.resolve(__dirname, '..')
function load(file, imports = {}) {
  const module = { exports: {} }
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(output, {
    module, exports: module.exports, Map, Set, Number, Error,
    require(name) {
      assert(name in imports, `Unexpected import ${name}`)
      return imports[name]
    },
  })
  return module.exports
}
const pool = load('src/data/characterPool.ts')
const seasons = load('src/services/seasons.ts')
const catalog = load('src/services/characterCatalog.ts', { '../data/characterPool': pool, './seasons': seasons })

test('season precedes character number and legacy content belongs to season one', () => {
  const rows = [{ number: 1, season: 2 }, { number: 10 }, { number: 2, season_id: '1' }]
  assert.deepEqual(rows.sort(catalog.compareCharactersByNumber).map(row => row.number), [2, 10, 1])
  assert.equal(seasons.getSeasonNumber({}), 1)
  assert.equal(seasons.SWEEP_UNLOCK_COUNT, 10)
})

test('actual 64-entry catalog agrees with authored config, no changed game data', () => {
  const authored = JSON.parse(fs.readFileSync(path.resolve(root, '../data/content/characters.json'), 'utf8').replace(/^\uFEFF/, '')).characters
  assert.equal(catalog.localCharacterCatalog.length, 64)
  assert.deepEqual(Array.from(catalog.localCharacterCatalog, row => [row.configId, row.number]), authored.map(row => [row.id, row.number]))
  assert.deepEqual([...catalog.createCharacterNumberMap().values()].sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i + 1))
})

test('numeric sorting, precise config IDs, unknown entries retained and stable ties', () => {
  const map = catalog.createCharacterNumberMap([{ configId: 'ten', number: 10 }, { configId: 'two', number: 2 }])
  const rows = [{ character_id: 'unknown_1_char_001' }, { character_id: 'b', config_id: 'ten' },
    { character_id: 'z', config_id: 'two' }, { character_id: 'a', config_id: 'two' }]
  assert.deepEqual(rows.sort((a, b) => catalog.compareCharactersByNumber(a, b, map)).map(row => row.character_id),
    ['a', 'z', 'b', 'unknown_1_char_001'])
  assert.equal(catalog.getCharacterNumber({ character_id: 'char_001_water_physical_tank', name: '江无尘' }, new Map()), undefined)
  assert.equal(catalog.getCharacterNumber({ config_id: 'ten', number: 99 }, map), 10)
})

test('invalid, duplicate numbers and duplicate config IDs fail explicitly', () => {
  for (const number of [0, -1, 1.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => catalog.createCharacterNumberMap([{ configId: 'x', number }]))
  }
  assert.throws(() => catalog.createCharacterNumberMap([{ configId: 'a', number: 1 }, { configId: 'b', number: 1 }]))
  assert.throws(() => catalog.createCharacterNumberMap([{ configId: 'a', number: 1 }, { configId: 'a', number: 2 }]))
  assert.throws(() => catalog.createCharacterNumberMap([{ configId: '', number: 1 }]))
})
