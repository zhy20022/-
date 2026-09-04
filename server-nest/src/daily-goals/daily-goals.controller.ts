import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { DailyGoalsService } from './daily-goals.service';

class ClaimDailyGoalDto {
  @IsString()
  goalKey: string;

  @IsOptional()
  @IsString()
  dateKey?: string;
}

@Controller('daily-goals')
export class DailyGoalsController {
  constructor(
    private readonly auth: AuthService,
    private readonly dailyGoals: DailyGoalsService,
  ) {}

  @Get(':playerId')
  list(
    @Headers('authorization') authorization: string | undefined,
    @Param('playerId') playerId: string,
    @Query('dateKey') dateKey?: string,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.dailyGoals.list(playerId, dateKey);
  }

  @Post(':playerId/claim')
  claim(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('playerId') playerId: string,
    @Body() dto: ClaimDailyGoalDto,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.dailyGoals.claim(playerId, dto.goalKey, dto.dateKey, idempotencyKey);
  }
}
