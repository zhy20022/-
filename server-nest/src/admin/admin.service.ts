import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AdminLogEntity,
  BattleRecordEntity,
  DailyGoalProgressEntity,
  IdleClaimEntity,
  IdleSessionEntity,
  InventoryItemEntity,
  MailEntity,
  PlayerEntity,
  RankingEntryEntity,
  UserEntity,
} from '../database/entities';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(AdminLogEntity) private readonly logs: Repository<AdminLogEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    @InjectRepository(MailEntity) private readonly mails: Repository<MailEntity>,
    @InjectRepository(InventoryItemEntity) private readonly inventory: Repository<InventoryItemEntity>,
    @InjectRepository(DailyGoalProgressEntity) private readonly dailyGoals: Repository<DailyGoalProgressEntity>,
    @InjectRepository(IdleSessionEntity) private readonly idleSessions: Repository<IdleSessionEntity>,
    @InjectRepository(IdleClaimEntity) private readonly idleClaims: Repository<IdleClaimEntity>,
    @InjectRepository(BattleRecordEntity) private readonly battleRecords: Repository<BattleRecordEntity>,
    @InjectRepository(RankingEntryEntity) private readonly rankings: Repository<RankingEntryEntity>,
  ) {}

  async dashboard() {
    const [users, players, mails, logs] = await Promise.all([
      this.users.count(),
      this.players.count(),
      this.mails.count(),
      this.logs.find({ order: { createdAt: 'DESC' }, take: 20 }),
    ]);
    return { users, players, mails, recentLogs: logs };
  }

  async listPlayers(query?: string) {
    if (!query) return this.players.find({ order: { createdAt: 'DESC' }, take: 100 });
    return this.players
      .createQueryBuilder('player')
      .where('player.displayName ILIKE :query', { query: `%${query}%` })
      .orWhere('player.id = :id', { id: query })
      .orderBy('player.createdAt', 'DESC')
      .limit(100)
      .getMany();
  }

  async operationsDashboard() {
    const [
      players,
      activeIdleSessions,
      dailyGoalRows,
      battleRecords,
      rankingEntries,
      recentIdleClaims,
      recentBattles,
    ] = await Promise.all([
      this.players.count(),
      this.idleSessions.count({ where: { status: 'active' } }),
      this.dailyGoals.count(),
      this.battleRecords.count(),
      this.rankings.count(),
      this.idleClaims.find({ order: { createdAt: 'DESC' }, take: 10 }),
      this.battleRecords.find({ order: { createdAt: 'DESC' }, take: 10 }),
    ]);
    return {
      players,
      activeIdleSessions,
      dailyGoalRows,
      battleRecords,
      rankingEntries,
      recentIdleClaims,
      recentBattles,
    };
  }

  async playerOperations(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    const [inventory, dailyGoals, idleSessions, idleClaims, battleRecords, rankings] = await Promise.all([
      this.inventory.find({ where: { playerId }, order: { updatedAt: 'DESC' }, take: 100 }),
      this.dailyGoals.find({ where: { playerId }, order: { updatedAt: 'DESC' }, take: 50 }),
      this.idleSessions.find({ where: { playerId }, order: { createdAt: 'DESC' }, take: 20 }),
      this.idleClaims.find({ where: { playerId }, order: { createdAt: 'DESC' }, take: 20 }),
      this.battleRecords.find({ where: { playerId }, order: { createdAt: 'DESC' }, take: 20 }),
      this.rankings.find({ where: { playerId }, order: { updatedAt: 'DESC' }, take: 20 }),
    ]);
    return { player, inventory, dailyGoals, idleSessions, idleClaims, battleRecords, rankings };
  }

  async banUser(userId: string, actor: string, reason?: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('user not found');
    user.status = 'banned';
    user.metadata = { ...(user.metadata || {}), banReason: reason || null, bannedAt: new Date().toISOString() };
    await this.users.save(user);
    await this.log(actor, 'ban_user', userId, { reason });
    return user;
  }

  async sendMail(actor: string, playerId: string, title: string, body: string, rewards: Array<Record<string, unknown>>) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    const mail = this.mails.create({ playerId, title, body, rewards });
    await this.mails.save(mail);
    await this.log(actor, 'send_mail', playerId, { title, rewards });
    return mail;
  }

  listLogs() {
    return this.logs.find({ order: { createdAt: 'DESC' }, take: 100 });
  }

  async log(actor: string, action: string, targetId?: string | null, payload: Record<string, unknown> = {}) {
    return this.logs.save(this.logs.create({ actor, action, targetId, payload }));
  }
}
