import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { GameConfigsService } from '../configs/configs.service';
import { IdempotencyService } from '../common/idempotency.service';
import { DailyGoalsService } from '../daily-goals/daily-goals.service';
import { IdleClaimEntity, IdleSessionEntity, InventoryItemEntity, PlayerCharacterEntity, PlayerEntity } from '../database/entities';
import { InventoryGrantItem, InventoryService } from '../inventory/inventory.service';

interface IdleStageConfig {
  stageId: string;
  name?: string;
  maxClaimSeconds?: number;
  minClaimSeconds?: number;
  rewardsPerHour?: InventoryGrantItem[];
  goldPerHour?: number;
  requiredPower?: number;
  teamPowerDivisor?: number;
  maxTeamBonus?: number;
}

@Injectable()
export class IdleService {
  constructor(
    private readonly configs: GameConfigsService,
    private readonly inventory: InventoryService,
    private readonly dailyGoals: DailyGoalsService,
    private readonly idempotency: IdempotencyService,
    @InjectRepository(IdleSessionEntity) private readonly sessions: Repository<IdleSessionEntity>,
    @InjectRepository(IdleClaimEntity) private readonly claims: Repository<IdleClaimEntity>,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    @InjectRepository(PlayerCharacterEntity) private readonly characters: Repository<PlayerCharacterEntity>,
  ) {}

  async start(playerId: string, stageId: string, characterIds: string[]) {
    const player = await this.assertPlayer(playerId);
    const stage = await this.getStage(stageId);
    if (!characterIds.length) throw new BadRequestException('characterIds are required');
    const owned = await this.characters.find({ where: { id: In(characterIds), playerId } });
    if (owned.length !== characterIds.length) {
      throw new BadRequestException('all idle characters must belong to player');
    }
    const teamPower = this.calculateTeamPower(owned);
    if (stage.requiredPower && teamPower < stage.requiredPower) {
      throw new BadRequestException(`idle stage requires team power ${stage.requiredPower}`);
    }
    const rewardMultiplier = this.calculateRewardMultiplier(teamPower, stage);

    const active = await this.sessions.findOne({ where: { playerId, status: 'active' } });
    if (active) {
      active.status = 'stopped';
      active.metadata = { ...(active.metadata || {}), stoppedBy: 'new_idle_session', stoppedAt: new Date().toISOString() };
      await this.sessions.save(active);
    }

    const now = new Date();
    const session = await this.sessions.save(this.sessions.create({
      playerId: player.id,
      stageId: stage.stageId,
      characterIds,
      status: 'active',
      startedAt: now,
      lastClaimedAt: now,
      metadata: {
        stageName: stage.name || stage.stageId,
        teamPower,
        rewardMultiplier,
      },
    }));
    return { session, preview: this.previewForSession(session, stage, now) };
  }

  async status(playerId: string) {
    await this.assertPlayer(playerId);
    const session = await this.sessions.findOne({ where: { playerId, status: 'active' }, order: { createdAt: 'DESC' } });
    if (!session) return { session: null, preview: null };
    const stage = await this.getStage(session.stageId);
    return { session, preview: this.previewForSession(session, stage, new Date()) };
  }

