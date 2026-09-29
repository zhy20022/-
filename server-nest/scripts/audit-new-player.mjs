import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';

const databaseUrl = process.env.E2E_DATABASE_URL;
assert(databaseUrl && ['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)
  && new URL(databaseUrl).pathname.includes('newplayer'), 'dedicated local newplayer database required');
const api = 'http://127.0.0.1:4198/api';
const server = spawn(process.execPath, ['dist/main.js'], { windowsHide: true, stdio: 'pipe', env: {
  ...process.env, NODE_ENV: 'test', PORT: '4198', DATABASE_URL: databaseUrl, DB_SSL: 'false',
  TYPEORM_SYNCHRONIZE: 'true', REDIS_URL: 'redis://127.0.0.1:6399', CONTENT_DIR: '../data/content',
  BACKUP_ENABLED: 'false', AUTH_TOKEN_SECRET: randomUUID() + randomUUID(), RATE_LIMIT_MAX: '20000',
} });
let tail = '';
for (const pipe of [server.stdout, server.stderr]) pipe.on('data', chunk => { tail = (tail + chunk).slice(-2000); });
const db = new pg.Client({ connectionString: databaseUrl });
const results = [];
let originalPool;
const poolId = randomUUID();
async function request(path, body, token, expected = body === undefined ? 200 : 201, key = randomUUID()) {
  const response = await fetch(api + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: token ? `Bearer ${token}` : '', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
const packages = profile => Number(profile.inventory.find(item => item.itemConfigId === 'character_exp_crystal')?.quantity || 0);
try {
  await db.connect();
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(api + '/dungeons')).ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  assert(ready, tail);
  const catalog = (await request('/dungeons')).dungeons;
  const roster = JSON.parse(readFileSync('../data/content/characters.json', 'utf8').replace(/^\uFEFF/, '')).characters;
  const starter = (await request('/gacha/pools')).find(pool => pool.key === 'starter');
  assert(starter);
  originalPool = (await db.query('SELECT * FROM game_configs WHERE "configKey"=$1', ['gacha_pools'])).rows[0] || null;
  for (const config of roster) {
    // Enumerate every possible first character while using the real draw transaction and original cost.
    const entry = starter.entries.find(item => item.characterConfigId === config.id);
    assert(entry, `character absent from starter pool: ${config.id}`);
    const payload = { pools: [{ ...starter, entries: [{ ...entry, weight: 1 }] }] };
    await db.query(`INSERT INTO game_configs (id,"configKey",payload) VALUES ($1,'gacha_pools',$2)
      ON CONFLICT ("configKey") DO UPDATE SET payload=$2, enabled=true`, [poolId, payload]);
    const username = `np_${randomUUID().replaceAll('-', '').slice(0, 18)}`, password = randomUUID();
    const session = await request('/auth/register', { username, password });
    const playerId = session.player.id, token = session.accessToken;
    const draw = await request(`/gacha/${playerId}/draw`, { poolKey: 'starter', count: 1 }, token);
    const profile = await request(`/players/${playerId}/profile`, undefined, token);
    const character = profile.characters[0];
    assert.equal(character.characterConfigId, config.id);
    assert.equal(character.level, 1);
    assert.equal(profile.player.gold, session.player.gold - draw.cost.amount);
    const skillPath = `/players/${playerId}/characters/${character.id}/skills`;
    const skills = await request(skillPath, undefined, token);
    assert.deepEqual(skills.unlockedSkills.map(skill => skill.logic), ['A', 'B', 'C']);
    await request(skillPath, { skillSlots: skills.skillSlots }, token);
    const dungeon = catalog.find(row => row.dungeonType === 'SINGLE' && row.difficulty === 'normal' && row.attributeType === config.attributeType);
    const wrong = catalog.find(row => row.dungeonType === 'SINGLE' && row.difficulty === 'normal' && row.attributeType !== config.attributeType);
    await request(`/dungeons/${playerId}/${wrong.dungeonId}/start`, { characterIds: [character.id] }, token, 400);
    const beforePreview = await request(`/players/${playerId}/characters/${character.id}/exp-preview?levelDelta=1`, undefined, token);
    assert.equal(beforePreview.canAfford, false);
    await request(`/players/${playerId}/characters/${character.id}/use-exp`, { levelDelta: 1 }, token, 400);
    const runs = [];
    async function runBattle() {
      const before = await request(`/players/${playerId}/profile`, undefined, token);
      const start = await request(`/dungeons/${playerId}/${dungeon.dungeonId}/start`, { characterIds: [character.id] }, token);
      const trusted = (await db.query(`SELECT response FROM operation_requests WHERE "playerId"=$1
        AND operation='battle-start' AND "idempotencyKey"=$2`, [playerId, start.battleSeed])).rows[0].response.serverBattle;
      await db.query(`UPDATE operation_requests SET response=jsonb_set(response,'{serverTime}',to_jsonb($1::text))
        WHERE "playerId"=$2 AND operation='battle-start' AND "idempotencyKey"=$3`,
        [new Date(Date.now() - (trusted.duration + 1) * 250).toISOString(), playerId, start.battleSeed]);
      const body = { playerId, dungeonId: dungeon.dungeonId, characterIds: [character.id], success: false,
        duration: 0, clientTrace: { battleSeed: start.battleSeed } };
      const settlement = await request('/battle-settlement', body, token);
      const duplicate = await request('/battle-settlement', body, token);
      assert.equal(duplicate.record.id, settlement.record.id);
      const after = await request(`/players/${playerId}/profile`, undefined, token);
      assert.equal(packages(after) - packages(before), settlement.serverRewards.expCrystals);
      assert.equal(after.player.gold - before.player.gold, settlement.serverRewards.gold);
      assert.equal(settlement.record.success, trusted.success);
      assert.equal(after.characters[0].exp - before.characters[0].exp, settlement.serverRewards.directCharacterExp);
      const lastFrame = trusted.frames.at(-1);
      const row = { level: before.characters[0].level, duration: trusted.duration, survived: trusted.survived,
        success: trusted.success, expPackages: settlement.serverRewards.expCrystals, gold: settlement.serverRewards.gold,
        directExp: settlement.serverRewards.directCharacterExp, damage: trusted.damageScore,
        remainingEnemies: lastFrame.units.filter(unit => !trusted.units[unit[0]].isPlayer && unit[1] > 0).length };
      runs.push(row);
      return after;
    }
    let preview;
    for (let attempt = 0; attempt < 3; attempt++) {
      await runBattle();
      preview = await request(`/players/${playerId}/characters/${character.id}/exp-preview?levelDelta=1`, undefined, token);
      if (preview.canAfford) break;
    }
    let upgraded = null;
    if (preview.canAfford) {
      const before = await request(`/players/${playerId}/profile`, undefined, token);
      const key = randomUUID();
      upgraded = await request(`/players/${playerId}/characters/${character.id}/use-exp`, { levelDelta: 1 }, token, 201, key);
      await request(`/players/${playerId}/characters/${character.id}/use-exp`, { levelDelta: 1 }, token, 201, key);
      const after = await request(`/players/${playerId}/profile`, undefined, token);
      assert.equal(after.characters[0].level, 2);
      assert.equal(before.player.gold - after.player.gold, preview.requiredGold);
      assert.equal(packages(before) - packages(after), preview.requiredExpPackages);
      await runBattle();
    }
    const again = await request('/auth/login', { username, password });
    const restored = await request(`/players/${playerId}/profile`, undefined, again.accessToken);
    assert.equal(restored.characters[0].level, upgraded ? 2 : 1);
    const savedSkills = await request(skillPath, undefined, again.accessToken);
    assert.deepEqual(savedSkills.skillSlots, skills.skillSlots);
    const records = await request(`/battle-settlement/${playerId}/records`, undefined, again.accessToken);
    assert.equal(records.length, runs.length);
    const result = { configId: config.id, name: config.name, attribute: config.attributeType, profession: config.professionType,
      initialGold: session.player.gold, drawCost: draw.cost.amount, wrongAttributeRejected: true, level1SkillSave: true,
      upgraded: Boolean(upgraded), upgradePackages: upgraded?.consumedExpPackages || 0,
      upgradeGold: upgraded?.consumedGold || 0, finalGold: restored.player.gold, finalPackages: packages(restored),
      reloginVerified: true, runs };
    results.push(result);
    console.log(JSON.stringify({ name: config.name, attribute: config.attributeType, upgraded: result.upgraded, runs }));
  }
  const report = { checkedAt: new Date().toISOString(), characters: results.length,
    method: 'isolated local database; real registration, controlled first draw, original costs; actual battle engine; only completion clock advanced; no injected growth resources',
    results };
  assert(process.env.E2E_REPORT_PATH, 'E2E_REPORT_PATH required');
  writeFileSync(process.env.E2E_REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
} finally {
  if (originalPool) await db.query('UPDATE game_configs SET payload=$1, enabled=$2 WHERE "configKey"=$3',
    [originalPool.payload, originalPool.enabled, 'gacha_pools']);
  else await db.query('DELETE FROM game_configs WHERE id=$1', [poolId]).catch(() => {});
  await db.end();
  if (server.exitCode === null) { server.kill(); await once(server, 'exit'); }
}
