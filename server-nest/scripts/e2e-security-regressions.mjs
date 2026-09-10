import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import leveling from '../dist/common/leveling.js';

const api = process.env.E2E_API_BASE || 'http://127.0.0.1:4199/api';
const databaseUrl = process.env.E2E_DATABASE_URL;
assert(databaseUrl, 'E2E_DATABASE_URL must point to an isolated local test database');
assert(['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname), 'fixture writes are local-only');
assert(['127.0.0.1', 'localhost'].includes(new URL(api).hostname), 'test API must be local');
const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
const checks = [];
async function request(path, body, token, expected = body === undefined ? 200 : 201, key = randomUUID()) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: token ? `Bearer ${token}` : '', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
  return value;
}
try {
  const a = await request('/auth/register', { username: `audit_${Date.now()}`, password: `Audit-${randomUUID()}` });
  const b = await request('/auth/register', { username: `audit_b_${Date.now()}`, password: `Audit-${randomUUID()}` });
  const playerId = a.player.id;
  const token = a.accessToken;
  const ids = [];
  for (let index = 0; index < 64; index++) {
    const id = randomUUID();
    ids.push(id);
    await db.query(`INSERT INTO player_characters (id, "playerId", "characterConfigId", "attributeType", "professionType") VALUES ($1,$2,$3,'FIRE','PHYSICAL_MELEE_DPS')`, [id, playerId, `audit_${index}`]);
  }
  assert.equal((await request(`/players/${playerId}/profile`, undefined, token)).characters.length, 64);
  checks.push('all 64 owned characters returned');
  const dungeonId = 'fire_type_single_001';
  const body = { playerId, dungeonId, characterIds: [ids[0]], success: true, duration: 60, singleMonstersKilled: 20, groupMonstersKilled: 100, damageScore: 999999999 };
  await request('/battle-settlement', body, token, 400);
  await request('/battle-settlement', { ...body, clientTrace: { battleSeed: randomUUID() } }, token, 400);
  const old = await request(`/dungeons/${playerId}/${dungeonId}/start`, { characterIds: [ids[0]] }, token);
  const started = await request(`/dungeons/${playerId}/${dungeonId}/start`, { characterIds: [ids[0]] }, token);
  await request('/battle-settlement', { ...body, duration: 0, clientTrace: { battleSeed: old.battleSeed } }, token, 400);
  const settlement = { ...body, clientTrace: { battleSeed: started.battleSeed } };
  await request('/battle-settlement', settlement, token, 400);
  await request('/battle-settlement', { ...settlement, characterIds: [ids[1]] }, token, 400);
  await request('/battle-settlement', settlement, b.accessToken, 401);
  checks.push('missing, forged, superseded, premature, mismatched and cross-account settlement rejected');
  await delay(15000);
  const results = await Promise.all(Array.from({ length: 6 }, () => request('/battle-settlement', settlement, token)));
  assert.equal(new Set(results.map(r => r.record.id)).size, 1);
  assert.equal(results.filter(r => !r.idempotency.replayed).length, 1);
  const trusted = (await db.query(`SELECT response FROM operation_requests WHERE "playerId"=$1 AND operation='battle-start' AND "idempotencyKey"=$2`, [playerId, started.battleSeed])).rows[0].response.serverBattle;
  assert.equal(results[0].serverRewards.directCharacterExp, trusted.singleMonstersKilled + Math.floor(trusted.groupMonstersKilled / 5));
  assert.equal(results[0].record.damageScore, trusted.damageScore);
  assert.equal(await request(`/ranking/damage_weekly/player/${playerId}`, undefined, token), null);
  await request('/battle-settlement', { ...settlement, singleMonstersKilled: 19 }, token, 409);
  checks.push('six different HTTP keys award once; changed payload rejected; kill-wave budget and ranking protected');
  const itemId = randomUUID();
  await db.query(`INSERT INTO inventory_items (id,"playerId","itemConfigId","itemType",quantity,payload) VALUES ($1,$2,'audit_armor','equipment',1,'{"slot":"BODY"}')`, [itemId, playerId]);
  const equip = (id) => `/players/${playerId}/characters/${id}/equip`;
  await request(equip(ids[0]), { itemId }, token);
  await request(equip(ids[1]), { itemId }, token, 400);
  await request(`/inventory/${playerId}/items/${itemId}/dismantle`, {}, token, 400);
  await request(`/players/${playerId}/characters/${ids[0]}/unequip`, { slot: 'BODY' }, token);
  await request(equip(ids[1]), { itemId }, token);
  checks.push('equipment cannot be duplicated or dismantled while equipped; slot-only unequip works');
  await db.query(`INSERT INTO inventory_items ("playerId","itemConfigId","itemType",quantity) VALUES ($1,'audit_consumable','consumable',6)`, [playerId]);
  const consumed = await Promise.all(Array.from({ length: 10 }, async () => {
    const response = await fetch(`${api}/inventory/${playerId}/consume`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ itemConfigId: 'audit_consumable', quantity: 1 }) });
    await response.text();
    return response.status;
  }));
  assert.equal(consumed.filter(code => code === 201).length, 6);
  assert.equal(consumed.filter(code => code === 400).length, 4);
  checks.push('ten concurrent consumes of six items succeed exactly six times');
  await db.query(`UPDATE player_characters SET level=99, exp=$1 WHERE id=$2`, [leveling.getExpForNextLevel(99) - 1, ids[0]]);
  const upgraded = await request(`/players/${playerId}/characters/${ids[0]}/use-exp`, { amount: 100 }, token);
  assert.equal(upgraded.character.level, 100);
  assert.equal(upgraded.consumedExpPackages, 1);
  assert.equal(upgraded.consumedGold, 1);
  const preview = await request(`/players/${playerId}/characters/${ids[0]}/exp-preview`, undefined, token);
  assert.equal(preview.requiredGold, 0);
  checks.push('max-level upgrade charges only remaining experience and zero afterward');
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await db.end();
}
