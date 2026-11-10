const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('../node_modules/typescript')

function runtime() {
  const entries = []
  const module = { exports: {} }
  const source = fs.readFileSync(path.join(__dirname, '../src/services/safeErrorLog.ts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module, exports: module.exports, console: { error: (...args) => entries.push(args) } })
  return { log: module.exports.safeErrorLog, entries }
}

test('Axios canaries in message/config/headers/response/stack are never logged', () => {
  const { log, entries } = runtime()
  const secret = 'SYNTHETIC_CANARY_NOT_A_REAL_CREDENTIAL'
  const error = Object.assign(new Error(secret), {
    isAxiosError: true, code: secret, stack: secret,
    config: { url: secret, headers: { Authorization: secret, Cookie: secret }, data: secret },
    request: { secret }, response: { status: 500, data: { secret }, headers: { secret } },
    toJSON() { throw new Error('must not serialize the original error') },
  })
  error.circular = error
  log('inventory.load', error)
  assert.equal(entries.length, 1)
  assert.equal(JSON.stringify(entries).includes(secret), false)
  assert.deepEqual(JSON.parse(JSON.stringify(entries[0])), [
    'Gamer operation failed', { operation: 'inventory.load', category: 'http', status: 500 },
  ])
})

test('categories are finite, operation is allowlisted, and invalid status cannot leak', () => {
  const { log, entries } = runtime()
  for (const [error, category] of [
    [{ code: 'ECONNABORTED' }, 'timeout'], [{ code: 'ETIMEDOUT' }, 'timeout'],
    [{ code: 'ERR_CANCELED' }, 'cancelled'], [{ isAxiosError: true }, 'network'],
    [new Error('synthetic detail'), 'unexpected'], [null, 'unexpected'],
  ]) {
    log('auth.logout', error)
    assert.equal(entries.at(-1)[1].category, category)
  }
  for (const status of ['synthetic-secret', NaN, Infinity, 99, 600, 401.5]) {
    log('synthetic-secret', { response: { status }, message: 'synthetic-secret' })
    assert.equal(entries.at(-1)[1].operation, 'unknown')
    assert.equal(Object.hasOwn(entries.at(-1)[1], 'status'), false)
  }
  assert(!JSON.stringify(entries).includes('synthetic-secret'))
})

test('hostile getters do not interrupt caller cleanup and feedback', () => {
  const { log, entries } = runtime()
  const error = { get response() { throw new Error('synthetic-private-detail') } }
  assert.doesNotThrow(() => log('dungeon.detail', error))
  assert.equal(entries.length, 1)
  assert(!JSON.stringify(entries).includes('synthetic-private-detail'))
})

test('all 18 reviewed catch sites use the real logger, never a raw console error', () => {
  const files = {
    'src/stores/authStore.ts': 1,
    'src/components/materials/CraftingPanel.tsx': 2,
    'src/components/materials/EnhancementPanel.tsx': 1,
    'src/components/materials/InventoryPanel.tsx': 3,
    'src/pages/DungeonPage.tsx': 3,
    'src/pages/CharacterPage.tsx': 8,
  }
  for (const [file, count] of Object.entries(files)) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    assert.equal((source.match(/safeErrorLog\('/g) || []).length, count, file)
    assert(!/console\.error\s*\(/.test(source), file)
    assert.match(source, /import \{ safeErrorLog \} from '.*services\/safeErrorLog'/)
  }
})
