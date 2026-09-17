import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
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
