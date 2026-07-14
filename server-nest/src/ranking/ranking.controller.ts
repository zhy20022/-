import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { RankingService } from './ranking.service';

class SubmitScoreDto {
  @IsString()
  playerId: string;

  @IsInt()
  @Min(0)
  score: number;

  @IsOptional()
  @IsString()
  seasonId?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

@Controller('ranking')
export class RankingController {
  constructor(private readonly ranking: RankingService) {}

  @Post(':rankingKey/score')
  submit(@Param('rankingKey') rankingKey: string, @Body() dto: SubmitScoreDto) {
    return this.ranking.submitScore(dto.playerId, rankingKey, dto.score, dto.seasonId || 'default', dto.payload || {});
  }

  @Get(':rankingKey')
  list(
    @Param('rankingKey') rankingKey: string,
    @Query('seasonId') seasonId = 'default',
    @Query('limit') limit = '100',
  ) {
    return this.ranking.leaderboard(rankingKey, seasonId, Number(limit));
  }

  @Get(':rankingKey/player/:playerId')
  playerRank(
    @Param('rankingKey') rankingKey: string,
    @Param('playerId') playerId: string,
    @Query('seasonId') seasonId = 'default',
  ) {
    return this.ranking.getPlayerRank(playerId, rankingKey, seasonId);
  }
}
