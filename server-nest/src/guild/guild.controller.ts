import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { GuildService } from './guild.service';

class CreateGuildDto {
  @IsString()
  leaderPlayerId: string;

  @IsString()
  @MaxLength(40)
  name: string;
}

class JoinGuildDto {
  @IsString()
  playerId: string;
}

class ContributionDto {
  @IsString()
  playerId: string;

  @IsInt()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

@Controller('guild')
export class GuildController {
  constructor(
    private readonly auth: AuthService,
    private readonly guild: GuildService,
  ) {}

  @Get()
  list(@Query('limit') limit = '100') {
    return this.guild.listGuilds(Number(limit));
  }

  @Post()
  create(@Headers('authorization') authorization: string | undefined, @Body() dto: CreateGuildDto) {
    this.auth.assertPlayerAccess(authorization, dto.leaderPlayerId);
    return this.guild.createGuild(dto.leaderPlayerId, dto.name);
  }

  @Get('player/:playerId/current')
  mine(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.guild.myGuild(playerId);
  }

  @Get(':guildId')
  get(@Param('guildId') guildId: string) {
    return this.guild.getGuild(guildId);
  }

  @Post(':guildId/join')
  join(@Headers('authorization') authorization: string | undefined, @Param('guildId') guildId: string, @Body() dto: JoinGuildDto) {
    this.auth.assertPlayerAccess(authorization, dto.playerId);
    return this.guild.joinGuild(dto.playerId, guildId);
  }

  @Post('contribute')
  contribute(@Headers('authorization') authorization: string | undefined, @Body() dto: ContributionDto) {
    this.auth.assertPlayerAccess(authorization, dto.playerId);
    return this.guild.contribute(dto.playerId, dto.amount, dto.source || 'manual', dto.payload || {});
  }

  @Get(':guildId/contributions')
  log(@Param('guildId') guildId: string) {
    return this.guild.contributionLog(guildId);
  }
}
