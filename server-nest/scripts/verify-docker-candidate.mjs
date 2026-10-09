import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve('..');
const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
const commit = git(['rev-parse', 'HEAD']);
assert.equal(git(['status', '--porcelain']), '', 'use a clean candidate checkout, not the user working tree');
assert(!process.env.E2E_CANDIDATE_COMMIT || process.env.E2E_CANDIDATE_COMMIT === commit, 'candidate commit mismatch');
const artifacts = await mkdtemp(join(tmpdir(), 'gamer-docker-gate-'));
const report = { commit, startedAt: new Date().toISOString(), verified: false, suites: [] };
const targets = [['prod', 'docker-compose.prod.yml'], ['public-api', 'docker-compose.public-api.yml']];
report.suites = targets.map(([label, filename]) => ({
  label, filename, build: 'NOT VERIFIED', start: 'NOT VERIFIED', migration: 'NOT VERIFIED',
  readiness: 'NOT VERIFIED', worker: 'NOT VERIFIED', content: 'NOT VERIFIED', smoke: 'NOT VERIFIED',
  gateway: 'NOT VERIFIED (not started; TLS/WSS requires a separate proxy acceptance)',
}));
let logIndex = 0;
function command(executable, args, env = process.env) {
  const result = spawnSync(executable, args, { cwd: root, env, windowsHide: true, encoding: 'utf8',
    timeout: 1200000, maxBuffer: 20 * 1024 * 1024 });
  return { code: result.status, text: (result.stdout || '') + (result.stderr || ''), error: result.error?.message };
}
async function docker(args, env) {
  const result = command('docker', args, env);
  // Commands may contain generated secrets; save only output, not argv/config.
  await writeFile(join(artifacts, `${++logIndex}-docker.log`), result.text + (result.error || ''));
  assert.equal(result.code, 0, `Docker command failed; see ${artifacts}/${logIndex}-docker.log`);
  return result.text.trim();
}

