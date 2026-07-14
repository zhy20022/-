import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const apiBase = process.env.E2E_API_BASE || 'http://127.0.0.1:4100/api';
const databaseUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || 'postgres://gamer:gamer_dev_password@127.0.0.1:55432/gamer_online';
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6380';
const shouldStartServer = process.env.E2E_START_SERVER !== 'false';

let spawnedServer;

async function main() {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    await ensureApi();
    const health = await getJson('/health');
    assert(health.db === 'ok', `expected health db ok, got ${health.db}`);

    const stamp = Date.now();
    const seasonId = `http-season-${stamp}`;
    const playerA = await createGuest(`http-db-a-${stamp}`, `E2E_A_${stamp}`);
    const playerB = await createGuest(`http-db-b-${stamp}`, `E2E_B_${stamp}`);
    const authA = authHeader(playerA.accessToken);
    const authB = authHeader(playerB.accessToken);

    await db.query('update players set "premiumCurrency" = $1, gold = $2 where id = any($3::uuid[])', [
      100000,
      10000,
      [playerA.id, playerB.id],
    ]);

    const drawA = await postJson(`/gacha/${playerA.id}/draw`, { poolKey: 'starter', count: 10 }, authA);
    const drawB = await postJson(`/gacha/${playerB.id}/draw`, { poolKey: 'starter', count: 10 }, authB);
    assert(drawA.results?.length === 10, 'player A gacha draw did not return 10 results');
    assert(drawB.results?.length === 10, 'player B gacha draw did not return 10 results');

    const characterA = await ensureCharacter(db, playerA.id, authA, 'http_test_a');
    const characterB = await ensureCharacter(db, playerB.id, authB, 'http_test_b');

    const battle = await postJson('/battle-settlement', {
      playerId: playerA.id,
      dungeonId: 'http_integration_dungeon',
      characterIds: [characterA.id],
      success: true,
      duration: 42.5,
      damageScore: 1000000 + (stamp % 100000),
      rewards: [
        {
          itemConfigId: 'http_test_crystal',
          itemType: 'material',
          quantity: 3,
          payload: { source: 'http-db-test' },
        },
      ],
      clientTrace: { test: 'http-db-integration' },
    }, authA);
    assert(battle.record?.id, 'battle settlement did not return a record id');
    assert(battle.progress?.id, 'battle settlement did not return progress id');

    const inventoryA = await getJson(`/inventory/${playerA.id}`, authA);
    assert(Array.isArray(inventoryA) && inventoryA.length > 0, 'player A inventory should contain rewards/items');
    const authoritativeReward = inventoryA.find((item) => item.itemConfigId === 'server_authority_crystal');
    assert(authoritativeReward?.quantity >= 3, 'battle settlement should grant server-authoritative configured reward');
    const forgedClientReward = inventoryA.find((item) => item.itemConfigId === 'http_test_crystal');
    assert(!forgedClientReward, 'battle settlement should not trust forged client reward payloads');
    await expectFailure('/ranking/damage_weekly/score', {
      playerId: playerA.id,
      score: 999999999,
      seasonId,
      payload: { forgedBy: 'client' },
    }, 'protected ranking direct submit should fail');

    const idleStart = await postJson('/idle/start', {
      playerId: playerA.id,
      stageId: 'default_idle_stage',
      characterIds: [characterA.id],
    }, authA);
    assert(idleStart.session?.id, 'idle start did not return a session id');
    await db.query('update idle_sessions set "lastClaimedAt" = now() - interval \'2 hours\' where id = $1', [idleStart.session.id]);
    const idleStatus = await getJson(`/idle/${playerA.id}/status`, authA);
    assert(idleStatus.preview?.cappedSeconds >= 7190, 'idle status should preview roughly two hours of rewards');
    const idleClaim = await postJson(`/idle/${playerA.id}/claim`, {}, authA);
    assert(idleClaim.claim?.id, 'idle claim did not return claim id');
    assert(idleClaim.gold >= 240, 'idle claim should grant server-calculated gold');
    assert(idleClaim.rewards?.some((item) => item.itemConfigId === 'idle_training_crystal'), 'idle claim should grant configured idle material');
    const idleHistory = await getJson(`/idle/${playerA.id}/history`, authA);
    assert(idleHistory.length >= 1, 'idle history should include the new claim');

    const rankingRank = await getJson(`/ranking/damage_weekly/player/${playerA.id}?seasonId=default`);
    assert(rankingRank?.entry?.payload?.source === 'server', 'battle settlement should write server-owned ranking score');
    assert(rankingRank.entry.score === battle.record.damageScore, 'server ranking score should match battle record damage');

    const rankingList = await getJson('/ranking/damage_weekly?seasonId=default&limit=5');
    assert(Array.isArray(rankingList) && rankingList.some((item) => item.playerId === playerA.id), 'ranking list should include battle settlement score');

    const guild = await postJson('/guild', { leaderPlayerId: playerA.id, name: `E2E_Guild_${stamp}` }, authA);
    const guildId = guild.guild?.id;
    assert(guildId, 'guild creation did not return guild id');

    await postJson(`/guild/${guildId}/join`, { playerId: playerB.id }, authB);
    const contribution = await postJson('/guild/contribute', {
      playerId: playerA.id,
      amount: 250,
      source: 'http_test',
      payload: { battleRecordId: battle.record.id },
    }, authA);
    assert(contribution.guild?.contribution >= 250, 'guild contribution was not applied');

    const guildCurrent = await getJson(`/guild/player/${playerA.id}/current`, authA);
    assert(guildCurrent.members?.length === 2, `expected guild to have 2 members, got ${guildCurrent.members?.length}`);

    await postJson(`/friends-assist/${playerA.id}/request`, { addresseePlayerId: playerB.id }, authA);
    await postJson(`/friends-assist/${playerB.id}/accept`, { requesterPlayerId: playerA.id }, authB);

    const friendsA = await getJson(`/friends-assist/${playerA.id}`, authA);
    assert(friendsA.length === 1, `expected player A to have 1 friend, got ${friendsA.length}`);

    const rosterA = await getJson(`/friends-assist/${playerA.id}/assist-roster`, authA);
    assert(rosterA.length > 0, 'assist roster should include at least one friend character');

    const assist = await postJson(`/friends-assist/${playerA.id}/assist`, {
      helperPlayerId: playerB.id,
      helperCharacterId: characterB.id,
      dungeonId: 'http_integration_dungeon',
      payload: { battleRecordId: battle.record.id },
    }, authA);
    assert(assist.id, 'friend assist did not return record id');

    const assistHistory = await getJson(`/friends-assist/${playerA.id}/assist-history`, authA);
    assert(assistHistory.length >= 1, 'assist history should include the new assist');

    const dailyGoals = await getJson(`/daily-goals/${playerA.id}`, authA);
    const completedGoalKeys = dailyGoals.goals.filter((goal) => goal.complete).map((goal) => goal.goalKey);
    for (const goalKey of ['battle_clear', 'gacha_draw', 'idle_claim', 'guild_contribute', 'friend_assist']) {
      assert(completedGoalKeys.includes(goalKey), `daily goal ${goalKey} should be complete`);
    }
    const dailyClaim = await postJson(`/daily-goals/${playerA.id}/claim`, { goalKey: 'idle_claim' }, authA);
    assert(dailyClaim.progress?.claimed === true, 'daily goal claim should mark progress claimed');
    await expectFailure(`/daily-goals/${playerA.id}/claim`, { goalKey: 'idle_claim' }, 'duplicate daily goal claim should fail', authA);
    await expectGetFailure('/admin/operations', 'admin operations should require admin token');
    const operations = await getJson('/admin/operations', { 'x-admin-token': process.env.ADMIN_TOKEN || 'dev-admin-token' });
    assert(operations.players >= 2, 'admin operations should return player count with admin token');
    const playerOperations = await getJson(`/admin/players/${playerA.id}/operations`, { 'x-admin-token': process.env.ADMIN_TOKEN || 'dev-admin-token' });
    assert(playerOperations.player?.id === playerA.id, 'admin player operations should return selected player');

    const counts = await tableCounts(db);
    assert(Number(counts.battle_records) >= 1, 'battle_records table should have rows');
    assert(Number(counts.idle_sessions) >= 1, 'idle_sessions table should have rows');
    assert(Number(counts.idle_claims) >= 1, 'idle_claims table should have rows');
    assert(Number(counts.daily_goal_progress) >= 5, 'daily_goal_progress table should have rows');
    assert(Number(counts.ranking_entries) >= 1, 'ranking_entries table should have rows');
    assert(Number(counts.friendships) >= 1, 'friendships table should have rows');
    assert(Number(counts.friend_assist_records) >= 1, 'friend_assist_records table should have rows');
    assert(Number(counts.guilds) >= 1, 'guilds table should have rows');
    assert(Number(counts.guild_members) >= 2, 'guild_members table should have rows');
    assert(Number(counts.guild_contributions) >= 1, 'guild_contributions table should have rows');

    const result = {
      ok: true,
      apiBase,
      database: maskDatabaseUrl(databaseUrl),
      health,
      players: { a: playerA.id, b: playerB.id },
      characters: { a: characterA.id, b: characterB.id },
      drawCounts: { a: drawA.results.length, b: drawB.results.length },
      battle: { recordId: battle.record.id, progressId: battle.progress.id, rewards: battle.rewards?.length || 0 },
      idle: {
        sessionId: idleStart.session.id,
        claimId: idleClaim.claim.id,
        gold: idleClaim.gold,
        history: idleHistory.length,
      },
      ranking: { rank: rankingRank.rank, score: rankingRank.entry.score, entriesChecked: rankingList.length },
      guild: { id: guildId, members: guildCurrent.members.length, contribution: contribution.guild.contribution },
      friends: { count: friendsA.length, roster: rosterA.length, assistRecord: assist.id, history: assistHistory.length },
      dailyGoals: { completed: completedGoalKeys, claimed: dailyClaim.progress.goalKey },
      admin: { players: operations.players, selectedPlayer: playerOperations.player.id },
      tableCounts: counts,
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.end();
    if (spawnedServer) {
      spawnedServer.kill();
    }
  }
}

