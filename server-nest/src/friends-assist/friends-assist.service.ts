import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { DailyGoalsService } from '../daily-goals/daily-goals.service';
import { FriendAssistRecordEntity, FriendshipEntity, PlayerCharacterEntity, PlayerEntity } from '../database/entities';

@Injectable()
export class FriendsAssistService {
  constructor(
    @InjectRepository(FriendshipEntity) private readonly friendships: Repository<FriendshipEntity>,
    @InjectRepository(FriendAssistRecordEntity) private readonly assists: Repository<FriendAssistRecordEntity>,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    @InjectRepository(PlayerCharacterEntity) private readonly characters: Repository<PlayerCharacterEntity>,
    private readonly dailyGoals: DailyGoalsService,
  ) {}

  async requestFriend(requesterPlayerId: string, addresseePlayerId: string) {
    if (requesterPlayerId === addresseePlayerId) throw new BadRequestException('cannot add yourself');
    await this.assertPlayer(requesterPlayerId);
    await this.assertPlayer(addresseePlayerId);
    const existing = await this.findRelationship(requesterPlayerId, addresseePlayerId);
    if (existing) return existing;
    return this.friendships.save(this.friendships.create({ requesterPlayerId, addresseePlayerId, status: 'pending' }));
  }

  async acceptFriend(addresseePlayerId: string, requesterPlayerId: string) {
    const friendship = await this.friendships.findOne({ where: { requesterPlayerId, addresseePlayerId } });
    if (!friendship) throw new NotFoundException('friend request not found');
    friendship.status = 'accepted';
    return this.friendships.save(friendship);
  }

  async listFriends(playerId: string) {
    await this.assertPlayer(playerId);
    const rows = await this.friendships.find({
      where: [
        { requesterPlayerId: playerId, status: 'accepted' },
        { addresseePlayerId: playerId, status: 'accepted' },
      ],
      order: { updatedAt: 'DESC' },
    });
    const friendIds = rows.map((row) => row.requesterPlayerId === playerId ? row.addresseePlayerId : row.requesterPlayerId);
    const players = friendIds.length > 0 ? await this.players.find({ where: { id: In(friendIds) } }) : [];
    return rows.map((row) => ({
      friendship: row,
      friend: players.find((player) => player.id === (row.requesterPlayerId === playerId ? row.addresseePlayerId : row.requesterPlayerId)),
    }));
  }

  async assistRoster(playerId: string) {
    const friends = await this.listFriends(playerId);
    const friendIds = friends.map((row) => row.friend?.id).filter((id): id is string => Boolean(id));
    if (friendIds.length === 0) return [];
    const characters = await this.characters.find({ where: { playerId: In(friendIds) }, order: { level: 'DESC' }, take: 100 });
    return characters.map((character) => ({
      helperPlayerId: character.playerId,
      character,
      friend: friends.find((row) => row.friend?.id === character.playerId)?.friend,
    }));
  }

  async recordAssist(
    borrowerPlayerId: string,
    helperPlayerId: string,
    helperCharacterId?: string,
    dungeonId?: string,
    payload: Record<string, unknown> = {},
    manager: EntityManager = this.assists.manager,
  ) {
    await this.assertAcceptedFriends(borrowerPlayerId, helperPlayerId, manager);
    await this.assertPlayer(helperPlayerId, manager);
    const rewardGold = 100;
    const lockedHelper = await manager.findOne(PlayerEntity, {
      where: { id: helperPlayerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!lockedHelper) throw new NotFoundException('player not found');
    lockedHelper.gold += rewardGold;
    await manager.save(lockedHelper);
    const assist = await manager.save(manager.create(FriendAssistRecordEntity, {
      borrowerPlayerId,
      helperPlayerId,
      helperCharacterId: helperCharacterId || null,
      dungeonId: dungeonId || null,
      rewardGold,
      payload,
    }));
    await this.dailyGoals.recordEvent(borrowerPlayerId, 'friend_assist', 1, {
      assistId: assist.id,
      helperPlayerId,
      dungeonId,
    }, manager);
    return assist;
  }

  async resolveAssistCharacters(
    borrowerPlayerId: string,
    characterIds: string[],
    manager: EntityManager = this.characters.manager,
  ) {
    const uniqueIds = [...new Set(characterIds)];
    if (uniqueIds.length !== characterIds.length) throw new BadRequestException('assist characters must be unique');
    if (uniqueIds.length === 0) return [];
    const characters = await manager.find(PlayerCharacterEntity, {
      where: { id: In(uniqueIds) },
      lock: { mode: 'pessimistic_write' },
    });
    if (characters.length !== uniqueIds.length) throw new NotFoundException('assist character not found');
    for (const character of characters) {
      if (character.playerId === borrowerPlayerId) {
        throw new BadRequestException('assist characters must belong to accepted friends');
      }
      await this.assertAcceptedFriends(borrowerPlayerId, character.playerId, manager);
    }
    return uniqueIds.map((id) => characters.find((character) => character.id === id)!);
  }

  async assistHistory(playerId: string) {
    await this.assertPlayer(playerId);
    return this.assists.find({
      where: [
        { borrowerPlayerId: playerId },
        { helperPlayerId: playerId },
      ],
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  private async assertAcceptedFriends(a: string, b: string, manager: EntityManager = this.friendships.manager) {
    const row = await this.findRelationship(a, b, manager);
    if (!row || row.status !== 'accepted') throw new BadRequestException('players are not accepted friends');
    return row;
  }

  private async assertPlayer(playerId: string, manager: EntityManager = this.players.manager) {
    const player = await manager.findOne(PlayerEntity, { where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }

  private async findRelationship(a: string, b: string, manager: EntityManager = this.friendships.manager) {
    return manager.findOne(FriendshipEntity, {
      where: [
        { requesterPlayerId: a, addresseePlayerId: b },
        { requesterPlayerId: b, addresseePlayerId: a },
      ],
    });
  }
}
