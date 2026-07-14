import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
  ) {
    await this.assertAcceptedFriends(borrowerPlayerId, helperPlayerId);
    const helper = await this.assertPlayer(helperPlayerId);
    const rewardGold = 100;
    helper.gold += rewardGold;
    await this.players.save(helper);
    const assist = await this.assists.save(this.assists.create({
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
    });
    return assist;
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

  private async findRelationship(a: string, b: string) {
    return this.friendships.findOne({
      where: [
        { requesterPlayerId: a, addresseePlayerId: b },
        { requesterPlayerId: b, addresseePlayerId: a },
      ],
    });
  }

  private async assertAcceptedFriends(a: string, b: string) {
    const row = await this.findRelationship(a, b);
    if (!row || row.status !== 'accepted') throw new BadRequestException('players are not accepted friends');
    return row;
  }

  private async assertPlayer(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }
}
