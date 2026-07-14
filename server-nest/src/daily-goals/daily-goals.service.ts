import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async recordEvent(playerId: string, eventType: string, amount = 1, metadata: Record<string, unknown> = {}) {
    if (!playerId || !eventType || amount <= 0) return [];
    const goals = (await this.loadGoals()).filter((goal) => goal.eventType === eventType);
    if (goals.length === 0) return [];

    const dateKey = this.todayKey();
    const updated: DailyGoalProgressEntity[] = [];
    for (const goal of goals) {
      let row = await this.progress.findOne({ where: { playerId, dateKey, goalKey: goal.goalKey } });
      if (!row) {
        row = this.progress.create({ playerId, dateKey, goalKey: goal.goalKey, progress: 0, metadata: {} });
      }
      const target = Number(goal.target || 1);
      row.progress = Math.min(target, row.progress + amount);
      row.metadata = {
        ...(row.metadata || {}),
        lastEventType: eventType,
        lastMetadata: metadata,
        lastRecordedAt: new Date().toISOString(),
      };
      updated.push(await this.progress.save(row));
    }
    return updated;
  }

  async claim(playerId: string, goalKey: string, dateKey = this.todayKey()) {
    const player = await this.assertPlayer(playerId);
    const goals = await this.loadGoals();
    const goal = goals.find((item) => item.goalKey === goalKey);
    if (!goal) throw new NotFoundException('daily goal not found');
    const row = await this.progress.findOne({ where: { playerId, dateKey, goalKey } });
    if (!row || row.progress < Number(goal.target || 1)) {
      throw new BadRequestException('daily goal is not complete');
    }
    if (row.claimed) throw new BadRequestException('daily goal reward already claimed');

    const reward = goal.rewards || {};
    let grantedItems: InventoryItemEntity[] = [];
    if (reward.items?.length) {
      grantedItems = await this.inventory.grant(playerId, reward.items, 'daily_goal');
    }
    const gold = Math.max(0, Number(reward.gold || 0));
    if (gold > 0) {
      player.gold += gold;
      await this.players.save(player);
    }

    row.claimed = true;
    row.metadata = { ...(row.metadata || {}), claimedAt: new Date().toISOString() };
    const saved = await this.progress.save(row);
    return { progress: saved, rewards: { gold, items: grantedItems } };
  }

  private async loadGoals() {
    const config = await this.configs.getContentConfig('daily_goals');
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
