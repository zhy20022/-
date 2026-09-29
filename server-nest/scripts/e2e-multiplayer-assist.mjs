import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const databaseUrl = process.env.E2E_DATABASE_URL;
assert(databaseUrl && ['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname),
  'E2E_DATABASE_URL must point to an isolated local database');
assert(new URL(databaseUrl).pathname.slice(1).startsWith('gamer_rewards_e2e'),
  'E2E_DATABASE_URL must point to a gamer_rewards_e2e* database');

const api = process.env.E2E_API_BASE || 'http://127.0.0.1:4199/api';
const server = spawn(process.execPath, ['dist/main.js'], {
  cwd: new URL('..', import.meta.url),
  windowsHide: true,
  stdio: 'pipe',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: new URL(api).port || '4199',
    DATABASE_URL: databaseUrl,
    DB_SSL: 'false',
    TYPEORM_SYNCHRONIZE: 'true',
    REDIS_URL: 'redis://127.0.0.1:6399',
    CONTENT_DIR: '../data/content',
    BACKUP_ENABLED: 'false',
    AUTH_TOKEN_SECRET: randomUUID() + randomUUID(),
  },
});
const db = new pg.Client({ connectionString: databaseUrl });
let output = '';
for (const pipe of [server.stdout, server.stderr]) {
  pipe.on('data', (chunk) => {
    output = (output + chunk.toString()).slice(-6000);
  });
}

async function request(path, body, token, expected = body === undefined ? 200 : 201, key) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
  return value;
}

async function register(label) {
  const value = await request('/auth/register', {
    username: `m${label[0]}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 100)}`,
    password: `Multi-${randomUUID()}`,
  });
  assert(value.player?.id && value.accessToken, 'registration did not return an online session');
  return value;
}

