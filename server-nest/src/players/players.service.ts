import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryItemEntity, MailEntity, PlayerCharacterEntity, PlayerEntity } from '../database/entities';

@Injectable()
export class PlayersService {
  constructor(
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    @InjectRepository(PlayerCharacterEntity) private readonly characters: Repository<PlayerCharacterEntity>,
    @InjectRepository(InventoryItemEntity) private readonly inventory: Repository<InventoryItemEntity>,
    @InjectRepository(MailEntity) private readonly mails: Repository<MailEntity>,
  ) {}

  async getProfile(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    const [characters, inventory, mails] = await Promise.all([
      this.characters.find({ where: { playerId }, take: 50 }),
      this.inventory.find({ where: { playerId }, take: 100 }),
      this.mails.find({ where: { playerId }, order: { createdAt: 'DESC' }, take: 30 }),
    ]);
    return { player, characters, inventory, mails };
  }
}
