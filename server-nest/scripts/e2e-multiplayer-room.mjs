import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const databaseUrl = process.env.E2E_DATABASE_URL;
assert(databaseUrl && ['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname), 'isolated local database required');
assert(new URL(databaseUrl).pathname.slice(1).startsWith('gamer_rewards_e2e'), 'gamer_rewards_e2e database required');

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
for (const pipe of [server.stdout, server.stderr]) pipe.on('data', (chunk) => { output = (output + chunk.toString()).slice(-6000); });

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
  return request('/auth/register', {
    username: `r${label[0]}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 100)}`,
    password: `Room-${randomUUID()}`,
  });
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

try {
  await db.connect();
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) break;
    try {
      if ((await fetch(`${api}/health/live`)).ok) { ready = true; break; }
    } catch { /* wait */ }
    await delay(500);
  }
  assert(ready, `server did not start: ${output}`);

  const leader = await register('leader');
  const teammate = await register('teammate');
  const leaderCharacters = [
    await insertCharacter(leader.player.id, 'char_033_fire_physical_tank', 'PHYSICAL_TANK'),
    await insertCharacter(leader.player.id, 'char_035_fire_physical_melee_dps', 'PHYSICAL_MELEE_DPS'),
    await insertCharacter(leader.player.id, 'char_039_fire_healer', 'HEALER'),
  ];
  const teammateCharacters = [
    await insertCharacter(teammate.player.id, 'char_040_fire_support', 'SUPPORT'),
    await insertCharacter(teammate.player.id, 'char_038_fire_magic_ranged_dps', 'MAGIC_RANGED_DPS'),
  ];

  await request(`/friends-assist/${leader.player.id}/request`, { addresseePlayerId: teammate.player.id }, leader.accessToken);
  await request(`/friends-assist/${teammate.player.id}/accept`, { requesterPlayerId: leader.player.id }, teammate.accessToken);

  const room = await request('/multiplayer-rooms', { dungeonId: 'fire_type_squad_001' }, leader.accessToken);
  assert(room.room_id && room.status === 'waiting');
  const invitation = await request(`/multiplayer-rooms/${room.room_id}/invite`, { inviteePlayerId: teammate.player.id }, leader.accessToken);
  const pending = await request('/multiplayer-rooms/invitations?status=pending', undefined, teammate.accessToken);
  assert(pending.some((item) => item.invitation_id === invitation.invitation_id));
  const joined = await request(`/multiplayer-rooms/invitations/${invitation.invitation_id}/accept`, { characterIds: teammateCharacters }, teammate.accessToken);
  assert.equal(joined.members.length, 2);

  const leaderReady = await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: leaderCharacters, isReady: true }, leader.accessToken);
  assert(leaderReady.members.find((member) => member.player_id === leader.player.id).is_ready);
  const teammateReady = await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: teammateCharacters, isReady: true }, teammate.accessToken);
  assert(teammateReady.members.find((member) => member.player_id === teammate.player.id).is_ready);

  const startKey = randomUUID();
  const started = await request(`/multiplayer-rooms/${room.room_id}/start`, {}, leader.accessToken, 201, startKey);
  assert(started.battle_seed && started.status === 'in_battle');
  assert.deepEqual(started.character_ids, [...leaderCharacters, ...teammateCharacters]);
  const currentForTeammate = await request('/multiplayer-rooms/current', undefined, teammate.accessToken);
  assert.equal(currentForTeammate.battle_seed, started.battle_seed);
  assert.equal(currentForTeammate.room_id, started.room_id);

  await db.query(
    `UPDATE operation_requests
     SET response = jsonb_set(response, '{serverTime}', to_jsonb((now() - interval '10 minutes')::text))
     WHERE "playerId" = $1 AND operation = 'battle-start' AND "idempotencyKey" = $2`,
    [leader.player.id, started.battle_seed],
  );
  const leaderBattle = await request(`/multiplayer-rooms/${room.room_id}/battle`, undefined, leader.accessToken);
  const teammateBattle = await request(`/multiplayer-rooms/${room.room_id}/battle`, undefined, teammate.accessToken);
  assert.equal(teammateBattle.battleSeed, leaderBattle.battleSeed);
  assert.equal(teammateBattle.outcome.success, leaderBattle.outcome.success);

  const teammateGoldBefore = await gold(teammate.player.id);
  const settledByTeammate = await request(`/multiplayer-rooms/${room.room_id}/settle`, {}, teammate.accessToken, 201);
  const settledByLeader = await request(`/multiplayer-rooms/${room.room_id}/settle`, {}, leader.accessToken, 201);
  assert.equal(settledByTeammate.record.id, settledByLeader.record.id);
  assert.equal((await gold(teammate.player.id)) - teammateGoldBefore, 100);
  const records = await db.query(
    `SELECT count(*)::int AS count FROM battle_records WHERE "playerId" = $1 AND id = $2`,
    [leader.player.id, settledByTeammate.record.id],
  );
  assert.equal(records.rows[0].count, 1);
  const finalRoom = await request('/multiplayer-rooms/current', undefined, leader.accessToken);
  assert.equal(finalRoom.status, 'finished');

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'friend invitation and acceptance',
      'two-account room membership',
      'independent character selections',
      'both members ready',
      'one authoritative battle seed',
      'both accounts read identical battle outcome',
      'non-leader settlement accepted',
      'settlement and helper reward replay-safe',
    ],
  }, null, 2));
} finally {
  await db.end().catch(() => undefined);
  if (server.exitCode === null) { server.kill(); await once(server, 'exit').catch(() => undefined); }
}
