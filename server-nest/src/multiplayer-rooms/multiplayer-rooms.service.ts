import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
  PlayerCharacterEntity,
  PlayerEntity,
} from '../database/entities';

@Injectable()
export class MultiplayerRoomsService {
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

  async list(playerId: string) {
    await this.assertPlayer(playerId);
    const rows = await this.rooms.find({ where: { status: 'waiting' }, order: { updatedAt: 'DESC' }, take: 50 });
    const visible = [];
    for (const room of rows) {
      if (room.leaderPlayerId === playerId || await this.areFriends(playerId, room.leaderPlayerId)) visible.push(await this.serializeRoom(room));
    }
    return visible;
  }

  async current(playerId: string) {
    const member = await this.members.findOne({ where: { playerId }, order: { updatedAt: 'DESC' } });
    if (!member) return null;
    const room = await this.rooms.findOne({ where: { id: member.roomId } });
    return room ? this.serializeRoom(room) : null;
  }

  async create(playerId: string, dungeonId: string) {
    const dungeon = this.dungeons.get(dungeonId);
    if (dungeon.dungeonType === 'SINGLE') throw new BadRequestException('only multiplayer dungeons can create rooms');
    const existing = await this.members.manager.query(
      `SELECT r."id" FROM "multiplayer_rooms" r
       INNER JOIN "multiplayer_room_members" m ON m."roomId" = r."id"
       WHERE m."playerId" = $1 AND r."status" IN ('waiting', 'starting', 'in_battle')
       ORDER BY r."updatedAt" DESC LIMIT 1`,
      [playerId],
    ) as Array<{ id: string }>;
    if (existing[0]) {
      const active = await this.rooms.findOne({ where: { id: existing[0].id } });
      if (active) return this.serializeRoom(active);
    }
    const capacity = dungeon.dungeonType === 'SQUAD' ? 5 : 4;
    const room = await this.rooms.save(this.rooms.create({
      dungeonId,
      leaderPlayerId: playerId,
      status: 'waiting',
      capacity,
      maxCharactersPerMember: dungeon.dungeonType === 'SERVER_BOSS' ? 20 : 5,
      characterIds: [],
    }));
    await this.members.save(this.members.create({ roomId: room.id, playerId, characterIds: [], isReady: false }));
    return this.serializeRoom(room);
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
      const invitation = await manager.findOne(MultiplayerRoomInvitationEntity, {
        where: { id: invitationId, inviteePlayerId: playerId, status: 'pending' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invitation) throw new NotFoundException('invitation not found or expired');
      const room = await manager.findOne(MultiplayerRoomEntity, { where: { id: invitation.roomId }, lock: { mode: 'pessimistic_write' } });
      if (!room || room.status !== 'waiting') throw new ConflictException('room is no longer available');
      const memberCount = await manager.count(MultiplayerRoomMemberEntity, { where: { roomId: room.id } });
      if (memberCount >= room.capacity) throw new ConflictException('room is full');
      await this.validateMemberCharacters(manager, playerId, room, characterIds);
      const existing = await manager.findOne(MultiplayerRoomMemberEntity, { where: { roomId: room.id, playerId } });
      if (!existing) {
        await manager.save(manager.create(MultiplayerRoomMemberEntity, { roomId: room.id, playerId, characterIds, isReady: false }));
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
      await manager.save(member);
      return this.serializeRoom(room, manager);
    });
  }

  async start(playerId: string, roomId: string, idempotencyKey?: string) {
    const room = await this.rooms.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('room not found');
    if (room.leaderPlayerId !== playerId) throw new ConflictException('only the room leader can start the room');
    if (room.battleSeed) return this.serializeRoom(room);
    const starting = await this.members.manager.transaction(async (manager) => {
      const locked = await manager.findOne(MultiplayerRoomEntity, { where: { id: roomId }, lock: { mode: 'pessimistic_write' } });
      if (!locked) throw new NotFoundException('room not found');
      if (locked.status !== 'waiting') throw new ConflictException('room is already starting or finished');
      const members = await manager.find(MultiplayerRoomMemberEntity, { where: { roomId }, order: { joinedAt: 'ASC' } });
      if (members.length < 2) throw new BadRequestException('at least two players are required');
      if (members.some((member) => !member.isReady || member.characterIds.length === 0)) throw new BadRequestException('all room members must be ready with characters');
      const characterIds = members.flatMap((member) => member.characterIds);
      const dungeon = this.dungeons.get(locked.dungeonId);
      const expected = { SINGLE: 1, SQUAD: 5, TEAM: 20, SERVER_BOSS: 20 }[dungeon.dungeonType];
      if (characterIds.length !== expected || new Set(characterIds).size !== characterIds.length) {
        throw new BadRequestException(`room requires exactly ${expected} unique characters`);
      }
      locked.status = 'starting';
      locked.characterIds = characterIds;
      await manager.save(locked);
      return locked;
    });
    const key = idempotencyKey && /^[0-9a-f-]{36}$/i.test(idempotencyKey) ? idempotencyKey : randomUUID();
    try {
      const started = await this.dungeons.start(playerId, starting.dungeonId, starting.characterIds, key);
      starting.status = 'in_battle';
      starting.battleSeed = started.battleSeed as string;
      await this.rooms.save(starting);
      return this.serializeRoom(starting);
    } catch (error) {
      starting.status = 'waiting';
      await this.rooms.save(starting);
      throw error;
    }
  }

  async battle(playerId: string, roomId: string) {
    const room = await this.assertMember(roomId, playerId);
    if (!room.battleSeed) throw new ConflictException('room battle has not started');
    return this.dungeons.battleStatus(room.leaderPlayerId, room.battleSeed);
  }

  async settle(playerId: string, roomId: string) {
    const room = await this.assertMember(roomId, playerId);
    if (!room.battleSeed) throw new ConflictException('room battle has not started');
    const result = await this.settlement.settle({
      playerId: room.leaderPlayerId,
      dungeonId: room.dungeonId,
      characterIds: room.characterIds,
      success: false,
      duration: 0,
      clientTrace: { source: 'online-multiplayer-room', roomId, battleSeed: room.battleSeed },
    });
    if (room.status !== 'finished') {
      room.status = 'finished';
      room.battleRecordId = result.record.id;
      await this.rooms.save(room);
    }
    return result;
  }

  async leave(playerId: string, roomId: string) {
    return this.members.manager.transaction(async (manager) => {
      const room = await manager.findOne(MultiplayerRoomEntity, { where: { id: roomId }, lock: { mode: 'pessimistic_write' } });
      if (!room) throw new NotFoundException('room not found');
      if (room.status !== 'waiting') throw new ConflictException('room cannot be left after battle starts');
      const member = await manager.findOne(MultiplayerRoomMemberEntity, { where: { roomId, playerId } });
      if (!member) throw new NotFoundException('room member not found');
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
    const member = await this.members.findOne({ where: { roomId, playerId } });
    if (!member) throw new ConflictException('player is not a member of this room');
    return room;
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
      character_ids: room.characterIds || [],
      members: members.map((member) => ({
        player_id: member.playerId,
        username: players.find((player) => player.id === member.playerId)?.displayName || member.playerId,
        character_ids: member.characterIds,
        is_ready: member.isReady,
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
