import { Controller, Get, Headers, Param } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { PlayersService } from './players.service';

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
}
