import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { IsArray, IsInt, IsString, Max, Min } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { DungeonsService } from './dungeons.service';

class StartDungeonDto {
  @IsArray()
  @IsString({ each: true })
  characterIds: string[];
}

class SweepDungeonDto {
  @IsString()
  characterId: string;

  @IsInt()
  @Min(1)
  @Max(10)
  count: number;
}

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
  async start(
    @Headers('authorization') authorization: string | undefined,
    @Param('playerId') playerId: string,
    @Param('dungeonId') dungeonId: string,
    @Body() dto: StartDungeonDto,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.dungeons.start(playerId, dungeonId, dto.characterIds);
  }

  @Post(':playerId/:dungeonId/sweep')
  sweep(
    @Headers('authorization') authorization: string | undefined,
    @Param('playerId') playerId: string,
    @Param('dungeonId') dungeonId: string,
    @Body() dto: SweepDungeonDto,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.dungeons.sweep(playerId, dungeonId, dto.characterId, dto.count);
  }
}
