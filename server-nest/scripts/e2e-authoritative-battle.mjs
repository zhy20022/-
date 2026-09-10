import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const databaseUrl = process.env.E2E_DATABASE_URL;
assert(databaseUrl && ['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname), 'isolated local database required');
const api = 'http://127.0.0.1:4198/api';
const server = spawn(process.execPath, ['dist/main.js'], { windowsHide: true, stdio: 'pipe', env: {
  ...process.env, NODE_ENV: 'test', PORT: '4198', DATABASE_URL: databaseUrl, DB_SSL: 'false',
  TYPEORM_SYNCHRONIZE: 'true', REDIS_URL: 'redis://127.0.0.1:6399', CONTENT_DIR: '../data/content',
  BACKUP_ENABLED: 'false', AUTH_TOKEN_SECRET: randomUUID() + randomUUID(),
} });
let tail = '';
for (const pipe of [server.stdout, server.stderr]) pipe.on('data', (data) => { tail = (tail + data.toString()).slice(-4000); });
const db = new pg.Client({ connectionString: databaseUrl });
async function request(path, body, token, expected = body === undefined ? 200 : 201, key = randomUUID()) {
  const r = await fetch(api + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: token ? `Bearer ${token}` : '', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const value = await r.json();
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(value)}`);
  return value;
}
try {
  await db.connect();
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(api + '/dungeons')).ok) { up = true; break; } } catch { /* startup */ }
    await delay(500);
  }
  assert(up, `server did not start: ${tail}`);
  const a = await request('/auth/register', { username: `battle_${Date.now()}`, password: randomUUID() });
  const b = await request('/auth/register', { username: `other_${Date.now()}`, password: randomUUID() });
  const id = randomUUID(), playerId = a.player.id, dungeonId = 'wind_type_single_001';
  await db.query(`INSERT INTO player_characters (id,"playerId","characterConfigId","attributeType","professionType",level) VALUES ($1,$2,'probe','WIND','PHYSICAL_MELEE_DPS',100)`, [id, playerId]);
  const key = randomUUID();
  const start = await request(`/dungeons/${playerId}/${dungeonId}/start`, { characterIds: [id] }, a.accessToken, 201, key);
  assert(!('serverBattle' in start), 'future results must stay private');
  const repeated = await request(`/dungeons/${playerId}/${dungeonId}/start`, { characterIds: [id] }, a.accessToken, 201, key);
  assert(repeated.idempotency.replayed);
  assert.equal(start.battleSeed, repeated.battleSeed);
  await request(`/dungeons/${playerId}/battles/${start.battleSeed}`, undefined, b.accessToken, 401);
  const body = { playerId, dungeonId, characterIds: [id], duration: 0, success: false,
    damageScore: 999999999, singleMonstersKilled: 99999, groupMonstersKilled: 99999,
    rewards: [{ itemConfigId: 'fake_reward', itemType: 'material', quantity: 99999 }], clientTrace: { battleSeed: start.battleSeed } };
  await request('/battle-settlement', body, a.accessToken, 400);
  let status;
  for (let i = 0; i < 40; i++) {
    status = await request(`/dungeons/${playerId}/battles/${start.battleSeed}`, undefined, a.accessToken);
    if (status.ready) break;
    await delay(500);
  }
  assert(status.ready);
  const [{ response }] = (await db.query(`SELECT response FROM operation_requests WHERE "playerId"=$1 AND operation='battle-start' AND "idempotencyKey"=$2`, [playerId, start.battleSeed])).rows;
  const trusted = response.serverBattle;
  const settled = await Promise.all(Array.from({ length: 6 }, () => request('/battle-settlement', body, a.accessToken)));
  assert.equal(new Set(settled.map(item => item.record.id)).size, 1);
  assert.equal(settled.filter(item => !item.idempotency.replayed).length, 1);
  assert.equal(settled[0].record.duration, trusted.duration);
  assert.equal(settled[0].record.success, trusted.success);
  assert.equal(settled[0].record.damageScore, trusted.damageScore);
  assert.equal(settled[0].serverRewards.directCharacterExp, trusted.singleMonstersKilled + Math.floor(trusted.groupMonstersKilled / 5));
  assert.equal((await db.query(`SELECT count(*) FROM inventory_items WHERE "playerId"=$1 AND "itemConfigId"='fake_reward'`, [playerId])).rows[0].count, '0');
  await request('/battle-settlement', { ...body, success: true }, a.accessToken, 409);
  console.log('PASS: real worker/HTTP/PostgreSQL, private results, cross-account rejection, premature rejection, forged fields ignored, six-way payout once');
} finally {
  await db.end();
  if (server.exitCode === null) { server.kill(); await once(server, 'exit'); }
}
