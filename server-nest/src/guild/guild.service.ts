import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DailyGoalsService } from '../daily-goals/daily-goals.service';
import { GuildContributionEntity, GuildEntity, GuildMemberEntity, PlayerEntity } from '../database/entities';

@Injectable()
export class GuildService {
  constructor(
    @InjectRepository(GuildEntity) private readonly guilds: Repository<GuildEntity>,
    @InjectRepository(GuildMemberEntity) private readonly members: Repository<GuildMemberEntity>,
    @InjectRepository(GuildContributionEntity) private readonly contributions: Repository<GuildContributionEntity>,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    private readonly dailyGoals: DailyGoalsService,
  ) {}

  async createGuild(leaderPlayerId: string, name: string) {
    await this.assertPlayer(leaderPlayerId);
    const existingMember = await this.members.findOne({ where: { playerId: leaderPlayerId } });
    if (existingMember) throw new BadRequestException('player already in guild');
    const existingGuild = await this.guilds.findOne({ where: { name } });
    if (existingGuild) throw new BadRequestException('guild name already exists');
    const guild = await this.guilds.save(this.guilds.create({ name, leaderPlayerId }));
    await this.members.save(this.members.create({ guildId: guild.id, playerId: leaderPlayerId, role: 'leader' }));
    return this.getGuild(guild.id);
  }

  async joinGuild(playerId: string, guildId: string) {
    await this.assertPlayer(playerId);
    const guild = await this.guilds.findOne({ where: { id: guildId } });
    if (!guild) throw new NotFoundException('guild not found');
    const existingMember = await this.members.findOne({ where: { playerId } });
    if (existingMember) throw new BadRequestException('player already in guild');
    const count = await this.members.count({ where: { guildId } });
    if (count >= guild.memberLimit) throw new BadRequestException('guild is full');
    await this.members.save(this.members.create({ guildId, playerId, role: 'member' }));
    return this.getGuild(guildId);
  }

  async getGuild(guildId: string) {
    const guild = await this.guilds.findOne({ where: { id: guildId } });
    if (!guild) throw new NotFoundException('guild not found');
    const members = await this.members.find({ where: { guildId }, order: { role: 'ASC', totalContribution: 'DESC' } });
    const playerIds = members.map((member) => member.playerId);
    const players = playerIds.length > 0 ? await this.players.find({ where: { id: In(playerIds) } }) : [];
    return {
      guild,
      members: members.map((member) => ({
        ...member,
        player: players.find((player) => player.id === member.playerId),
      })),
    };
  }

  async myGuild(playerId: string) {
    await this.assertPlayer(playerId);
    const member = await this.members.findOne({ where: { playerId } });
    if (!member) return null;
    return this.getGuild(member.guildId);
  }

  async contribute(playerId: string, amount: number, source = 'manual', payload: Record<string, unknown> = {}) {
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount must be positive');
    const member = await this.members.findOne({ where: { playerId } });
    if (!member) throw new BadRequestException('player is not in a guild');
    const guild = await this.guilds.findOne({ where: { id: member.guildId } });
    if (!guild) throw new NotFoundException('guild not found');

    guild.contribution += amount;
    member.weeklyContribution += amount;
    member.totalContribution += amount;
    if (guild.contribution >= guild.level * 10000) {
      guild.level += 1;
    }
    const contribution = this.contributions.create({ guildId: guild.id, playerId, amount, source, payload });
    await Promise.all([
      this.guilds.save(guild),
      this.members.save(member),
      this.contributions.save(contribution),
    ]);
    await this.dailyGoals.recordEvent(playerId, 'guild_contribute', 1, { guildId: guild.id, amount, source });
    return { guild, member, contribution };
  }

  async listGuilds(limit = 100) {
    const take = Math.max(1, Math.min(200, limit));
    return this.guilds.find({ order: { contribution: 'DESC', level: 'DESC' }, take });
  }

  async contributionLog(guildId: string) {
    await this.getGuild(guildId);
    return this.contributions.find({ where: { guildId }, order: { createdAt: 'DESC' }, take: 100 });
  }

  private async assertPlayer(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }
}
