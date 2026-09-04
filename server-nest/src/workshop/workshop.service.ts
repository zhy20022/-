import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { IdempotencyService } from '../common/idempotency.service';
import { GameConfigsService } from '../configs/configs.service';
import { InventoryItemEntity, PlayerCharacterEntity, PlayerEntity } from '../database/entities';

interface MaterialRule {
  materialType: string;
  acceptedItemConfigIds: string[];
  materialCost: number;
  goldCost: number;
}

interface EquipmentRules {
  crafting: {
    exclusive: MaterialRule & { quality: string; baseStats: Record<string, number> };
    equipmentSet: MaterialRule & {
      quality: string;
      slots: string[];
      professionCategories: string[];
      baseStats: Record<string, number>;
    };
  };
  enhancement: {
    maxLevel: number;
    breakthroughLevels: number[];
    goldCostBase: number;
    materialCostBase: number;
    materialType: string;
    acceptedItemConfigIds: string[];
    successRates: Record<string, number>;
    breakthroughCosts: Record<string, { gold: number; material: number }>;
  };
}

const DEFAULT_RULES: EquipmentRules = {
  crafting: {
    exclusive: { materialType: 'EXCLUSIVE_ITEM', acceptedItemConfigIds: ['exclusive_material', 'generic_battle_material'], materialCost: 20, goldCost: 0, quality: 'epic', baseStats: { attack_bonus: 100, magic_attack_bonus: 100 } },
    equipmentSet: { materialType: 'EQUIPMENT_SET', acceptedItemConfigIds: ['equipment_material', 'generic_battle_material'], materialCost: 1, goldCost: 0, quality: 'rare', slots: ['HEAD', 'CHEST', 'LEGS', 'BOOTS', 'GLOVES', 'ACCESSORY'], professionCategories: ['A', 'B', 'C', 'D'], baseStats: { hp_bonus: 100, attack_bonus: 50, defense_bonus: 50 } },
  },
  enhancement: { maxLevel: 50, breakthroughLevels: [10, 20, 30, 40], goldCostBase: 1000, materialCostBase: 1, materialType: 'EQUIPMENT_SET', acceptedItemConfigIds: ['equipment_material', 'generic_battle_material'], successRates: { '0': 1, '10': 0.8, '20': 0.6, '30': 0.4, '40': 0.2 }, breakthroughCosts: { '10': { gold: 10000, material: 5 }, '20': { gold: 20000, material: 10 }, '30': { gold: 30000, material: 15 }, '40': { gold: 40000, material: 20 } } },
};

