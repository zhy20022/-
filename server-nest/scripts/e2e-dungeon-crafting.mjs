import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const databaseUrl = new URL(process.env.E2E_DATABASE_URL);
assert(['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) &&
  databaseUrl.pathname.startsWith('/gamer_rewards_e2e'), 'isolated local database required');
const port = process.env.E2E_PORT || '4197';
const db = new pg.Client({ connectionString: databaseUrl.href });
const server = spawn(process.execPath, ['dist/main.js'], {
  cwd: new URL('..', import.meta.url), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env, NODE_ENV: 'test', PORT: port, DATABASE_URL: databaseUrl.href, DB_SSL: 'false',
    TYPEORM_SYNCHRONIZE: 'false', BACKUP_ENABLED: 'false', CONTENT_DIR: '../data/content',
    REDIS_URL: 'redis://127.0.0.1:6399', AUTH_TOKEN_SECRET: randomUUID() + randomUUID(),
  },
});
const exited = once(server, 'exit');
let output = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', (data) => { output = (output + data).slice(-5000); });

async function request(path, body, token, status = body === undefined ? 200 : 201, key = randomUUID()) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': key }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const result = await response.json();
  assert.equal(response.status, status, `${path}: ${JSON.stringify(result).slice(0, 500)}`);
  return result;
}

