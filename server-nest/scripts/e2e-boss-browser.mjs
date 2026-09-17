import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import pg from 'pg';
const { chromium } = createRequire(import.meta.url)('playwright');
const databaseUrl = process.env.E2E_DATABASE_URL;
assert(databaseUrl && ['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname), 'isolated local database required');
const api = 'http://127.0.0.1:4198/api';
const server = spawn(process.execPath, ['dist/main.js'], { windowsHide: true, stdio: 'pipe', env: {
  ...process.env, NODE_ENV: 'test', PORT: '4198', DATABASE_URL: databaseUrl, DB_SSL: 'false',
  TYPEORM_SYNCHRONIZE: 'true', REDIS_URL: 'redis://127.0.0.1:6399', CONTENT_DIR: '../data/content',
  BACKUP_ENABLED: 'false', AUTH_TOKEN_SECRET: randomUUID() + randomUUID(), RATE_LIMIT_MAX: '10000',
} });
let tail = '';
for (const pipe of [server.stdout, server.stderr]) pipe.on('data', data => { tail = (tail + data).slice(-2000); });
const db = new pg.Client({ connectionString: databaseUrl });
let browser;
async function request(url, body, token, key = randomUUID()) {
  const r = await fetch(api + url, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: token ? 'Bearer ' + token : '', 'Idempotency-Key': key },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const data = await r.json();
  assert(r.ok, url + ': ' + JSON.stringify(data));
  return data;
}
try {
  await db.connect();
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(api + '/dungeons')).ok) { up = true; break; } } catch {}
    await delay(500);
  }
  assert(up, tail);
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  const session = await request('/auth/register', { username: 'boss_' + Date.now(), password: randomUUID() });
  const roster = JSON.parse(readFileSync('../data/content/characters.json', 'utf8').replace(/^\uFEFF/, '')).characters;
  const party = [25, 31, 27, 28, 32].map(number => {
    const character = roster.find(row => Number(row.id.split('_')[1]) === number);
    assert(character, `missing authored character ${number}`);
    return character;
  });
  const ids = Array.from({ length: 20 }, () => randomUUID());
  for (const [i, id] of ids.entries()) {
    const character = party[i % party.length];
    await db.query('INSERT INTO player_characters (id,"playerId","characterConfigId","attributeType","professionType",level) VALUES ($1,$2,$3,$4,$5,100)',
      [id, session.player.id, character.id, character.attributeType, character.professionType]);
  }
  const catalog = await request('/dungeons');
  const bosses = catalog.dungeons.filter(row => row.dungeonType !== 'SINGLE');
  assert.equal(bosses.length, 24);
  for (const dungeon of bosses) {
    const characterIds = ids.slice(0, dungeon.dungeonType === 'SQUAD' ? 5 : 20);
    const start = await request('/dungeons/' + session.player.id + '/' + dungeon.dungeonId + '/start',
      { characterIds }, session.accessToken);
    const ticket = (await db.query('SELECT response FROM operation_requests WHERE "playerId"=$1 AND "idempotencyKey"=$2 AND operation=$3',
      [session.player.id, start.battleSeed, 'battle-start'])).rows[0].response;
    const trusted = ticket.serverBattle;
    const bossFrame = trusted.frames.find(frame => frame.units.some(row => row[9] && row[1] > 0));
    assert(bossFrame, 'no living boss snapshot: ' + dungeon.dungeonId);
    // Advance only the test clock. Never replace the engine result, HP, damage or rewards.
    const setClock = async time => db.query(
      'UPDATE operation_requests SET response=jsonb_set(response,\'{serverTime}\',to_jsonb($1::text)) WHERE "playerId"=$2 AND "idempotencyKey"=$3 AND operation=$4',
      [new Date(Date.now() - time * 250).toISOString(), session.player.id, start.battleSeed, 'battle-start']);
    for (const width of [1280, 390]) {
      await setClock(bossFrame.time);
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({ session, dungeon, characterIds, seed, api }) => {
        window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: api };
        localStorage.setItem('gamer_online_current_session', JSON.stringify(session));
        sessionStorage.setItem('gamer_battle_' + session.player.id, JSON.stringify({
          online_mode: true, player_id: session.player.id, dungeon_id: dungeon.dungeonId, dungeon,
          character_ids: characterIds, characters: characterIds.map(id => ({ character_id: id })), settlement_key: seed,
        }));
      }, { session, dungeon, characterIds, seed: start.battleSeed, api });
      const responsePromise = page.waitForResponse(r => r.url().includes('/battles/') && r.status() === 200);
      await page.goto('http://127.0.0.1:3017/#/battle');
      const status = await (await responsePromise).json();
      await page.waitForFunction(count => document.querySelectorAll('.player-units .unit-card').length === count, characterIds.length);
      const visibleEnemies = status.frame.units.filter(row => !status.units[row[0]].isPlayer && row[1] > 0);
      assert.equal(await page.locator('.enemy-unit-card').count(), visibleEnemies.length);
      for (const row of visibleEnemies) {
        assert(await page.locator('.enemy-units').innerText().then(text => text.includes(row[5])));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (dungeon.attributeType === 'WATER') {
        await page.locator('.enemy-units').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(process.env.TEMP, 'real-' + dungeon.dungeonType + '-' + width + '.png') });
      }
      await context.close();
      assert.equal(errors.length, 0, errors.join('\n'));
    }
    await setClock(trusted.duration + 1);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(({ session, dungeon, characterIds, seed, api }) => {
      window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: api };
      localStorage.setItem('gamer_online_current_session', JSON.stringify(session));
      sessionStorage.setItem('gamer_battle_' + session.player.id, JSON.stringify({
        online_mode: true, player_id: session.player.id, dungeon_id: dungeon.dungeonId, dungeon,
        character_ids: characterIds, characters: characterIds.map(id => ({ character_id: id })), settlement_key: seed,
      }));
    }, { session, dungeon, characterIds, seed: start.battleSeed, api });
    const settledResponse = page.waitForResponse(r => r.url().endsWith('/battle-settlement') && r.status() === 201);
    await page.goto('http://127.0.0.1:3017/#/battle');
    const settled = await (await settledResponse).json();
    assert.equal(settled.record.success, trusted.success);
    assert.equal(settled.record.duration, trusted.duration);
    assert.equal(settled.record.damageScore, trusted.damageScore);
    await page.waitForFunction(() => document.body.innerText.includes('战斗已结算'));
    assert.match(await page.locator('body').innerText(), trusted.success ? /结果:\s*通关/ : /结果:\s*失败/);
    const persisted = (await db.query('SELECT count(*) FROM battle_records WHERE id=$1', [settled.record.id])).rows[0].count;
    assert.equal(persisted, '1');
    await context.close();
    console.log(JSON.stringify({ dungeon: dungeon.dungeonId, viewports: [1280, 390], success: trusted.success,
      duration: trusted.duration, damage: trusted.damageScore, recordVerified: true }));
  }
  console.log('PASS: 24 real Boss challenges, 48 responsive battle views, 24 browser settlements matching PostgreSQL');
} finally {
  if (browser) await browser.close();
  await db.end();
  if (server.exitCode === null) { server.kill(); await once(server, 'exit'); }
}
