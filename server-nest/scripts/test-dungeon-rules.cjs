const assert = require('node:assert/strict')
const { test } = require('node:test')
const { sweepRequirement, sweepClearCount, bossMaterialCount, playbackTime } = require('../dist/dungeons/dungeon-rules')

test('sweep counts separate all single clears, solo squad clears and flawless raids', () => {
  const row = { successfulAttempts: 10, bestRecord: { soloClears: 4, flawlessCount: 9 } }
  assert.equal(sweepClearCount('SINGLE', row), 10)
  assert.equal(sweepRequirement('SINGLE'), 10)
  assert.equal(sweepClearCount('SQUAD', row), 4)
  assert.equal(sweepRequirement('SQUAD'), 5)
  assert.equal(sweepClearCount('TEAM', row), 9)
  assert.equal(sweepClearCount('SQUAD', { successfulAttempts: 50 }), 0)
})

test('boss rewards preserve partial kills and grant exactly two extra for a full clear', () => {
  assert.equal(bossMaterialCount(0, 4, false), 0)
  assert.equal(bossMaterialCount(2, 4, false), 2)
  assert.equal(bossMaterialCount(4, 4, true), 6)
  assert.equal(bossMaterialCount(1, 1, true), 3)
  assert.equal(bossMaterialCount(0, 0, true), 0)
})

test('room clock preserves elapsed time when unanimous consent changes speed', () => {
  const now = Date.parse('2026-11-10T08:00:00Z')
  const clock = { elapsed: 10, updatedAt: new Date(now - 10000).toISOString(), speed: 1 }
  assert.equal(playbackTime({ playback: clock }, now), 20)
  assert.equal(playbackTime({ playback: { elapsed: 20, updatedAt: new Date(now).toISOString(), speed: 4 } }, now + 10000), 60)
})

test('actual room voting requires all members, rejects outsiders, and duplicate votes do not count', async () => {
  const { MultiplayerRoomsService } = require('../dist/multiplayer-rooms/multiplayer-rooms.service')
  const members = [{ playerId: 'a' }, { playerId: 'b' }]
  const tickets = members.map(member => ({
    playerId: member.playerId,
    response: { playback: { elapsed: 0, updatedAt: new Date().toISOString(), speed: 1, agreedPlayerIds: [], totalPlayers: 2 } },
  }))
  const manager = {
    findOne: async () => ({ status: 'in_battle', battleSeed: 'test' }),
    find: async entity => entity.name === 'MultiplayerRoomMemberEntity' ? members : tickets,
    save: async row => row,
  }
  const repository = { manager: { transaction: async callback => callback(manager) } }
  const service = new MultiplayerRoomsService({}, repository, {}, {}, {}, {}, {}, {}, {})
  await assert.rejects(service.agreeSpeed('outsider', 'room'), /membership/)
  assert.deepEqual(await service.agreeSpeed('a', 'room'), { speed: 1, agreed: 1, total: 2 })
  assert.deepEqual(await service.agreeSpeed('a', 'room'), { speed: 1, agreed: 1, total: 2 })
  assert.deepEqual(await service.agreeSpeed('b', 'room'), { speed: 4, agreed: 2, total: 2 })
  assert.equal(tickets[0].response.playback.speed, 4)
  assert.deepEqual(tickets[0].response.playback, tickets[1].response.playback)
})