async function insertCharacter(playerId, configId, professionType) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO player_characters
      (id, "playerId", "characterConfigId", "attributeType", "professionType", level, exp, "skillSlots", equipment, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'FIRE', $4, 100, 0, '{}', '{}', now(), now())`,
    [id, playerId, configId, professionType],
  );
  return id;
}

async function gold(playerId) {
  const result = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
  return Number(result.rows[0].gold);
}

async function characterExp(characterId) {
  const result = await db.query('SELECT level, exp FROM player_characters WHERE id = $1', [characterId]);
  return { level: Number(result.rows[0].level), exp: Number(result.rows[0].exp) };
}

try {
  await db.connect();
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) break;
    try {
      if ((await fetch(`${api}/health/live`)).ok) {
        ready = true;
        break;
      }
    } catch { /* wait for Nest startup */ }
    await delay(500);
  }
  assert(ready, `server did not start: ${output}`);

  const borrower = await register('borrower');
  const helper = await register('helper');
  const stranger = await register('stranger');
  const borrowerAuth = borrower.accessToken;
  const helperAuth = helper.accessToken;
  const strangerAuth = stranger.accessToken;

  const borrowerCharacter = await insertCharacter(borrower.player.id, 'char_033_fire_physical_tank', 'PHYSICAL_TANK');
  const helperCharacters = [];
  for (const [configId, professionType] of [
    ['char_039_fire_healer', 'HEALER'],
    ['char_040_fire_support', 'SUPPORT'],
    ['char_035_fire_physical_melee_dps', 'PHYSICAL_MELEE_DPS'],
    ['char_038_fire_magic_ranged_dps', 'MAGIC_RANGED_DPS'],
  ]) {
    helperCharacters.push(await insertCharacter(helper.player.id, configId, professionType));
  }
  const strangerCharacter = await insertCharacter(stranger.player.id, 'char_037_fire_physical_ranged_dps', 'PHYSICAL_RANGED_DPS');

  await request(`/friends-assist/${borrower.player.id}/request`, { addresseePlayerId: helper.player.id }, borrowerAuth);
  await request(`/friends-assist/${helper.player.id}/accept`, { requesterPlayerId: borrower.player.id }, helperAuth);
  const roster = await request(`/friends-assist/${borrower.player.id}/assist-roster`, undefined, borrowerAuth);
  assert.equal(roster.length, 4, 'accepted friend assist roster should contain helper characters');

  const dungeonId = 'fire_type_squad_001';
  const validCharacterIds = [borrowerCharacter, ...helperCharacters];
  const nonFriendCharacterIds = [borrowerCharacter, ...helperCharacters.slice(0, 3), strangerCharacter];
  await request(`/dungeons/${borrower.player.id}/${dungeonId}/start`, {
    characterIds: nonFriendCharacterIds,
  }, borrowerAuth, 400, randomUUID());
  await request(`/dungeons/${borrower.player.id}/${dungeonId}/start`, {
    characterIds: [borrowerCharacter, helperCharacters[0], helperCharacters[0], helperCharacters[1], helperCharacters[2]],
  }, borrowerAuth, 400, randomUUID());

  const startKey = randomUUID();
  const started = await request(`/dungeons/${borrower.player.id}/${dungeonId}/start`, {
    characterIds: validCharacterIds,
  }, borrowerAuth, 201, startKey);
  assert(!started.serverBattle, 'future battle result must not be exposed at start');
  const ticketQuery = await db.query(
    `SELECT response FROM operation_requests
     WHERE "playerId" = $1 AND operation = 'battle-start' AND "idempotencyKey" = $2`,
    [borrower.player.id, startKey],
  );
  const ticket = ticketQuery.rows[0].response;
  assert.deepEqual(ticket.assistCharacterIds.sort(), helperCharacters.slice().sort());
  assert.equal(ticket.characterOwners[borrowerCharacter], borrower.player.id);
  for (const characterId of helperCharacters) {
    assert.equal(ticket.characterOwners[characterId], helper.player.id);
  }

  await db.query(
    `UPDATE operation_requests
     SET response = jsonb_set(response, '{serverTime}', to_jsonb((now() - interval '10 minutes')::text))
     WHERE "playerId" = $1 AND operation = 'battle-start' AND "idempotencyKey" = $2`,
    [borrower.player.id, startKey],
  );
  const status = await request(`/dungeons/${borrower.player.id}/battles/${started.battleSeed}`, undefined, borrowerAuth);
  assert(status.ready && status.outcome, 'server battle should be ready for settlement');
  assert.equal(status.outcome.success, true, 'test squad should complete successfully');

  const helperGoldBefore = await gold(helper.player.id);
  const borrowerCharacterBefore = await characterExp(borrowerCharacter);
  const helperCharacterBefore = [];
  for (const characterId of helperCharacters) helperCharacterBefore.push(await characterExp(characterId));
  const settlementBody = {
    playerId: borrower.player.id,
    dungeonId,
    characterIds: validCharacterIds,
    success: false,
    duration: 0,
    clientTrace: { battleSeed: started.battleSeed, source: 'e2e-multiplayer-assist' },
  };
  const settled = await request('/battle-settlement', settlementBody, borrowerAuth, 201, started.battleSeed);
  const replayed = await request('/battle-settlement', settlementBody, borrowerAuth, 201, started.battleSeed);
  assert.equal(replayed.idempotency.replayed, true);
  assert.equal(replayed.record.id, settled.record.id);
  assert.equal((await gold(helper.player.id)) - helperGoldBefore, 100);
  assert.deepEqual(await characterExp(borrowerCharacter), borrowerCharacterBefore);
  const helperCharacterAfter = [];
  for (const characterId of helperCharacters) helperCharacterAfter.push(await characterExp(characterId));
  assert.deepEqual(helperCharacterAfter, helperCharacterBefore);

  const assistRecords = await db.query(
    `SELECT "borrowerPlayerId", "helperPlayerId", "helperCharacterId"
     FROM friend_assist_records
     WHERE "borrowerPlayerId" = $1 AND "helperPlayerId" = $2 AND "dungeonId" = $3`,
    [borrower.player.id, helper.player.id, dungeonId],
  );
  assert.equal(assistRecords.rows.length, 1, 'replayed settlement must not duplicate assist records');
  assert.equal(assistRecords.rows[0].helperCharacterId, helperCharacters[0],
    'assist reward should record the first selected helper character');
  const dailyGoal = await db.query(
    `SELECT progress FROM daily_goal_progress
     WHERE "playerId" = $1 AND "goalKey" = 'friend_assist'`,
    [borrower.player.id],
  );
  assert.equal(Number(dailyGoal.rows[0].progress), 1, 'friend assist daily goal should advance once');
  assert.equal(
    (await db.query(`SELECT count(*)::int AS count FROM battle_records WHERE id = $1`, [settled.record.id])).rows[0].count,
    1,
  );

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'accepted friend roster',
      'non-friend character rejected',
      'duplicate character rejected',
      'server ownership ticket',
      'authoritative multiplayer settlement',
      'helper gold reward once',
      'helper character progression protected',
      'assist record and daily goal replay-safe',
    ],
  }, null, 2));
} finally {
  await db.end().catch(() => undefined);
  if (server.exitCode === null) {
    server.kill();
    await once(server, 'exit').catch(() => undefined);
  }
}
