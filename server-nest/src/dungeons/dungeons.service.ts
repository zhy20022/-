import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { BattleRecordEntity, DungeonProgressEntity, InventoryItemEntity, PlayerCharacterEntity, PlayerEntity } from '../database/entities';

export interface OnlineDungeon {
  dungeonId: string;
  name: string;
  dungeonType: 'SINGLE';
  attributeType: string;
  difficulty: 'normal' | 'hard' | 'nightmare';
  duration: number;
  sweepUnlockCount: number;
  rewardConfig: {
    type: 'experience';
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
    private readonly dataSource: DataSource,
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
    if (dungeon.dungeonType === 'SINGLE' && characters.length !== 1) {
      throw new BadRequestException('experience dungeon requires exactly one character');
    }
    const character = characters[0];
    if (character && this.normalizeAttribute(character.attributeType) !== dungeon.attributeType) {
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
    const cappedGroupKills = Math.min(Math.max(0, Math.floor(groupMonstersKilled || 0)), maxWaves * 5);
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

  async start(playerId: string, dungeonId: string, characterIds: string[]) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    if (!characterIds?.length) throw new BadRequestException('characterIds are required');
    const characters = await this.characters.find({ where: { playerId, id: In(characterIds) } });
    if (characters.length !== characterIds.length) throw new BadRequestException('all characters must belong to player');
    const dungeon = this.assertCanEnter(dungeonId, characters);
    return {
      battleSeed: `${playerId}:${dungeonId}:${Date.now()}`,
      dungeon,
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
  }

  async sweep(playerId: string, dungeonId: string, characterId: string, count: number) {
    const dungeon = this.get(dungeonId);
    const character = await this.characters.findOne({ where: { id: characterId, playerId } });
    if (!character) throw new NotFoundException('character not found');
    this.assertCanEnter(dungeonId, [character]);
    const sweepCount = Math.max(1, Math.min(10, Math.floor(count || 1)));
    return this.dataSource.transaction(async (manager) => {
      const player = await manager.findOne(PlayerEntity, { where: { id: playerId }, lock: { mode: 'pessimistic_write' } });
      if (!player) throw new NotFoundException('player not found');
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
    return ATTRIBUTE_DEFS.flatMap(([idPrefix, attributeType, name]) => (
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
  }
}
