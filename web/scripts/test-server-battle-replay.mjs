import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/services/serverBattleReplay.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { serverBattleSnapshot } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const status = {
  ready: false, speed: 4, outcome: null,
  frame: { time: 12, units: [
    ['player', 0, 0, 0, false, 'Player', 100, []],
    ['boss', 35, 12, 1, true, 'New phase', 200, ['Skill two'], true, true],
    ['dead', 0, 0, 0, false, 'Dead monster', 50, []],
  ] },
  units: { player: { isPlayer: true }, boss: { isPlayer: false }, dead: { isPlayer: false } },
  events: [{ time: 10, event_type: 'boss_mechanic', message: 'Phase changed' }],
}
const snapshot = serverBattleSnapshot(status, 60)
assert.equal(snapshot.current_time, 12)
assert.equal(snapshot.player_units[0].health, 0)
assert.equal(snapshot.player_units[0].is_alive, false)
assert.equal(snapshot.enemy_units.length, 1)
assert.equal(snapshot.enemy_units[0].shield, 12)
assert.equal(snapshot.enemy_units[0].phase, 2)
assert.equal(snapshot.enemy_units[0].boss_mechanic.shared_health, true)
assert.equal(snapshot.enemy_units[0].boss_mechanic.active, false)
assert.deepEqual(snapshot.enemy_units[0].current_skills, ['Skill two'])
assert.equal(snapshot.battle_events[0].time_text, '10.0s')
assert.equal(serverBattleSnapshot({ ...status, ready: true }, 60).battle_state.code, 'completed')
assert.throws(() => serverBattleSnapshot({ ...status, units: {} }, 60))
console.log('Server battle replay mapping passed')
