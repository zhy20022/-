import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const apiBase = process.env.E2E_API_BASE || 'http://127.0.0.1:4100/api';
const databaseUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || 'postgres://gamer:gamer_dev_password@127.0.0.1:55432/gamer_online';
const shouldStartServer = process.env.E2E_START_SERVER !== 'false';
const adminToken = process.env.ADMIN_TOKEN || 'dev-admin-token';
let spawnedServer;

async function main() {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await ensureApi();
    const stamp = Date.now();
    const account = await postJson('/auth/register', { username: `workshop_${stamp}`, password: 'WorkshopE2E!123' });
    const playerId = account.player.id;
    const auth = authHeader(account.accessToken);
    const characterId = randomUUID();
    await db.query(
      `insert into player_characters
        (id, "playerId", "characterConfigId", "attributeType", "professionType", level, exp, "skillSlots", equipment, "createdAt", "updatedAt")
       values ($1, $2, 'char_033_fire_physical_tank', 'FIRE', 'PHYSICAL_TANK', 1, 0, '{}', '{}', now(), now())`,
      [characterId, playerId],
    );

    await postJson(`/inventory/${playerId}/grant`, {
      source: 'e2e_workshop',
      items: [{ itemConfigId: 'generic_battle_material', itemType: 'material', quantity: 100, payload: { materialType: 'EQUIPMENT_SET' } }],
    }, { 'x-admin-token': adminToken });

    const skills = await getJson(`/players/${playerId}/characters/${characterId}/skills`, auth);
    assert(skills.unlockedSkills.length >= 9, 'at least nine skills should be available at level one');
    assert(skills.skillSlots.low.length === 5 && skills.skillSlots.mid.length === 3 && skills.skillSlots.high.length === 1, 'default skill slots should be 5/3/1');
    const skillSave = await postJson(`/players/${playerId}/characters/${characterId}/skills`, { skillSlots: skills.skillSlots }, auth);
    assert(skillSave.success, 'skill configuration should save');

    const exclusivePreview = await postJson(`/workshop/${playerId}/crafting/preview`, { craftingType: 'exclusive' }, auth);
    assert(exclusivePreview.preview.canCraft, 'exclusive weapon preview should be affordable');
    const exclusive = await postJson(`/workshop/${playerId}/crafting/exclusive`, { characterId }, auth);
    assert(exclusive.item?.itemType === 'weapon', 'exclusive weapon should enter inventory');
    assert(exclusive.item.payload?.specialSkill?.damageMultiplier === 1.1, 'exclusive weapon should contain its battle skill effect');

    const equipmentPreview = await postJson(`/workshop/${playerId}/crafting/preview`, { craftingType: 'equipment', attributeType: 'FIRE' }, auth);
    assert(equipmentPreview.preview.canCraft, 'equipment preview should be affordable');
    const crafted = await postJson(`/workshop/${playerId}/crafting/equipment`, { attributeType: 'FIRE', professionCategory: 'A', slot: 'HEAD' }, auth);
    assert(crafted.item?.itemType === 'equipment', 'crafted equipment should enter inventory');

    await postJson(`/inventory/${playerId}/items/${exclusive.item.id}/lock`, {}, auth);
    const lockedInventory = await getJson(`/inventory/${playerId}`, auth);
    assert(lockedInventory.find((item) => item.id === exclusive.item.id)?.locked, 'inventory lock should persist');
    await postJson(`/inventory/${playerId}/items/${exclusive.item.id}/unlock`, {}, auth);

    await postJson(`/players/${playerId}/characters/${characterId}/equip`, { itemId: exclusive.item.id }, auth);
    await postJson(`/players/${playerId}/characters/${characterId}/equip`, { itemId: crafted.item.id }, auth);
    const equipmentOptions = await getJson(`/players/${playerId}/characters/${characterId}/equipment-options`, auth);
    assert(equipmentOptions.weapons.find((item) => item.id === exclusive.item.id)?.isCurrentCharacterEquipped, 'equipped weapon should be marked');
    assert(equipmentOptions.equipment.find((item) => item.id === crafted.item.id)?.isCurrentCharacterEquipped, 'equipped armor should be marked');

    const dungeonId = 'fire_type_single_001';
    const start = await postJson(`/dungeons/${playerId}/${dungeonId}/start`, { characterIds: [characterId] }, auth);
    assert(start.characters[0].equipmentSkillEffects.length === 1, 'battle loadout should expose exclusive weapon skill effects');

    const enhancePreview = await getJson(`/workshop/${playerId}/equipment/${crafted.item.id}/enhancement`, auth);
    assert(enhancePreview.preview.currentLevel === 0 && enhancePreview.preview.successRate === 1, 'level zero enhancement preview should be authoritative');
    const enhanced = await postJson(`/workshop/${playerId}/equipment/${crafted.item.id}/enhance`, {}, auth);
    assert(enhanced.success && enhanced.newLevel === 1, 'first enhancement should succeed and persist');
    const profile = await getJson(`/players/${playerId}/profile`, auth);
    assert(profile.characters[0].equipment.equipment_set.HEAD.level === 1, 'enhanced stats should synchronize to equipped character data');

    await db.query(
      `insert into dungeon_progress
        (id, "playerId", "dungeonId", "totalAttempts", "successfulAttempts", "failedAttempts", "bestDamageScore", "bestRecord", "createdAt", "updatedAt")
       values ($1, $2, $3, 50, 50, 0, 0, '{}', now(), now())
       on conflict ("playerId", "dungeonId") do update set "totalAttempts" = 50, "successfulAttempts" = 50, "updatedAt" = now()`,
      [randomUUID(), playerId, dungeonId],
    );
    const beforeSweep = await getJson(`/players/${playerId}/profile`, auth);
    const beforeCrystals = quantityOf(beforeSweep.inventory, 'character_exp_crystal');
    const beforeGold = beforeSweep.player.gold;
    const sweep = await postJson(`/dungeons/${playerId}/${dungeonId}/sweep`, { characterId, count: 2 }, auth);
    assert(sweep.rewards.expCrystals === 1062 && sweep.rewards.gold === 200, 'two normal sweeps should grant configured rewards');
    const afterSweep = await getJson(`/players/${playerId}/profile`, auth);
    assert(quantityOf(afterSweep.inventory, 'character_exp_crystal') === beforeCrystals + 1062, 'sweep crystals should persist');
    assert(afterSweep.player.gold === beforeGold + 200, 'sweep gold should persist');
    assert(sweep.progress.successfulAttempts === 52, 'sweep should update dungeon progress');

    await expectFailure(`/inventory/${playerId}/items/${crafted.item.id}/dismantle`, {}, auth, 'equipped item dismantle should fail');
    await postJson(`/players/${playerId}/characters/${characterId}/unequip`, { itemId: crafted.item.id, slot: 'HEAD' }, auth);
    const dismantlePreview = await getJson(`/inventory/${playerId}/items/${crafted.item.id}/dismantle-preview`, auth);
    assert(dismantlePreview.materials[0].quantity >= 2, 'dismantle preview should return materials');
    await postJson(`/inventory/${playerId}/items/${crafted.item.id}/dismantle`, {}, auth);
    const finalInventory = await getJson(`/inventory/${playerId}`, auth);
    assert(!finalInventory.some((item) => item.id === crafted.item.id), 'dismantled item should be removed');

    const other = await postJson('/auth/register', { username: `other_${stamp}`, password: 'WorkshopE2E!123' });
    await expectGetFailure(`/inventory/${playerId}`, authHeader(other.accessToken), 'another player token must not read inventory');

    console.log(JSON.stringify({
      ok: true,
      playerId,
      characterId,
      skillSlots: { low: 5, mid: 3, high: 1 },
      crafted: { exclusiveWeaponId: exclusive.item.id, equipmentId: crafted.item.id },
      battleEquipmentSkills: start.characters[0].equipmentSkillEffects.length,
      enhancementLevel: enhanced.newLevel,
      sweep: sweep.rewards,
      finalInventoryCount: finalInventory.length,
    }, null, 2));
  } finally {
    await db.end();
    if (spawnedServer) spawnedServer.kill();
  }
}

