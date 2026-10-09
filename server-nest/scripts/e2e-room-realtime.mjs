import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
const { io } = createRequire(new URL('../../web/package.json', import.meta.url))('socket.io-client');
const url = new URL(process.env.E2E_DATABASE_URL || '');
assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.slice(1).startsWith('gamer_rewards_e2e'));
const db = new pg.Client({ connectionString: url.toString() });
const ports = [4206, 4207];
const secret = randomUUID();
const sockets = [];
const children = [];
const report = { verified: false, checks: [], startedAt: new Date().toISOString() };
const evidence = resolve(process.env.E2E_ARTIFACT_DIR || process.env.TEMP, 'room-realtime');
let output = '';
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: url.toString(), TYPEORM_SYNCHRONIZE: 'false',
  AUTH_TOKEN_SECRET: secret, REDIS_URL: 'redis://127.0.0.1:6399', BACKUP_ENABLED: 'false',
  CONTENT_DIR: '../data/content', RATE_LIMIT_MAX: '100000', CORS_ORIGIN: 'http://127.0.0.1:3026' };
function child(args, extra = {}) {
  const process = spawn(globalThis.process.execPath, args, { env: { ...env, ...extra }, windowsHide: true, stdio: 'pipe' });
  children.push(process);
  for (const pipe of [process.stdout, process.stderr]) pipe.on('data', data => { output = (output + data).slice(-20000); });
  return process;
}
async function until(label, check, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(80); }
  throw new Error(`timeout ${label}\n${output}`);
}
async function request(path, token, body, status = body === undefined ? 200 : 201, port = ports[0]) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) },
    method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}