async function ensureApi() {
  if (await canReachHealth()) return;
  if (!shouldStartServer) {
    throw new Error(`API is not reachable at ${apiBase}; start it first or remove E2E_START_SERVER=false`);
  }

  spawnedServer = spawn(process.execPath, ['dist/main.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: process.env.PORT || '4100',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'dev-admin-token',
      CONTENT_DIR: process.env.CONTENT_DIR || '../data/content',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawnedServer.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  spawnedServer.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await canReachHealth()) return;
    await delay(500);
  }
  throw new Error(`API did not become reachable at ${apiBase}`);
}

async function canReachHealth() {
  try {
    const response = await fetch(`${apiBase}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function createGuest(deviceId, displayName) {
  const response = await postJson('/auth/guest', { deviceId, displayName });
  assert(response.player?.id, `guest login did not return player id for ${displayName}`);
  assert(response.accessToken, `guest login did not return access token for ${displayName}`);
  return { ...response.player, accessToken: response.accessToken };
}

async function ensureCharacter(db, playerId, headers, fallbackConfigId) {
  const profile = await getJson(`/players/${playerId}/profile`, headers);
  if (profile.characters?.length > 0) return profile.characters[0];

  const id = randomUUID();
  await db.query(
    `insert into player_characters
      (id, "playerId", "characterConfigId", "attributeType", "professionType", level, exp, "skillSlots", equipment, "createdAt", "updatedAt")
     values ($1, $2, $3, 'FIRE', 'PHYSICAL_MELEE_DPS', 1, 0, '{}', '{}', now(), now())`,
    [id, playerId, fallbackConfigId],
  );
  const updated = await getJson(`/players/${playerId}/profile`, headers);
  const character = updated.characters?.find((item) => item.id === id) || updated.characters?.[0];
  assert(character?.id, `failed to create fallback character for player ${playerId}`);
  return character;
}

async function tableCounts(db) {
  const tables = [
    'players',
    'player_characters',
    'inventory_items',
    'battle_records',
    'idle_sessions',
    'idle_claims',
    'daily_goal_progress',
    'ranking_entries',
    'friendships',
    'friend_assist_records',
    'guilds',
    'guild_members',
    'guild_contributions',
  ];
  const result = {};
  for (const table of tables) {
    const { rows } = await db.query(`select count(*)::int as count from ${table}`);
    result[table] = rows[0].count;
  }
  return result;
}

async function getJson(path, headers = {}) {
  return requestJson(path, { method: 'GET', headers });
}

async function postJson(path, body, headers = {}) {
  return requestJson(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(body),
  });
}

async function expectFailure(path, body, message, headers = {}) {
  try {
    await postJson(path, body, headers);
  } catch {
    return;
  }
  throw new Error(message);
}

async function expectGetFailure(path, message, headers = {}) {
  try {
    await getJson(path, headers);
  } catch {
    return;
  }
  throw new Error(message);
}

function authHeader(token) {
  return { authorization: `Bearer ${token}` };
}

async function requestJson(path, init) {
  const response = await fetch(`${apiBase}${path}`, init);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function maskDatabaseUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<invalid-url>';
  }
}

main().catch((error) => {
  console.error(`[e2e-http] ${error.stack || error.message}`);
  if (spawnedServer) {
    spawnedServer.kill();
  }
  process.exitCode = 1;
});
