import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { DungeonsService } from './dungeons.service';

@Controller('dungeons')
export class DungeonsController {
  constructor(
    private readonly auth: AuthService,
    private readonly dungeons: DungeonsService,
  ) {}

  @Get()
  list() {
    return this.dungeons.list();
  }

  @Get(':dungeonId')
  get(@Param('dungeonId') dungeonId: string) {
    return { dungeon: this.dungeons.get(dungeonId) };
  }

  @Post(':playerId/:dungeonId/start')
  start(
    @Headers('authorization') authorization: string | undefined,
    @Param('playerId') playerId: string,
    @Param('dungeonId') dungeonId: string,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return {
      battleSeed: `${playerId}:${dungeonId}:${Date.now()}`,
      dungeon: this.dungeons.get(dungeonId),
      serverTime: new Date().toISOString(),
    };
  }
}
