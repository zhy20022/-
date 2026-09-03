import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const apiBase = process.env.E2E_API_BASE || 'http://127.0.0.1:4100/api';
const databaseUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || 'postgres://gamer:gamer_dev_password@127.0.0.1:5433/gamer_online';
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6380';
const shouldStartServer = process.env.E2E_START_SERVER !== 'false';

let spawnedServer;

async function main() {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await ensureApi();
    const stamp = Date.now();
    const username = `Loop_${stamp}`;
    const password = `Loop-${stamp}-secure`;
    const registered = await postJson('/auth/register', {
      username,
      password,
    });
    const session = await postJson('/auth/login', { username, password });
    assert(session.player.id === registered.player.id, 'password login should restore the registered player');
    const playerId = session.player.id;
    const auth = authHeader(session.accessToken);
    assert(session.player.gold >= 100000, 'new online player should start with gold for first loop');

    const pools = await getJson('/gacha/pools');
    assert(pools.some((pool) => pool.cost?.currency === 'gold'), 'gacha pool should cost gold');

    const draw = await postJson(`/gacha/${playerId}/draw`, { poolKey: 'starter', count: 10 }, auth);
    assert(draw.results.length === 10, 'draw should return 10 results');
    assert(draw.cost.currency === 'gold', 'draw cost should be gold');

    const profileAfterDraw = await getJson(`/players/${playerId}/profile`, auth);
    const character = profileAfterDraw.characters[0];
    assert(character?.id, 'player should own at least one character after draw');
    assert(profileAfterDraw.player.gold < session.player.gold, 'gacha should deduct gold');

    const dungeonId = dungeonForAttribute(character.attributeType);
    await postJson(`/dungeons/${playerId}/${dungeonId}/start`, {}, auth);
    const settlement = await postJson('/battle-settlement', {
      playerId,
      dungeonId,
      characterIds: [character.id],
      success: true,
      duration: 60,
      singleMonstersKilled: 10,
      groupMonstersKilled: 50,
      clientTrace: { source: 'e2e-online-loop' },
    }, auth);
    assert(settlement.outcome === 'success', 'experience dungeon settlement should succeed');
    assert(settlement.serverRewards.expCrystals === 531, 'normal experience dungeon should grant 531 exp packs');
    assert(settlement.serverRewards.gold === 100, 'normal experience dungeon should grant 100 gold');
    assert(settlement.serverRewards.directCharacterExp === 20, '20 waves should grant 20 direct character exp');
    assert(settlement.progress.successfulAttempts >= 1, 'dungeon progress should persist clear count');

    const profileAfterBattle = await getJson(`/players/${playerId}/profile`, auth);
    const battledCharacter = profileAfterBattle.characters.find((item) => item.id === character.id);
    assert(battledCharacter.exp >= 20 || battledCharacter.level > character.level, 'direct battle exp should persist on character');
    assert(profileAfterBattle.inventory.some((item) => item.itemConfigId === 'character_exp_crystal' && item.quantity >= 531), 'experience pack reward should persist in inventory');

    const preview = await getJson(`/players/${playerId}/characters/${character.id}/exp-preview?levelDelta=1`, auth);
    assert(preview.currency === 'gold', 'level preview should charge gold as the only currency');
    assert(preview.expItemConfigId === 'character_exp_crystal', 'level preview should require experience packages');
    assert(preview.canAfford, 'player should afford one level-up after experience dungeon');

    const upgraded = await postJson(`/players/${playerId}/characters/${character.id}/use-exp`, { levelDelta: 1 }, auth);
    assert(upgraded.consumedGold > 0, 'character upgrade should consume gold');
    assert(upgraded.consumedExpPackages > 0, 'character upgrade should consume experience packages');
    assert(upgraded.character.level >= character.level + 1, 'character should level up');

    const profileAfterReload = await getJson(`/players/${playerId}/profile`, auth);
    const persistedCharacter = profileAfterReload.characters.find((item) => item.id === character.id);
    assert(persistedCharacter.level === upgraded.character.level, 'character level should persist after reload');
    assert(profileAfterReload.player.gold === upgraded.player.gold, 'player gold should persist after reload');

    const counts = await db.query(
      `select
        (select count(*)::int from players) as players,
        (select count(*)::int from player_characters) as characters,
        (select count(*)::int from inventory_items) as inventory,
        (select count(*)::int from battle_records) as battles,
        (select count(*)::int from dungeon_progress) as progress`,
    );

    console.log(JSON.stringify({
      ok: true,
      apiBase,
      playerId,
      characterId: character.id,
      dungeonId,
      drawCost: draw.cost,
      battle: {
        recordId: settlement.record.id,
        rewards: settlement.serverRewards,
        progressId: settlement.progress.id,
      },
      upgrade: {
        consumedGold: upgraded.consumedGold,
        consumedExpPackages: upgraded.consumedExpPackages,
        level: upgraded.character.level,
        remainingGold: upgraded.player.gold,
      },
      tableCounts: counts.rows[0],
    }, null, 2));
  } finally {
    await db.end();
    if (spawnedServer) spawnedServer.kill();
  }
}

function dungeonForAttribute(attributeType) {
  const map = {
    FIRE: 'fire_type_single_001',
    WOOD: 'wood_type_single_001',
    WIND: 'wind_type_single_001',
    WATER: 'water_type_single_001',
    EARTH: 'earth_type_single_001',
    THUNDER: 'lightning_type_single_001',
    LIGHT: 'holy_type_single_001',
    DARK: 'shadow_type_single_001',
  };
  return map[String(attributeType || '').toUpperCase()] || 'fire_type_single_001';
}

async function ensureApi() {
  if (await canReachHealth()) return;
  if (!shouldStartServer) {
    throw new Error(`API is not reachable at ${apiBase}`);
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
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

async function requestJson(path, init) {
  const response = await fetch(`${apiBase}${path}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function authHeader(token) {
  return { authorization: `Bearer ${token}` };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(`[e2e-online-loop] ${error.stack || error.message}`);
  if (spawnedServer) spawnedServer.kill();
  process.exitCode = 1;
});
