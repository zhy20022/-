import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsString } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { MultiplayerRoomsService } from './multiplayer-rooms.service';

class CreateRoomDto { @IsString() dungeonId: string; }
class InviteRoomDto { @IsString() inviteePlayerId: string; }
class RoomMemberDto {
  @IsArray() @IsString({ each: true }) characterIds: string[];
  @IsBoolean() isReady: boolean;
}

@Controller('multiplayer-rooms')
export class MultiplayerRoomsController {
  constructor(private readonly auth: AuthService, private readonly rooms: MultiplayerRoomsService) {}

  @Get()
  list(@Headers('authorization') authorization: string | undefined) {
    const session = this.auth.verifyAuthorization(authorization);
    return this.rooms.list(session.playerId);
  }

  @Get('current')
  current(@Headers('authorization') authorization: string | undefined) {
    const session = this.auth.verifyAuthorization(authorization);
    return this.rooms.current(session.playerId);
  }

  @Get('invitations')
  invitations(@Headers('authorization') authorization: string | undefined, @Query('status') status?: string) {
    const session = this.auth.verifyAuthorization(authorization);
    return status && status !== 'pending' ? [] : this.rooms.pendingInvitations(session.playerId);
  }

  @Post()
  create(@Headers('authorization') authorization: string | undefined, @Body() dto: CreateRoomDto) {
    const session = this.auth.verifyAuthorization(authorization);
    return this.rooms.create(session.playerId, dto.dungeonId);
  }

  @Post(':roomId/invite')
  invite(@Headers('authorization') authorization: string | undefined, @Param('roomId') roomId: string, @Body() dto: InviteRoomDto) {
    const session = this.auth.verifyAuthorization(authorization);
    return this.rooms.invite(session.playerId, roomId, dto.inviteePlayerId);
  }

  @Post('invitations/:invitationId/accept')
  accept(@Headers('authorization') authorization: string | undefined, @Param('invitationId') invitationId: string, @Body() dto: Partial<RoomMemberDto>) {
    const session = this.auth.verifyAuthorization(authorization);
    return this.rooms.acceptInvitation(session.playerId, invitationId, dto.characterIds || []);
  }

  @Post(':roomId/member')
  member(@Headers('authorization') authorization: string | undefined, @Param('roomId') roomId: string, @Body() dto: RoomMemberDto) {
    const session = this.auth.verifyAuthorization(authorization);
    return this.rooms.updateMember(session.playerId, roomId, dto.characterIds, dto.isReady);
  }

  @Post(':roomId/start')
  start(@Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') idempotencyKey: string | undefined, @Param('roomId') roomId: string) {
    const session = this.auth.verifyAuthorization(authorization);
    return this.rooms.start(session.playerId, roomId, idempotencyKey);
  }

  @Get(':roomId/battle')
  battle(@Headers('authorization') authorization: string | undefined, @Param('roomId') roomId: string) {
    const session = this.auth.verifyAuthorization(authorization);
    return this.rooms.battle(session.playerId, roomId);
  }

  @Post(':roomId/settle')
  settle(@Headers('authorization') authorization: string | undefined, @Param('roomId') roomId: string) {
    const session = this.auth.verifyAuthorization(authorization);
    return this.rooms.settle(session.playerId, roomId);
  }

  @Post(':roomId/leave')
  leave(@Headers('authorization') authorization: string | undefined, @Param('roomId') roomId: string) {
    const session = this.auth.verifyAuthorization(authorization);
    return this.rooms.leave(session.playerId, roomId);
  }
}
