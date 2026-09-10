import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { IdempotencyService } from '../common/idempotency.service';
import { BattleRecordEntity, DungeonProgressEntity, InventoryItemEntity, PlayerCharacterEntity, PlayerEntity, OperationRequestEntity } from '../database/entities';
import { BattleSimulationService, ServerBattle } from '../battle-settlement/battle-simulation.service';

export interface OnlineDungeon {
  dungeonId: string;
  name: string;
  dungeonType: 'SINGLE' | 'SQUAD' | 'TEAM' | 'SERVER_BOSS';
  attributeType: string;
  difficulty: 'normal' | 'hard' | 'nightmare';
  duration: number;
  sweepUnlockCount: number;
  rewardConfig: {
    type: 'experience' | 'boss';
    fullExp: number;
    gold: number;
    spawnStartTime: number;
    spawnInterval: number;
    spawnWaveCount: number;
    allowedMonsterTypes: Array<'SINGLE' | 'GROUP_5'>;
    characterExpPerSingleKill: number;
    characterExpPerFiveGroupKills: number;
  };
}

const ATTRIBUTE_DEFS = [
  ['fire', 'FIRE', '火系经验本'],
  ['wood', 'WOOD', '木系经验本'],
  ['wind', 'WIND', '风系经验本'],
  ['water', 'WATER', '水系经验本'],
  ['earth', 'EARTH', '土系经验本'],
  ['lightning', 'THUNDER', '雷系经验本'],
  ['holy', 'LIGHT', '光系经验本'],
  ['shadow', 'DARK', '暗系经验本'],
] as const;

const DIFFICULTIES = [
  ['normal', '', 531, 100],
  ['hard', '_hard', 1381, 250],
  ['nightmare', '_nightmare', 2960, 600],
] as const;

