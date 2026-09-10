import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

const apiBase = (process.env.E2E_API_BASE || 'https://gamer-2d-playable-demo.yicheng430664.chatgpt.site/api').replace(/\/$/, '');
const expectedCommit = String(process.env.E2E_EXPECTED_COMMIT || '').trim();

async function main() {
  const health = await waitForDeployment();
  assert(health.db === 'ok', 'PostgreSQL is not ready');
  assert(health.redis === 'PONG', 'Redis is not ready');
  assert(health.schemaReady, `schema is not ready: ${health.schemaVersion}`);

  const stamp = Date.now();
  const username = `rel_${stamp.toString(36)}`;
  const password = `Release-${stamp}-secure`;
  const registered = await postJson('/auth/register', { username, password });
  const session = await postJson('/auth/login', { username, password });
  assert(registered.player.id === session.player.id, 'login did not restore the registered player');

  const playerId = session.player.id;
  const auth = { authorization: `Bearer ${session.accessToken}` };
  const pools = await getJson('/gacha/pools');
  assert(Array.isArray(pools) && pools.some((pool) => pool.key === 'starter'), 'starter gacha pool is unavailable');

  const draw = await postJson(`/gacha/${playerId}/draw`, { poolKey: 'starter', count: 1 }, auth, `release-gacha:${randomUUID()}`);
  assert(draw.results?.length === 1, 'gacha draw did not return one result');
  assert(draw.cost?.currency === 'gold', 'gacha draw did not use gold');

  const profileAfterDraw = await getJson(`/players/${playerId}/profile`, auth);
  const character = profileAfterDraw.characters?.[0];
  assert(character?.id, 'drawn character was not persisted');
  const dungeonId = dungeonForAttribute(character.attributeType);

  const started = await postJson(`/dungeons/${playerId}/${dungeonId}/start`, { characterIds: [character.id] }, auth);
  await delay(15000);
  const status = await getJson(`/dungeons/${playerId}/battles/${started.battleSeed}`, auth);
  assert(status.ready && status.outcome, 'server battle is not ready for settlement');
  const settlement = await postJson('/battle-settlement', {
    playerId,
    dungeonId,
    characterIds: [character.id],
    success: true,
    duration: 60,
    singleMonstersKilled: 10,
    groupMonstersKilled: 50,
    clientTrace: { source: 'post-deploy-acceptance', battleSeed: started.battleSeed },
  }, auth, started.battleSeed);
  assert(settlement.record.success === status.outcome.success, 'settlement disagrees with server battle outcome');
  assert(settlement.record.duration === status.outcome.duration, 'settlement duration is not server-authored');
  assert(settlement.record.damageScore === status.outcome.damageScore, 'settlement damage is not server-authored');
  const seconds = status.outcome.duration;
  const ratio = seconds >= 60 ? 1 : seconds >= 45 ? .65 : seconds >= 30 ? .4 : seconds >= 15 ? .15 : 0;
  assert(settlement.serverRewards?.expCrystals === Math.floor(531 * ratio), 'experience package reward is incorrect');

  const preview = await getJson(`/players/${playerId}/characters/${character.id}/exp-preview?levelDelta=1`, auth);
  const upgraded = preview.canAfford ? await postJson(
    `/players/${playerId}/characters/${character.id}/use-exp`,
    { levelDelta: 1 },
    auth,
    `release-exp:${randomUUID()}`,
  ) : null;
  if (upgraded) assert(upgraded.character.level >= character.level + 1, 'character upgrade was not persisted');

  const finalProfile = await getJson(`/players/${playerId}/profile`, auth);
  const finalCharacter = finalProfile.characters.find((item) => item.id === character.id);
  assert(finalCharacter, 'reloaded character is missing');
  if (upgraded) assert(finalCharacter.level === upgraded.character.level, 'reloaded character level does not match');
  const records = await getJson(`/battle-settlement/${playerId}/records`, auth);
  assert(records.some((record) => record.id === settlement.record.id), 'server battle record was not persisted');

  console.log(JSON.stringify({
    ok: true,
    apiBase,
    deploymentCommit: health.deploymentCommit,
    schemaVersion: health.schemaVersion,
    playerId,
    characterId: character.id,
    dungeonId,
    goldSpent: draw.cost.amount + (upgraded?.consumedGold || 0),
    battleSuccess: status.outcome.success,
    firstUpgradeAvailable: Boolean(upgraded),
    finalLevel: finalCharacter.level,
  }, null, 2));
}

async function waitForDeployment() {
  let latestError = 'health endpoint unavailable';
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    try {
      const health = await getJson('/health/ready');
      const commitMatches = !expectedCommit || String(health.deploymentCommit || '').startsWith(expectedCommit);
      if (health.ok && commitMatches) return health;
      latestError = `ready=${health.ok}, commit=${health.deploymentCommit || 'unknown'}`;
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 100) await delay(15000);
  }
  throw new Error(`deployment did not become ready: ${latestError}`);
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

async function getJson(path, headers = {}) {
  return requestJson(path, { method: 'GET', headers });
}

async function postJson(path, body, headers = {}, idempotencyKey) {
  return requestJson(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function requestJson(path, init) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(`[e2e-public-release] ${error.stack || error.message}`);
  process.exitCode = 1;
});
