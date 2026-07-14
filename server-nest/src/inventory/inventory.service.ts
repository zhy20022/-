import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryItemEntity, PlayerEntity } from '../database/entities';

export interface InventoryGrantItem {
  itemConfigId: string;
  itemType: string;
  quantity: number;
  payload?: Record<string, unknown>;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItemEntity) private readonly inventory: Repository<InventoryItemEntity>,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
  ) {}

  async list(playerId: string) {
    await this.assertPlayer(playerId);
    return this.inventory.find({ where: { playerId }, order: { createdAt: 'DESC' }, take: 200 });
  }

  async grant(playerId: string, items: InventoryGrantItem[], source = 'system') {
    await this.assertPlayer(playerId);
    const saved: InventoryItemEntity[] = [];
    for (const item of items) {
      if (!item.itemConfigId || !item.itemType || item.quantity <= 0) {
        throw new BadRequestException('invalid grant item');
      }
      const stackable = ['material', 'currency', 'fragment', 'consumable'].includes(item.itemType);
      let row = stackable
        ? await this.inventory.findOne({ where: { playerId, itemConfigId: item.itemConfigId, itemType: item.itemType } })
        : null;
      if (!row) {
        row = this.inventory.create({
          playerId,
          itemConfigId: item.itemConfigId,
          itemType: item.itemType,
          quantity: 0,
          payload: { ...(item.payload || {}), firstSource: source },
        });
      }
      row.quantity += item.quantity;
      row.payload = { ...(row.payload || {}), ...(item.payload || {}), lastSource: source };
      saved.push(await this.inventory.save(row));
    }
    return saved;
  }

  async consume(playerId: string, itemConfigId: string, quantity: number) {
    await this.assertPlayer(playerId);
    if (quantity <= 0) throw new BadRequestException('quantity must be positive');
    const row = await this.inventory.findOne({ where: { playerId, itemConfigId } });
    if (!row || row.quantity < quantity) {
      throw new BadRequestException('not enough item quantity');
    }
    row.quantity -= quantity;
    if (row.quantity === 0) {
      await this.inventory.remove(row);
      return { itemConfigId, quantity: 0, removed: true };
    }
    return this.inventory.save(row);
  }

  private async assertPlayer(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }
}
