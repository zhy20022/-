import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const transpile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText
const dataUrl = js => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
const reducerUrl = dataUrl(transpile(readFileSync(new URL('../src/services/roomRealtimeState.ts', import.meta.url), 'utf8')))
const sockets = []
globalThis.window = { location: { origin: 'https://web.invalid' }, __GAMER_RUNTIME_CONFIG__: {} }
globalThis.__testSocket = () => {
  const handlers = new Map()
  const socket = {
    handlers, connected: true, requests: [], closed: false,
    on(name, callback) { handlers.set(name, callback); return socket },
    timeout() { return socket },
    emit(name, payload, callback) { socket.requests.push({ name, payload, callback }) },
    removeAllListeners() { handlers.clear() },
    disconnect() { socket.closed = true; socket.connected = false },
    fire(name, value) { handlers.get(name)?.(value) },
  }
  sockets.push(socket)
  return socket
}
const source = readFileSync(new URL('../src/services/realtimeSocket.ts', import.meta.url), 'utf8')
const js = transpile(source)
  .replace("import { io } from 'socket.io-client';", 'const io = globalThis.__testSocket;')
  .replace("import { getOnlineApiBase } from '../config';", "const getOnlineApiBase = () => 'https://api.invalid/api';")
  .replace("'./roomRealtimeState'", JSON.stringify(reducerUrl))
  .replaceAll('import.meta.env.VITE_ROOM_REALTIME', "'true'")
const { connectRoom } = await import(dataUrl(js))
const initial = { room_id: 'a', version: '1' }
let fallbacks = 0
const updates = []
const dispose = connectRoom({ initial, token: 'one', onRoom: room => updates.push(room), onFallback: () => fallbacks++ })
const socket = sockets[0]
socket.fire('connect')
assert.equal(socket.requests[0].payload.version, '1')
socket.requests[0].callback(null, { mode: 'events', roomId: 'a', version: '1', events: [] })
const event = version => ({ roomId: 'a', eventId: version, version, payload: { ...initial, version } })
socket.fire('room.event', event('2'))
socket.fire('room.event', event('2'))
socket.fire('room.event', event('1'))
assert.deepEqual(updates.map(room => room.version), ['1', '2'])
socket.fire('room.event', event('4'))
assert.equal(socket.requests.at(-1).payload.version, '2')
socket.fire('room.event', event('5')) // Live message races with recovery ACK.
socket.requests.at(-1).callback(null, { mode: 'events', roomId: 'a', version: '4', events: [event('3'), event('4')] })
assert.equal(updates.at(-1).version, '5')
socket.fire('disconnect')
assert.equal(fallbacks, 1)
socket.fire('connect')
assert.equal(socket.requests.at(-1).payload.version, '5')
socket.requests.at(-1).callback(null, { mode: 'snapshot', roomId: 'a', version: '8', snapshot: { ...initial, version: '8' } })
assert.equal(updates.at(-1).version, '8')
socket.fire('connect_error')
assert.equal(fallbacks, 2)
socket.fire('connect')
const lateAck = socket.requests.at(-1).callback
dispose()
assert.equal(socket.closed, true)
assert.equal(socket.handlers.size, 0)
const count = updates.length
lateAck(null, { mode: 'snapshot', roomId: 'a', version: '9', snapshot: { ...initial, version: '9' } })
assert.equal(updates.length, count)
const secondDispose = connectRoom({ initial: { room_id: 'b', version: '1' }, token: 'two', onRoom: room => updates.push(room), onFallback: () => fallbacks++ })
assert.equal(socket.handlers.size, 0)
sockets[1].fire('room.event', event('9'))
assert.equal(updates.length, count)
secondDispose()
window.__GAMER_RUNTIME_CONFIG__.roomRealtime = false
const disabled = connectRoom({ initial, token: 'one', onRoom: () => assert.fail(), onFallback: () => assert.fail() })
assert.equal(sockets.length, 2)
disabled()
console.log('PASS (mock transport): gap replay/live ACK race/reconnect/snapshot/fallback/cleanup/account-room isolation/disabled')
