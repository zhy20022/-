import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { BattleSettlementService } from '../battle-settlement/battle-settlement.service';
import { DungeonsService } from '../dungeons/dungeons.service';
import {
  FriendshipEntity,
  MultiplayerRoomEntity,
  MultiplayerRoomInvitationEntity,
  MultiplayerRoomMemberEntity,
  OperationRequestEntity,
  PlayerCharacterEntity,
  PlayerEntity,
} from '../database/entities';

@Injectable()
export class MultiplayerRoomsService implements OnModuleInit, OnModuleDestroy {
  private readonly heartbeatIntervalMs = Number(process.env.MULTIPLAYER_HEARTBEAT_INTERVAL_MS || 5000);
  private readonly disconnectTimeoutMs = Number(process.env.MULTIPLAYER_DISCONNECT_TIMEOUT_MS || 15000);
  private readonly reconnectGraceMs = Number(process.env.MULTIPLAYER_RECONNECT_GRACE_MS || 30000);
  private presenceTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(MultiplayerRoomEntity) private readonly rooms: Repository<MultiplayerRoomEntity>,
    @InjectRepository(MultiplayerRoomMemberEntity) private readonly members: Repository<MultiplayerRoomMemberEntity>,
    @InjectRepository(MultiplayerRoomInvitationEntity) private readonly invitations: Repository<MultiplayerRoomInvitationEntity>,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    @InjectRepository(PlayerCharacterEntity) private readonly characters: Repository<PlayerCharacterEntity>,
    @InjectRepository(FriendshipEntity) private readonly friendships: Repository<FriendshipEntity>,
    private readonly dungeons: DungeonsService,
    private readonly settlement: BattleSettlementService,
  ) {}

  onModuleInit() {
    this.presenceTimer = setInterval(() => void this.sweepPresence(), this.heartbeatIntervalMs);
    this.presenceTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
  }

  async list(playerId: string) {
    await this.assertPlayer(playerId);
    const rows = await this.rooms.find({ where: { status: 'waiting' }, order: { updatedAt: 'DESC' }, take: 50 });
    const visible = [];
    for (const room of rows) {
      const refreshed = await this.refreshPresence(room);
      if (refreshed.leaderPlayerId === playerId || await this.areFriends(playerId, refreshed.leaderPlayerId)) visible.push(await this.serializeRoom(refreshed));
    }
    return visible;
  }

  async current(playerId: string) {
    const room = await this.activeRoom(playerId);
    if (!room) return null;
    const refreshed = await this.refreshPresence(room);
    const stillMember = await this.members.findOne({ where: { roomId: refreshed.id, playerId } });
    if (!stillMember) return null;
    return this.serializeRoom(refreshed);
  }

  async heartbeat(playerId: string, roomId: string) {
    const room = await this.getRoom(roomId);
    await this.members.manager.transaction(async (manager) => {
      const member = await manager.findOne(MultiplayerRoomMemberEntity, {
        where: { roomId, playerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!member) throw new NotFoundException('room member not found');
      if (room.status === 'finished' || room.status === 'cancelled') return;
      const now = new Date();
      member.connectionStatus = 'online';
      member.lastSeenAt = now;
      member.disconnectedAt = null;
      await manager.save(member);
    });
    const refreshed = await this.refreshPresence(room);
    return this.serializeRoom(refreshed);
  }

  async create(playerId: string, dungeonId: string) {
    const dungeon = this.dungeons.get(dungeonId);
    if (dungeon.dungeonType === 'SINGLE') throw new BadRequestException('only multiplayer dungeons can create rooms');
    return this.members.manager.transaction(async (manager) => {
      await this.lockPlayer(manager, playerId);
      const existing = await this.activeRoom(playerId, manager);
      if (existing) return this.serializeRoom(existing, manager);
      await this.assertNoActiveBattle(manager, playerId);
      const capacity = dungeon.dungeonType === 'SQUAD' ? 5 : 4;
      const room = await manager.save(manager.create(MultiplayerRoomEntity, {
        dungeonId,
        leaderPlayerId: playerId,
        status: 'waiting',
        capacity,
        maxCharactersPerMember: dungeon.dungeonType === 'SERVER_BOSS' ? 20 : 5,
        characterIds: [],
      }));
      await manager.save(manager.create(MultiplayerRoomMemberEntity, { roomId: room.id, playerId, characterIds: [], isReady: false, connectionStatus: 'online', lastSeenAt: new Date() }));
      return this.serializeRoom(room, manager);
    });
  }

  async invite(inviterPlayerId: string, roomId: string, inviteePlayerId: string) {
    const room = await this.getRoom(roomId);
    if (room.leaderPlayerId !== inviterPlayerId) throw new ConflictException('only the room leader can invite players');
    if (room.status !== 'waiting') throw new ConflictException('room is no longer waiting');
    if (inviterPlayerId === inviteePlayerId || !await this.areFriends(inviterPlayerId, inviteePlayerId)) {
      throw new BadRequestException('invitee must be an accepted friend');
    }
    await this.assertPlayer(inviteePlayerId);
    const existingMember = await this.members.findOne({ where: { roomId, playerId: inviteePlayerId } });
    if (existingMember) throw new ConflictException('player is already in the room');
    const existing = await this.invitations.findOne({ where: { roomId, inviteePlayerId, status: 'pending' } });
    if (existing) return this.serializeInvitation(existing);
    const invitation = await this.invitations.save(this.invitations.create({
      roomId, inviterPlayerId, inviteePlayerId, status: 'pending',
    }));
    return this.serializeInvitation(invitation);
  }

  async pendingInvitations(playerId: string) {
    const rows = await this.invitations.find({ where: { inviteePlayerId: playerId, status: 'pending' }, order: { createdAt: 'DESC' }, take: 50 });
    return Promise.all(rows.map(async (row) => ({
      ...(await this.serializeInvitation(row)),
      room: await this.getRoom(row.roomId).then((room) => this.serializeRoom(room)).catch(() => null),
    })));
  }

  async acceptInvitation(playerId: string, invitationId: string, characterIds: string[] = []) {
    return this.members.manager.transaction(async (manager) => {
      await this.lockPlayer(manager, playerId);
      const invitation = await manager.findOne(MultiplayerRoomInvitationEntity, {
        where: { id: invitationId, inviteePlayerId: playerId, status: 'pending' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invitation) throw new NotFoundException('invitation not found or expired');
      const room = await manager.findOne(MultiplayerRoomEntity, { where: { id: invitation.roomId }, lock: { mode: 'pessimistic_write' } });
      if (!room || room.status !== 'waiting') throw new ConflictException('room is no longer available');
      const active = await this.activeRoom(playerId, manager);
      if (active && active.id !== room.id) throw new ConflictException('leave the current room before joining another');
      await this.assertNoActiveBattle(manager, playerId);
      const memberCount = await manager.count(MultiplayerRoomMemberEntity, { where: { roomId: room.id } });
      if (memberCount >= room.capacity) throw new ConflictException('room is full');
      await this.validateMemberCharacters(manager, playerId, room, characterIds);
      const existing = await manager.findOne(MultiplayerRoomMemberEntity, { where: { roomId: room.id, playerId } });
      if (!existing) {
        await manager.save(manager.create(MultiplayerRoomMemberEntity, { roomId: room.id, playerId, characterIds, isReady: false, connectionStatus: 'online', lastSeenAt: new Date() }));
      }
      invitation.status = 'accepted';
      await manager.save(invitation);
      return this.serializeRoom(room, manager);
    });
  }

  async updateMember(playerId: string, roomId: string, characterIds: string[], isReady: boolean) {
    return this.members.manager.transaction(async (manager) => {
      const room = await manager.findOne(MultiplayerRoomEntity, { where: { id: roomId }, lock: { mode: 'pessimistic_write' } });
      if (!room) throw new NotFoundException('room not found');
      if (room.status !== 'waiting') throw new ConflictException('room is no longer waiting');
      const member = await manager.findOne(MultiplayerRoomMemberEntity, { where: { roomId, playerId }, lock: { mode: 'pessimistic_write' } });
      if (!member) throw new NotFoundException('room member not found');
      await this.validateMemberCharacters(manager, playerId, room, characterIds);
      const allOther = await manager.find(MultiplayerRoomMemberEntity, { where: { roomId } });
      const duplicates = allOther.filter((row) => row.playerId !== playerId).flatMap((row) => row.characterIds || []).filter((id) => characterIds.includes(id));
      if (duplicates.length > 0) throw new BadRequestException('a character cannot be selected by two room members');
      member.characterIds = characterIds;
      member.isReady = Boolean(isReady && characterIds.length > 0);
      member.connectionStatus = 'online';
      member.lastSeenAt = new Date();
      member.disconnectedAt = null;
      await manager.save(member);
      return this.serializeRoom(room, manager);
    });
  }

  async start(playerId: string, roomId: string, idempotencyKey?: string) {
    const room = await this.rooms.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('room not found');
    const refreshed = await this.refreshPresence(room);
    if (refreshed.leaderPlayerId !== playerId) throw new ConflictException('only the room leader can start the room');
    return this.members.manager.transaction(async (manager) => {
      const locked = await manager.findOne(MultiplayerRoomEntity, { where: { id: roomId }, lock: { mode: 'pessimistic_write' } });
      if (!locked) throw new NotFoundException('room not found');
      if (locked.leaderPlayerId !== playerId) throw new ConflictException('only the room leader can start the room');
      if (locked.battleSeed) return this.serializeRoom(locked, manager);
      if (locked.status !== 'waiting') throw new ConflictException('room is already starting or finished');
      const members = await manager.find(MultiplayerRoomMemberEntity, { where: { roomId }, order: { joinedAt: 'ASC' } });
      if (members.some((member) => member.connectionStatus === 'offline')) throw new ConflictException('all room members must be online before starting');
      if (members.length < 2) throw new BadRequestException('at least two players are required');
      if (members.some((member) => !member.isReady || member.characterIds.length === 0)) throw new BadRequestException('all room members must be ready with characters');
      const characterIds = members.flatMap((member) => member.characterIds);
      const dungeon = this.dungeons.get(locked.dungeonId);
      const expected = { SINGLE: 1, SQUAD: 5, TEAM: 20, SERVER_BOSS: 20 }[dungeon.dungeonType];
      if (characterIds.length !== expected || new Set(characterIds).size !== characterIds.length) {
        throw new BadRequestException(`room requires exactly ${expected} unique characters`);
      }
      locked.characterIds = characterIds;
      const key = idempotencyKey && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey) ? idempotencyKey : randomUUID();
      locked.battleSeed = await this.dungeons.startRoom(manager, locked.dungeonId, members, key, locked.id);
      locked.status = 'in_battle';
      await manager.save(locked);
      return this.serializeRoom(locked, manager);
    });
  }

  async battle(playerId: string, roomId: string) {
    const room = await this.assertMember(roomId, playerId);
    if (!room.battleSeed) throw new ConflictException('room battle has not started');
    return this.dungeons.battleStatus(playerId, room.battleSeed);
  }

  async settle(playerId: string, roomId: string) {
    return this.members.manager.transaction(async (manager) => {
      // Serialize reciprocal helper payouts; keep membership for replay and recovery.
      const room = await manager.findOne(MultiplayerRoomEntity, { where: { id: roomId }, lock: { mode: 'pessimistic_write' } });
      if (!room) throw new NotFoundException('room not found');
      const member = await manager.findOne(MultiplayerRoomMemberEntity, { where: { roomId, playerId } });
      if (!member) throw new ConflictException('player is not a member of this room');
      if (!room.battleSeed) throw new ConflictException('room battle has not started');
      const result = await this.settlement.settle({
        playerId,
        dungeonId: room.dungeonId,
        characterIds: room.characterIds,
        success: false,
        duration: 0,
        clientTrace: { source: 'online-multiplayer-room', roomId, battleSeed: room.battleSeed },
      }, manager);
      const members = await manager.find(MultiplayerRoomMemberEntity, { where: { roomId } });
      const settled = await manager.count(OperationRequestEntity, {
        where: { playerId: In(members.map((item) => item.playerId)), operation: 'battle-settlement', idempotencyKey: room.battleSeed },
      });
      if (settled === members.length && room.status !== 'finished') {
        room.status = 'finished';
        room.battleRecordId = result.record.id;
        await manager.save(room);
      }
      return result;
    });
  }

  async leave(playerId: string, roomId: string) {
    return this.members.manager.transaction(async (manager) => {
      const room = await manager.findOne(MultiplayerRoomEntity, { where: { id: roomId }, lock: { mode: 'pessimistic_write' } });
      if (!room) throw new NotFoundException('room not found');
      const member = await manager.findOne(MultiplayerRoomMemberEntity, { where: { roomId, playerId } });
      if (!member) throw new NotFoundException('room member not found');
      if (room.status === 'finished' || room.status === 'cancelled') return null;
      if (room.status !== 'waiting') throw new ConflictException('room cannot be left before battle settlement');
      await manager.remove(member);
      const remaining = await manager.find(MultiplayerRoomMemberEntity, { where: { roomId }, order: { joinedAt: 'ASC' } });
      if (remaining.length === 0) {
        room.status = 'cancelled';
      } else if (room.leaderPlayerId === playerId) {
        room.leaderPlayerId = remaining[0].playerId;
      }
      await manager.save(room);
      return remaining.length === 0 ? null : this.serializeRoom(room, manager);
    });
  }

  private async assertMember(roomId: string, playerId: string) {
    const room = await this.getRoom(roomId);
    const refreshed = await this.refreshPresence(room);
    const member = await this.members.findOne({ where: { roomId, playerId } });
    if (!member) throw new ConflictException('player is not a member of this room');
    return refreshed;
  }

  private async activeRoom(playerId: string, manager: EntityManager = this.rooms.manager) {
    const rows = await manager.query(
      `SELECT r."id" FROM "multiplayer_rooms" r
       JOIN "multiplayer_room_members" m ON m."roomId" = r."id"
       WHERE m."playerId"::text = $1 AND r."status" IN ('waiting', 'starting', 'in_battle')
       AND NOT EXISTS (
         SELECT 1 FROM "operation_requests" o WHERE o."playerId" = $1
         AND o."operation" = 'battle-settlement' AND o."idempotencyKey" = r."battleSeed"::text
         AND o."response" IS NOT NULL
       ) ORDER BY r."updatedAt" DESC LIMIT 1`, [playerId],
    ) as Array<{ id: string }>;
    return rows[0] ? manager.findOne(MultiplayerRoomEntity, { where: { id: rows[0].id } }) : null;
  }

  private async lockPlayer(manager: EntityManager, playerId: string) {
    const player = await manager.findOne(PlayerEntity, { where: { id: playerId }, lock: { mode: 'pessimistic_write' } });
    if (!player) throw new NotFoundException('player not found');
  }

  private async assertNoActiveBattle(manager: EntityManager, playerId: string) {
    const player = await manager.findOne(PlayerEntity, { where: { id: playerId } });
    if (player?.flags?.activeBattleSeed) throw new ConflictException('settle the active battle before joining another room');
  }

  private async refreshPresence(room: MultiplayerRoomEntity) {
    return this.members.manager.transaction(async (manager) => {
      const lockedRoom = await manager.findOne(MultiplayerRoomEntity, { where: { id: room.id }, lock: { mode: 'pessimistic_write' } });
      if (!lockedRoom) throw new NotFoundException('room not found');
      if (['finished', 'cancelled'].includes(lockedRoom.status)) return lockedRoom;
      const members = await manager.find(MultiplayerRoomMemberEntity, { where: { roomId: lockedRoom.id }, order: { joinedAt: 'ASC' }, lock: { mode: 'pessimistic_write' } });
      const now = Date.now();
      for (const member of members) {
        const lastSeen = member.lastSeenAt ? member.lastSeenAt.getTime() : member.updatedAt.getTime();
        if (member.connectionStatus === 'online' && now - lastSeen > this.disconnectTimeoutMs) {
          member.connectionStatus = 'offline';
          member.disconnectedAt = new Date(now);
        }
      }
      const expired = members.filter((member) => member.connectionStatus === 'offline' && member.disconnectedAt && now - member.disconnectedAt.getTime() > this.reconnectGraceMs);
      if (lockedRoom.status === 'waiting') {
        for (const member of expired) await manager.remove(member);
      }
      const activeMembers = lockedRoom.status === 'waiting'
        ? members.filter((member) => !expired.some((item) => item.id === member.id))
        : members;
      const onlineMembers = activeMembers.filter((member) => member.connectionStatus === 'online');
      const currentLeader = activeMembers.find((member) => member.playerId === lockedRoom.leaderPlayerId && member.connectionStatus === 'online');
      if (!currentLeader && onlineMembers[0] && lockedRoom.status === 'waiting') {
        lockedRoom.leaderPlayerId = onlineMembers[0].playerId;
      }
      if (activeMembers.length === 0 && lockedRoom.status === 'waiting') {
        lockedRoom.status = 'cancelled';
      }
      await manager.save(activeMembers);
      return manager.save(lockedRoom);
    });
  }

  private async sweepPresence() {
    try {
      const rooms = await this.rooms.find({ where: [
        { status: 'waiting' },
        { status: 'starting' },
        { status: 'in_battle' },
      ], take: 100 });
      for (const room of rooms) await this.refreshPresence(room);
    } catch {
      // Presence is best effort; the next heartbeat or API read retries the sweep.
    }
  }

  private async getRoom(roomId: string) {
    const room = await this.rooms.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('room not found');
    return room;
  }

  private async assertPlayer(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }

  private async areFriends(a: string, b: string, manager: EntityManager = this.friendships.manager) {
    const row = await manager.findOne(FriendshipEntity, { where: [
      { requesterPlayerId: a, addresseePlayerId: b, status: 'accepted' },
      { requesterPlayerId: b, addresseePlayerId: a, status: 'accepted' },
    ] });
    return Boolean(row);
  }

  private async validateMemberCharacters(manager: EntityManager, playerId: string, room: MultiplayerRoomEntity, characterIds: string[]) {
    if (!Array.isArray(characterIds) || characterIds.length > room.maxCharactersPerMember || new Set(characterIds).size !== characterIds.length) {
      throw new BadRequestException(`provide 1-${room.maxCharactersPerMember} unique characterIds`);
    }
    const owned = await manager.find(PlayerCharacterEntity, { where: { playerId, id: In(characterIds) }, lock: { mode: 'pessimistic_write' } });
    if (owned.length !== characterIds.length) throw new BadRequestException('all selected characters must belong to the room member');
  }

  private async serializeRoom(room: MultiplayerRoomEntity, manager: EntityManager = this.rooms.manager) {
    const members = await manager.find(MultiplayerRoomMemberEntity, { where: { roomId: room.id }, order: { joinedAt: 'ASC' } });
    const playerIds = members.map((member) => member.playerId);
    const players = playerIds.length ? await manager.find(PlayerEntity, { where: { id: In(playerIds) } }) : [];
    const dungeon = this.dungeons.get(room.dungeonId);
    return {
      room_id: room.id,
      dungeon_id: room.dungeonId,
      dungeon_type: dungeon.dungeonType,
      leader_id: room.leaderPlayerId,
      capacity: room.capacity,
      max_characters_per_member: room.maxCharactersPerMember,
      status: room.status,
      battle_seed: room.battleSeed || null,
      battle_record_id: room.battleRecordId || null,
      character_ids: room.status === 'waiting' ? members.flatMap((member) => member.characterIds || []) : room.characterIds || [],
      members: members.map((member) => ({
        player_id: member.playerId,
        username: players.find((player) => player.id === member.playerId)?.displayName || member.playerId,
        character_ids: member.characterIds,
        is_ready: member.isReady,
        connection_status: member.connectionStatus,
        reconnect_remaining_seconds: member.connectionStatus === 'offline' && member.disconnectedAt
          ? Math.max(0, Math.ceil((this.reconnectGraceMs - (Date.now() - member.disconnectedAt.getTime())) / 1000))
          : null,
      })),
    };
  }

  private async serializeInvitation(row: MultiplayerRoomInvitationEntity) {
    const [inviter, invitee] = await Promise.all([
      this.players.findOne({ where: { id: row.inviterPlayerId } }),
      this.players.findOne({ where: { id: row.inviteePlayerId } }),
    ]);
    return {
      invitation_id: row.id,
      room_id: row.roomId,
      inviter_id: row.inviterPlayerId,
      inviter_username: inviter?.displayName || row.inviterPlayerId,
      invitee_id: row.inviteePlayerId,
      invitee_username: invitee?.displayName || row.inviteePlayerId,
      status: row.status,
      created_at: row.createdAt,
    };
  }
}
