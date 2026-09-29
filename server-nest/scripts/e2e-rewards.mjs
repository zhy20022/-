import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const apiBase = (process.env.E2E_API_BASE || 'http://127.0.0.1:4100/api').replace(/\/$/, '');
const secondApiBase = (process.env.E2E_SECOND_API_BASE ||
  `${new URL(apiBase).origin.replace(/:\d+$/, `:${Number(new URL(apiBase).port || 80) + 1}`)}/api`).replace(/\/$/, '');
const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl || !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname) ||
    !new URL(databaseUrl).pathname.slice(1).startsWith('gamer_rewards_e2e')) {
  throw new Error('E2E_DATABASE_URL must point to an isolated local gamer_rewards_e2e* database');
}
if (![apiBase, secondApiBase].every((base) => ['127.0.0.1', 'localhost'].includes(new URL(base).hostname))) {
  throw new Error('Both E2E API bases must point to local APIs');
}

const db = new pg.Client({ connectionString: databaseUrl });
const servers = [];

async function request(path, { method = 'GET', token, body, key, base = apiBase, status = method === 'GET' ? 200 : 201 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  assert(
    (Array.isArray(status) ? status : [status]).includes(response.status),
    `${method} ${path}: expected ${status}, got ${response.status}: ${JSON.stringify(result)}`,
  );
  return result;
}

async function gold(playerId) {
  const result = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
  return result.rows[0].gold;
}

async function quantity(playerId, configId) {
  const result = await db.query(
    'SELECT COALESCE(SUM(quantity), 0)::integer AS count FROM inventory_items WHERE "playerId"=$1 AND "itemConfigId"=$2',
    [playerId, configId],
  );
  return result.rows[0].count;
}

async function startApi(base) {
  const apiUrl = new URL(base);
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`API port ${apiUrl.port || '80'} is already in use`)));
    probe.listen(Number(apiUrl.port || 80), apiUrl.hostname, () => probe.close(resolve));
  });
  const server = spawn(process.execPath, ['dist/main.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      TYPEORM_SYNCHRONIZE: 'false',
      PORT: apiUrl.port || '4100',
      CONTENT_DIR: process.env.CONTENT_DIR || '../data/content',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(server);
  server.stdout.on('data', (chunk) => {
    const text = String(chunk);
    for (const line of text.split(/\r?\n/)) {
      if (line.includes('ERROR') || line.includes('listening on port')) process.stdout.write(`[api] ${line}\n`);
    }
  });
  server.stderr.on('data', (chunk) => {
    const text = String(chunk);
    if (!text.includes('[redis] unavailable')) process.stderr.write(`[api] ${text}`);
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error(`API exited with ${server.exitCode}`);
    try {
      const live = await fetch(`${base}/health/live`);
      if (live.ok) return;
    } catch { /* Wait for startup. */ }
    await delay(500);
  }
  throw new Error(`API did not start at ${base}`);
}

async function main() {
  await db.connect();
  if (process.env.E2E_START_SERVER === 'false') {
    throw new Error('e2e:rewards must start its own isolated APIs');
  }
  await startApi(apiBase);
  await startApi(secondApiBase);

  const stamp = Date.now().toString(36);
  const account = await request('/auth/register', {
    method: 'POST', body: { username: `reward_${stamp}`, password: `Reward-${randomUUID()}` },
  });
  const playerId = account.player.id;
  const token = account.accessToken;
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM players WHERE id=$1', [playerId])).rows[0].count, 1,
    'API must use the isolated test database');
  const bossId = 'fire_type_server_boss_001';
  const checkPath = `/achievements/${playerId}/check`;
  const questPath = `/quests/${playerId}`;
  const shopPath = `/shop/${playerId}/exchange`;
  const chestPath = `/world-boss/${playerId}/${bossId}`;

  await db.query(
    `INSERT INTO battle_records ("playerId", "dungeonId", success, duration, "damageScore", "characterIds", rewards, "resultPayload")
     VALUES ($1, 'fire_type_single_001', true, 60, 100, '[]', '{}', '{}')`,
    [playerId],
  );
  await db.query(
    `INSERT INTO dungeon_progress ("playerId", "dungeonId", "totalAttempts", "successfulAttempts")
     VALUES ($1, 'fire_type_single_001', 1, 1)`,
    [playerId],
  );

  const achievementGold = await gold(playerId);
  const sameKey = `achievement:${randomUUID()}`;
  const unlocked = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    request(checkPath, { method: 'POST', token, body: {}, key: sameKey, base: index % 2 ? secondApiBase : apiBase })));
  assert.equal(unlocked.filter((row) => !row.idempotency.replayed).length, 1);
  assert.equal(unlocked[0].newly_unlocked.length, 1);
  const differentKeys = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    request(checkPath, { method: 'POST', token, body: {}, key: `achievement:${randomUUID()}`, base: index % 2 ? secondApiBase : apiBase })));
  assert(differentKeys.every((row) => row.newly_unlocked.length === 0));
  assert.equal(await gold(playerId), achievementGold + 500);
  const achievements = await db.query(
    `SELECT count(*)::integer AS count FROM achievement_progress WHERE "playerId"=$1 AND "achievementId"='combat_001' AND unlocked`,
    [playerId],
  );
  assert.equal(achievements.rows[0].count, 1);

  await request(`${questPath}/main_001/accept`, { method: 'POST', token, body: {} });
  const questGold = await gold(playerId);
  const claimKey = `quest:${randomUUID()}`;
  const claims = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    request(`${questPath}/main_001/claim`, { method: 'POST', token, body: {}, key: claimKey, base: index % 2 ? secondApiBase : apiBase })));
  assert.equal(claims.filter((row) => !row.idempotency.replayed).length, 1);
  await Promise.all(Array.from({ length: 4 }, (_, index) =>
    request(`${questPath}/main_001/claim`, {
      method: 'POST', token, body: {}, key: `quest:${randomUUID()}`, base: index % 2 ? secondApiBase : apiBase, status: 400,
    })));
  assert.equal(await gold(playerId), questGold + 1000);
  const questRows = await db.query(
    `SELECT count(*)::integer AS count FROM quest_progress WHERE "playerId"=$1 AND "questId"='main_001' AND status='CLAIMED'`,
    [playerId],
  );
  assert.equal(questRows.rows[0].count, 1);

  const daily = (await request(`${questPath}/list?type=daily`, { token })).quests.find((row) => row.quest_id === 'daily_001');
  assert.equal(daily.objectives[0].current_count, 1);
  await request(`${questPath}/daily_001/accept`, { method: 'POST', token, body: {} });
  await request(`${questPath}/daily_001/claim`, { method: 'POST', token, body: {}, status: 400 });
  await db.query(
    `INSERT INTO battle_records ("playerId", "dungeonId", success, duration, "damageScore", "characterIds", rewards, "resultPayload", "createdAt")
     SELECT $1, 'fire_type_single_001', true, 60, 100, '[]', '{}', '{}', now() - interval '8 days'
     FROM generate_series(1, 5)`,
    [playerId],
  );
  const afterOldBattles = (await request(`${questPath}/list?type=daily`, { token })).quests.find((row) => row.quest_id === 'daily_001');
  assert.equal(afterOldBattles.objectives[0].current_count, 1);
  await db.query(
    `INSERT INTO battle_records ("playerId", "dungeonId", success, duration, "damageScore", "characterIds", rewards, "resultPayload")
     SELECT $1, 'fire_type_single_001', true, 60, 100, '[]', '{}', '{}' FROM generate_series(1, 2)`,
    [playerId],
  );
  const dailyGold = await gold(playerId);
  await request(`${questPath}/daily_001/claim`, { method: 'POST', token, body: {}, key: `daily:${randomUUID()}` });
  await request(`${questPath}/daily_001/claim`, { method: 'POST', token, body: {}, key: `daily:${randomUUID()}`, status: 400 });
  assert.equal(await gold(playerId), dailyGold + 500);

  await request(shopPath, { method: 'POST', token, body: { itemId: 'equip_fire' }, status: 400 });
  const noPurchase = await db.query('SELECT count(*)::integer AS count FROM shop_purchases WHERE "playerId"=$1', [playerId]);
  assert.equal(noPurchase.rows[0].count, 0);
  await db.query(
    `INSERT INTO inventory_items ("playerId", "itemConfigId", "itemType", quantity, payload)
     VALUES ($1, 'equipment_material', 'material', 30, '{"attributeType":"FIRE"}')`,
    [playerId],
  );
  const exchangeKey = `shop:${randomUUID()}`;
  const exchanges = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    request(shopPath, { method: 'POST', token, body: { itemId: 'equip_fire' }, key: exchangeKey, base: index % 2 ? secondApiBase : apiBase })));
  assert.equal(exchanges.filter((row) => !row.idempotency.replayed).length, 1);
  assert.equal(await quantity(playerId, 'equipment_material'), 25);
  const remaining = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    request(shopPath, {
      method: 'POST', token, body: { itemId: 'equip_fire' }, key: `shop:${randomUUID()}`,
      base: index % 2 ? secondApiBase : apiBase, status: [201, 400],
    })));
  assert.equal(remaining.filter((row) => row.success).length, 4);
  assert.equal(remaining.filter((row) => row.statusCode === 400).length, 2);
  assert.equal(await quantity(playerId, 'equipment_material'), 5);
  const purchases = await db.query(
    `SELECT quantity FROM shop_purchases WHERE "playerId"=$1 AND "itemId"='equip_fire'`,
    [playerId],
  );
  assert.equal(purchases.rows[0].quantity, 5);
  assert.equal((await db.query(
    `SELECT count(*)::integer AS count FROM inventory_items WHERE "playerId"=$1 AND "itemType"='equipment' AND "itemConfigId" LIKE 'shop_fire_%'`,
    [playerId],
  )).rows[0].count, 5);

  const chest = await db.query(
    `INSERT INTO world_boss_chests ("playerId", "dungeonId", "seasonId", layer, tier, status)
     VALUES ($1, $2, 'test-season', 1, 1, 'unopened') RETURNING id`,
    [playerId, bossId],
  );
  const openPath = `${chestPath}/chests/${chest.rows[0].id}/open`;
  const chestKey = `chest:${randomUUID()}`;
  const opened = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    request(openPath, { method: 'POST', token, body: {}, key: chestKey, base: index % 2 ? secondApiBase : apiBase })));
  assert.equal(opened.filter((row) => !row.idempotency.replayed).length, 1);
  await request(openPath, { method: 'POST', token, body: {}, key: `chest:${randomUUID()}`, status: 400 });
  assert.equal(await quantity(playerId, 'illustration_piece'), 1);
  assert.equal((await db.query(
    `SELECT status FROM world_boss_chests WHERE id=$1`, [chest.rows[0].id],
  )).rows[0].status, 'opened');

  const rollover = await request('/auth/register', {
    method: 'POST', body: { username: `rollover_${stamp}`, password: `Reward-${randomUUID()}` },
  });
  const rolloverId = rollover.player.id;
  const rolloverToken = rollover.accessToken;
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const datePart = (type) => dateParts.find((item) => item.type === type).value;
  const shanghaiDate = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
  await db.query(
    `INSERT INTO quest_progress ("playerId", "questId", "periodKey", status, "claimedAt")
     VALUES ($1, 'daily_001', $2, 'CLAIMED', now() - interval '1 day')`,
    [rolloverId, '2000-01-01'],
  );
  const freshDaily = await request(`/quests/${rolloverId}/daily_001/accept`, {
    method: 'POST', token: rolloverToken, body: {},
  });
  assert.equal(freshDaily.quest.status, 'IN_PROGRESS');
  assert.equal((await db.query(
    `SELECT count(*)::integer AS count FROM quest_progress WHERE "playerId"=$1 AND "questId"='daily_001'`,
    [rolloverId],
  )).rows[0].count, 2);
  assert.equal((await db.query(
    `SELECT "periodKey" FROM quest_progress WHERE "playerId"=$1 AND "questId"='daily_001' AND status='IN_PROGRESS'`,
    [rolloverId],
  )).rows[0].periodKey, shanghaiDate);

  const monday = new Date(`${shanghaiDate}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const shanghaiMonday = monday.toISOString().slice(0, 10);
  const periodBoundary = (date) => `${date}T00:00:00+08:00`;
  const insertBattleAt = async (time) => db.query(
    `INSERT INTO battle_records ("playerId", "dungeonId", success, duration, "damageScore", "characterIds", rewards, "resultPayload", "createdAt")
     VALUES ($1, 'fire_type_single_001', true, 60, 100, '[]', '{}', '{}', $2::timestamptz AT TIME ZONE current_setting('TimeZone'))`,
    [rolloverId, time],
  );
  await insertBattleAt(new Date(Date.parse(periodBoundary(shanghaiDate)) - 1).toISOString());
  let boundaryDaily = (await request(`/quests/${rolloverId}/list?type=daily`, { token: rolloverToken }))
    .quests.find((row) => row.quest_id === 'daily_001');
  assert.equal(boundaryDaily.objectives[0].current_count, 0);
  await insertBattleAt(periodBoundary(shanghaiDate));
  boundaryDaily = (await request(`/quests/${rolloverId}/list?type=daily`, { token: rolloverToken }))
    .quests.find((row) => row.quest_id === 'daily_001');
  assert.equal(boundaryDaily.objectives[0].current_count, 1);
  const tomorrow = new Date(Date.parse(periodBoundary(shanghaiDate)) + 24 * 60 * 60 * 1000).toISOString();
  await insertBattleAt(tomorrow);
  boundaryDaily = (await request(`/quests/${rolloverId}/list?type=daily`, { token: rolloverToken }))
    .quests.find((row) => row.quest_id === 'daily_001');
  assert.equal(boundaryDaily.objectives[0].current_count, 1);

  const insertAssistAt = async (time) => db.query(
    `INSERT INTO friend_assist_records ("borrowerPlayerId", "helperPlayerId", "createdAt")
     VALUES ($1, $2, $3::timestamptz AT TIME ZONE current_setting('TimeZone'))`,
    [rolloverId, playerId, time],
  );
  await insertAssistAt(new Date(Date.parse(periodBoundary(shanghaiMonday)) - 1).toISOString());
  let weekly = (await request(`/quests/${rolloverId}/list?type=weekly`, { token: rolloverToken })).quests[0];
  assert.equal(weekly.objectives[0].current_count, 0);
  await insertAssistAt(periodBoundary(shanghaiMonday));
  weekly = (await request(`/quests/${rolloverId}/list?type=weekly`, { token: rolloverToken })).quests[0];
  assert.equal(weekly.objectives[0].current_count, 1);
  await insertAssistAt(new Date(Date.parse(periodBoundary(shanghaiMonday)) + 7 * 24 * 60 * 60 * 1000).toISOString());
  weekly = (await request(`/quests/${rolloverId}/list?type=weekly`, { token: rolloverToken })).quests[0];
  assert.equal(weekly.objectives[0].current_count, 1);
  await request(`/quests/${rolloverId}/weekly_001/accept`, { method: 'POST', token: rolloverToken, body: {} });
  const weeklyGold = await gold(rolloverId);
  await request(`/quests/${rolloverId}/weekly_001/claim`, { method: 'POST', token: rolloverToken, body: {} });
  await request(`/quests/${rolloverId}/weekly_001/claim`, { method: 'POST', token: rolloverToken, body: {}, status: 400 });
  assert.equal(await gold(rolloverId), weeklyGold + 1000);
  assert.equal(await quantity(rolloverId, 'generic_battle_material'), 3);
  assert.equal((await db.query(
    `SELECT "periodKey" FROM quest_progress WHERE "playerId"=$1 AND "questId"='weekly_001'`,
    [rolloverId],
  )).rows[0].periodKey, shanghaiMonday);

  const materialRollback = await request('/auth/register', {
    method: 'POST', body: { username: `material_${stamp}`, password: `Reward-${randomUUID()}` },
  });
  const materialPlayerId = materialRollback.player.id;
  const materialToken = materialRollback.accessToken;
  await db.query(
    `INSERT INTO friend_assist_records ("borrowerPlayerId", "helperPlayerId", "createdAt")
     VALUES ($1, $2, now())`,
    [materialPlayerId, playerId],
  );
  await request(`/quests/${materialPlayerId}/weekly_001/accept`, { method: 'POST', token: materialToken, body: {} });
  const materialGold = await gold(materialPlayerId);
  const materialKey = `material:${randomUUID()}`;
  await db.query(
    `ALTER TABLE inventory_items ADD CONSTRAINT "CHK_rewards_e2e_material_rollback"
     CHECK ("playerId" <> '${materialPlayerId}' OR "itemConfigId" <> 'generic_battle_material')`,
  );
  try {
    await request(`/quests/${materialPlayerId}/weekly_001/claim`, {
      method: 'POST', token: materialToken, body: {}, key: materialKey, status: 500,
    });
    assert.equal(await gold(materialPlayerId), materialGold);
    assert.equal(await quantity(materialPlayerId, 'generic_battle_material'), 0);
    assert.equal((await db.query(
      `SELECT status FROM quest_progress WHERE "playerId"=$1 AND "questId"='weekly_001'`,
      [materialPlayerId],
    )).rows[0].status, 'IN_PROGRESS');
  } finally {
    await db.query(`ALTER TABLE inventory_items DROP CONSTRAINT "CHK_rewards_e2e_material_rollback"`);
  }
  await request(`/quests/${materialPlayerId}/weekly_001/claim`, {
    method: 'POST', token: materialToken, body: {}, key: materialKey,
  });
  assert.equal(await gold(materialPlayerId), materialGold + 1000);
  assert.equal(await quantity(materialPlayerId, 'generic_battle_material'), 3);

  const insertEnhancementAt = async (time, success) => db.query(
    `INSERT INTO operation_requests ("playerId", operation, "idempotencyKey", "requestHash", response, "createdAt")
     VALUES ($1, 'workshop-enhance', $2, 'e2e-test', $3::jsonb,
       $4::timestamptz AT TIME ZONE current_setting('TimeZone'))`,
    [rolloverId, randomUUID(), JSON.stringify({ success }), time],
  );
  await insertEnhancementAt(periodBoundary(shanghaiDate), false);
  await insertEnhancementAt(new Date(Date.parse(periodBoundary(shanghaiDate)) - 1).toISOString(), true);
  let enhancement = (await request(`/quests/${rolloverId}/list?type=daily`, { token: rolloverToken }))
    .quests.find((row) => row.quest_id === 'daily_002');
  assert.equal(enhancement.objectives[0].current_count, 0);
  await insertEnhancementAt(periodBoundary(shanghaiDate), true);
  enhancement = (await request(`/quests/${rolloverId}/list?type=daily`, { token: rolloverToken }))
    .quests.find((row) => row.quest_id === 'daily_002');
  assert.equal(enhancement.objectives[0].current_count, 1);

  await db.query(
    `INSERT INTO battle_records ("playerId", "dungeonId", success, duration, "damageScore", "characterIds", rewards, "resultPayload")
     VALUES ($1, 'fire_type_single_001', true, 60, 100, '[]', '{}', '{}')`,
    [rolloverId],
  );
  const rollbackKey = `rollback:${randomUUID()}`;
  const beforeRollbackGold = await gold(rolloverId);
  await db.query(
    `ALTER TABLE players ADD CONSTRAINT "CHK_rewards_e2e_rollback"
     CHECK (id <> '${rolloverId}' OR gold <= ${beforeRollbackGold + 499})`,
  );
  try {
    await request(`/achievements/${rolloverId}/check`, {
      method: 'POST', token: rolloverToken, body: {}, key: rollbackKey, status: 500,
    });
    assert.equal(await gold(rolloverId), beforeRollbackGold);
    assert.equal((await db.query(
      `SELECT count(*)::integer AS count FROM achievement_progress WHERE "playerId"=$1 AND "achievementId"='combat_001' AND unlocked`,
      [rolloverId],
    )).rows[0].count, 0);
    assert.equal((await db.query(
      `SELECT count(*)::integer AS count FROM operation_requests
       WHERE "playerId"=$1 AND operation='online-achievement-check' AND "idempotencyKey"=$2`,
      [rolloverId, rollbackKey],
    )).rows[0].count, 0);
  } finally {
    await db.query(`ALTER TABLE players DROP CONSTRAINT "CHK_rewards_e2e_rollback"`);
  }
  const retry = await request(`/achievements/${rolloverId}/check`, {
    method: 'POST', token: rolloverToken, body: {}, key: rollbackKey,
  });
  assert.equal(retry.newly_unlocked.length, 1);
  assert.equal(await gold(rolloverId), beforeRollbackGold + 500);

  console.log(JSON.stringify({
    ok: true, playerId,
    checked: ['two API instances and one database', 'achievement concurrent replay and rollback',
      'quest concurrent claim and material rollback',
      'quest period rollover',
      'Shanghai daily and weekly boundaries', 'successful enhancement only', 'shop rollback and limit', 'boss chest replay'],
  }, null, 2));
}

try {
  await main();
} finally {
  await db.end().catch(() => undefined);
  for (const server of servers) server.kill();
}
