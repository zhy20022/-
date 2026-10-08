import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.E2E_DATABASE_URL;
assert(databaseUrl && ['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname));
const connection = new URL(databaseUrl);
assert(connection.pathname.slice(1).startsWith('gamer_rewards_e2e'));
const api = 'http://127.0.0.1:4195/api';
const artifactDir = resolve(process.env.E2E_ARTIFACT_DIR || process.env.TEMP, 'gamer-p0-delivery');
const adminToken = randomUUID() + randomUUID();
const backupToken = randomUUID() + randomUUID();
const restoreName = `gamer_rewards_e2e_restore_${Date.now()}`;
const schemaSource = await readFile('src/database/schema-version.ts', 'utf8');
const expectedVersion = schemaSource.match(/CURRENT_SCHEMA_VERSION\s*=\s*'([^']+)'/)[1];
const candidateCommit = process.env.E2E_CANDIDATE_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const candidateDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', windowsHide: true }).trim();
const report = { verified: false, checks: [], expectedVersion, restoreName, candidateCommit,
  candidateKind: candidateDirty ? 'HEAD plus uncommitted tracked changes' : 'clean tracked candidate commit', startedAt: new Date().toISOString() };
const serverEnv = {
  ...process.env, NODE_ENV: 'test', PORT: '4195', DATABASE_URL: databaseUrl, DB_SSL: 'false',
  TYPEORM_SYNCHRONIZE: 'false', REDIS_URL: 'redis://127.0.0.1:6399', CONTENT_DIR: '../data/content',
  AUTH_TOKEN_SECRET: randomUUID() + randomUUID(), ADMIN_TOKEN: adminToken, BACKUP_TOKEN: backupToken,
  RATE_LIMIT_MAX: '100000', RENDER_GIT_COMMIT: candidateCommit,
};
const servers = [];
let output = '';
function startServer(env) {
  const child = spawn(process.execPath, ['dist/main.js'], { windowsHide: true, stdio: 'pipe', env });
  servers.push(child);
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', data => { output = (output + data).slice(-6000); });
  return child;
}
async function waitServer(base) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/health/live')).ok) return; } catch {}
    await delay(250);
  }
  throw new Error(`server not ready: ${base}\n${output}`);
}
startServer(serverEnv);
const db = new pg.Client({ connectionString: databaseUrl });
const pgEnv = { ...process.env, PGHOST: connection.hostname, PGPORT: connection.port || '5432',
  PGUSER: connection.username, PGPASSWORD: connection.password };