try {
  await db.connect();
  let ready = false;
  let startupError;
  for (let i = 0; i < 60 && server.exitCode === null; i++) {
    try { await request('/health/live'); ready = true; break; } catch (error) { startupError = error; await delay(250); }
  }
  assert(ready, `${startupError?.stack}\n${startupError?.cause}\n${output.slice(-600)}`);

  const { player, accessToken: token } = await request('/auth/register', {
    username: `craft_${Date.now().toString(36)}`, password: `Craft-${randomUUID()}`,
  });
  const catalog = JSON.parse(readFileSync(new URL('../../data/content/characters.json', import.meta.url), 'utf8').replace(/^\uFEFF/, '')).characters;
  const roster = [];
  for (const number of [1, 7, 8, 3, 6, 17, 23, 24, 19, 22, 33, 39, 40, 35, 38, 49, 55, 56, 51, 54]) {
    const config = catalog.find((row) => row.number === number);
    const id = randomUUID();
    // Keep this reward test independent of ordinary roster balance and random Boss selection.
    const equipment = { head: { itemId: `test-${id}`, itemData: { stats: {
      hp_bonus: 1_000_000, attack_bonus: 200_000, defense_bonus: 200_000,
      magic_attack_bonus: 200_000, magic_defense_bonus: 200_000,
    } } } };
    await db.query(
      `INSERT INTO player_characters (id,"playerId","characterConfigId","attributeType","professionType",level,exp,"skillSlots",equipment)
       VALUES ($1,$2,$3,$4,$5,100,0,'{}',$6)`,
      [id, player.id, config.id, config.attributeType, config.professionType, equipment],
    );
    roster.push(id);
  }
  const workshop = `/workshop/${player.id}`;
  const preview = (craftingType, attributeType) => request(`${workshop}/crafting/preview`, { craftingType, attributeType }, token);
  const inventory = async () => new Map((await request(`/inventory/${player.id}`, undefined, token))
    .map((item) => [item.itemConfigId, item.quantity]));
  await db.query(`INSERT INTO inventory_items ("playerId","itemConfigId","itemType",quantity,payload)
    VALUES ($1,'generic_battle_material','material',100,'{"materialType":"EQUIPMENT_SET"}')`, [player.id]);
  assert.deepEqual((await preview('equipment', 'FIRE')).preview.costs[0],
    { materialType: 'EQUIPMENT_SET', attributeType: 'FIRE', required: 2, owned: 0, enough: false });
  assert.deepEqual((await preview('exclusive')).preview.costs[0],
    { materialType: 'EXCLUSIVE_ITEM', attributeType: null, required: 5, owned: 0, enough: false });

  async function clear(dungeonId, count, itemConfigId, materialType, attributeType) {
    const characterIds = roster.slice(0, count);
    const started = await request(`/dungeons/${player.id}/${dungeonId}/start`, { characterIds }, token);
    // Elapse playback time without changing any worker result.
    const { rows: [ticket] } = await db.query(`UPDATE operation_requests
      SET response = jsonb_set(response, '{serverTime}', to_jsonb($3::text))
      WHERE "playerId"=$1 AND "idempotencyKey"=$2 AND operation='battle-start'
      RETURNING response->'serverBattle' AS battle`,
    [player.id, started.battleSeed, new Date(Date.now() - 240_000).toISOString()]);
    assert(ticket.battle.success && ticket.battle.bossesKilled > 0, `${dungeonId} test roster must clear`);
    assert.equal(ticket.battle.bossesKilled, ticket.battle.bossesSpawned);
    const body = { playerId: player.id, dungeonId, characterIds, success: false, duration: 0,
      clientTrace: { battleSeed: started.battleSeed } };
    const before = (await inventory()).get(itemConfigId) || 0;
    const settled = await request('/battle-settlement', body, token);
    const quantity = ticket.battle.bossesKilled + 2;
    assert.equal(settled.outcome, 'success');
    assert.equal(settled.rewards.length, 1);
    assert.equal(settled.rewards[0].itemConfigId, itemConfigId);
    assert.equal(settled.rewards[0].payload.materialType, materialType);
    assert.equal(settled.rewards[0].payload.attributeType, attributeType);
    assert.equal(settled.record.rewards.granted[0].quantity, quantity);
    assert.equal((await request('/battle-settlement', body, token)).record.id, settled.record.id);
    assert.equal((await inventory()).get(itemConfigId), before + quantity);
    console.log(`${dungeonId}: ${count} characters cleared; ${itemConfigId} +${quantity}`);
    return quantity;
  }

  const fireDungeon = 'fire_type_squad_001';
  const teamDungeon = 'fire_type_team_001';
  const fire = await clear(fireDungeon, 5, 'equipment_material_fire', 'EQUIPMENT_SET', 'FIRE');
  const water = await clear('water_type_squad_001', 5, 'equipment_material_water', 'EQUIPMENT_SET', 'WATER');
  const exclusive = await clear(teamDungeon, 20, 'exclusive_material', 'EXCLUSIVE_ITEM', null);

  for (const [dungeonId, itemId, quantity] of [
    [fireDungeon, 'equipment_material_fire', fire], [teamDungeon, 'exclusive_material', exclusive],
  ]) {
    const path = `/dungeons/${player.id}/${dungeonId}/sweep`;
    const input = { characterId: roster[0], count: 2 };
    await request(path, input, token, 400);
    await db.query(`UPDATE dungeon_progress SET "bestRecord" = "bestRecord" || '{"soloClears":5,"flawlessCount":10}'
      WHERE "playerId"=$1 AND "dungeonId"=$2`, [player.id, dungeonId]);
    const sweep = await request(path, input, token);
    assert.equal(sweep.rewards.items[0].itemConfigId, itemId);
    assert.equal(sweep.materialsAwarded[0].count, quantity * 2);
    assert.equal((await inventory()).get(itemId), quantity * 3);
  }
  assert.equal((await preview('equipment', 'FIRE')).preview.costs[0].owned, fire * 3);
  assert.equal((await preview('equipment', 'WATER')).preview.costs[0].owned, water);
  assert.equal((await preview('equipment', 'WIND')).preview.canCraft, false);
  assert.equal((await preview('exclusive')).preview.costs[0].owned, exclusive * 3);

  const set = await request(`${workshop}/crafting/equipment`, { attributeType: 'FIRE', professionCategory: 'A', slot: 'HEAD' }, token);
  const weapon = await request(`${workshop}/crafting/exclusive`, { characterId: roster[0] }, token);
  assert.equal(set.item.payload.attributeType, 'FIRE');
  assert.equal(weapon.item.payload.characterId, roster[0]);
  assert(weapon.item.payload.specialSkill?.effect);
  const after = await inventory();
  assert.equal(after.get('equipment_material_fire'), fire * 3 - 2);
  assert.equal(after.get('equipment_material_water'), water);
  assert.equal(after.get('exclusive_material'), exclusive * 3 - 5);
  assert.equal(after.get('generic_battle_material'), 100);
  console.log('Dungeon settlement, sweep, attribute stacks and workshop debit passed.');
} finally {
  server.kill();
  await Promise.all([db.end(), exited]);
}