try {
  await docker(['version']);
  await docker(['compose', 'version']);
  for (const suite of report.suites) {
    const { label, filename } = suite;
    const project = `gamer-rc-${label}-${randomUUID().slice(0, 8)}`;
    const database = `gamer_rewards_e2e_docker_${label.replace('-', '_')}`;
    const password = randomUUID().replaceAll('-', '');
    const env = { ...process.env, COMPOSE_PROJECT_NAME: project, POSTGRES_DB: database, POSTGRES_USER: 'rc_test',
      POSTGRES_PASSWORD: password, AUTH_TOKEN_SECRET: randomUUID() + randomUUID(),
      ADMIN_TOKEN: randomUUID() + randomUUID(), BACKUP_TOKEN: randomUUID() + randomUUID(),
      PUBLIC_WEB_ORIGINS: 'https://localhost', DOMAIN_NAME: 'localhost', API_DOMAIN_NAME: 'localhost',
      ACME_EMAIL: 'rc@example.invalid' };
    const apiEnv = { NODE_ENV: 'production', PORT: '4100',
      DATABASE_URL: `postgres://rc_test:${password}@postgres:5432/${database}`, REDIS_URL: 'redis://redis:6379',
      AUTH_TOKEN_SECRET: env.AUTH_TOKEN_SECRET, ADMIN_TOKEN: env.ADMIN_TOKEN, BACKUP_TOKEN: env.BACKUP_TOKEN,
      CONTENT_DIR: '/workspace/data/content', TYPEORM_SYNCHRONIZE: 'false', DB_SSL: 'false',
      CORS_ORIGIN: env.PUBLIC_WEB_ORIGINS,
      ALLOW_GUEST_LOGIN: 'false', RATE_LIMIT_MAX: '100000', RENDER_GIT_COMMIT: commit };
    const overlay = join(artifacts, `${label}.json`);
    await writeFile(overlay, JSON.stringify({ services: {
      schema: { environment: apiEnv },
      api: { environment: apiEnv, ports: ['127.0.0.1::4100'] },
    } }));
    const composeFile = join(root, 'deploy/production', filename);
    const args = ['compose', '-p', project, '-f', composeFile, '-f', overlay];
    const compose = tail => docker([...args, ...tail], env);
    const productionEnv = join(root, 'deploy/production/.env.production');
    let createdEnv = false;
    let started = false;
    try {
      if (label === 'prod') {
        await writeFile(productionEnv, '# Generated isolated gate environment; API values supplied by test overlay.\n', { flag: 'wx' });
        createdEnv = true;
      }
      // Do not save interpolated config, which contains synthetic credentials.
      await compose(['config', '--quiet']);
      const existing = await compose(['ps', '-aq']);
      assert.equal(existing, '', 'random test project unexpectedly already exists');
      await compose(['build', '--pull', 'schema', 'api', ...(label === 'prod' ? ['gateway'] : [])]);
      suite.build = 'PASS';
      started = true;
      await compose(['up', '-d', 'postgres', 'redis', 'schema', 'api']);
      suite.start = 'PASS';
      const container = await compose(['ps', '-q', 'api']);
      assert(container, 'API container missing');
      suite.image = await docker(['inspect', '--format', '{{.Image}}', container], env);
      const address = await compose(['port', 'api', '4100']);
      assert(/^127\.0\.0\.1:\d+$/.test(address), 'API port must be loopback-only');
      const api = `http://${address}/api`;
      const deadline = Date.now() + 180000;
      let ready;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`${api}/health/ready`, { signal: AbortSignal.timeout(5000) });
          if (response.ok) { ready = await response.json(); break; }
        } catch { /* Dependencies can still be starting. */ }
        await delay(1000);
      }
      assert(ready?.ok && ready.db === 'ok' && ready.redis === 'PONG' && ready.schemaReady, 'readiness did not pass');
      assert.equal(ready.deploymentCommit, commit);
      suite.health = ready;
      suite.readiness = 'PASS';
      await compose(['run', '--rm', 'schema']);
      suite.migration = 'PASS';
      // Inspect the image without Compose's content bind mount.
      await docker(['run', '--rm', '--entrypoint', 'sh', suite.image, '-ec',
        'test -f /app/dist/database/migrations/1788514000000-MultiplayerRoomEvents.js'], env);
      await docker(['run', '--rm', '--entrypoint', 'sh', suite.image, '-ec',
        'test -f /workspace/scripts/nest_battle_worker.py; test -f /workspace/data/content/characters.json; test -f /app/dist/main.js; test -f /app/dist/database/migrations/1788513000000-MultiplayerRoomPresence.js; python3 -c "import sys; sys.path.insert(0, \\"/workspace\\"); import src.combat.battle"; node -e "JSON.parse(require(\\"fs\\").readFileSync(\\"/workspace/data/content/characters.json\\",\\"utf8\\"))"'], env);
      suite.content = 'PASS';
      const smoke = command(process.execPath, ['server-nest/scripts/e2e-public-release.mjs'],
        { ...env, E2E_API_BASE: api, E2E_EXPECTED_COMMIT: commit });
      await writeFile(join(artifacts, `${label}-gameplay.log`), smoke.text + (smoke.error || ''));
      assert.equal(smoke.code, 0, 'container registration/login/gacha/battle/settlement smoke failed');
      suite.worker = 'PASS (real HTTP battle uses image Python worker)';
      suite.smoke = 'PASS';
    } catch (error) {
      suite.failure = String(error);
      process.exitCode = 1;
    } finally {
      if (started) {
        const logs = command('docker', [...args, 'logs', '--no-color', '--tail', '250'], env);
        await writeFile(join(artifacts, `${label}-containers.log`), logs.text);
        try {
          await compose(['down', '--volumes', '--remove-orphans']);
        } catch (error) {
          suite.cleanupFailure = String(error);
          process.exitCode = 1;
        }
      }
      if (createdEnv) await unlink(productionEnv);
      await unlink(overlay);
    }
  }
  report.verified = report.suites.every(suite => suite.smoke === 'PASS' && !suite.failure && !suite.cleanupFailure);
} catch (error) {
  report.failure = String(error);
  report.runner = 'BLOCKED';
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, artifacts }, null, 2));
}
