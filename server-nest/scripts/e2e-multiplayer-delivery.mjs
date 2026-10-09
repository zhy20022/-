import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { chromium } = createRequire(import.meta.url)('playwright');
const databaseUrl = process.env.E2E_DATABASE_URL;
assert(databaseUrl && ['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname), 'isolated local database required');
assert(new URL(databaseUrl).pathname.slice(1).startsWith('gamer_rewards_e2e'), 'test database name required');
const api = process.env.E2E_API_BASE || 'http://127.0.0.1:4196/api';
const web = process.env.E2E_WEB_BASE || 'http://127.0.0.1:3018';
const rounds = Number(process.env.E2E_ROUNDS || 10);
assert(Number.isInteger(rounds) && rounds >= 2 && rounds <= 20);
const artifactDir = resolve(process.env.E2E_ARTIFACT_DIR || process.env.TEMP, 'gamer-multiplayer-delivery');
const report = { verified: false, rounds: [], checks: [], errors: [], api, web, startedAt: new Date().toISOString() };
const processes = [];
const db = new pg.Client({ connectionString: databaseUrl });
let browser;
const pages = [];
const memberRequests = [];
const realtimeFrames = [];
const frontendRealtimeDisabled = process.env.E2E_ROOM_REALTIME === 'false';
const realtimeDisabled = frontendRealtimeDisabled || process.env.E2E_SERVER_REALTIME === 'false';
let openedSockets = 0;
let output = '';
function run(args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: 'pipe' });
  processes.push(child);
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', data => { output = (output + data).slice(-12000); });
  return child;
}
async function request(path, body, session, expected = body === undefined ? 200 : 201, key) {
  const response = await fetch(api + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}\n${output}`);
  return value;
}
async function waitFor(label, predicate, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(200);
  }
  throw new Error(`timeout: ${label}\n${output}`);
}
async function snapshot(playerId, dungeonId) {
  const player = (await db.query('SELECT gold, flags FROM players WHERE id=$1', [playerId])).rows[0];
  const items = (await db.query('SELECT "itemConfigId", quantity FROM inventory_items WHERE "playerId"=$1 AND "itemType"=$2 ORDER BY "itemConfigId"',
    [playerId, 'material'])).rows;
  const chars = (await db.query('SELECT id, "playerId", level, exp, "skillSlots", equipment FROM player_characters WHERE "playerId"=$1 ORDER BY id', [playerId])).rows;
  const progress = (await db.query('SELECT * FROM dungeon_progress WHERE "playerId"=$1 AND "dungeonId"=$2', [playerId, dungeonId])).rows[0];
  return { gold: Number(player.gold), flags: player.flags, items: Object.fromEntries(items.map(row => [row.itemConfigId, Number(row.quantity)])),
    chars, attempts: Number(progress?.totalAttempts || 0), successes: Number(progress?.successfulAttempts || 0) };
}
async function prepareAccount(label, definitions) {
  const username = `dl_${label.slice(0, 3)}_${Date.now().toString(36)}`;
  const password = randomUUID();
  const session = await request('/auth/register', { username, password });
  const ids = [];
  for (const [config, profession] of definitions) {
    const id = randomUUID();
    // Initial owned-character fixtures only. No writes after gameplay begins.
    await db.query(`INSERT INTO player_characters
      (id,"playerId","characterConfigId","attributeType","professionType",level,exp,"skillSlots",equipment)
      VALUES ($1,$2,$3,'FIRE',$4,100,0,'{}','{}')`, [id, session.player.id, config, profession]);
    ids.push(id);
  }
  return { ...session, username, password, ids };
}
async function makePage(account, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript(({ apiBase, roomRealtime }) => {
    window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase, roomRealtime };
  }, { apiBase: api, roomRealtime: !frontendRealtimeDisabled });
  const page = await context.newPage();
  pages.push(page);
  page.on('websocket', socket => {
    if (!socket.url().includes('/socket.io/')) return;
    openedSockets++;
    socket.on('framereceived', frame => {
      if (typeof frame.payload === 'string') realtimeFrames.push({ playerId: account.player.id, payload: frame.payload });
    });
  });
  page.on('request', request => {
    if (request.method() === 'POST' && /\/(member|heartbeat)$/.test(request.url())) {
      memberRequests.push({ at: new Date().toISOString(), url: request.url(), body: request.postData() });
    }
  });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) console.log(`HTTP ${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => console.log(`NETWORK ${request.url()} ${request.failure()?.errorText}`));
  await page.goto(`${web}/#/login`);
  await page.locator('input[type=text]').fill(account.username);
  await page.locator('input[type=password]').fill(account.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(url => !url.hash.includes('/login'));
  // The guide is a separate verified flow; dismiss it, without altering game state.
  const skip = page.getByRole('button', { name: /跳过/ });
  if (await skip.count()) await skip.first().click();
  await page.goto(`${web}/#/dungeons/multiplayer`);
  await page.getByRole('button', { name: '创建房间', exact: true }).waitFor();
  return { context, page };
}
async function postClick(page, suffix, action) {
  const response = page.waitForResponse(row => row.url().endsWith(suffix) && row.request().method() === 'POST' && row.status() === 201);
  await action();
  return (await response).json();
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  await mkdir(artifactDir, { recursive: true });
  await db.connect();
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl, DB_SSL: 'false',
    TYPEORM_SYNCHRONIZE: 'false', CONTENT_DIR: '../data/content', BACKUP_ENABLED: 'false',
    AUTH_TOKEN_SECRET: randomUUID() + randomUUID(), REDIS_URL: 'redis://127.0.0.1:6399',
    RATE_LIMIT_MAX: '100000', MULTIPLAYER_HEARTBEAT_INTERVAL_MS: '500',
    ROOM_REALTIME_ENABLED: realtimeDisabled ? 'false' : 'true',
    MULTIPLAYER_DISCONNECT_TIMEOUT_MS: '9000', MULTIPLAYER_RECONNECT_GRACE_MS: '30000' };
  const migration = run(['dist/database/run-migrations.js'], new URL('..', import.meta.url), env);
  const [migrationCode] = await once(migration, 'exit');
  assert.equal(migrationCode, 0, output);
  run(['dist/main.js'], new URL('..', import.meta.url), { ...env, PORT: new URL(api).port });
  run(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--strictPort', '--port', new URL(web).port], new URL('../../web', import.meta.url),
    { ...process.env, VITE_FORMAL_ONLINE: 'true', VITE_STATIC_DEMO: 'false', VITE_ONLINE_API_URL: api });
  await waitFor('servers', async () => {
    try { return (await fetch(api + '/health/live')).ok && (await fetch(web)).ok; } catch { return false; }
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const leader = await prepareAccount('a', [
    ['char_033_fire_physical_tank', 'PHYSICAL_TANK'], ['char_035_fire_physical_melee_dps', 'PHYSICAL_MELEE_DPS'],
    ['char_039_fire_healer', 'HEALER'],
  ]);
  const teammate = await prepareAccount('b', [
    ['char_040_fire_support', 'SUPPORT'], ['char_038_fire_magic_ranged_dps', 'MAGIC_RANGED_DPS'],
  ]);
  const outsider = await prepareAccount('outsider', []);
  const outsiderBefore = await snapshot(outsider.player.id, 'fire_type_squad_001');
  await request(`/friends-assist/${leader.player.id}/request`, { addresseePlayerId: teammate.player.id }, leader);
  await request(`/friends-assist/${teammate.player.id}/accept`, { requesterPlayerId: leader.player.id }, teammate);
  let a = await makePage(leader, 1280);
  const b = await makePage(teammate, 390);
  const dungeonId = 'fire_type_squad_001';
  for (let round = 1; round <= rounds; round++) {
    await Promise.all([a.page.goto(`${web}/#/dungeons/multiplayer`), b.page.goto(`${web}/#/dungeons/multiplayer`)]);
    await a.page.getByRole('button', { name: '创建房间', exact: true }).waitFor();
    await waitFor('dungeon loaded', async () => (await a.page.locator(`option[value="${dungeonId}"]`).count()) > 0)
      .catch(async error => { throw new Error(`${error.message}\n${await a.page.locator('body').innerText()}`); });
    await a.page.locator('.setup-panel select').first().selectOption(dungeonId);
    const room = await postClick(a.page, '/multiplayer-rooms', () => a.page.getByRole('button', { name: '创建房间', exact: true }).click());
    await a.page.locator('.room-form-row select').selectOption(teammate.player.id);
    await postClick(a.page, '/invite', () => a.page.getByRole('button', { name: '邀请', exact: true }).click());
    await b.page.getByRole('button', { name: '接受邀请', exact: true }).waitFor();
    await postClick(b.page, '/accept', () => b.page.getByRole('button', { name: '接受邀请', exact: true }).click());
    if (!realtimeDisabled && round === 1) {
      await waitFor('both authenticated room subscriptions', () =>
        [leader, teammate].every(account => realtimeFrames.some(frame =>
          frame.playerId === account.player.id && frame.payload.includes(room.room_id) &&
          /"mode":"(snapshot|events)"/.test(frame.payload))));
      // Disable room HTTP reads briefly: peer state MUST now arrive via the socket.
      await a.page.route('**/api/multiplayer-rooms/current', route => route.abort());
      await b.page.route('**/api/multiplayer-rooms/current', route => route.abort());
      await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: teammate.ids, isReady: true }, teammate);
      await waitFor('peer ready via real socket without HTTP current', async () =>
        (await a.page.locator(`[data-player-id="${teammate.player.id}"] em`).innerText()).includes('已准备'));
      await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: teammate.ids, isReady: false }, teammate);
      await waitFor('peer unready via real socket', async () =>
        (await a.page.locator(`[data-player-id="${teammate.player.id}"] em`).innerText()).includes('未准备'));
      await a.page.unroute('**/api/multiplayer-rooms/current');
      await b.page.unroute('**/api/multiplayer-rooms/current');
      report.checks.push('two independent browser socket subscriptions and peer ready/unready with HTTP current blocked');
    }
    for (const [page, count] of [[a.page, 3], [b.page, 2]]) {
      await page.getByRole('button', { name: '准备', exact: true }).waitFor();
      await page.locator('.character-room-grid button').first().waitFor();
      for (let i = 0; i < count; i++) {
        await page.locator('.character-room-grid button').nth(i).click();
        await waitFor(`round ${round} selected ${i + 1}/${count}`, async () =>
          await page.locator('.character-room-grid button.selected').count() === i + 1);
      }
    }
    if (round === 1) {
      await request(`/multiplayer-rooms/${room.room_id}/start`, {}, leader, 400);
      await request(`/multiplayer-rooms/${room.room_id}/start`, {}, teammate, 409);
      await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: [leader.ids[0], leader.ids[0]], isReady: true }, leader, 400);
      await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: teammate.ids, isReady: true }, leader, 400);
      await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: leader.ids.slice(0, 2), isReady: true }, leader);
      await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: teammate.ids, isReady: true }, teammate);
      await request(`/multiplayer-rooms/${room.room_id}/start`, {}, leader, 400);
      await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: leader.ids.slice(0, 2), isReady: false }, leader);
      await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: teammate.ids, isReady: false }, teammate);
      report.checks.push('unready/nonleader/insufficient/duplicate/cross-account rejected');
      // Wait for polling to observe the negative-case cleanup.
      await waitFor('reset ready flags', async () => (await a.page.getByRole('button', { name: '准备', exact: true }).count()) === 1 &&
        (await b.page.getByRole('button', { name: '准备', exact: true }).count()) === 1);
    }
    if (round === 2) {
      const frameCount = realtimeFrames.length;
      await a.context.setOffline(true);
      await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: teammate.ids, isReady: true }, teammate);
      await delay(2500);
      await a.context.setOffline(false);
      if (!realtimeDisabled) {
        await waitFor('browser socket replay after offline gap', () => realtimeFrames.slice(frameCount).some(frame =>
          frame.playerId === leader.player.id && frame.payload.includes(room.room_id) &&
          /"mode":"(events|snapshot)"/.test(frame.payload)));
        report.checks.push('real browser offline/reconnect authorized event replay or snapshot');
      }
      await request(`/multiplayer-rooms/${room.room_id}/member`, { characterIds: teammate.ids, isReady: false }, teammate);
      await a.page.reload();
      await a.page.getByRole('button', { name: '准备', exact: true }).waitFor();
      for (let i = 0; i < 3; i++) await a.page.locator('.character-room-grid button').nth(i).click();
      report.checks.push('waiting leader offline/reload/recovered');
    }
    for (const [page, account, count] of [[a.page, leader, 3], [b.page, teammate, 2]]) {
      assert.equal(await page.locator('.character-room-grid button.selected').count(), count);
      const readyRoom = await postClick(page, '/member', () => page.getByRole('button', { name: '准备', exact: true }).click());
      const member = readyRoom.members.find(row => row.player_id === account.player.id);
      assert.equal(member.character_ids.length, count, 'ready request must preserve UI selection');
      assert.equal(member.is_ready, true);
    }
    const startButton = a.page.getByRole('button', { name: '房主开战', exact: true });
    await waitFor('3+2 ready UI start enabled', () => startButton.isEnabled());
    assert.match(await a.page.locator('.dungeon-summary').innerText(), /角色 5\/5/);
    assert.equal(await a.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await b.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (round <= 2) {
      await a.page.screenshot({ path: resolve(artifactDir, `ready-${round}-desktop.png`), fullPage: true });
      await b.page.screenshot({ path: resolve(artifactDir, `ready-${round}-mobile.png`), fullPage: true });
    }
    const before = await Promise.all([snapshot(leader.player.id, dungeonId), snapshot(teammate.player.id, dungeonId)]);
    const settlements = [[], []];
    const listeners = [a.page, b.page].map((page, index) => {
      const listener = response => {
        if (response.url().endsWith(`/${room.room_id}/settle`) && response.status() === 201) {
          settlements[index].push(response.json());
        }
      };
      page.on('response', listener);
      return listener;
    });
    const started = await postClick(a.page, '/start', () => startButton.click({ clickCount: 2 }));
    await Promise.all([a.page.waitForURL(/#\/battle/), b.page.waitForURL(/#\/battle/)]);
    const tickets = (await db.query(`SELECT "playerId", response FROM operation_requests
      WHERE operation='battle-start' AND "idempotencyKey"=$1 ORDER BY "playerId"`, [started.battle_seed])).rows;
    assert.equal(tickets.length, 2);
    assert.deepEqual(tickets[0].response.serverBattle, tickets[1].response.serverBattle);
    assert.equal(tickets[0].response.serverTime, tickets[1].response.serverTime);
    assert.deepEqual(tickets[0].response.characterOwners, tickets[1].response.characterOwners);
    assert.deepEqual(started.character_ids, [...leader.ids, ...teammate.ids]);
    if (round === 1) {
      const replays = await Promise.all([
        request(`/multiplayer-rooms/${room.room_id}/start`, {}, leader, 201, randomUUID()),
        request(`/multiplayer-rooms/${room.room_id}/start`, {}, leader, 201, randomUUID()),
      ]);
      assert(replays.every(row => row.battle_seed === started.battle_seed));
      report.checks.push('double UI click and concurrent start replay one seed');
    }
    if (round === 2) {
      await b.context.setOffline(true);
      await delay(3000);
      await b.context.setOffline(false);
      await b.page.reload();
      await b.page.waitForURL(/#\/battle/);
      report.checks.push('battle offline/reload/recovered same entry');
    }
    await waitFor('both natural UI settlements', async () => settlements.every(rows => rows.length > 0), 90000);
    const results = await Promise.all(settlements.map(rows => rows[0]));
    const repeats = await Promise.all([leader, leader, teammate, teammate].map(session =>
      request(`/multiplayer-rooms/${room.room_id}/settle`, {}, session)));
    assert.equal(repeats[0].record.id, results[0].record.id);
    assert.equal(repeats[1].record.id, results[0].record.id);
    assert.equal(repeats[2].record.id, results[1].record.id);
    assert.equal(repeats[3].record.id, results[1].record.id);
    const after = await Promise.all([snapshot(leader.player.id, dungeonId), snapshot(teammate.player.id, dungeonId)]);
    const trusted = tickets[0].response.serverBattle;
    for (const [index, session] of [leader, teammate].entries()) {
      const result = results[index];
      assert.equal(result.record.playerId, session.player.id);
      assert.equal(result.record.success, trusted.success);
      assert.equal(result.record.duration, trusted.duration);
      assert.equal(result.record.damageScore, trusted.damageScore);
      assert.equal(after[index].attempts - before[index].attempts, 1);
      assert.equal(after[index].successes - before[index].successes, trusted.success ? 1 : 0);
      assert.equal(after[index].gold - before[index].gold, trusted.success ? 100 : 0);
      const expectedItems = { ...before[index].items };
      for (const item of result.record.rewards.granted) expectedItems[item.itemConfigId] = (expectedItems[item.itemConfigId] || 0) + item.quantity;
      assert.deepEqual(after[index].items, expectedItems);
      assert.deepEqual(after[index].chars, before[index].chars, 'boss reward must not change owned characters or equipment');
      assert.equal(after[index].flags.activeBattleSeed, null);
      const count = (await db.query(`SELECT count(*)::int count FROM battle_records
        WHERE "playerId"=$1 AND "resultPayload"->>'serverBattleSeed'=$2`, [session.player.id, started.battle_seed])).rows[0].count;
      assert.equal(count, 1);
      assert.equal(await request('/multiplayer-rooms/current', undefined, session), null);
    }
    const storedRoom = (await db.query('SELECT * FROM multiplayer_rooms WHERE id=$1', [room.room_id])).rows[0];
    assert.equal(storedRoom.status, 'finished');
    await request(`/multiplayer-rooms/${room.room_id}/leave`, {}, leader);
    await request(`/multiplayer-rooms/${room.room_id}/leave`, {}, teammate);
    for (const [index, page] of [a.page, b.page].entries()) {
      page.off('response', listeners[index]);
      const back = page.getByRole('button', { name: '立即返回', exact: true });
      if (await back.count()) await back.click();
      await page.waitForURL(/#\/dungeons$/);
    }
    await a.page.goto(`${web}/#/dungeons/multiplayer`);
    await a.page.reload();
    await a.page.getByRole('button', { name: '创建房间', exact: true }).waitFor();
    report.rounds.push({ round, roomId: room.room_id, battleSeed: started.battle_seed,
      accounts: [leader.player.id, teammate.player.id], selections: [3, 2],
      owners: tickets[0].response.characterOwners, snapshotHash: digest(trusted), serverTime: tickets[0].response.serverTime,
      outcome: { success: trusted.success, duration: trusted.duration, damage: trusted.damageScore },
      recordIds: results.map(row => row.record.id), rewards: results.map(row => row.record.rewards),
      goldDeltas: after.map((row, index) => row.gold - before[index].gold), status: storedRoom.status, reconciled: true });
    console.log(JSON.stringify(report.rounds.at(-1)));
    if (round === 2) console.log('PASS: 2 real UI smoke rounds');
  }
  assert.deepEqual(await snapshot(outsider.player.id, dungeonId), outsiderBefore, 'unrelated player must remain untouched');
  const orphan = (await db.query(`SELECT count(*)::int count FROM multiplayer_rooms
    WHERE "leaderPlayerId"::text=ANY($1::text[]) AND status IN ('starting','in_battle')`, [[leader.player.id, teammate.player.id]])).rows[0].count;
  assert.equal(orphan, 0);
  assert.deepEqual(report.errors, []);
  report.checks.push('finished reload/recreate/rejoin', 'concurrent duplicate settlement once per player',
    'SQL rewards/gold/progress/experience/ownership reconciled', 'outsider unchanged and no orphan rooms');
  report.verified = true;
  report.realtimeDisabled = realtimeDisabled;
  report.frontendRealtimeDisabled = frontendRealtimeDisabled;
  report.openedSockets = openedSockets;
  report.realtimeFrameCount = realtimeFrames.length;
  if (!realtimeDisabled) {
    assert(realtimeFrames.some(frame => frame.payload.includes('"battle.started"')), 'real browser battle-start event required');
  } else {
    assert(!realtimeFrames.some(frame => /"room\.(event|sync)"/.test(frame.payload)), 'no authorized realtime state when disabled');
    if (!frontendRealtimeDisabled) assert(openedSockets > 0, 'fallback must exercise attempted but rejected socket connections');
  }
  console.log(`PASS: ${rounds} continuous real UI rounds with PostgreSQL reconciliation`);
} catch (error) {
  report.failure = error.stack || String(error);
  report.memberRequests = memberRequests;
  report.pageText = [];
  for (const [index, page] of pages.entries()) {
    if (page.isClosed()) continue;
    report.pageText.push(await page.locator('body').innerText().catch(() => 'unavailable'));
    await page.screenshot({ path: resolve(artifactDir, `failure-${index}.png`), fullPage: true }).catch(() => undefined);
  }
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(artifactDir, 'result.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  await db.end().catch(() => undefined);
  for (const child of processes.reverse()) {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit').catch(() => undefined);
    }
  }
  console.log(`Evidence: ${resolve(artifactDir, 'result.json')}`);
}
