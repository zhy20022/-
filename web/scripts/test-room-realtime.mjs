import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/services/roomRealtimeState.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const { reduceRoomEvent, reduceRoomSnapshot, validVersion } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const room = { room_id: 'room', version: '2', status: 'waiting' }
const event = version => ({ roomId: 'room', version, payload: { ...room, version, status: 'in_battle' } })
assert.equal(reduceRoomEvent(room, event('2')).room, room)
assert.equal(reduceRoomEvent(room, event('1')).room, room)
assert.equal(reduceRoomEvent(room, event('4')).gap, true)
const next = reduceRoomEvent(room, event('3')).room
assert.equal(next.version, '3')
assert.equal(reduceRoomEvent(next, event('3')).room, next)
assert.equal(reduceRoomEvent(next, event('2')).room, next)
assert.equal(reduceRoomSnapshot(next, room), next)
assert.equal(reduceRoomSnapshot(next, { ...room, version: '8' }).version, '8')
assert.equal(reduceRoomEvent(room, { ...event('3'), roomId: 'other' }).gap, true)
assert.equal(reduceRoomEvent(room, { ...event('3'), payload: { ...room, version: '4' } }).gap, true)
assert.equal(validVersion('-1'), false)
assert.equal(validVersion(2), false)
assert.equal(validVersion('9007199254740993'), true)
assert.equal(reduceRoomEvent({ ...room, version: '9007199254740992' }, event('9007199254740993')).gap, false)
console.log('PASS: duplicate/stale/out-of-order/gap/snapshot/room isolation/bigint room reducer')