@Injectable()
export class WorkshopService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly configs: GameConfigsService,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    @InjectRepository(PlayerCharacterEntity) private readonly characters: Repository<PlayerCharacterEntity>,
    @InjectRepository(InventoryItemEntity) private readonly inventory: Repository<InventoryItemEntity>,
  ) {}

  async materials(playerId: string) {
    await this.assertPlayer(playerId);
    const rows = await this.inventory.find({ where: { playerId, itemType: In(['material', 'fragment', 'consumable']) }, order: { createdAt: 'ASC' } });
    return { success: true, materials: rows.map((row) => this.serializeMaterial(row)) };
  }

  async previewCraft(playerId: string, input: { craftingType: 'exclusive' | 'equipment'; attributeType?: string }) {
    const player = await this.assertPlayer(playerId);
    const rules = await this.rules();
    const rule = input.craftingType === 'exclusive' ? rules.crafting.exclusive : rules.crafting.equipmentSet;
    const attribute = input.craftingType === 'equipment' ? this.normalizeAttribute(input.attributeType) : undefined;
    if (input.craftingType === 'equipment' && !attribute) throw new BadRequestException('attributeType is required');
    const owned = await this.materialCount(this.inventory.manager, playerId, rule.acceptedItemConfigIds, attribute);
    return {
      success: true,
      preview: {
        craftingType: input.craftingType,
        costs: [{ materialType: rule.materialType, attributeType: attribute || null, required: rule.materialCost, owned, enough: owned >= rule.materialCost }],
        gold: { required: rule.goldCost, owned: player.gold, enough: player.gold >= rule.goldCost },
        canCraft: owned >= rule.materialCost && player.gold >= rule.goldCost,
      },
    };
  }

  async craftExclusive(playerId: string, characterId: string, idempotencyKey?: string) {
    const rules = await this.rules();
    return this.idempotency.execute(playerId, 'workshop-craft-exclusive', idempotencyKey, { characterId }, async ({ manager, player }) => {
      const character = await manager.findOne(PlayerCharacterEntity, { where: { id: characterId, playerId } });
      if (!character) throw new NotFoundException('character not found');
      await this.charge(manager, player, rules.crafting.exclusive, undefined);
      const config = await this.findCharacterConfig(character.characterConfigId);
      const item = manager.create(InventoryItemEntity, {
        playerId,
        itemConfigId: `exclusive_${character.characterConfigId}_${Date.now()}`,
        itemType: 'weapon',
        quantity: 1,
        payload: {
          name: `${String(config?.name || character.characterConfigId)} Exclusive Weapon`,
          subtype: 'exclusive_weapon',
          slot: 'weapon',
          quality: rules.crafting.exclusive.quality,
          characterId: character.id,
          characterConfigId: character.characterConfigId,
          baseStats: rules.crafting.exclusive.baseStats,
          stats: rules.crafting.exclusive.baseStats,
          enhancementLevel: 0,
          breakthroughs: [],
          specialSkill: this.buildExclusiveSkill(config),
        },
      });
      return { success: true, message: 'exclusive weapon crafted', item: await manager.save(item), player };
    });
  }

  async craftEquipment(
    playerId: string,
    input: { attributeType: string; professionCategory: string; slot: string },
    idempotencyKey?: string,
  ) {
    const rules = await this.rules();
    const attributeType = this.normalizeAttribute(input.attributeType);
    const slot = input.slot.toUpperCase();
    const professionCategory = input.professionCategory.toUpperCase();
    if (!attributeType) throw new BadRequestException('invalid attributeType');
    if (!rules.crafting.equipmentSet.slots.includes(slot)) throw new BadRequestException('invalid equipment slot');
    if (!rules.crafting.equipmentSet.professionCategories.includes(professionCategory)) throw new BadRequestException('invalid profession category');
    return this.idempotency.execute(playerId, 'workshop-craft-equipment', idempotencyKey, input, async ({ manager, player }) => {
      await this.charge(manager, player, rules.crafting.equipmentSet, attributeType);
      const item = manager.create(InventoryItemEntity, {
        playerId,
        itemConfigId: `set_${attributeType}_${professionCategory}_${slot}_${Date.now()}`,
        itemType: 'equipment',
        quantity: 1,
        payload: {
          name: `${attributeType} ${professionCategory} ${slot}`,
          subtype: 'equipment_set',
          slot,
          attributeType,
          professionCategory,
          quality: rules.crafting.equipmentSet.quality,
          baseStats: rules.crafting.equipmentSet.baseStats,
          stats: rules.crafting.equipmentSet.baseStats,
          enhancementLevel: 0,
          breakthroughs: [],
        },
      });
      return { success: true, message: 'equipment crafted', item: await manager.save(item), player };
    });
  }

  async enhancementPreview(playerId: string, itemId: string) {
    const player = await this.assertPlayer(playerId);
    const item = await this.getEquipment(playerId, itemId);
    const rules = await this.rules();
    const level = Number(item.payload?.enhancementLevel || 0);
    const breakthroughs = this.breakthroughs(item);
    const requiresBreakthrough = rules.enhancement.breakthroughLevels.includes(level) && !breakthroughs.includes(level);
    const requiredGold = requiresBreakthrough ? Number(rules.enhancement.breakthroughCosts[String(level)]?.gold || 0) : level >= rules.enhancement.maxLevel ? 0 : rules.enhancement.goldCostBase * (level + 1);
    const requiredMaterial = requiresBreakthrough ? Number(rules.enhancement.breakthroughCosts[String(level)]?.material || 0) : level >= rules.enhancement.maxLevel ? 0 : rules.enhancement.materialCostBase * (level + 1);
    const ownedMaterial = await this.materialCount(this.inventory.manager, playerId, rules.enhancement.acceptedItemConfigIds);
    return {
      success: true,
      preview: {
        currentLevel: level,
        nextLevel: Math.min(level + 1, rules.enhancement.maxLevel),
        maxLevel: rules.enhancement.maxLevel,
        successRate: this.successRate(rules, level),
        requiresBreakthrough,
        action: requiresBreakthrough ? 'breakthrough' : 'enhance',
        costs: {
          gold: { required: requiredGold, owned: player.gold, enough: player.gold >= requiredGold },
          material: { materialType: rules.enhancement.materialType, required: requiredMaterial, owned: ownedMaterial, enough: ownedMaterial >= requiredMaterial },
        },
      },
    };
  }

  async enhance(playerId: string, itemId: string, idempotencyKey?: string) {
    const rules = await this.rules();
    return this.idempotency.execute(playerId, 'workshop-enhance', idempotencyKey, { itemId }, async ({ manager, player }) => {
      const item = await this.lockEquipment(manager, playerId, itemId);
      const level = Number(item.payload?.enhancementLevel || 0);
      if (level >= rules.enhancement.maxLevel) throw new BadRequestException('equipment is already at max enhancement level');
      if (rules.enhancement.breakthroughLevels.includes(level) && !this.breakthroughs(item).includes(level)) {
        throw new BadRequestException('equipment requires breakthrough before enhancement');
      }
      const cost = { materialType: rules.enhancement.materialType, acceptedItemConfigIds: rules.enhancement.acceptedItemConfigIds, materialCost: rules.enhancement.materialCostBase * (level + 1), goldCost: rules.enhancement.goldCostBase * (level + 1) };
      await this.charge(manager, player, cost);
      const success = Math.random() < this.successRate(rules, level);
      const newLevel = success ? level + 1 : this.failureLevel(level, rules.enhancement.breakthroughLevels);
      item.payload = { ...item.payload, enhancementLevel: newLevel, stats: this.calculateStats(item.payload, newLevel, this.breakthroughs(item).length) };
      const saved = await manager.save(item);
      await this.syncEquippedCopies(manager, saved);
      return { success, message: success ? 'enhancement succeeded' : 'enhancement failed and level was adjusted', newLevel, equipment: saved, player };
    });
  }

  async breakthrough(playerId: string, itemId: string, idempotencyKey?: string) {
    const rules = await this.rules();
    return this.idempotency.execute(playerId, 'workshop-breakthrough', idempotencyKey, { itemId }, async ({ manager, player }) => {
      const item = await this.lockEquipment(manager, playerId, itemId);
      const level = Number(item.payload?.enhancementLevel || 0);
      const breakthroughs = this.breakthroughs(item);
      if (!rules.enhancement.breakthroughLevels.includes(level) || breakthroughs.includes(level)) throw new BadRequestException('equipment is not waiting for breakthrough');
      const configuredCost = rules.enhancement.breakthroughCosts[String(level)];
      if (!configuredCost) throw new BadRequestException('breakthrough cost is not configured');
      await this.charge(manager, player, { materialType: rules.enhancement.materialType, acceptedItemConfigIds: rules.enhancement.acceptedItemConfigIds, materialCost: configuredCost.material, goldCost: configuredCost.gold });
      breakthroughs.push(level);
      item.payload = { ...item.payload, breakthroughs, stats: this.calculateStats(item.payload, level, breakthroughs.length) };
      const saved = await manager.save(item);
      await this.syncEquippedCopies(manager, saved);
      return { success: true, message: 'breakthrough succeeded', equipment: saved, player };
    });
  }

  private async rules(): Promise<EquipmentRules> {
    const config = await this.configs.getContentConfig('equipment');
    return (config.payload as EquipmentRules | null) || DEFAULT_RULES;
  }

  private async charge(manager: EntityManager, player: PlayerEntity, rule: MaterialRule, attributeType?: string) {
    if (player.gold < rule.goldCost) throw new BadRequestException({ message: 'not enough gold', required: rule.goldCost, owned: player.gold });
    const owned = await this.materialCount(manager, player.id, rule.acceptedItemConfigIds, attributeType);
    if (owned < rule.materialCost) throw new BadRequestException({ message: 'not enough crafting material', materialType: rule.materialType, required: rule.materialCost, owned });
    await this.consumeMaterials(manager, player.id, rule.acceptedItemConfigIds, rule.materialCost, attributeType);
    player.gold -= rule.goldCost;
    await manager.save(player);
  }

  private async materialCount(manager: EntityManager, playerId: string, acceptedIds: string[], attributeType?: string) {
    const rows = await manager.find(InventoryItemEntity, { where: { playerId, itemConfigId: In(acceptedIds), itemType: 'material' } });
    return rows.filter((row) => this.materialMatches(row, attributeType)).reduce((sum, row) => sum + row.quantity, 0);
  }

  private async consumeMaterials(manager: EntityManager, playerId: string, acceptedIds: string[], amount: number, attributeType?: string) {
    const rows = (await manager.find(InventoryItemEntity, { where: { playerId, itemConfigId: In(acceptedIds), itemType: 'material' }, order: { createdAt: 'ASC' } }))
      .filter((row) => this.materialMatches(row, attributeType))
      .sort((a, b) => Number(b.payload?.attributeType === attributeType) - Number(a.payload?.attributeType === attributeType));
    let remaining = amount;
    for (const row of rows) {
      const used = Math.min(remaining, row.quantity);
      row.quantity -= used;
      remaining -= used;
      if (row.quantity <= 0) await manager.remove(row);
      else await manager.save(row);
      if (remaining <= 0) return;
    }
    throw new BadRequestException('material balance changed, please retry');
  }

  private materialMatches(row: InventoryItemEntity, attributeType?: string) {
    if (!attributeType || row.itemConfigId === 'generic_battle_material') return true;
    const itemAttribute = this.normalizeAttribute(String(row.payload?.attributeType || row.payload?.attribute_type || ''));
    return !itemAttribute || itemAttribute === attributeType;
  }

  private serializeMaterial(row: InventoryItemEntity) {
    return { itemId: row.id, itemConfigId: row.itemConfigId, materialType: String(row.payload?.materialType || row.itemConfigId), attributeType: row.payload?.attributeType || null, count: row.quantity, payload: row.payload };
  }

  private async lockEquipment(manager: EntityManager, playerId: string, itemId: string) {
    const item = await manager.findOne(InventoryItemEntity, { where: { id: itemId, playerId }, lock: { mode: 'pessimistic_write' } });
    if (!item) throw new NotFoundException('equipment not found');
    if (item.itemType !== 'equipment') throw new BadRequestException('only equipment set pieces can be enhanced');
    return item;
  }

  private async getEquipment(playerId: string, itemId: string) {
    const item = await this.inventory.findOne({ where: { id: itemId, playerId } });
    if (!item) throw new NotFoundException('equipment not found');
    if (item.itemType !== 'equipment') throw new BadRequestException('only equipment set pieces can be enhanced');
    return item;
  }

  private breakthroughs(item: InventoryItemEntity) {
    return Array.isArray(item.payload?.breakthroughs) ? item.payload.breakthroughs.map(Number) : [];
  }

  private successRate(rules: EquipmentRules, level: number) {
    const threshold = Object.keys(rules.enhancement.successRates).map(Number).sort((a, b) => b - a).find((value) => level >= value) || 0;
    return Number(rules.enhancement.successRates[String(threshold)] || 1);
  }

  private failureLevel(level: number, breakthroughLevels: number[]) {
    const lower = Math.max(0, level - 1);
    return Math.max(0, ...breakthroughLevels.filter((point) => point <= lower), lower);
  }

  private calculateStats(payload: Record<string, unknown>, level: number, breakthroughCount: number) {
    const base = (payload.baseStats || payload.stats || {}) as Record<string, number>;
    const multiplier = (1 + level * 0.02) * Math.pow(1.2, breakthroughCount);
    return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, Math.round(Number(value || 0) * multiplier)]));
  }

  private buildExclusiveSkill(config: Record<string, unknown> | null) {
    const skills = Array.isArray(config?.skills) ? config.skills as Array<Record<string, unknown>> : [];
    const signature = skills[2] || skills[0] || {};
    return { id: `${String(config?.id || 'character')}_exclusive_skill`, name: `${String(config?.name || 'Character')} Exclusive Effect`, trigger: 'on_skill_cast', sourceSkillSlot: signature.slot || 3, effect: signature.effect || 'Increase final skill damage by 10%.', damageMultiplier: 1.1 };
  }

  private async findCharacterConfig(configId: string) {
    const config = await this.configs.getContentConfig('characters');
    const payload = config.payload as { characters?: Array<Record<string, unknown> & { id: string }> } | null;
    return payload?.characters?.find((item) => item.id === configId) || null;
  }

  private async syncEquippedCopies(manager: EntityManager, item: InventoryItemEntity) {
    const characters = await manager.find(PlayerCharacterEntity, { where: { playerId: item.playerId } });
    for (const character of characters) {
      const equipment = JSON.parse(JSON.stringify(character.equipment || {})) as Record<string, unknown>;
      let changed = false;
      const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const row = value as Record<string, unknown>;
        if (row.itemId === item.id || row.item_id === item.id) {
          row.level = Number(item.payload?.enhancementLevel || 0);
          row.itemData = item.payload;
          row.item_data = item.payload;
          Object.assign(row, item.payload);
          changed = true;
        }
        Object.values(row).forEach(visit);
      };
      visit(equipment);
      if (changed) {
        character.equipment = equipment;
        await manager.save(character);
      }
    }
  }

  private normalizeAttribute(value?: string) {
    const normalized = String(value || '').toUpperCase();
    if (!normalized) return '';
    if (normalized === 'LIGHTNING') return 'THUNDER';
    if (normalized === 'HOLY') return 'LIGHT';
    if (normalized === 'SHADOW') return 'DARK';
    return normalized;
  }

  private async assertPlayer(playerId: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }
}
