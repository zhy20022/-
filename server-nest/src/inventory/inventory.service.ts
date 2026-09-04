import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { IdempotencyService } from '../common/idempotency.service';
import { InventoryItemEntity, PlayerCharacterEntity, PlayerEntity } from '../database/entities';

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
    @InjectRepository(PlayerCharacterEntity) private readonly characters: Repository<PlayerCharacterEntity>,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(playerId: string) {
    await this.assertPlayer(playerId);
    return this.inventory.find({ where: { playerId }, order: { createdAt: 'DESC' }, take: 200 });
  }

  async grant(
    playerId: string,
    items: InventoryGrantItem[],
    source = 'system',
    manager?: EntityManager,
  ): Promise<InventoryItemEntity[]> {
    if (!manager) {
      return this.inventory.manager.transaction(async (transactionManager) => {
        const player = await transactionManager.findOne(PlayerEntity, {
          where: { id: playerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!player) throw new NotFoundException('player not found');
        return this.grant(playerId, items, source, transactionManager);
      });
    }

    const inventory = manager.getRepository(InventoryItemEntity);
    const saved: InventoryItemEntity[] = [];
    for (const item of items) {
      if (!item.itemConfigId || !item.itemType || item.quantity <= 0) {
        throw new BadRequestException('invalid grant item');
      }
      const stackable = ['material', 'currency', 'fragment', 'consumable'].includes(item.itemType);
      let row = stackable
        ? await inventory.findOne({
          where: { playerId, itemConfigId: item.itemConfigId, itemType: item.itemType },
          lock: { mode: 'pessimistic_write' },
        })
        : null;
      if (!row) {
        row = inventory.create({
          playerId,
          itemConfigId: item.itemConfigId,
          itemType: item.itemType,
          quantity: 0,
          payload: { ...(item.payload || {}), firstSource: source },
        });
      }
      const nextQuantity = row.quantity + item.quantity;
      row.quantity = item.itemConfigId === 'character_exp_crystal'
        ? Math.min(999_999_999, nextQuantity)
        : nextQuantity;
      row.payload = { ...(row.payload || {}), ...(item.payload || {}), lastSource: source };
      saved.push(await inventory.save(row));
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

  async setLocked(playerId: string, itemId: string, locked: boolean) {
    const item = await this.getOwnedItem(playerId, itemId);
    item.locked = locked;
    return { success: true, item: await this.inventory.save(item) };
  }

  async dismantlePreview(playerId: string, itemId: string) {
    const item = await this.getOwnedItem(playerId, itemId);
    return { success: true, materials: this.dismantleRewards(item) };
  }

  async dismantle(playerId: string, itemId: string, idempotencyKey?: string) {
    return this.idempotency.execute(playerId, 'inventory-dismantle', idempotencyKey, { itemId }, async ({ manager }) => {
      const item = await manager.findOne(InventoryItemEntity, {
        where: { id: itemId, playerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException('inventory item not found');
      if (item.locked) throw new BadRequestException('locked item cannot be dismantled');
      if (!['weapon', 'equipment'].includes(item.itemType)) throw new BadRequestException('item type cannot be dismantled');
      if (await this.isEquipped(playerId, itemId, manager)) throw new BadRequestException('equipped item cannot be dismantled');
      const rewards = this.dismantleRewards(item);
      await manager.remove(item);
      await this.grant(playerId, rewards.map((reward) => ({ ...reward, itemType: 'material' })), 'dismantle', manager);
      return { success: true, message: 'item dismantled', materials: rewards };
    });
  }

  private dismantleRewards(item: InventoryItemEntity) {
    const quality = String(item.payload?.quality || 'common').toLowerCase();
    const level = Number(item.payload?.enhancementLevel || 0);
    const base = quality === 'epic' ? 5 : quality === 'rare' ? 2 : 1;
    const quantity = base + Math.floor(level / 5);
    return [{ itemConfigId: 'generic_battle_material', materialType: 'EQUIPMENT_SET', attributeType: item.payload?.attributeType || null, quantity, payload: { materialType: 'EQUIPMENT_SET', attributeType: item.payload?.attributeType || null, source: 'dismantle' } }];
  }

  private async getOwnedItem(playerId: string, itemId: string) {
    await this.assertPlayer(playerId);
    const item = await this.inventory.findOne({ where: { id: itemId, playerId } });
    if (!item) throw new NotFoundException('inventory item not found');
    return item;
  }

  private async isEquipped(playerId: string, itemId: string, manager?: EntityManager) {
    const characters = await (manager?.getRepository(PlayerCharacterEntity) || this.characters)
      .find({ where: { playerId }, select: { equipment: true } });
    return characters.some((character) => JSON.stringify(character.equipment || {}).includes(itemId));
  }

  private async assertPlayer(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }
}