  async claim(playerId: string, idempotencyKey?: string) {
    return this.idempotency.execute(playerId, 'idle-claim', idempotencyKey, { playerId }, async ({ manager, player }) => {
      const session = await manager.findOne(IdleSessionEntity, {
        where: { playerId, status: 'active' },
        order: { createdAt: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) throw new NotFoundException('active idle session not found');
      const stage = await this.getStage(session.stageId, manager);
      const now = new Date();
      const preview = this.previewForSession(session, stage, now);
      const minClaimSeconds = Number(stage.minClaimSeconds ?? 60);
      if (preview.cappedSeconds < minClaimSeconds) {
        throw new BadRequestException(`idle rewards require at least ${minClaimSeconds} seconds`);
      }

      let grantedItems: InventoryItemEntity[] = [];
      if (preview.rewards.length > 0) {
        grantedItems = await this.inventory.grant(playerId, preview.rewards, 'idle_claim', manager);
      }
      if (preview.gold > 0) {
        player.gold += preview.gold;
        await manager.save(player);
      }

      session.lastClaimedAt = now;
      await manager.save(session);
      const claim = await manager.save(manager.create(IdleClaimEntity, {
        playerId,
        sessionId: session.id,
        stageId: session.stageId,
        elapsedSeconds: preview.elapsedSeconds,
        cappedSeconds: preview.cappedSeconds,
        rewards: preview.rewards,
        goldGranted: preview.gold,
      }));
      await this.dailyGoals.recordEvent(playerId, 'idle_claim', 1, { sessionId: session.id, claimId: claim.id }, manager);

      return { claim, session, rewards: grantedItems, gold: preview.gold };
    });
  }

  async stop(playerId: string) {
    await this.assertPlayer(playerId);
    const session = await this.sessions.findOne({ where: { playerId, status: 'active' }, order: { createdAt: 'DESC' } });
    if (!session) return { stopped: false };
    session.status = 'stopped';
    session.metadata = { ...(session.metadata || {}), stoppedAt: new Date().toISOString() };
    return { stopped: true, session: await this.sessions.save(session) };
  }

  async history(playerId: string) {
    await this.assertPlayer(playerId);
    return this.claims.find({ where: { playerId }, order: { createdAt: 'DESC' }, take: 100 });
  }

  private previewForSession(session: IdleSessionEntity, stage: IdleStageConfig, now: Date) {
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - session.lastClaimedAt.getTime()) / 1000));
    const maxClaimSeconds = Number(stage.maxClaimSeconds ?? 8 * 3600);
    const cappedSeconds = Math.min(elapsedSeconds, maxClaimSeconds);
    const rewardMultiplier = Number(session.metadata?.rewardMultiplier || 1);
    const rewards = (stage.rewardsPerHour || [])
      .map((reward) => ({
        ...reward,
        quantity: Math.floor((Number(reward.quantity) * rewardMultiplier * cappedSeconds) / 3600),
        payload: {
          ...(reward.payload || {}),
          stageId: stage.stageId,
          idleSeconds: cappedSeconds,
          rewardMultiplier,
        },
      }))
      .filter((reward) => reward.quantity > 0);
    const gold = Math.floor((Number(stage.goldPerHour || 0) * rewardMultiplier * cappedSeconds) / 3600);
    return { elapsedSeconds, cappedSeconds, rewards, gold, maxClaimSeconds, rewardMultiplier };
  }

  private calculateTeamPower(characters: PlayerCharacterEntity[]) {
    return characters.reduce((sum, character) => {
      const level = Number(character.level || 1);
      const exp = Number(character.exp || 0);
      return sum + level * 100 + Math.floor(exp / 100);
    }, 0);
  }

  private calculateRewardMultiplier(teamPower: number, stage: IdleStageConfig) {
    const divisor = Math.max(1, Number(stage.teamPowerDivisor || 10000));
    const bonus = Math.min(Number(stage.maxTeamBonus ?? 0.5), teamPower / divisor);
    return Number((1 + Math.max(0, bonus)).toFixed(4));
  }

  private async getStage(stageId: string, manager?: EntityManager): Promise<IdleStageConfig> {
    const config = await this.configs.getContentConfig('idle_stages', manager);
    const payload = config.payload as { stages?: IdleStageConfig[] } | null;
    const stage = payload?.stages?.find((item) => item.stageId === stageId);
    if (stage) return stage;
    if (stageId === 'default_idle_stage') {
      return {
        stageId,
        name: 'Default Idle Stage',
        minClaimSeconds: 60,
        maxClaimSeconds: 8 * 3600,
        goldPerHour: 120,
        rewardsPerHour: [{ itemConfigId: 'idle_training_crystal', itemType: 'material', quantity: 60 }],
      };
    }
    throw new NotFoundException('idle stage not found');
  }

  private async assertPlayer(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }
}
