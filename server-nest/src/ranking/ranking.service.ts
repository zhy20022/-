import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlayerEntity, RankingEntryEntity } from '../database/entities';

const SERVER_AUTHORITATIVE_RANKINGS = new Set(['damage_weekly', 'battle_damage', 'world_boss_damage']);

@Injectable()
export class RankingService {
  constructor(
    @InjectRepository(RankingEntryEntity) private readonly rankings: Repository<RankingEntryEntity>,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
  ) {}

  async submitScore(
    playerId: string,
    rankingKey: string,
    score: number,
    seasonId = 'default',
    payload: Record<string, unknown> = {},
  ) {
    if (SERVER_AUTHORITATIVE_RANKINGS.has(rankingKey)) {
      throw new BadRequestException('ranking is server-authoritative');
    }
    return this.upsertScore(playerId, rankingKey, score, seasonId, payload);
  }

  async recordServerScore(
    playerId: string,
    rankingKey: string,
    score: number,
    seasonId = 'default',
    payload: Record<string, unknown> = {},
  ) {
    return this.upsertScore(playerId, rankingKey, score, seasonId, { ...payload, source: 'server' });
  }

  private async upsertScore(
    playerId: string,
    rankingKey: string,
    score: number,
    seasonId = 'default',
    payload: Record<string, unknown> = {},
  ) {
    if (!rankingKey) throw new BadRequestException('rankingKey is required');
    if (!Number.isFinite(score) || score < 0) throw new BadRequestException('score must be non-negative');
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');

    let row = await this.rankings.findOne({ where: { playerId, rankingKey, seasonId } });
    const shouldUpdate = !row || score > row.score;
    if (!row) {
      row = this.rankings.create({ playerId, playerName: player.displayName, rankingKey, seasonId, score, payload });
    } else if (shouldUpdate) {
      row.score = score;
      row.playerName = player.displayName;
      row.payload = payload;
    }
    const saved = shouldUpdate ? await this.rankings.save(row) : row;
    return { entry: saved, updated: shouldUpdate, rank: await this.getPlayerRank(playerId, rankingKey, seasonId) };
  }

  async leaderboard(rankingKey: string, seasonId = 'default', limit = 100) {
    const take = Math.max(1, Math.min(200, limit));
    const rows = await this.rankings.find({
      where: { rankingKey, seasonId },
      order: { score: 'DESC', updatedAt: 'ASC' },
      take,
    });
    return rows.map((entry, index) => ({ rank: index + 1, ...entry }));
  }

  async getPlayerRank(playerId: string, rankingKey: string, seasonId = 'default') {
    const entry = await this.rankings.findOne({ where: { playerId, rankingKey, seasonId } });
    if (!entry) return null;
    const ahead = await this.rankings
      .createQueryBuilder('ranking')
      .where('ranking.rankingKey = :rankingKey', { rankingKey })
      .andWhere('ranking.seasonId = :seasonId', { seasonId })
      .andWhere('(ranking.score > :score OR (ranking.score = :score AND ranking.updatedAt < :updatedAt))', {
        score: entry.score,
        updatedAt: entry.updatedAt,
      })
      .getCount();
    return { rank: ahead + 1, entry };
  }
}