async function request(path, body, session, expected = body === undefined ? 200 : 201, headers = {}, base = api) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  assert.equal(response.status, expected, `${path}: ${text}\n${output}`);
  return value;
}
try {
  await mkdir(artifactDir, { recursive: true });
  await db.connect();
  await waitServer(api);
  const secondApi = 'http://127.0.0.1:4194/api';
  startServer({ ...serverEnv, PORT: '4194' });
  await waitServer(secondApi);
  const password = randomUUID();
  const username = `p0_${Date.now()}`;
  const a = await request('/auth/register', { username, password });
  const b = await request('/auth/register', { username: `p0b_${Date.now()}`, password: randomUUID() });
  const score = { playerId: a.player.id, score: 999999 };
  await request('/ranking/world_boss%3Afire_type_server_boss_001/score', score, null, 401);
  await request('/ranking/test_public/score', { ...score, playerId: b.player.id }, a, 401);
  for (const key of ['world_boss:fire_type_server_boss_001', 'world_boss:water_type_server_boss_001',
    'damage_weekly', 'battle_damage', 'world_boss_damage']) {
    await request(`/ranking/${encodeURIComponent(key)}/score`, score, a, 400);
  }
  await request('/ranking/test_public/score', score, a);
  assert.equal((await db.query('SELECT count(*)::int count FROM ranking_entries WHERE "playerId"=$1 AND "rankingKey" LIKE $2',
    [a.player.id, 'world_boss:%'])).rows[0].count, 0);
  const manifest = JSON.parse(await readFile('../data/content/characters.json', 'utf8'));
  const party = [25, 31, 27, 28, 32].map(number => manifest.characters.find(row => Number(row.id.split('_')[1]) === number));
  assert(party.every(Boolean));
  const ids = [];
  for (let i = 0; i < 20; i++) {
    const character = party[i % party.length];
    const id = randomUUID();
    await db.query(`INSERT INTO player_characters (id,"playerId","characterConfigId","attributeType","professionType",level)
      VALUES ($1,$2,$3,$4,$5,100)`, [id, b.player.id, character.id, character.attributeType, character.professionType]);
    ids.push(id);
  }
  const dungeonId = 'fire_type_server_boss_001';
  const started = await request(`/dungeons/${b.player.id}/${dungeonId}/start`, { characterIds: ids }, b);
  const ticket = (await db.query(`SELECT response FROM operation_requests
    WHERE "playerId"=$1 AND operation='battle-start' AND "idempotencyKey"=$2`, [b.player.id, started.battleSeed])).rows[0].response;
  const trusted = ticket.serverBattle;
  assert.equal(trusted.success, true, 'authored fixture must genuinely defeat the world Boss');
  const forged = { playerId: b.player.id, dungeonId, characterIds: ids, success: false, duration: 0,
    damageScore: 999999999, rewards: [{ itemConfigId: 'forged_material', itemType: 'material', quantity: 99999 }],
    clientTrace: { battleSeed: started.battleSeed, source: 'client-forged' } };
  await request('/battle-settlement', { ...forged, playerId: a.player.id }, b, 401);
  await request('/battle-settlement', { ...forged, characterIds: [randomUUID(), ...ids.slice(1)] }, b, 400);
  await request('/battle-settlement', { ...forged, clientTrace: { battleSeed: randomUUID() } }, b, 400);
  const deadline = Date.now() + 90000;
  while (!(await request(`/dungeons/${b.player.id}/battles/${started.battleSeed}`, undefined, b)).ready) {
    assert(Date.now() < deadline, 'natural world Boss replay timeout');
    await delay(500);
  }
  const results = await Promise.all([api, secondApi, api, secondApi].map(base =>
    request('/battle-settlement', forged, b, 201, {}, base)));
  assert.equal(new Set(results.map(row => row.record.id)).size, 1);
  assert.equal(results[0].record.damageScore, trusted.damageScore);
  const rankRows = (await db.query('SELECT * FROM ranking_entries WHERE "playerId"=$1 AND "rankingKey"=$2',
    [b.player.id, `world_boss:${dungeonId}`])).rows;
  assert.equal(rankRows.length, 1);
  assert.equal(Number(rankRows[0].score), trusted.damageScore);
  assert.equal(Number(rankRows[0].payload.attempts), 1);
  assert.equal((await db.query(`SELECT count(*)::int count FROM inventory_items WHERE "playerId"=$1 AND "itemConfigId"='forged_material'`,
    [b.player.id])).rows[0].count, 0);
  const board = await request(`/ranking/${encodeURIComponent(`world_boss:${dungeonId}`)}?seasonId=${encodeURIComponent(rankRows[0].seasonId)}`);
  assert.equal(Number(board.find(row => row.playerId === b.player.id).score), trusted.damageScore);
  report.legalBoss = { battleSeed: started.battleSeed, engineVersion: trusted.engineVersion,
    success: trusted.success, trustedDamage: trusted.damageScore, recordedScore: Number(rankRows[0].score), recordId: results[0].record.id };
  report.checks.push('H03 unauthenticated/cross-account/dynamic Boss writes rejected; own public score works');
  report.checks.push('H03 real worker trusted Boss settlement updates actual dynamic ranking once; forged damage/rewards ignored');
  await request(`/players/${a.player.id}/profile`, undefined, a);
  await request(`/admin/users/${a.user.id}/ban`, { reason: 'isolated regression' }, null, 201, { 'x-admin-token': adminToken });
  await request(`/players/${a.player.id}/profile`, undefined, a, 403);
  await request(`/players/${a.player.id}/profile`, undefined, a, 403, {}, secondApi);
  await request('/multiplayer-rooms/current', undefined, a, 403);
  await request('/multiplayer-rooms', { dungeonId: 'fire_type_squad_001' }, a, 403);
  await request('/auth/login', { username, password }, null, 403);
  await request(`/players/${b.player.id}/profile`, undefined, b);
  await request(`/admin/users/${a.user.id}/unban`, {}, null, 401);
  await request(`/admin/users/${a.user.id}/unban`, {}, null, 201, { 'x-admin-token': adminToken });
  await request('/auth/login', { username, password });
  await request(`/players/${a.player.id}/profile`, undefined, a);
  await request(`/players/${a.player.id}/profile`, undefined, a, 200, {}, secondApi);
  report.checks.push('H04 authenticated unban restores login and unexpired old token across both instances; no status cache');
  report.checks.push('H04 admin ban immediately rejects old token reads/writes/login; other account unaffected');
  const backup = await fetch(api + '/admin/database/backup', { headers: { 'x-backup-token': backupToken } });
  assert.equal(backup.status, 200);
  assert.equal(backup.headers.get('x-backup-schema-version'), expectedVersion);
  assert.equal(backup.headers.get('x-backup-git-commit'), candidateCommit);
  const bytes = Buffer.from(await backup.arrayBuffer());
  const dumpPath = resolve(artifactDir, 'delivery.dump');
  await writeFile(dumpPath, bytes);
  execFileSync('createdb', [restoreName], { env: pgEnv, windowsHide: true });
  execFileSync('pg_restore', ['--exit-on-error', '--no-owner', '--no-privileges', '-d', restoreName, dumpPath],
    { env: pgEnv, windowsHide: true });
  const verify = execFileSync('psql', ['-d', restoreName, '-v', `expected_schema_version=${expectedVersion}`,
    '-f', 'scripts/verify-restored-backup.sql'], { env: pgEnv, windowsHide: true, encoding: 'utf8' });
  await writeFile(resolve(artifactDir, 'restore-verification.txt'), verify);
  const restore = new pg.Client({ connectionString: new URL(`/${restoreName}`, databaseUrl).toString() });
  await restore.connect();
  try {
    assert.equal((await restore.query('SELECT count(*)::int count FROM players')).rows[0].count,
      (await db.query('SELECT count(*)::int count FROM players')).rows[0].count);
    assert.equal((await restore.query('SELECT count(*)::int count FROM battle_records')).rows[0].count,
      (await db.query('SELECT count(*)::int count FROM battle_records')).rows[0].count);
  } finally { await restore.end(); }
  execFileSync(process.execPath, ['dist/database/run-migrations.js'], { env: { ...process.env, NODE_ENV: 'test',
    DATABASE_URL: new URL(`/${restoreName}`, databaseUrl).toString(), DB_SSL: 'false' }, windowsHide: true });
  const restoredApi = 'http://127.0.0.1:4193/api';
  startServer({ ...serverEnv, PORT: '4193', DATABASE_URL: new URL(`/${restoreName}`, databaseUrl).toString() });
  await waitServer(restoredApi);
  const restoredSession = await request('/auth/login', { username, password }, null, 201, {}, restoredApi);
  assert.equal(restoredSession.player.id, a.player.id);
  await request(`/players/${b.player.id}/profile`, undefined, b, 200, {}, restoredApi);
  const restoredRecords = await request(`/battle-settlement/${b.player.id}/records`, undefined, b, 200, {}, restoredApi);
  assert(restoredRecords.some(row => row.id === results[0].record.id));
  const recoveredReplay = await request('/battle-settlement', forged, b, 201, {}, restoredApi);
  assert.equal(recoveredReplay.record.id, results[0].record.id);
  report.checks.push('H05 real backup endpoint/header/pg_restore/current tables/presence/relations/counts/repeated migration');
  report.checks.push('H05 restored current Nest startup/login/profile/battle record/settlement replay');
  report.databaseVersion = (await db.query('SELECT version()')).rows[0].version;
  report.backupAt = new Date().toISOString();
  report.backupSha256 = createHash('sha256').update(bytes).digest('hex');
  report.verified = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error.stack || String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(artifactDir, 'result.json'), JSON.stringify(report, null, 2));
  await db.end().catch(() => undefined);
  for (const server of servers.reverse()) {
    if (server.exitCode === null) { server.kill(); await once(server, 'exit'); }
  }
}