function quantityOf(items, itemConfigId) {
  return Number(items.find((item) => item.itemConfigId === itemConfigId)?.quantity || 0);
}

async function ensureApi() {
  if (await canReachHealth()) return;
  if (!shouldStartServer) throw new Error(`API is not reachable at ${apiBase}`);
  spawnedServer = spawn(process.execPath, ['dist/main.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: process.env.PORT || '4100', DATABASE_URL: databaseUrl, REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6380', ADMIN_TOKEN: adminToken, CONTENT_DIR: process.env.CONTENT_DIR || '../data/content' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawnedServer.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  spawnedServer.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await canReachHealth()) return;
    await delay(500);
  }
  throw new Error(`API did not become reachable at ${apiBase}`);
}

async function canReachHealth() {
  try { return (await fetch(`${apiBase}/health`)).ok; } catch { return false; }
}

async function getJson(path, headers = {}) { return requestJson(path, { method: 'GET', headers }); }
async function postJson(path, body, headers = {}) { return requestJson(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
async function requestJson(path, init) {
  const response = await fetch(`${apiBase}${path}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}
async function expectFailure(path, body, headers, message) {
  try { await postJson(path, body, headers); } catch { return; }
  throw new Error(message);
}
async function expectGetFailure(path, headers, message) {
  try { await getJson(path, headers); } catch { return; }
  throw new Error(message);
}
function authHeader(token) { return { authorization: `Bearer ${token}` }; }
function assert(condition, message) { if (!condition) throw new Error(message); }

main().catch((error) => {
  console.error(`[e2e-workshop-loop] ${error.stack || error.message}`);
  if (spawnedServer) spawnedServer.kill();
  process.exitCode = 1;
});
