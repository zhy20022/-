import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';

const databaseUrl = process.env.E2E_DATABASE_URL;
assert(databaseUrl && ['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname), 'isolated local database required');
const api = 'http://127.0.0.1:4198/api';
const server = spawn(process.execPath, ['dist/main.js'], { windowsHide: true, stdio: 'pipe', env: {
  ...process.env, NODE_ENV: 'test', PORT: '4198', DATABASE_URL: databaseUrl, DB_SSL: 'false',
  TYPEORM_SYNCHRONIZE: 'true', REDIS_URL: 'redis://127.0.0.1:6399', CONTENT_DIR: '../data/content',
  BACKUP_ENABLED: 'false', AUTH_TOKEN_SECRET: randomUUID() + randomUUID(), RATE_LIMIT_MAX: '2000',
} });
let tail = '';
for (const pipe of [server.stdout, server.stderr]) pipe.on('data', data => { tail = (tail + data).slice(-2000); });
const db = new pg.Client({ connectionString: databaseUrl });
const verified = [];
async function request(path, body, token, expected = body === undefined ? 200 : 201, key = randomUUID()) {
  const result = await fetch(api + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: token ? `Bearer ${token}` : '', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const payload = await result.json();
  assert.equal(result.status, expected, `${path}: ${JSON.stringify(payload)}`);
  return payload;
}
try {
  await db.connect();
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(api + '/dungeons')).ok) { up = true; break; } } catch {}
    await delay(500);
  }
  assert(up, tail);
  const account = await request('/auth/register', { username: `skills_${Date.now()}`, password: randomUUID() });
  const other = await request('/auth/register', { username: `foreign_${Date.now()}`, password: randomUUID() });
  const playerId = account.player.id, token = account.accessToken;
  const authored = JSON.parse(readFileSync('../data/content/authored-character-skills.json', 'utf8')).characters;
  const characterCatalog = JSON.parse(readFileSync('../data/content/characters.json', 'utf8').replace(/^\uFEFF/, ''));
  const enabled = characterCatalog.characters
    .filter(character => authored[character.id])
    .map(character => [character.id, character.attributeType, character.professionType]);
  assert.equal(enabled.length, Object.keys(authored).length, 'every enabled authored character must have catalog metadata');
  const selected = process.env.E2E_CHARACTER_IDS?.split(',').filter(Boolean);
  if (selected) assert(selected.every(id => authored[id]), 'selected characters must be enabled');
  const cases = selected ? enabled.filter(([id]) => selected.includes(id)) : enabled;
  assert(cases.length > 0, 'at least one character must be tested');
  const catalog = await request('/dungeons');
  for (const [configId, attribute, profession] of cases) {
    const id = randomUUID();
    await db.query(`INSERT INTO player_characters (id,"playerId","characterConfigId","attributeType","professionType",level) VALUES ($1,$2,$3,$4,$5,100)`, [id, playerId, configId, attribute, profession]);
    const path = `/players/${playerId}/characters/${id}/skills`;
    const list = await request(path, undefined, token);
    assert.equal(list.unlockedSkills.length, 3);
    assert.deepEqual(list.unlockedSkills.map(s => s.logic), ['A','B','C']);
    await request(path, undefined, other.accessToken, 401);
    const [a,b,c] = list.unlockedSkills.map(s => s.skillId);
    const layouts = [
      { low: [a,a,a,a,a], mid: [b,b,c], high: [c] },
      { low: [a,a,a,a,a], mid: [b,b], high: [c,c] },
      { low: [a,a,a,a], mid: [a,b,b,c], high: [c] },
      { low: [a,a,a,a], mid: [a,b,c], high: [b,c] },
      { low: [a,a,a], mid: [a,a,b], high: [c,c,c] },
    ];
    for (const slots of layouts) {
      await request(path, { skillSlots: slots }, token);
      assert.deepEqual((await request(path, undefined, token)).skillSlots, slots);
      const persisted = (await db.query('SELECT "skillSlots" FROM player_characters WHERE id=$1', [id])).rows[0].skillSlots;
      assert.deepEqual(persisted.skillSlots, slots);
    }
    await request(path, { skillSlots: { ...layouts[0], low: [c,a,a,a,a] } }, token, 400);
    await request(path, { skillSlots: { ...layouts[0], low: ['foreign:1',a,a,a,a] } }, token, 400);
    await request(path, { skillSlots: layouts[1] }, token);
    const dungeon = catalog.dungeons.find(d => d.dungeonType === 'SINGLE' && d.attributeType === attribute && d.difficulty === 'normal');
    assert(dungeon, `missing experience dungeon ${attribute}`);
    const dungeonId = dungeon.dungeonId;
    const start = await request(`/dungeons/${playerId}/${dungeonId}/start`, { characterIds: [id] }, token);
    const ticket = (await db.query(`SELECT response FROM operation_requests WHERE "playerId"=$1 AND operation='battle-start' AND "idempotencyKey"=$2`, [playerId, start.battleSeed])).rows[0].response;
    const trusted = ticket.serverBattle;
    assert(trusted.events.some(e => e.payload?.skill_id === a));
    assert(trusted.events.some(e => e.payload?.skill_id === b));
    assert(trusted.events.some(e => e.payload?.skill_id === c));
    await request(path, { skillSlots: layouts[4] }, token);
    // Only advance the isolated test clock; keep all engine output unchanged.
    await db.query(`UPDATE operation_requests SET response=jsonb_set(response,'{serverTime}',to_jsonb($1::text))
      WHERE "playerId"=$2 AND "idempotencyKey"=$3 AND operation='battle-start'`,
      [new Date(Date.now() - (trusted.duration + 1) * 250).toISOString(), playerId, start.battleSeed]);
    let status;
    for (let i = 0; i < 45; i++) {
      status = await request(`/dungeons/${playerId}/battles/${start.battleSeed}`, undefined, token);
      if (status.ready) break;
      await delay(500);
    }
    assert(status.ready);
    assert.equal(status.outcome.damageScore, trusted.damageScore);
    const body = { playerId, dungeonId, characterIds: [id], duration: 0, success: false,
      clientTrace: { battleSeed: start.battleSeed } };
    const settled = await request('/battle-settlement', body, token);
    const replayed = await request('/battle-settlement', body, token);
    assert.equal(replayed.record.id, settled.record.id);
    assert.equal(settled.record.damageScore, trusted.damageScore);
    assert.equal(settled.record.success, trusted.success);
    const persistedBattle = (await db.query('SELECT * FROM battle_records WHERE id=$1', [settled.record.id])).rows;
    assert.equal(persistedBattle.length, 1);
    assert.equal(persistedBattle[0].damageScore, trusted.damageScore);
    assert.equal(persistedBattle[0].success, trusted.success);
    const result = { configId, layouts: 5, stored: true, realBattle: true, settlementOnce: true };
    verified.push(result);
    console.log(JSON.stringify(result));
  }
  const report = { passed: true, characters: verified.length, skillLayouts: verified.length * 5,
    isolatedLocalDatabase: true, clockAdvanced: true, results: verified };
  if (process.env.E2E_REPORT_PATH) writeFileSync(process.env.E2E_REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, characters: verified.length, skillLayouts: verified.length * 5 }));
} finally {
  await db.end();
  if (server.exitCode === null) { server.kill(); await once(server, 'exit'); }
}
