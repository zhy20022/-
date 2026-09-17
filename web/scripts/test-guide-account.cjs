const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const ts = require('typescript')
const storage = new Map()
let player = { player_id: 'first' }
const context = { exports: {}, require: () => ({ useAuthStore: { getState: () => ({ player }) } }),
  window: { dispatchEvent: () => {} }, CustomEvent: class {},
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/newPlayerGuide.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context)
const guide = context.exports
storage.set('gamer_new_player_guide_v1', JSON.stringify({ completed: ['draw_character'], hidden: true }))
assert.equal(guide.getNewPlayerGuideState().completed.length, 0)
guide.completeNewPlayerGuideStep('draw_character')
guide.setNewPlayerGuideHidden(true)
player = { player_id: 'second' }
assert.equal(guide.getNewPlayerGuideState().completed.length, 0)
assert.equal(guide.getNewPlayerGuideState().hidden, false)
guide.completeNewPlayerGuideStep('learn_dungeons')
player = { player_id: 'first' }
assert.equal(guide.getNewPlayerGuideState().completed.join(','), 'draw_character')
assert.equal(guide.getNewPlayerGuideState().hidden, true)
guide.resetNewPlayerGuide()
player = { player_id: 'second' }
assert.equal(guide.getNewPlayerGuideState().completed.join(','), 'learn_dungeons')
player = null
guide.completeNewPlayerGuideStep('draw_character')
assert.equal(guide.getNewPlayerGuideState().completed.length, 0)
player = { player_id: 'second' }
storage.set('gamer_new_player_guide_v2:second', '{broken')
assert.equal(guide.getNewPlayerGuideState().completed.length, 0)
context.localStorage.setItem = () => { throw new Error('blocked') }
assert.doesNotThrow(() => guide.completeNewPlayerGuideStep('draw_character'))
console.log('PASS: account isolation, returning account, hidden state, reset isolation, guest, legacy state, invalid/unavailable storage')
