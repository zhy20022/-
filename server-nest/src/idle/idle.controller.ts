import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { IsArray, IsString } from 'class-validator';
import { IdleService } from './idle.service';

class StartIdleDto {
  @IsString()
  playerId: string;

  @IsString()
  stageId: string;

  @IsArray()
  @IsString({ each: true })
  characterIds: string[];
}

@Controller('idle')
export class IdleController {
  constructor(
    private readonly auth: AuthService,
    private readonly idle: IdleService,
  ) {}

  @Post('start')
  start(@Headers('authorization') authorization: string | undefined, @Body() dto: StartIdleDto) {
    this.auth.assertPlayerAccess(authorization, dto.playerId);
    return this.idle.start(dto.playerId, dto.stageId, dto.characterIds);
  }

  @Get(':playerId/status')
  status(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.idle.status(playerId);
  }

  @Post(':playerId/claim')
  claim(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.idle.claim(playerId);
  }

  @Post(':playerId/stop')
  stop(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.idle.stop(playerId);
  }

  @Get(':playerId/history')
  history(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.idle.history(playerId);
  }
}
