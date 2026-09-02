import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { applyCharacterExp, getExpForNextLevel, getExpRequiredToLevel, MAX_CHARACTER_LEVEL } from '../common/leveling';
import { InventoryItemEntity, MailEntity, PlayerCharacterEntity, PlayerEntity } from '../database/entities';

const CHARACTER_EXP_ITEM_ID = 'character_exp_crystal';
const GOLD_PER_EXP_PACKAGE = 1;

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
    return { player, characters: characters.map((character) => this.serializeCharacter(character)), inventory, mails };
  }

  async expPreview(playerId: string, characterId: string, levelDelta = 1) {
    const player = await this.assertPlayer(playerId);
    const character = await this.getOwnedCharacter(playerId, characterId);
    const normalizedDelta = Math.max(1, Math.floor(levelDelta || 1));
    const targetLevel = Math.min(MAX_CHARACTER_LEVEL, character.level + normalizedDelta);
    const requiredExpPackages = getExpRequiredToLevel(character.level, character.exp, targetLevel);
    const requiredGold = this.calculateUpgradeGoldCost(requiredExpPackages);
    const ownedExpPackages = await this.getExpPackageQuantity(playerId);
    return {
      success: true,
      character: this.serializeCharacter(character),
      targetLevel,
      requiredExpPackages,
      requiredGold,
      ownedExpPackages,
      ownedGold: player.gold,
      needMoreExpPackages: Math.max(0, requiredExpPackages - ownedExpPackages),
      needMoreGold: Math.max(0, requiredGold - player.gold),
      canAfford: player.gold >= requiredGold && ownedExpPackages >= requiredExpPackages,
      currency: 'gold',
      expItemConfigId: CHARACTER_EXP_ITEM_ID,
    };
  }

  async useExp(playerId: string, characterId: string, dto: { amount?: number; levelDelta?: number }) {
    const player = await this.assertPlayer(playerId);
    const character = await this.getOwnedCharacter(playerId, characterId);
    if (character.level >= MAX_CHARACTER_LEVEL) {
      return {
        success: true,
        message: 'character already at max level',
        character: this.serializeCharacter(character),
        consumedGold: 0,
      };
    }

    const requestedExpPackages = dto.levelDelta
      ? getExpRequiredToLevel(
        character.level,
        character.exp,
        Math.min(MAX_CHARACTER_LEVEL, character.level + Math.max(1, Math.floor(dto.levelDelta))),
      )
      : Math.max(1, Math.floor(dto.amount || 0));
    const requestedGold = this.calculateUpgradeGoldCost(requestedExpPackages);
    const ownedExpPackages = await this.getExpPackageQuantity(playerId);
    if (requestedExpPackages <= 0 || ownedExpPackages < requestedExpPackages || player.gold < requestedGold) {
      throw new BadRequestException({
        message: 'not enough upgrade resources',
        requiredExpPackages: requestedExpPackages,
        ownedExpPackages,
        requiredGold: requestedGold,
        ownedGold: player.gold,
        needMoreExpPackages: Math.max(0, requestedExpPackages - ownedExpPackages),
        needMoreGold: Math.max(0, requestedGold - player.gold),
      });
    }

    await this.consumeExpPackages(playerId, requestedExpPackages);
    player.gold -= requestedGold;
    await this.players.save(player);
    const growth = applyCharacterExp(character.level, character.exp, requestedExpPackages);
    character.level = growth.afterLevel;
    character.exp = growth.afterExp;
    const saved = await this.characters.save(character);
    return {
      success: true,
      consumedGold: requestedGold,
      consumedExpPackages: requestedExpPackages,
      growth,
      character: this.serializeCharacter(saved),
      player,
      ownedExpPackages: await this.getExpPackageQuantity(playerId),
    };
  }

  private serializeCharacter(character: PlayerCharacterEntity) {
    return {
      ...character,
      maxLevel: MAX_CHARACTER_LEVEL,
      expToNextLevel: getExpForNextLevel(character.level),
    };
  }

  private async getOwnedCharacter(playerId: string, characterId: string) {
    const character = await this.characters.findOne({ where: { id: characterId, playerId } });
    if (!character) throw new NotFoundException('character not found');
    return character;
  }

  private calculateUpgradeGoldCost(expPackages: number) {
    return Math.max(1, Math.floor(Math.max(0, expPackages) * GOLD_PER_EXP_PACKAGE));
  }

  private async getExpPackageQuantity(playerId: string) {
    const row = await this.inventory.findOne({ where: { playerId, itemConfigId: CHARACTER_EXP_ITEM_ID } });
    return Number(row?.quantity || 0);
  }

  private async consumeExpPackages(playerId: string, amount: number) {
    const row = await this.inventory.findOne({ where: { playerId, itemConfigId: CHARACTER_EXP_ITEM_ID } });
    if (!row || row.quantity < amount) {
      throw new BadRequestException('not enough character experience packages');
    }
    row.quantity -= amount;
    if (row.quantity <= 0) {
      await this.inventory.remove(row);
      return null;
    }
    return this.inventory.save(row);
  }

  private async assertPlayer(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }
}
