import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { applyCharacterExp, getExpForNextLevel, getExpRequiredToLevel, MAX_CHARACTER_LEVEL } from '../common/leveling';
import { GameConfigsService } from '../configs/configs.service';
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
    private readonly configs: GameConfigsService,
  ) {}

  async getProfile(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    const [characters, inventory, mails] = await Promise.all([
      this.characters.find({ where: { playerId }, take: 50 }),
      this.inventory.find({ where: { playerId }, take: 100 }),
      this.mails.find({ where: { playerId }, order: { createdAt: 'DESC' }, take: 30 }),
    ]);
    const configMap = await this.getCharacterConfigMap();
    return {
      player,
      characters: characters.map((character) => this.serializeCharacter(character, configMap.get(character.characterConfigId))),
      inventory,
      mails,
    };
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

  async getSkills(playerId: string, characterId: string) {
    const character = await this.getOwnedCharacter(playerId, characterId);
    const unlockedSkills = await this.buildAttributeSkills(character.attributeType);
    const saved = this.extractSkillSlots(character.skillSlots);
    return {
      success: true,
      unlockedSkills,
      skillSlots: this.isCompleteSkillConfig(saved) ? saved : this.defaultSkillSlots(unlockedSkills),
      isValid: this.isCompleteSkillConfig(saved),
      rules: { low: 5, mid: 3, high: 1, availableFromLevel: 1, uniqueSkills: true },
    };
  }

  async configureSkills(playerId: string, characterId: string, skillSlots: Record<string, string[]>) {
    const character = await this.getOwnedCharacter(playerId, characterId);
    const unlockedSkills = await this.buildAttributeSkills(character.attributeType);
    const normalized = this.normalizeSkillSlots(skillSlots);
    const expected = { low: 5, mid: 3, high: 1 } as const;
    const skillMap = new Map(unlockedSkills.map((skill) => [skill.skillId, skill]));
    const allIds = [...normalized.low, ...normalized.mid, ...normalized.high];
    if ((Object.keys(expected) as Array<keyof typeof expected>).some((tier) => normalized[tier].length !== expected[tier])) {
      throw new BadRequestException('skill configuration requires 5 low, 3 mid and 1 high slot');
    }
    if (new Set(allIds).size !== allIds.length) throw new BadRequestException('the same skill cannot occupy multiple slots');
    for (const tier of Object.keys(expected) as Array<keyof typeof expected>) {
      if (normalized[tier].some((id) => !skillMap.has(id) || skillMap.get(id)?.tier.toLowerCase() !== tier)) {
        throw new BadRequestException(`invalid ${tier} skill selection`);
      }
    }
    character.skillSlots = {
      ...(character.skillSlots || {}),
      learnedSkills: unlockedSkills.map((skill) => skill.skillId),
      skillSlots: normalized,
      updatedAt: new Date().toISOString(),
    };
    const saved = await this.characters.save(character);
    return { success: true, message: 'skill configuration saved', skillSlots: normalized, character: this.serializeCharacter(saved) };
  }

  async equipmentOptions(playerId: string, characterId: string) {
    const character = await this.getOwnedCharacter(playerId, characterId);
    const items = await this.inventory.find({ where: { playerId, itemType: In(['weapon', 'equipment']) }, order: { createdAt: 'DESC' } });
    const equippedIds = this.getEquippedIds(character.equipment);
    const serialize = (item: InventoryItemEntity) => ({
      ...item,
      canEquip: item.itemType !== 'weapon' || !item.payload?.characterId || item.payload.characterId === character.id || item.payload.characterConfigId === character.characterConfigId,
      isCurrentCharacterEquipped: equippedIds.has(item.id),
      slot: item.itemType === 'weapon' ? 'weapon' : String(item.payload?.slot || 'ACCESSORY'),
    });
    return { success: true, weapons: items.filter((item) => item.itemType === 'weapon').map(serialize), equipment: items.filter((item) => item.itemType === 'equipment').map(serialize), character: this.serializeCharacter(character) };
  }

  async equip(playerId: string, characterId: string, itemId: string) {
    const character = await this.getOwnedCharacter(playerId, characterId);
    const item = await this.inventory.findOne({ where: { id: itemId, playerId } });
    if (!item) throw new NotFoundException('inventory item not found');
    if (!['weapon', 'equipment'].includes(item.itemType)) throw new BadRequestException('item cannot be equipped');
    if (item.itemType === 'weapon' && item.payload?.characterId && item.payload.characterId !== character.id && item.payload?.characterConfigId !== character.characterConfigId) {
      throw new BadRequestException('exclusive weapon belongs to another character');
    }
    const equipment = { ...(character.equipment || {}) };
    const payload = this.serializeEquippedItem(item);
    if (item.itemType === 'weapon') {
      equipment.weapon = payload;
    } else {
      const slot = String(item.payload?.slot || 'ACCESSORY').toUpperCase();
      equipment.equipment_set = { ...((equipment.equipment_set as Record<string, unknown>) || {}), [slot]: payload };
    }
    character.equipment = equipment;
    const saved = await this.characters.save(character);
    return { success: true, message: 'equipment saved', character: this.serializeCharacter(saved), equipped: payload };
  }

  async unequip(playerId: string, characterId: string, input: { itemId?: string; slot?: string }) {
    const character = await this.getOwnedCharacter(playerId, characterId);
    const equipment = { ...(character.equipment || {}) };
    if (input.slot?.toLowerCase() === 'weapon' || (equipment.weapon as { itemId?: string; item_id?: string } | undefined)?.itemId === input.itemId || (equipment.weapon as { item_id?: string } | undefined)?.item_id === input.itemId) {
      delete equipment.weapon;
    } else {
      const pieces = { ...((equipment.equipment_set as Record<string, { itemId?: string; item_id?: string }>) || {}) };
      for (const [slot, piece] of Object.entries(pieces)) {
        if (slot === input.slot?.toUpperCase() || piece?.itemId === input.itemId || piece?.item_id === input.itemId) delete pieces[slot];
      }
      equipment.equipment_set = pieces;
    }
    character.equipment = equipment;
    const saved = await this.characters.save(character);
    return { success: true, message: 'equipment removed', character: this.serializeCharacter(saved) };
  }

  private serializeCharacter(character: PlayerCharacterEntity, config?: Record<string, unknown>) {
    return {
      ...character,
      name: config?.name || character.equipment?.characterName || character.characterConfigId,
      attributeName: config?.attributeName,
      professionName: config?.professionName,
      rarity: config?.rarity || character.equipment?.rarity || 'rare',
      weaponName: config?.weaponName || character.equipment?.weaponName || '',
      skills: config?.skills || [],
      maxLevel: MAX_CHARACTER_LEVEL,
      expToNextLevel: getExpForNextLevel(character.level),
    };
  }

  private async buildAttributeSkills(attributeType: string) {
    const config = await this.configs.getContentConfig('skills');
    const payload = config.payload as { templates?: Array<Record<string, unknown>> } | null;
    const attribute = this.normalizeAttribute(attributeType);
    return (payload?.templates || []).map((template) => ({
      skillId: `${attribute}_${String(template.id_suffix)}`,
      name: String(template.name_template || '{attribute} Skill').replace('{attribute}', attribute),
      logic: String(template.logic || 'A'),
      tier: String(template.tier || 'LOW'),
      cooldown: Number(template.cooldown || 0),
      skillMultiplier: Number(template.skill_multiplier || 1),
      targetType: String(template.target_type || 'SINGLE'),
      description: String(template.description_template || '').replace('{attribute}', attribute),
      effectTags: template.effect_tags || [],
      statusEffects: template.status_effects || [],
    }));
  }

  private normalizeAttribute(value: string) {
    const normalized = String(value || 'FIRE').toUpperCase();
    if (normalized === 'LIGHTNING') return 'THUNDER';
    if (normalized === 'HOLY') return 'LIGHT';
    if (normalized === 'SHADOW') return 'DARK';
    return normalized;
  }

  private normalizeSkillSlots(input: Record<string, string[]>) {
    return {
      low: Array.isArray(input.low) ? input.low.map(String).filter(Boolean) : [],
      mid: Array.isArray(input.mid) ? input.mid.map(String).filter(Boolean) : [],
      high: Array.isArray(input.high) ? input.high.map(String).filter(Boolean) : [],
    };
  }

  private extractSkillSlots(payload: Record<string, unknown>) {
    const nested = (payload?.skillSlots || payload?.skill_slots || payload) as Record<string, string[]>;
    return this.normalizeSkillSlots(nested || {});
  }

  private isCompleteSkillConfig(slots: { low: string[]; mid: string[]; high: string[] }) {
    return slots.low.length === 5 && slots.mid.length === 3 && slots.high.length === 1 && new Set([...slots.low, ...slots.mid, ...slots.high]).size === 9;
  }

  private defaultSkillSlots(skills: Array<{ skillId: string; tier: string }>) {
    return {
      low: skills.filter((skill) => skill.tier === 'LOW').slice(0, 5).map((skill) => skill.skillId),
      mid: skills.filter((skill) => skill.tier === 'MID').slice(0, 3).map((skill) => skill.skillId),
      high: skills.filter((skill) => skill.tier === 'HIGH').slice(0, 1).map((skill) => skill.skillId),
    };
  }

  private getEquippedIds(equipment: Record<string, unknown>) {
    const ids = new Set<string>();
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      if (typeof row.itemId === 'string') ids.add(row.itemId);
      if (typeof row.item_id === 'string') ids.add(row.item_id);
      Object.values(row).forEach(visit);
    };
    visit(equipment);
    return ids;
  }

  private serializeEquippedItem(item: InventoryItemEntity) {
    return { itemId: item.id, item_id: item.id, itemConfigId: item.itemConfigId, itemType: item.itemType, item_type: item.itemType, itemName: item.payload?.name || item.itemConfigId, item_name: item.payload?.name || item.itemConfigId, level: Number(item.payload?.enhancementLevel || 0), itemData: item.payload, item_data: item.payload, ...item.payload };
  }

  private async getCharacterConfigMap() {
    const config = await this.configs.getContentConfig('characters');
    const payload = config.payload as { characters?: Array<Record<string, unknown> & { id: string }> } | null;
    return new Map((payload?.characters || []).map((character) => [character.id, character]));
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
