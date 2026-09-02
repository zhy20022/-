import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PlayerCharacterEntity } from '../database/entities';

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
