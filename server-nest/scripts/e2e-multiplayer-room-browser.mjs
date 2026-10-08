import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import pg from 'pg';

const { chromium } = createRequire(import.meta.url)('playwright');
const databaseUrl = process.env.E2E_DATABASE_URL;
assert(databaseUrl && ['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname), 'isolated local database required');
assert(new URL(databaseUrl).pathname.slice(1).startsWith('gamer_rewards_e2e'), 'gamer_rewards_e2e database required');

const api = process.env.E2E_API_BASE || 'http://127.0.0.1:4196/api';
const web = process.env.E2E_WEB_BASE || 'http://127.0.0.1:3018';
const browserPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const server = spawn(process.execPath, ['dist/main.js'], {
  cwd: new URL('..', import.meta.url),
  windowsHide: true,
  stdio: 'pipe',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: new URL(api).port || '4197',
    DATABASE_URL: databaseUrl,
    DB_SSL: 'false',
    TYPEORM_SYNCHRONIZE: 'false',
    REDIS_URL: 'redis://127.0.0.1:6399',
    CONTENT_DIR: '../data/content',
    BACKUP_ENABLED: 'false',
    AUTH_TOKEN_SECRET: randomUUID() + randomUUID(),
    MULTIPLAYER_HEARTBEAT_INTERVAL_MS: '500',
    MULTIPLAYER_DISCONNECT_TIMEOUT_MS: '6500',
    MULTIPLAYER_RECONNECT_GRACE_MS: '15000',
  },
});
const webServer = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--strictPort', '--port', new URL(web).port || '3018'], {
  cwd: new URL('../../web', import.meta.url),
  windowsHide: true,
  stdio: 'pipe',
  env: process.env,
});
const db = new pg.Client({ connectionString: databaseUrl });
let output = '';
for (const pipe of [server.stdout, server.stderr, webServer.stdout, webServer.stderr]) {
  pipe.on('data', (chunk) => { output = (output + chunk.toString()).slice(-8000); });
}

async function request(path, body, token, expected = body === undefined ? 200 : 201) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}\n${output}`);
  return value;
}

async function register(label) {
  return request('/auth/register', {
    username: `b${label[0]}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 100)}`,
    password: `Browser-${randomUUID()}`,
  });
}

async function waitFor(url, predicate, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await delay(250);
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function seedSession(page, session) {
  await page.addInitScript(({ session, api }) => {
    window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: api };
    localStorage.setItem('gamer_online_current_session', JSON.stringify(session));
    localStorage.setItem('gamer_online_access_token', session.accessToken);
    localStorage.setItem('gamer_online_player_id', session.player.id);
  }, { session, api: api.replace(/\/api$/, '') });
}

try {
  await db.connect();
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) break;
    try {
      if ((await fetch(`${api}/health/live`)).ok && (await fetch(web)).ok) { ready = true; break; }
    } catch { /* wait for both processes */ }
    await delay(500);
  }
  assert(ready, `servers did not start: ${output}`);
  assert.equal(await import('node:fs/promises').then((fs) => fs.access(browserPath).then(() => true).catch(() => false)), true, `browser not found: ${browserPath}`);

  const leader = await register('leader');
  const teammate = await register('teammate');
  await request(`/friends-assist/${leader.player.id}/request`, { addresseePlayerId: teammate.player.id }, leader.accessToken);
  await request(`/friends-assist/${teammate.player.id}/accept`, { requesterPlayerId: leader.player.id }, teammate.accessToken);
  const room = await request('/multiplayer-rooms', { dungeonId: 'fire_type_squad_001' }, leader.accessToken);
  const invitation = await request(`/multiplayer-rooms/${room.room_id}/invite`, { inviteePlayerId: teammate.player.id }, leader.accessToken);
  await request(`/multiplayer-rooms/invitations/${invitation.invitation_id}/accept`, {}, teammate.accessToken);

  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  const leaderContext = await browser.newContext();
  const teammateContext = await browser.newContext();
  const leaderPage = await leaderContext.newPage();
  const teammatePage = await teammateContext.newPage();
  const browserErrors = [];
  for (const page of [leaderPage, teammatePage]) {
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) browserErrors.push(`${response.request().method()} ${response.status()} ${response.url()}`);
    });
  }
  await seedSession(leaderPage, leader);
  await seedSession(teammatePage, teammate);
  await Promise.all([
    leaderPage.goto(`${web}/#/dungeons/multiplayer`),
    teammatePage.goto(`${web}/#/dungeons/multiplayer`),
  ]);
  const leaderRow = (page) => page.locator(`.member-row[data-player-id="${leader.player.id}"]`);
  const teammateRow = (page) => page.locator(`.member-row[data-player-id="${teammate.player.id}"]`);
  await waitFor('initial room state', async () => (await teammateRow(teammatePage).count()) === 1 && (await leaderRow(teammatePage).innerText()).includes('在线'), 30_000).catch(async (error) => {
    throw new Error(`${error.message}\npage=${await teammatePage.locator('body').innerText()}\nerrors=${browserErrors.join(' | ')}`);
  });
  assert.match(await leaderRow(teammatePage).innerText(), /房主/);

  await leaderContext.close();
  await waitFor('leader disconnect', async () => {
    const text = await leaderRow(teammatePage).innerText();
    return text.includes('已断线') && text.includes('后移出') && !text.includes('正在加载');
  });
  const disconnectedText = await leaderRow(teammatePage).innerText();
  assert.match(disconnectedText, /已断线/);
  assert.match(disconnectedText, /后移出/);
  assert.match(await teammateRow(teammatePage).innerText(), /房主/);

  const recoveredContext = await browser.newContext();
  const recoveredPage = await recoveredContext.newPage();
  await seedSession(recoveredPage, leader);
  await recoveredPage.goto(`${web}/#/dungeons/multiplayer`);
  await waitFor('leader reconnect', async () => (await leaderRow(recoveredPage).innerText()).includes('在线'));
  await waitFor('teammate observes reconnect', async () => {
    const text = await leaderRow(teammatePage).innerText();
    return text.includes('在线') && !text.includes('已断线');
  }).catch(async (error) => {
    throw new Error(`${error.message}\nteammate=${await leaderRow(teammatePage).innerText()}\nrecovered=${await leaderRow(recoveredPage).innerText()}`);
  });
  assert.match(await teammateRow(teammatePage).innerText(), /房主/);

  await recoveredContext.close();
  await teammateContext.close();
  await browser.close();
  console.log(JSON.stringify({
    ok: true,
    checks: [
      'two independent browser contexts loaded the same room',
      'leader browser disconnect showed reconnect countdown',
      'remaining browser observed automatic leader transfer',
      'leader reconnected inside grace period',
      'remaining browser observed recovered online status',
    ],
  }, null, 2));
} finally {
  await db.end().catch(() => undefined);
  if (server.exitCode === null) { server.kill(); await once(server, 'exit').catch(() => undefined); }
  if (webServer.exitCode === null) { webServer.kill(); await once(webServer, 'exit').catch(() => undefined); }
}
