import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { FriendsAssistService } from './friends-assist.service';

class FriendRequestDto {
  @IsString()
  addresseePlayerId: string;
}

class FriendAcceptDto {
  @IsString()
  requesterPlayerId: string;
}

class RecordAssistDto {
  @IsString()
  helperPlayerId: string;

  @IsOptional()
  @IsString()
  helperCharacterId?: string;

  @IsOptional()
  @IsString()
  dungeonId?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

@Controller('friends-assist')
export class FriendsAssistController {
  constructor(
    private readonly auth: AuthService,
    private readonly friends: FriendsAssistService,
  ) {}

  @Post(':playerId/request')
  request(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Body() dto: FriendRequestDto) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.friends.requestFriend(playerId, dto.addresseePlayerId);
  }

  @Post(':playerId/accept')
  accept(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Body() dto: FriendAcceptDto) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.friends.acceptFriend(playerId, dto.requesterPlayerId);
  }

  @Get(':playerId')
  list(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.friends.listFriends(playerId);
  }

  @Get(':playerId/assist-roster')
  roster(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.friends.assistRoster(playerId);
  }

  @Post(':playerId/assist')
  assist(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Body() dto: RecordAssistDto) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.friends.recordAssist(playerId, dto.helperPlayerId, dto.helperCharacterId, dto.dungeonId, dto.payload || {});
  }

  @Get(':playerId/assist-history')
  history(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.friends.assistHistory(playerId);
  }
}
