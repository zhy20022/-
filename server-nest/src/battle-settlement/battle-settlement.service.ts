import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { applyCharacterExp } from '../common/leveling';
import { GameConfigsService } from '../configs/configs.service';
import { DailyGoalsService } from '../daily-goals/daily-goals.service';
import { BattleRecordEntity, DungeonProgressEntity, PlayerCharacterEntity, PlayerEntity } from '../database/entities';
import { DungeonsService } from '../dungeons/dungeons.service';
import { InventoryGrantItem, InventoryService } from '../inventory/inventory.service';
import { RankingService } from '../ranking/ranking.service';

export interface BattleSettlementInput {
  playerId: string;
  dungeonId: string;
  characterIds: string[];
  success: boolean;
  duration: number;
  damageScore?: number;
  singleMonstersKilled?: number;
  groupMonstersKilled?: number;
  rewards?: InventoryGrantItem[];
  clientTrace?: Record<string, unknown>;
}

@Injectable()
export class BattleSettlementService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly configs: GameConfigsService,
    private readonly dailyGoals: DailyGoalsService,
    private readonly ranking: RankingService,
    private readonly dungeons: DungeonsService,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    @InjectRepository(PlayerCharacterEntity) private readonly characters: Repository<PlayerCharacterEntity>,
    @InjectRepository(BattleRecordEntity) private readonly battles: Repository<BattleRecordEntity>,
    @InjectRepository(DungeonProgressEntity) private readonly progress: Repository<DungeonProgressEntity>,
  ) {}

  async settle(input: BattleSettlementInput) {
    const player = await this.players.findOne({ where: { id: input.playerId } });
    if (!player) throw new NotFoundException('player not found');
    if (!input.dungeonId || !input.characterIds?.length) {
      throw new BadRequestException('dungeonId and characterIds are required');
    }
    if (input.duration < 0) throw new BadRequestException('duration must be non-negative');

    const ownedCharacters = await this.characters.find({ where: { id: In(input.characterIds), playerId: input.playerId } });
    if (ownedCharacters.length !== input.characterIds.length) {
      throw new BadRequestException('all battle characters must belong to player');
    }

    const onlineDungeon = this.dungeons.getOptional(input.dungeonId);
    const experienceResult = onlineDungeon
      ? this.dungeons.calculateExperienceRewards(
        this.dungeons.assertCanEnter(input.dungeonId, ownedCharacters),
        input.duration,
        input.singleMonstersKilled,
        input.groupMonstersKilled,
      )
      : null;
    const effectiveInput = {
      ...input,
      success: experienceResult ? experienceResult.success : input.success,
      duration: experienceResult ? experienceResult.cappedDuration : input.duration,
    };

    const normalizedRewards = experienceResult
      ? this.buildExperienceRewards(experienceResult.expCrystals)
      : await this.normalizeRewards(input);
    const granted = normalizedRewards.length > 0
      ? await this.inventory.grant(input.playerId, normalizedRewards, 'battle_settlement')
      : [];
    let updatedCharacters: PlayerCharacterEntity[] = [];
    if (experienceResult) {
      if (experienceResult.gold > 0) {
        player.gold += experienceResult.gold;
        await this.players.save(player);
      }
      if (experienceResult.directCharacterExp > 0) {
        updatedCharacters = await this.applyDirectCharacterExp(ownedCharacters, experienceResult.directCharacterExp);
      }
    }
    const progress = await this.updateProgress(effectiveInput);
    const record = await this.battles.save(this.battles.create({
      playerId: input.playerId,
      dungeonId: input.dungeonId,
      success: effectiveInput.success,
      duration: effectiveInput.duration,
      damageScore: Number(input.damageScore || 0),
      characterIds: input.characterIds,
      rewards: { granted: normalizedRewards, gold: experienceResult?.gold || 0, directCharacterExp: experienceResult?.directCharacterExp || 0 },
      resultPayload: {
        clientTrace: input.clientTrace || {},
        serverRewards: experienceResult || null,
        progressId: progress.id,
      },
    }));
    if (effectiveInput.success) {
      await this.dailyGoals.recordEvent(input.playerId, 'battle_clear', 1, {
        battleRecordId: record.id,
        dungeonId: input.dungeonId,
      });
    }
    const damageScore = Number(input.damageScore || 0);
    if (damageScore > 0) {
      await this.ranking.recordServerScore(input.playerId, 'damage_weekly', damageScore, 'default', {
        battleRecordId: record.id,
        dungeonId: input.dungeonId,
      });
    }

    return {
      record,
      progress,
      rewards: granted,
      player,
      characters: updatedCharacters,
      serverRewards: experienceResult,
      outcome: effectiveInput.success ? 'success' : 'failed',
    };
  }

  async records(playerId: string) {
    await this.assertPlayer(playerId);
    return this.battles.find({ where: { playerId }, order: { createdAt: 'DESC' }, take: 100 });
  }

  async dungeonProgress(playerId: string) {
    await this.assertPlayer(playerId);
    return this.progress.find({ where: { playerId }, order: { updatedAt: 'DESC' }, take: 100 });
  }

  private async normalizeRewards(input: BattleSettlementInput): Promise<InventoryGrantItem[]> {
    const config = await this.configs.getContentConfig('reward_rules');
    const payload = config.payload as {
      battleSettlement?: {
        allowClientRewards?: boolean;
        defaultSuccessRewards?: InventoryGrantItem[];
        dungeons?: Array<{ dungeonId: string; successRewards?: InventoryGrantItem[]; failedRewards?: InventoryGrantItem[] }>;
      };
    } | null;
    const rules = payload?.battleSettlement;
    const dungeonRule = rules?.dungeons?.find((item) => item.dungeonId === input.dungeonId);
    const configuredRewards = input.success ? dungeonRule?.successRewards : dungeonRule?.failedRewards;
    if (configuredRewards?.length) {
      return configuredRewards.filter((item) => item.quantity > 0);
    }
    if (rules?.allowClientRewards && input.rewards?.length) {
      return input.rewards.filter((item) => item.quantity > 0);
    }
    if (!input.success) return [];
    return rules?.defaultSuccessRewards?.length ? rules.defaultSuccessRewards : [{
      itemConfigId: 'generic_battle_material',
      itemType: 'material',
      quantity: 1,
      payload: { category: 'battle_settlement_default' },
    }];
  }

  private async updateProgress(input: BattleSettlementInput) {
    let row = await this.progress.findOne({ where: { playerId: input.playerId, dungeonId: input.dungeonId } });
    if (!row) {
      row = this.progress.create({
        playerId: input.playerId,
        dungeonId: input.dungeonId,
        totalAttempts: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        bestDamageScore: 0,
        bestRecord: {},
      });
    }
    row.totalAttempts += 1;
    if (input.success) row.successfulAttempts += 1;
    else row.failedAttempts += 1;
    const score = Number(input.damageScore || 0);
    if (score > row.bestDamageScore) row.bestDamageScore = score;
    if (input.success && (row.bestDuration == null || input.duration < row.bestDuration)) {
      row.bestDuration = input.duration;
      row.bestRecord = {
        duration: input.duration,
        damageScore: score,
        characterIds: input.characterIds,
        settledAt: new Date().toISOString(),
      };
    }
    return this.progress.save(row);
  }

  private buildExperienceRewards(expCrystals: number): InventoryGrantItem[] {
    if (expCrystals <= 0) return [];
    return [{
      itemConfigId: 'character_exp_crystal',
      itemType: 'material',
      quantity: Math.min(999_999_999, Math.floor(expCrystals)),
      payload: {
        materialType: 'CHARACTER_EXP',
        name: '通用角色经验结晶',
        source: 'experience_dungeon',
      },
    }];
  }

  private async applyDirectCharacterExp(characters: PlayerCharacterEntity[], amount: number) {
    const updated: PlayerCharacterEntity[] = [];
    for (const character of characters) {
      const growth = applyCharacterExp(character.level, character.exp, amount);
      character.level = growth.afterLevel;
      character.exp = growth.afterExp;
      character.skillSlots = { ...(character.skillSlots || {}), lastBattleGrowth: growth };
      updated.push(await this.characters.save(character));
    }
    return updated;
  }

  private async assertPlayer(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }
}
