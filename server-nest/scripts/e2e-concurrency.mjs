import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const apiBase = (process.env.E2E_API_BASE || 'http://127.0.0.1:4100/api').replace(/\/$/, '');
const accountCount = Math.max(2, Math.min(12, Number(process.env.E2E_ACCOUNT_COUNT || 6)));
const duplicateRequests = Math.max(2, Math.min(12, Number(process.env.E2E_DUPLICATE_REQUESTS || 6)));
const timings = [];
let requestCount = 0;

async function main() {
  const health = await getJson('/health');
  assert(health.db === 'ok' && health.schemaReady, 'PostgreSQL or the schema is not ready for concurrency testing');

  const stamp = Date.now().toString(36);
  const accounts = await Promise.all(Array.from({ length: accountCount }, (_, index) => register(stamp, index)));
  const accountResults = await Promise.all(accounts.map(runAccountIdempotency));
  const serialized = await runSerializedMutationBurst(accounts[0]);
  const insufficientFunds = process.env.E2E_DATABASE_URL
    ? await runInsufficientFundsBurst(accounts[1])
    : { skipped: true, reason: 'E2E_DATABASE_URL is not available to the public acceptance runner' };

  const sorted = [...timings].sort((left, right) => left - right);
  const report = {
    ok: true,
    apiBase,
    deploymentCommit: health.deploymentCommit,
    schemaVersion: health.schemaVersion,
    accountCount,
    requestCount,
    duplicateRequests,
    idempotentAccounts: accountResults,
    serializedMutations: serialized,
    insufficientFunds,
    latencyMs: {
      min: Math.round(sorted[0] || 0),
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: Math.round(sorted.at(-1) || 0),
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

async function runInsufficientFundsBurst(account) {
  const pg = (await import('pg')).default;
  const database = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await database.connect();
  try {
    await database.query('update players set gold = 1000 where id = $1', [account.playerId]);
  } finally {
    await database.end();
  }

  const attempts = await Promise.all(Array.from({ length: 10 }, () => postRaw(
    `/gacha/${account.playerId}/draw`,
    { poolKey: 'starter', count: 1 },
    account.headers,
    `load-overdraft:${randomUUID()}`,
  )));
  const succeeded = attempts.filter((attempt) => attempt.status === 201);
  const rejected = attempts.filter((attempt) => attempt.status === 400);
  assert(succeeded.length === 6, `expected 6 affordable draws, got ${succeeded.length}`);
  assert(rejected.length === 4, `expected 4 insufficient-funds rejections, got ${rejected.length}`);
  assert(attempts.every((attempt) => attempt.status === 201 || attempt.status === 400), 'overdraft burst returned an unexpected status');
  const profile = await getJson(`/players/${account.playerId}/profile`, account.headers);
  assert(Number(profile.player.gold) === 40, `expected final gold 40, got ${profile.player.gold}`);
  return { attempted: 10, succeeded: 6, rejected: 4, finalGold: Number(profile.player.gold) };
}

async function register(stamp, index) {
  const username = `load_${stamp}_${index}`;
  const password = `Load-${stamp}-${index}-secure`;
  const response = await postJson('/auth/register', { username, password });
  return {
    playerId: response.player.id,
    initialGold: Number(response.player.gold),
    headers: { authorization: `Bearer ${response.accessToken}` },
  };
}

async function runAccountIdempotency(account) {
  const drawKey = `load-gacha:${randomUUID()}`;
  const drawBody = { poolKey: 'starter', count: 10 };
  const draws = await Promise.all(Array.from({ length: duplicateRequests }, () => (
    postJson(`/gacha/${account.playerId}/draw`, drawBody, account.headers, drawKey)
  )));
  const recordIds = new Set(draws.map((draw) => draw.recordId));
  assert(recordIds.size === 1, `duplicate gacha request created ${recordIds.size} records`);
  assert(draws.filter((draw) => draw.idempotency?.replayed === false).length === 1, 'gacha should execute exactly once');

  const profile = await getJson(`/players/${account.playerId}/profile`, account.headers);
  const character = profile.characters?.[0];
  assert(character?.id, 'gacha did not provide a character for battle verification');
  assert(Number(profile.player.gold) === account.initialGold - Number(draws[0].cost.amount), 'idempotent gacha charged gold more than once');

  const dungeonId = dungeonForAttribute(character.attributeType);
  const started = await postJson(
    `/dungeons/${account.playerId}/${dungeonId}/start`,
    { characterIds: [character.id] },
    account.headers,
  );
  const settlementBody = {
    playerId: account.playerId,
    dungeonId,
    characterIds: [character.id],
    success: true,
    duration: 60,
    singleMonstersKilled: 10,
    groupMonstersKilled: 50,
    clientTrace: { source: 'concurrency-acceptance', battleSeed: started.battleSeed },
  };
  const settlements = await Promise.all(Array.from({ length: duplicateRequests }, () => (
    postJson('/battle-settlement', settlementBody, account.headers, started.battleSeed)
  )));
  const battleIds = new Set(settlements.map((settlement) => settlement.record.id));
  assert(battleIds.size === 1, `duplicate settlement created ${battleIds.size} battle records`);
  assert(settlements.filter((settlement) => settlement.idempotency?.replayed === false).length === 1, 'battle settlement should execute exactly once');

  const records = await getJson(`/battle-settlement/${account.playerId}/records`, account.headers);
  const matchingRecords = records.filter((record) => record.id === settlements[0].record.id);
  assert(matchingRecords.length === 1, 'settled battle record was not persisted exactly once');
  await expectStatus(
    `/gacha/${account.playerId}/draw`,
    { poolKey: 'starter', count: 1 },
    account.headers,
    drawKey,
    409,
  );

  return {
    playerId: account.playerId,
    gachaRecordId: draws[0].recordId,
    battleRecordId: settlements[0].record.id,
    replayedDraws: draws.filter((draw) => draw.idempotency?.replayed).length,
    replayedSettlements: settlements.filter((settlement) => settlement.idempotency?.replayed).length,
  };
}

async function runSerializedMutationBurst(account) {
  const before = await getJson(`/players/${account.playerId}/profile`, account.headers);
  const count = 12;
  const responses = await Promise.all(Array.from({ length: count }, () => (
    postJson(
      `/gacha/${account.playerId}/draw`,
      { poolKey: 'starter', count: 1 },
      account.headers,
      `load-serial:${randomUUID()}`,
    )
  )));
  const after = await getJson(`/players/${account.playerId}/profile`, account.headers);
  const spent = responses.reduce((sum, response) => sum + Number(response.cost.amount), 0);
  assert(new Set(responses.map((response) => response.recordId)).size === count, 'unique concurrent mutations were incorrectly replayed');
  assert(Number(after.player.gold) === Number(before.player.gold) - spent, 'serialized mutations lost or duplicated a gold update');
  assert(Number(after.player.gold) >= 0, 'serialized mutations produced a negative balance');
  return { playerId: account.playerId, operations: count, spent, finalGold: Number(after.player.gold) };
}

function dungeonForAttribute(attributeType) {
  const map = {
    FIRE: 'fire_type_single_001', WOOD: 'wood_type_single_001', WIND: 'wind_type_single_001',
    WATER: 'water_type_single_001', EARTH: 'earth_type_single_001', THUNDER: 'lightning_type_single_001',
    LIGHT: 'holy_type_single_001', DARK: 'shadow_type_single_001',
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

async function expectStatus(path, body, headers, idempotencyKey, expectedStatus) {
  const response = await postRaw(path, body, headers, idempotencyKey);
  assert(response.status === expectedStatus, `expected HTTP ${expectedStatus}, got ${response.status}`);
}

async function postRaw(path, body, headers, idempotencyKey) {
  const startedAt = performance.now();
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers, 'idempotency-key': idempotencyKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  timings.push(performance.now() - startedAt);
  requestCount += 1;
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, payload };
}

async function requestJson(path, init) {
  const startedAt = performance.now();
  const response = await fetch(`${apiBase}${path}`, { ...init, signal: AbortSignal.timeout(60_000) });
  timings.push(performance.now() - startedAt);
  requestCount += 1;
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) throw new Error(`${init.method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  return Math.round(values[Math.min(values.length - 1, Math.floor(values.length * ratio))]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(`[e2e-concurrency] ${error.stack || error.message}`);
  process.exitCode = 1;
});
