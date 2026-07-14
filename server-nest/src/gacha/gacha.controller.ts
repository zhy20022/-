import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { GachaService } from './gacha.service';

class DrawDto {
  @IsOptional()
  @IsString()
  poolKey?: string;

  @IsOptional()
  @IsInt()
  @IsIn([1, 10, 100])
  count?: number;
}

@Controller('gacha')
export class GachaController {
  constructor(
    private readonly auth: AuthService,
    private readonly gacha: GachaService,
  ) {}

  @Get('pools')
  pools() {
    return this.gacha.listPools();
  }

  @Post(':playerId/draw')
  draw(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Body() dto: DrawDto) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.gacha.draw(playerId, dto.poolKey || 'starter', dto.count || 1);
  }
}
