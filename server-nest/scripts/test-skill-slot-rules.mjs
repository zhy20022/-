import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { skillSlotError } = require('../dist/players/skill-slot-rules.js');
const skills = ['A', 'B', 'C'].map(logic => ({ skillId: logic, logic }));
const valid = [
  { low: ['A','A','A','A','A'], mid: ['B','B','C'], high: ['C'] },
  { low: ['A','A','A','A','A'], mid: ['B','C'], high: ['B','C'] },
  { low: ['A','A','A','A'], mid: ['A','B','B','C'], high: ['C'] },
  { low: ['A','A','A','A'], mid: ['A','B','C'], high: ['B','C'] },
  { low: ['A','A','A'], mid: ['A','A','B'], high: ['C','C','C'] },
];
for (const slots of valid) assert.equal(skillSlotError(slots, skills), null);
for (const tier of ['low', 'mid', 'high']) {
  const slots = structuredClone(valid[0]);
  slots[tier][0] = 'unknown';
  assert.ok(skillSlotError(slots, skills));
}
for (const [tier, logic] of [['low','C'], ['high','A'], ['low','B']]) {
  const slots = structuredClone(valid[0]);
  slots[tier][0] = logic;
  assert.ok(skillSlotError(slots, skills));
}
assert.ok(skillSlotError({ low: ['A'], mid: ['B'], high: ['C'] }, skills));
console.log('skill slot rules: five layouts, duplicates, unknown IDs, tier and count limits passed');
const { PlayersService } = require('../dist/players/players.service.js');
const { GameConfigsService } = require('../dist/configs/configs.service.js');
const { ConfigService } = require('@nestjs/config');
const configId = 'char_008_water_support';
const character = { id: 'hero', playerId: 'player', characterConfigId: configId, attributeType: 'WATER',
  skillSlots: { skillSlots: { low: Array(5).fill('WATER_low_a_1'), mid: ['WATER_low_b_1','WATER_low_b_1'], high: ['WATER_mid_c_1','WATER_mid_c_1'] } }, equipment: {} };
const manager = {
  findOne: async entity => entity.name === 'PlayerEntity' ? { id: 'player' } : character,
  save: async row => row,
};
const service = new PlayersService({ manager: { transaction: fn => fn(manager) } },
  { findOne: async () => character }, {}, {}, new GameConfigsService(new ConfigService(), { findOne: async () => null }), {});
const loaded = await service.getSkills('player', 'hero');
assert.equal(loaded.unlockedSkills.length, 3);
assert.deepEqual(loaded.unlockedSkills.map(skill => skill.logic), ['A', 'B', 'C']);
assert.equal(loaded.isValid, true);
assert.equal(loaded.skillSlots.low[0], `${configId}:1`);
await service.configureSkills('player', 'hero', loaded.skillSlots);
assert.deepEqual((await service.getSkills('player', 'hero')).skillSlots, loaded.skillSlots);
const forged = structuredClone(loaded.skillSlots);
forged.low[0] = 'another_character:1';
await assert.rejects(service.configureSkills('player', 'hero', forged));
console.log('authored skill service: three skills, legacy migration, save/reload and foreign ID rejection passed (repository stubs)');
