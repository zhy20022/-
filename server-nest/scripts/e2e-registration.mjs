import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const databaseUrl = process.env.E2E_DATABASE_URL;
assert(databaseUrl && ['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname), 'isolated local database required');
const server = spawn(process.execPath, ['dist/main.js'], { windowsHide: true, stdio: 'pipe', env: {
  ...process.env, NODE_ENV: 'test', PORT: '4198', DATABASE_URL: databaseUrl, DB_SSL: 'false',
  TYPEORM_SYNCHRONIZE: 'true', REDIS_URL: 'redis://127.0.0.1:6399', CONTENT_DIR: '../data/content',
  BACKUP_ENABLED: 'false', AUTH_TOKEN_SECRET: randomUUID() + randomUUID(), RATE_LIMIT_MAX: '2000',
} });
let tail = '';
for (const pipe of [server.stdout, server.stderr]) pipe.on('data', data => { tail = (tail + data).slice(-2000); });
const db = new pg.Client({ connectionString: databaseUrl });
async function register(username) {
  const response = await fetch('http://127.0.0.1:4198/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'Test-only-' + username }), signal: AbortSignal.timeout(30000),
  });
  return { status: response.status, body: await response.json() };
}
try {
  await db.connect();
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://127.0.0.1:4198/api/dungeons')).ok) { up = true; break; } } catch {}
    await delay(500);
  }
  assert(up, tail);
  const stamp = Date.now().toString(36);
  const unique = await Promise.all(Array.from({ length: 6 }, (_, i) => register('reg_' + stamp + '_' + i)));
  assert(unique.every(row => row.status === 201));
  const sameName = 'same_' + stamp;
  const collisions = await Promise.all(Array.from({ length: 6 }, () => register(sameName)));
  assert.equal(collisions.filter(row => row.status === 201).length, 1);
  assert.equal(collisions.filter(row => row.status === 409).length, 5);
  const count = await db.query('SELECT count(*) FROM users u JOIN players p ON p."userId"=u.id::text WHERE u."accountId"=$1', ['password:' + sameName]);
  assert.equal(count.rows[0].count, '1');
  // Simulate failure after user INSERT, proving both tables roll back together.
  await db.query(`CREATE OR REPLACE FUNCTION test_registration_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."displayName" LIKE 'rollback_%' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`);
  await db.query('CREATE TRIGGER test_registration_failure BEFORE INSERT ON players FOR EACH ROW EXECUTE FUNCTION test_registration_failure()');
  const failedName = 'rollback_' + stamp;
  assert.equal((await register(failedName)).status, 500);
  assert.equal((await db.query('SELECT count(*) FROM users WHERE "accountId"=$1', ['password:' + failedName])).rows[0].count, '0');
  console.log('PASS: six concurrent registrations, one account on same-name collision, atomic rollback on profile failure');
} finally {
  await db.query('DROP TRIGGER IF EXISTS test_registration_failure ON players').catch(() => {});
  await db.query('DROP FUNCTION IF EXISTS test_registration_failure()').catch(() => {});
  await db.end();
  if (server.exitCode === null) { server.kill(); await once(server, 'exit'); }
}