@Injectable()
export class DungeonsService {
  private readonly dungeons = this.buildDungeons();

  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly simulation: BattleSimulationService,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    @InjectRepository(PlayerCharacterEntity) private readonly characters: Repository<PlayerCharacterEntity>,
  ) {}

  list() {
    return {
      dungeons: this.dungeons,
      version: 1,
    };
  }

  get(dungeonId: string) {
    const dungeon = this.dungeons.find((item) => item.dungeonId === dungeonId);
    if (!dungeon) throw new NotFoundException('dungeon not found');
    return dungeon;
  }

  getOptional(dungeonId: string) {
    return this.dungeons.find((item) => item.dungeonId === dungeonId) || null;
  }

  assertCanEnter(dungeonId: string, characters: PlayerCharacterEntity[]) {
    const dungeon = this.get(dungeonId);
    const expected = { SINGLE: 1, SQUAD: 5, TEAM: 20, SERVER_BOSS: 20 }[dungeon.dungeonType];
    if (characters.length !== expected) {
      throw new BadRequestException(`dungeon requires exactly ${expected} characters`);
    }
    const character = characters[0];
    if (dungeon.dungeonType === 'SINGLE' && character && this.normalizeAttribute(character.attributeType) !== dungeon.attributeType) {
      throw new BadRequestException(`${dungeon.name} can only be entered by ${dungeon.attributeType} characters`);
    }
    return dungeon;
  }

  calculateExperienceRewards(
    dungeon: OnlineDungeon,
    duration: number,
    singleMonstersKilled = 0,
    groupMonstersKilled = 0,
  ) {
    const cappedDuration = Math.max(0, Math.min(Number(duration || 0), dungeon.duration));
    const thresholdRatio = cappedDuration >= 60 ? 1 : cappedDuration >= 45 ? 0.65 : cappedDuration >= 30 ? 0.4 : cappedDuration >= 15 ? 0.15 : 0;
    const maxWaves = Math.min(
      dungeon.rewardConfig.spawnWaveCount,
      Math.max(0, Math.floor(cappedDuration / dungeon.rewardConfig.spawnInterval) + 1),
    );
    const cappedSingleKills = Math.min(Math.max(0, Math.floor(singleMonstersKilled || 0)), maxWaves);
    const cappedGroupKills = Math.min(Math.max(0, Math.floor(groupMonstersKilled || 0)), (maxWaves - cappedSingleKills) * 5);
    const directCharacterExp =
      cappedSingleKills * dungeon.rewardConfig.characterExpPerSingleKill +
      Math.floor(cappedGroupKills / 5) * dungeon.rewardConfig.characterExpPerFiveGroupKills;

    return {
      success: cappedDuration >= dungeon.duration,
      expCrystals: Math.floor(dungeon.rewardConfig.fullExp * thresholdRatio),
      gold: cappedDuration >= dungeon.duration ? dungeon.rewardConfig.gold : 0,
      directCharacterExp,
      cappedDuration,
      thresholdRatio,
      cappedSingleKills,
      cappedGroupKills,
      maxWaves,
    };
  }

  async start(playerId: string, dungeonId: string, characterIds: string[], idempotencyKey?: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    if (!characterIds?.length || characterIds.length > 20 || new Set(characterIds).size !== characterIds.length) throw new BadRequestException('provide 1-20 unique characterIds');
    const battleSeed = idempotencyKey || randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(battleSeed)) throw new BadRequestException('battle start Idempotency-Key must be a UUID');
    const ticket = await this.idempotency.execute(playerId, 'battle-start', battleSeed, { dungeonId, characterIds }, async ({ manager, player }) => {
      const owned = await manager.find(PlayerCharacterEntity, { where: { playerId, id: In(characterIds) }, lock: { mode: 'pessimistic_write' } });
      if (owned.length !== characterIds.length) throw new BadRequestException('all characters must belong to player');
      const characters = characterIds.map((id) => owned.find((character) => character.id === id)!);
      const dungeon = this.assertCanEnter(dungeonId, characters);
      const snapshots = characters.map((character) => ({ ...character, attributeType: this.normalizeAttribute(character.attributeType) }));
      const serverBattle = await this.simulation.simulate({ seed: battleSeed, dungeon, characters: snapshots });
      player.flags = { ...player.flags, activeBattleSeed: battleSeed };
      await manager.save(player);
      return {
        battleSeed,
        playerId,
        characterIds,
        dungeon,
        serverBattle,
        engineVersion: serverBattle.engineVersion,
        characters: characters.map((character) => ({
          id: character.id,
          level: character.level,
          attributeType: character.attributeType,
          skillSlots: character.skillSlots,
          equipment: character.equipment,
          equipmentSkillEffects: this.equipmentSkillEffects(character.equipment),
        })),
        serverTime: new Date().toISOString(),
      };
    });
    // Persist the result with the ticket, but do not disclose future outcomes at start.
    const publicTicket: Record<string, unknown> = { ...ticket };
    delete publicTicket.serverBattle;
    return publicTicket;
  }

  async battleStatus(playerId: string, battleSeed: string) {
    const started = await this.players.manager.findOne(OperationRequestEntity, { where: { playerId, operation: 'battle-start', idempotencyKey: battleSeed } });
    const ticket = started?.response;
    const result = ticket?.serverBattle as ServerBattle | undefined;
    if (!result) throw new NotFoundException('server battle not found');
    const elapsed = Math.max(0, (Date.now() - Date.parse(String(ticket!.serverTime))) / 1000 * 4);
    const visible = Math.min(elapsed, result.duration);
    const frame = result.frames.filter((item) => item.time <= visible).at(-1) || result.frames[0];
    const ids = new Set(frame.units.map((row) => (row as unknown[])[0]));
    const rows = new Map(frame.units.map((row) => [(row as unknown[])[0], row as unknown[]]));
    return { battleSeed, engineVersion: result.engineVersion, speed: 4, ready: elapsed >= result.duration,
      frame, units: Object.fromEntries(Object.entries(result.units).filter(([id]) => ids.has(id)).map(([id, metadata]) =>
        [id, { ...(metadata as Record<string, unknown>), name: rows.get(id)?.[5], maxHealth: rows.get(id)?.[6], currentSkillCycle: rows.get(id)?.[7] }])),
      events: result.events.filter((event) => event.time <= visible),
      outcome: elapsed >= result.duration ? { success: result.success, duration: result.duration, damageScore: result.damageScore } : null };
  }

  async sweep(playerId: string, dungeonId: string, characterId: string, count: number, idempotencyKey?: string) {
    const dungeon = this.get(dungeonId);
    if (dungeon.dungeonType !== 'SINGLE') throw new BadRequestException('boss sweep is not enabled');
    const sweepCount = Math.max(1, Math.min(10, Math.floor(count || 1)));
    return this.idempotency.execute(playerId, 'dungeon-sweep', idempotencyKey, { dungeonId, characterId, count: sweepCount }, async ({ manager, player }) => {
      const character = await manager.findOne(PlayerCharacterEntity, {
        where: { id: characterId, playerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!character) throw new NotFoundException('character not found');
      this.assertCanEnter(dungeonId, [character]);
      let progress = await manager.findOne(DungeonProgressEntity, { where: { playerId, dungeonId }, lock: { mode: 'pessimistic_write' } });
      if (!progress || progress.successfulAttempts < dungeon.sweepUnlockCount) {
        throw new BadRequestException({ message: 'sweep is not unlocked', requiredClears: dungeon.sweepUnlockCount, currentClears: progress?.successfulAttempts || 0 });
      }
      const expCrystals = dungeon.rewardConfig.fullExp * sweepCount;
      const gold = dungeon.rewardConfig.gold * sweepCount;
      let expItem = await manager.findOne(InventoryItemEntity, { where: { playerId, itemConfigId: 'character_exp_crystal', itemType: 'material' }, lock: { mode: 'pessimistic_write' } });
      if (!expItem) {
        expItem = manager.create(InventoryItemEntity, { playerId, itemConfigId: 'character_exp_crystal', itemType: 'material', quantity: 0, payload: { materialType: 'CHARACTER_EXP', name: 'Universal Character Experience Crystal', source: 'experience_dungeon_sweep' } });
      }
      const before = expItem.quantity;
      expItem.quantity = Math.min(999_999_999, before + expCrystals);
      expItem.payload = { ...expItem.payload, lastSource: 'experience_dungeon_sweep' };
      await manager.save(expItem);
      player.gold += gold;
      await manager.save(player);
      progress.totalAttempts += sweepCount;
      progress.successfulAttempts += sweepCount;
      progress.bestRecord = { ...(progress.bestRecord || {}), lastSweepAt: new Date().toISOString(), lastSweepCount: sweepCount };
      progress = await manager.save(progress);
      const record = await manager.save(manager.create(BattleRecordEntity, {
        playerId,
        dungeonId,
        success: true,
        duration: 0,
        damageScore: 0,
        characterIds: [characterId],
        rewards: { gold, expCrystals: expItem.quantity - before },
        resultPayload: { mode: 'sweep', count: sweepCount },
      }));
      return {
        success: true,
        message: 'sweep completed',
        sweepCount,
        rewards: { gold, expCrystals: expItem.quantity - before, requestedExpCrystals: expCrystals, capped: expItem.quantity - before < expCrystals },
        materialsAwarded: [{ itemConfigId: 'character_exp_crystal', name: 'Experience Crystal', count: expItem.quantity - before }],
        player,
        progress,
        recordId: record.id,
      };
    });
  }

  private equipmentSkillEffects(equipment: Record<string, unknown>) {
    const effects: unknown[] = [];
    const seen = new Set<string>();
    const add = (effect: unknown) => {
      if (!effect || typeof effect !== 'object') return;
      const key = String((effect as Record<string, unknown>).id || JSON.stringify(effect));
      if (seen.has(key)) return;
      seen.add(key);
      effects.push(effect);
    };
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const payload = value as Record<string, unknown>;
      add(payload.specialSkill);
      add(payload.special_skill);
      Object.values(payload).forEach(visit);
    };
    visit(equipment);
    return effects;
  }

  private normalizeAttribute(value: string) {
    const normalized = String(value || '').toUpperCase();
    if (normalized === 'LIGHTNING') return 'THUNDER';
    if (normalized === 'HOLY') return 'LIGHT';
    if (normalized === 'SHADOW') return 'DARK';
    return normalized;
  }

  private buildDungeons(): OnlineDungeon[] {
    const experience = ATTRIBUTE_DEFS.flatMap(([idPrefix, attributeType, name]) => (
      DIFFICULTIES.map(([difficulty, suffix, fullExp, gold]) => ({
        dungeonId: `${idPrefix}_type_single_001${suffix}`,
        name: difficulty === 'normal' ? name : `${name}-${difficulty}`,
        dungeonType: 'SINGLE' as const,
        attributeType,
        difficulty,
        duration: 60,
        sweepUnlockCount: 50,
        rewardConfig: {
          type: 'experience' as const,
          fullExp,
          gold,
          spawnStartTime: 0,
          spawnInterval: 3,
          spawnWaveCount: 20,
          allowedMonsterTypes: ['SINGLE', 'GROUP_5'] as Array<'SINGLE' | 'GROUP_5'>,
          characterExpPerSingleKill: 1,
          characterExpPerFiveGroupKills: 1,
        },
      }))
    ));
    const bosses: OnlineDungeon[] = ATTRIBUTE_DEFS.flatMap(([prefix, attributeType, name]) =>
      (['SQUAD', 'TEAM', 'SERVER_BOSS'] as const).map((dungeonType) => ({
        dungeonId: `${prefix}_type_${dungeonType.toLowerCase()}_001`,
        name: `${name.replace('经验本', '')}-${{ SQUAD: '五人本', TEAM: '二十人本', SERVER_BOSS: '全服Boss挑战' }[dungeonType]}`,
        attributeType, dungeonType, difficulty: 'normal' as const,
        duration: dungeonType === 'TEAM' ? 240 : 180, sweepUnlockCount: 50,
        rewardConfig: { type: 'boss' as const, fullExp: 0, gold: 0, spawnStartTime: 0, spawnInterval: 3,
          spawnWaveCount: 0, allowedMonsterTypes: ['SINGLE', 'GROUP_5'], characterExpPerSingleKill: 0, characterExpPerFiveGroupKills: 0 },
      })));
    return [...experience, ...bosses];
  }
}
