import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const url = process.env.E2E_DATABASE_URL;
assert(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
const api = 'http://127.0.0.1:4197/api';
const server = spawn(process.execPath, ['dist/main.js'], { windowsHide: true, stdio: 'pipe', env: {
  ...process.env, NODE_ENV: 'test', PORT: '4197', DATABASE_URL: url, DB_SSL: 'false',
  TYPEORM_SYNCHRONIZE: 'false', CONTENT_DIR: '../data/content', REDIS_URL: 'redis://127.0.0.1:6399',
  AUTH_TOKEN_SECRET: randomUUID() + randomUUID(), BACKUP_ENABLED: 'false',
} });
let logs = '';
for (const pipe of [server.stdout, server.stderr]) pipe.on('data', chunk => { logs = (logs + chunk).slice(-3000); });
const db = new pg.Client({ connectionString: url });
async function call(path, body, token, expected = body ? 201 : 200, key = randomUUID()) {
  const response = await fetch(api + path, { method: body ? 'POST' : 'GET', headers: {
    'content-type': 'application/json', authorization: token ? `Bearer ${token}` : '', 'Idempotency-Key': key,
  }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
  return result;
}
try {
  await db.connect();
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(api + '/dungeons')).ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  assert(ready, logs);
  const account = await call('/auth/register', { username: 'star_' + Date.now(), password: randomUUID() });
  const { id } = account.player, token = account.accessToken, characterId = randomUUID();
  await db.query(`INSERT INTO player_characters(id,"playerId","characterConfigId","attributeType","professionType",level) VALUES($1,$2,'char_001_water_physical_tank','WATER','PHYSICAL_TANK',1)`, [characterId, id]);
  await db.query(`INSERT INTO inventory_items("playerId","itemConfigId","itemType",quantity,payload) VALUES($1,'char_001_water_physical_tank_shard','fragment',50,'{}')`, [id]);
  const path = `/players/${id}/characters/${characterId}`;
  const before = (await call(`/players/${id}/profile`, undefined, token)).characters[0];
  const key = randomUUID();
  const repeated = await Promise.all([call(path + '/star-up', {}, token, 201, key), call(path + '/star-up', {}, token, 201, key)]);
  assert(repeated.every(row => row.character.star === 2));
  assert.equal((await call(path + '/star-preview', undefined, token)).owned, 45);
  for (let star = 3; star <= 5; star++) assert.equal((await call(path + '/star-up', {}, token)).character.star, star);
  await call(path + '/star-up', {}, token, 400);
  const after = (await call(`/players/${id}/profile`, undefined, token)).characters[0];
  for (const stat of Object.keys(before.base_stats)) assert.equal(after.base_stats[stat], before.base_stats[stat] * 2);
  assert.equal((await call(path + '/star-preview', undefined, token)).owned, 0);
  for (const slot of ['SHOULDERS', 'RING', 'NECKLACE']) {
    await db.query(`INSERT INTO inventory_items("playerId","itemConfigId","itemType",quantity,payload) VALUES($1,'equipment_material','material',10,'{"attributeType":"WATER"}') ON CONFLICT DO NOTHING`, [id]);
    const crafted = await call(`/workshop/${id}/crafting/equipment`, { attributeType: 'WATER', professionCategory: 'A', slot }, token);
    await call(path + '/equip', { itemId: crafted.item.id }, token);
  }
  const foreign = await call('/auth/register', { username: 'foreign_' + Date.now(), password: randomUUID() });
  await call(path + '/star-up', {}, foreign.accessToken, 401);
  const pool = { pools: [{ key: 'duplicate-test', name: 'Test', cost: { currency: 'gold', amount: 0 },
    entries: [{ entryId: 'hero', type: 'character', characterConfigId: 'char_001_water_physical_tank', weight: 1, rarity: 'rare' }] }] };
  await db.query(`INSERT INTO game_configs("configKey",payload) VALUES('gacha_pools',$1) ON CONFLICT("configKey") DO UPDATE SET payload=$1`, [JSON.stringify(pool)]);
  const drawKey = randomUUID();
  const drawn = await call(`/gacha/${id}/draw`, { poolKey: 'duplicate-test', count: 10 }, token, 201, drawKey);
  assert(drawn.results.every(row => row.duplicate && row.shardsGranted === 1 && row.convertedTo.quantity === 1));
  await call(`/gacha/${id}/draw`, { poolKey: 'duplicate-test', count: 10 }, token, 201, drawKey);
  assert.equal((await call(path + '/star-preview', undefined, token)).owned, 10);
  await db.query(`DELETE FROM game_configs WHERE "configKey"='gacha_pools'`);
  console.log('PASS: HTTP/PostgreSQL star costs, replayed upgrade once, max star, 200% stats and new equipment slots');
} finally {
  await db.end();
  if (server.exitCode === null) { server.kill(); await once(server, 'exit'); }
}
