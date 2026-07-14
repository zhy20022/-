import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthService } from '../auth/auth.service';
import { BattleSettlementService } from './battle-settlement.service';

class SettlementRewardDto {
  @IsString()
  itemConfigId: string;

  @IsString()
  itemType: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

class SettleBattleDto {
  @IsString()
  playerId: string;

  @IsString()
  dungeonId: string;

  @IsArray()
  @IsString({ each: true })
  characterIds: string[];

  @IsBoolean()
  success: boolean;

  @IsNumber()
  @Min(0)
  duration: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  damageScore?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettlementRewardDto)
  rewards?: SettlementRewardDto[];

  @IsOptional()
  @IsObject()
  clientTrace?: Record<string, unknown>;
}

@Controller('battle-settlement')
export class BattleSettlementController {
  constructor(
    private readonly auth: AuthService,
    private readonly settlement: BattleSettlementService,
  ) {}

  @Post()
  settle(@Headers('authorization') authorization: string | undefined, @Body() dto: SettleBattleDto) {
    this.auth.assertPlayerAccess(authorization, dto.playerId);
    return this.settlement.settle(dto);
  }

  @Get(':playerId/records')
  records(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.settlement.records(playerId);
  }

  @Get(':playerId/progress')
  progress(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.settlement.dungeonProgress(playerId);
  }
}
