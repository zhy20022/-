import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const url = new URL(process.env.E2E_DATABASE_URL || '');
assert(['localhost', '127.0.0.1'].includes(url.hostname) &&
  url.pathname.slice(1).startsWith('gamer_rewards_e2e'), 'isolated database required');
const artifactRoot = process.env.E2E_ARTIFACT_DIR || resolve(process.env.TEMP, 'gamer-p0-final-20261008');
await mkdir(artifactRoot, { recursive: true });
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
const report = { startedAt: new Date().toISOString(), results: [], verified: false };
const baseEnv = { ...process.env, NODE_ENV: 'test', DB_SSL: 'false', TYPEORM_SYNCHRONIZE: 'false',
  AUTH_TOKEN_SECRET: randomUUID() + randomUUID(), REDIS_URL: 'redis://127.0.0.1:6399', RATE_LIMIT_MAX: '100000' };
async function run(label, script, env) {
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, [script], { windowsHide: true, stdio: 'pipe', env });
  let output = '';
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', data => {
    output += data.toString();
    process.stdout.write(data);
  });
  const [code] = await once(child, 'exit');
  const row = { label, script, code, startedAt, finishedAt: new Date().toISOString() };
  report.results.push(row);
  await writeFile(resolve(artifactRoot, `${label}.log`), output);
  assert.equal(code, 0, `${label} failed; see ${artifactRoot}`);
}
async function database(label) {
  const name = `gamer_rewards_e2e_final_${label}_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const connection = new URL(url);
  connection.pathname = `/${name}`;
  const env = { ...baseEnv, E2E_DATABASE_URL: connection.toString(), DATABASE_URL: connection.toString(),
    E2E_ARTIFACT_DIR: artifactRoot };
  await run(`migration-${label}`, 'dist/database/run-migrations.js', env);
  return env;
}
try {
  const security = await database('p0');
  await run('migration-repeat', 'dist/database/run-migrations.js', security);
  await run('legacy-upgrade', 'scripts/test-legacy-migration.mjs', security);
  await run('p0-security-restore', 'scripts/e2e-p0-delivery.mjs', security);
  const core = await database('core');
  await run('single-authoritative', 'scripts/e2e-authoritative-battle.mjs', core);
  await run('registration', 'scripts/e2e-registration.mjs', core);
  const rewards = await database('rewards');
  await run('rewards-fixture-regression', 'scripts/e2e-rewards.mjs',
    { ...rewards, E2E_API_BASE: 'http://127.0.0.1:4180/api', E2E_SECOND_API_BASE: 'http://127.0.0.1:4181/api' });
  const rooms = await database('rooms');
  await run('multiplayer-api', 'scripts/e2e-multiplayer-room.mjs', rooms);
  await run('multiplayer-presence-browser', 'scripts/e2e-multiplayer-room-browser.mjs',
    { ...rooms, E2E_API_BASE: 'http://127.0.0.1:4197/api', E2E_WEB_BASE: 'http://127.0.0.1:3019' });
  await run('multiplayer-final-ten', 'scripts/e2e-multiplayer-delivery.mjs',
    { ...rooms, E2E_ROUNDS: '10', E2E_API_BASE: 'http://127.0.0.1:4197/api', E2E_WEB_BASE: 'http://127.0.0.1:3019' });
  report.verified = true;
} catch (error) {
  report.failure = error.stack || String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(artifactRoot, 'core-regression.json'), JSON.stringify(report, null, 2));
  await admin.end();
}
