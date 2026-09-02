import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, Min } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { PlayersService } from './players.service';

class UseCharacterExpDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  levelDelta?: number;
}

@Controller('players')
export class PlayersController {
  constructor(
    private readonly auth: AuthService,
    private readonly players: PlayersService,
  ) {}

  @Get(':playerId/profile')
  profile(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.players.getProfile(playerId);
  }

  @Get(':playerId/characters/:characterId/exp-preview')
  expPreview(
    @Headers('authorization') authorization: string | undefined,
    @Param('playerId') playerId: string,
    @Param('characterId') characterId: string,
    @Query('levelDelta') levelDelta?: string,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.players.expPreview(playerId, characterId, Number(levelDelta || 1));
  }

  @Post(':playerId/characters/:characterId/use-exp')
  useExp(
    @Headers('authorization') authorization: string | undefined,
    @Param('playerId') playerId: string,
    @Param('characterId') characterId: string,
    @Body() dto: UseCharacterExpDto,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.players.useExp(playerId, characterId, dto);
  }
}
