import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { BattleSimulationService } = require('../dist/battle-settlement/battle-simulation.service.js');
const { ConfigService } = require('@nestjs/config');
const service = new BattleSimulationService(new ConfigService({ BATTLE_WORKER_ROOT: resolve('..') }));
const row = (i) => ({ id: `character-${i}`, characterConfigId: `character-${i}`, level: 100,
  attributeType: 'WIND', professionType: i % 5 === 1 ? 'HEALER' : 'PHYSICAL_MELEE_DPS', skillSlots: {}, equipment: {} });
for (const [dungeonType, count, duration] of [['SINGLE', 1, 60], ['SQUAD', 5, 180], ['TEAM', 20, 240], ['SERVER_BOSS', 20, 180]]) {
  const input = { seed: 'fixed-trusted-seed', dungeon: { dungeonId: `probe-${dungeonType}`, name: 'probe',
    attributeType: 'WIND', dungeonType, duration, difficulty: 'normal' }, characters: Array.from({ length: count }, (_, i) => row(i)) };
  const first = await service.simulate(input);
  const second = await service.simulate(input);
  assert.deepEqual(first, second, `${dungeonType} must be reproducible`);
  assert(first.duration <= duration);
  assert(first.frames.length <= 32);
  assert(Number.isSafeInteger(first.damageScore));
  assert(Object.values(first.units).some((unit) => unit.definition), 'must execute authored monsters');
  if (first.success) assert(first.frames.at(-1).units.every(([id, health]) => first.units[id].isPlayer || health <= 0), 'last scheduled enemies must actually be defeated');
  console.log(JSON.stringify({ dungeonType, duration: first.duration, success: first.success,
    frames: first.frames.length, bytes: Buffer.byteLength(JSON.stringify(first)), damage: first.damageScore }));
}
console.log('battle worker integration passed');
const authoredId = 'char_008_water_support';
const authored = await service.simulate({ seed: 'authored-healer-probe',
  dungeon: { dungeonId: 'probe-healer', name: 'probe', attributeType: 'WIND', dungeonType: 'SQUAD', duration: 180, difficulty: 'normal' },
  characters: [{ ...row(0), characterConfigId: authoredId, attributeType: 'WATER', professionType: 'SUPPORT',
    skillSlots: { skillSlots: { low: Array(5).fill(`${authoredId}:1`), mid: [`${authoredId}:2`, `${authoredId}:2`], high: [`${authoredId}:3`, `${authoredId}:3`] } },
  }, ...[1, 2, 3, 4].map(row)],
});
for (const slot of [1, 2, 3]) assert(authored.events.some(event => event.payload?.skill_id === `${authoredId}:${slot}`), `authored skill ${slot} must execute`);
assert(authored.frames.some(frame => frame.units.some(([id, , shield]) => id.startsWith('character-') && shield > 0)), 'authored shield must reach replay');
console.log('authored healer: configured ABC casts and shield replay passed');

const { DungeonsService } = require('../dist/dungeons/dungeons.service.js');
const dungeons = new DungeonsService(null, service, null, null).list().dungeons;
const balance = JSON.parse(readFileSync(resolve('../data/content/team-dungeon-balance.json'), 'utf8'));
for (const dungeon of dungeons.filter(d => ['SQUAD', 'TEAM'].includes(d.dungeonType))) {
  assert.equal(dungeon.duration, balance[dungeon.dungeonType].duration);
  assert.equal(dungeon.timeline.bossSpawnTime, 60);
  assert.equal(dungeon.timeline.bossEncounters, 1);
  assert(dungeon.timeline.bossSpawnTime < dungeon.duration);
}
const catalog = JSON.parse(readFileSync(resolve('../data/content/characters.json'), 'utf8').replace(/^\uFEFF/, '')).characters;
for (const [kind, size] of [['SQUAD', 5], ['TEAM', 20]]) {
  const roster = kind === 'SQUAD' ? [1, 7, 8, 3, 6] : [1, 7, 8, 3, 6, 17, 23, 24, 19, 22, 33, 39, 40, 35, 38, 49, 55, 56, 51, 54];
  const characters = roster.map((number, i) => {
    const config = catalog.find(c => c.number === number);
    return { ...row(i), characterConfigId: config.id, attributeType: config.attributeType, professionType: config.professionType };
  });
  assert.equal(new Set(characters.map(c => c.characterConfigId)).size, size);
  const dungeon = dungeons.find(d => d.dungeonType === kind && d.attributeType === 'WATER');
  const result = await service.simulate({ seed: 'team-schedule-regression', dungeon, characters });
  const bosses = Object.values(result.units).filter(u => !u.isPlayer && u.id.includes('_boss_'));
  assert(bosses.length >= 1 && bosses.length <= (kind === 'SQUAD' ? 1 : 4), 'only one encounter may spawn');
  assert(result.frames.every(f => f.time >= 60 || f.units.every(([id]) => !id.includes('_boss_'))));
  assert.equal(result.success, true, `${kind} reference team must clear`);
  console.log(JSON.stringify({ kind, distinctCharacters: size, duration: result.duration, bossUnits: bosses.length, success: result.success }));
}
console.log('formal team catalog and unique-character worker integration passed');
