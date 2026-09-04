import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { IdempotencyService } from '../common/idempotency.service';
import { GameConfigsService } from '../configs/configs.service';
import { DailyGoalProgressEntity, InventoryItemEntity, PlayerEntity } from '../database/entities';
import { InventoryGrantItem, InventoryService } from '../inventory/inventory.service';

export interface DailyGoalReward {
  gold?: number;
  items?: InventoryGrantItem[];
}

export interface DailyGoalConfig {
  goalKey: string;
  title?: string;
  eventType: string;
  target: number;
  rewards?: DailyGoalReward;
}

export interface DailyGoalPayload {
  timezone?: string;
  goals?: DailyGoalConfig[];
}

@Injectable()
export class DailyGoalsService {
  constructor(
    private readonly configs: GameConfigsService,
    private readonly inventory: InventoryService,
    private readonly idempotency: IdempotencyService,
    @InjectRepository(DailyGoalProgressEntity) private readonly progress: Repository<DailyGoalProgressEntity>,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
  ) {}

  async list(playerId: string, dateKey = this.todayKey()) {
    await this.assertPlayer(playerId);
    const goals = await this.loadGoals();
    const rows = await this.progress.find({ where: { playerId, dateKey } });
    return {
      dateKey,
      goals: goals.map((goal) => {
        const row = rows.find((item) => item.goalKey === goal.goalKey);
        const progress = Math.min(Number(row?.progress || 0), Number(goal.target || 1));
        return {
          goalKey: goal.goalKey,
          title: goal.title || goal.goalKey,
          eventType: goal.eventType,
          target: Number(goal.target || 1),
          progress,
          complete: progress >= Number(goal.target || 1),
          claimed: Boolean(row?.claimed),
          rewards: goal.rewards || {},
          metadata: row?.metadata || {},
        };
      }),
    };
  }

  async recordEvent(
    playerId: string,
    eventType: string,
    amount = 1,
    metadata: Record<string, unknown> = {},
    manager: EntityManager = this.progress.manager,
  ) {
    if (!playerId || !eventType || amount <= 0) return [];
    const goals = (await this.loadGoals(manager)).filter((goal) => goal.eventType === eventType);
    if (goals.length === 0) return [];

    const dateKey = this.todayKey();
    const updated: DailyGoalProgressEntity[] = [];
    for (const goal of goals) {
      const target = Number(goal.target || 1);
      const eventMetadata = {
        lastEventType: eventType,
        lastMetadata: metadata,
        lastRecordedAt: new Date().toISOString(),
      };
      const rows = await manager.query(
        `INSERT INTO "daily_goal_progress"
          ("id", "playerId", "dateKey", "goalKey", "progress", "claimed", "metadata", "createdAt", "updatedAt")
         VALUES (uuid_generate_v4(), $1, $2, $3, LEAST($4::integer, $5::integer), false, $6::jsonb, now(), now())
         ON CONFLICT ("playerId", "dateKey", "goalKey") DO UPDATE
         SET "progress" = LEAST($4::integer, "daily_goal_progress"."progress" + $5::integer),
             "metadata" = "daily_goal_progress"."metadata" || EXCLUDED."metadata",
             "updatedAt" = now()
         RETURNING *`,
        [playerId, dateKey, goal.goalKey, target, amount, JSON.stringify(eventMetadata)],
      ) as DailyGoalProgressEntity[];
      updated.push(rows[0]);
    }
    return updated;
  }

  async claim(playerId: string, goalKey: string, dateKey = this.todayKey(), idempotencyKey?: string) {
    const goals = await this.loadGoals();
    const goal = goals.find((item) => item.goalKey === goalKey);
    if (!goal) throw new NotFoundException('daily goal not found');
    const key = idempotencyKey || `daily:${dateKey}:${goalKey}`;
    return this.idempotency.execute(playerId, 'daily-goal-claim', key, { goalKey, dateKey }, async ({ manager, player }) => {
      const row = await manager.findOne(DailyGoalProgressEntity, {
        where: { playerId, dateKey, goalKey },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row || row.progress < Number(goal.target || 1)) {
        throw new BadRequestException('daily goal is not complete');
      }
      if (row.claimed) throw new BadRequestException('daily goal reward already claimed');

      const reward = goal.rewards || {};
      let grantedItems: InventoryItemEntity[] = [];
      if (reward.items?.length) {
        grantedItems = await this.inventory.grant(playerId, reward.items, 'daily_goal', manager);
      }
      const gold = Math.max(0, Number(reward.gold || 0));
      if (gold > 0) {
        player.gold += gold;
        await manager.save(player);
      }

      row.claimed = true;
      row.metadata = { ...(row.metadata || {}), claimedAt: new Date().toISOString() };
      const saved = await manager.save(row);
      return { progress: saved, rewards: { gold, items: grantedItems } };
    });
  }

  private async loadGoals(manager?: EntityManager) {
    const config = await this.configs.getContentConfig('daily_goals', manager);
    const payload = config.payload as DailyGoalPayload | null;
    return payload?.goals?.length ? payload.goals : [];
  }

  private todayKey() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const value = (type: string) => parts.find((part) => part.type === type)?.value || '01';
    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  private async assertPlayer(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }
}