function open(token, port = ports[0], origin = env.CORS_ORIGIN) {
  const socket = io(`http://127.0.0.1:${port}/rooms`, {
    auth: { token }, transports: ['websocket'], reconnection: false, extraHeaders: { origin },
  });
  sockets.push(socket);
  return socket;
}
async function connected(token, port) {
  const socket = open(token, port);
  await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([error]) => { throw error; })]);
  return socket;
}
async function rejected(token, origin) {
  const socket = open(token, ports[0], origin);
  await once(socket, 'connect_error');
  assert.equal(socket.connected, false);
  socket.disconnect();
}
const subscribe = (socket, room, version) => socket.timeout(5000).emitWithAck('room.subscribe', {
  roomId: room, ...(version === undefined ? {} : { version }),
});
function signed(session, exp) {
  const payload = Buffer.from(JSON.stringify({ userId: session.user.id, playerId: session.player.id, exp })).toString('base64url');
  return `online.${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
try {
  await mkdir(evidence, { recursive: true });
  await db.connect();
  const migrate = child(['dist/database/run-migrations.js']);
  assert.equal((await once(migrate, 'exit'))[0], 0, output);
  let first = child(['dist/main.js'], { PORT: String(ports[0]) });
  child(['dist/main.js'], { PORT: String(ports[1]) });
  for (const port of ports) await until('server', async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/api/health/live`)).ok; } catch { return false; }
  });
  const a = await request('/auth/guest', null, { deviceId: randomUUID() });
  const b = await request('/auth/guest', null, { deviceId: randomUUID() });
  const outsider = await request('/auth/guest', null, { deviceId: randomUUID() });
  await rejected(undefined);
  await rejected('invalid');
  await rejected(signed(a, Math.floor(Date.now() / 1000) - 5));
  await rejected(a.accessToken, 'https://untrusted.invalid');
  await db.query(`UPDATE users SET status='banned' WHERE id=$1`, [outsider.user.id]);
  await rejected(outsider.accessToken);
  await db.query(`UPDATE users SET status='active' WHERE id=$1`, [outsider.user.id]);
  report.checks.push('unauthenticated/invalid/expired/banned/origin handshake rejected');
  await request(`/friends-assist/${a.player.id}/request`, a.accessToken, { addresseePlayerId: b.player.id });
  await request(`/friends-assist/${b.player.id}/accept`, b.accessToken, { requesterPlayerId: a.player.id });
  const room = await request('/multiplayer-rooms', a.accessToken, { dungeonId: 'fire_type_squad_001' });
  const aSocket = await connected(a.accessToken);
  const outsiderSocket = await connected(outsider.accessToken);
  assert.equal((await subscribe(outsiderSocket, room.room_id)).error.status, 403);
  await request(`/multiplayer-rooms/${room.room_id}/sync`, outsider.accessToken, undefined, 403);
  assert.equal((await subscribe(aSocket, room.room_id, '999999')).error.status, 400);
  assert.equal((await subscribe(aSocket, randomUUID())).error.status, 404);
  assert.equal((await subscribe(aSocket, room.room_id)).mode, 'snapshot');
  const events = [];
  aSocket.on('room.event', event => events.push(event));
  const invitation = await request(`/multiplayer-rooms/${room.room_id}/invite`, a.accessToken, { inviteePlayerId: b.player.id });
  await request(`/multiplayer-rooms/invitations/${invitation.invitation_id}/accept`, b.accessToken, { characterIds: [] });
  await until('join pushed', () => events.some(event => event.eventType === 'member.joined'));
  const bSocket = await connected(b.accessToken, ports[1]);
  const initial = await subscribe(bSocket, room.room_id);
  const bEvents = [];
  bSocket.on('room.event', event => bEvents.push(event));
  const ids = [];
  for (const session of [a, b]) {
    const id = randomUUID(); ids.push(id);
    await db.query(`INSERT INTO player_characters (id,"playerId","characterConfigId","attributeType","professionType",level,exp,"skillSlots",equipment)
      VALUES ($1,$2,'char_033_fire_physical_tank','FIRE','PHYSICAL_TANK',100,0,'{}','{}')`, [id, session.player.id]);
  }
  await Promise.all([a, b].map((session, index) => request(`/multiplayer-rooms/${room.room_id}/member`,
    session.accessToken, { characterIds: [ids[index]], isReady: true }, 201, ports[index])));
  await until('cross-instance committed event delivery', () => bEvents.length === 2 && events.length === 3);
  const current = await request('/multiplayer-rooms/current', a.accessToken);
  assert.equal(current.version, '4');
  assert.deepEqual(bEvents.map(event => event.version), ['3', '4']);
  const history = await subscribe(aSocket, room.room_id, '1');
  assert.equal(history.mode, 'events');
  assert.deepEqual(history.events.map(event => event.version), ['2', '3', '4']);
  assert.equal(initial.version, '2');
  const before = (await db.query(`SELECT count(*)::int n FROM multiplayer_room_events WHERE "roomId"=$1`, [room.room_id])).rows[0].n;
  await request(`/multiplayer-rooms/${room.room_id}/member`, a.accessToken, { characterIds: [ids[0]], isReady: true });
  await request(`/multiplayer-rooms/${room.room_id}/heartbeat`, a.accessToken, {});
  await subscribe(aSocket, room.room_id, '1');
  assert.equal((await db.query(`SELECT count(*)::int n FROM multiplayer_room_events WHERE "roomId"=$1`, [room.room_id])).rows[0].n, before);
  report.checks.push('nonmember/future/missing errors; concurrent two-instance ordered versions; no-op and replay have no side effects');
  // Real transaction fails AFTER appending the event, proving state+event rollback.
  await db.query(`CREATE FUNCTION realtime_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW."roomId"='${room.room_id}'::uuid AND NEW.version=5 THEN RAISE EXCEPTION 'test rollback'; END IF;
    RETURN NEW; END $$`);
  await db.query(`CREATE CONSTRAINT TRIGGER realtime_fail_commit AFTER INSERT ON multiplayer_room_events
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION realtime_fail_commit()`);
  await request(`/multiplayer-rooms/${room.room_id}/member`, a.accessToken, { characterIds: [ids[0]], isReady: false }, 500);
  await db.query(`DROP TRIGGER realtime_fail_commit ON multiplayer_room_events`);
  await db.query(`DROP FUNCTION realtime_fail_commit()`);
  assert.equal((await request('/multiplayer-rooms/current', a.accessToken)).version, '4');
  assert.equal((await request('/multiplayer-rooms/current', a.accessToken)).members.find(row => row.player_id === a.player.id).is_ready, true);
  assert.equal((await db.query(`SELECT count(*)::int n FROM multiplayer_room_events WHERE "roomId"=$1`, [room.room_id])).rows[0].n, before);
  report.checks.push('deferred transaction failure rolls back both room state and appended event');
  aSocket.disconnect();
  await request(`/multiplayer-rooms/${room.room_id}/member`, b.accessToken, { characterIds: [ids[1]], isReady: false }, 201, ports[1]);
  first.kill(); await once(first, 'exit');
  first = child(['dist/main.js'], { PORT: String(ports[0]) });
  await until('restarted', async () => {
    try { return (await fetch(`http://127.0.0.1:${ports[0]}/api/health/live`)).ok; } catch { return false; }
  });
  const resumed = await connected(a.accessToken);
  const recovery = await subscribe(resumed, room.room_id, '4');
  assert.equal(recovery.mode, 'events');
  assert.equal(recovery.events[0].version, '5');
  await db.query(`DELETE FROM multiplayer_room_events WHERE "roomId"=$1 AND version=3`, [room.room_id]);
  const fallback = await subscribe(resumed, room.room_id, '1');
  assert.equal(fallback.mode, 'snapshot');
  assert.equal(fallback.snapshot.version, '5');
  report.checks.push('process restart and missed publication replay; missing history authoritative snapshot');
  await request(`/multiplayer-rooms/${room.room_id}/leave`, b.accessToken, {});
  await until('departed subscriber revoked', () => !bSocket.connected);
  const expiring = await connected(signed(a, Math.floor(Date.now() / 1000) + 1));
  await subscribe(expiring, room.room_id);
  await until('expiry disconnect', () => !expiring.connected);
  await db.query(`UPDATE users SET status='banned' WHERE id=$1`, [a.user.id]);
  await until('live ban disconnect', () => !resumed.connected);
  report.checks.push('membership loss/live expiry/live ban disconnect and subscription cleanup');
  report.verified = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally {
  for (const socket of sockets) socket.disconnect();
  for (const process of children) if (process.exitCode === null && process.signalCode === null) {
    const exited = once(process, 'exit');
    process.kill();
    await exited;
  }
  await db.end();
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve(evidence, 'server.log'), output);
}
