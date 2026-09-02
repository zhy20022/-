import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GachaRecordEntity, PlayerCharacterEntity, PlayerEntity } from '../database/entities';
import { GameConfigsService } from '../configs/configs.service';
import { DailyGoalsService } from '../daily-goals/daily-goals.service';
import { InventoryService } from '../inventory/inventory.service';

export interface GachaEntry {
  entryId: string;
  type: 'character' | 'item';
  weight: number;
  rarity: string;
  name?: string;
  characterConfigId?: string;
  attributeType?: string;
  professionType?: string;
  itemConfigId?: string;
  itemType?: string;
  quantity?: number;
}

export interface GachaPool {
  key: string;
  name: string;
  cost?: { currency: string; amount: number };
  entries: GachaEntry[];
}

export interface CharacterConfig {
  id: string;
  name: string;
  attributeType: string;
  professionType: string;
  professionName?: string;
  rarity?: string;
  weaponName?: string;
  skills?: Array<Record<string, unknown>>;
}

const DEFAULT_POOL: GachaPool = {
  key: 'starter',
  name: 'Starter Recruitment',
  cost: { currency: 'gold', amount: 160 },
  entries: [
    {
      entryId: 'default_fire_dps',
      type: 'character',
      weight: 60,
      rarity: 'rare',
      characterConfigId: 'fire_dps_001',
      name: 'Fire Vanguard',
      attributeType: 'FIRE',
      professionType: 'PHYSICAL_MELEE_DPS',
    },
    {
      entryId: 'default_gold',
      type: 'item',
      weight: 40,
      rarity: 'common',
      itemConfigId: 'gold_pack_small',
      itemType: 'currency',
      quantity: 500,
      name: 'Small Gold Pack',
    },
  ],
};

@Injectable()
export class GachaService {
  constructor(
    private readonly configs: GameConfigsService,
    private readonly inventory: InventoryService,
    private readonly dailyGoals: DailyGoalsService,
    @InjectRepository(GachaRecordEntity) private readonly records: Repository<GachaRecordEntity>,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    @InjectRepository(PlayerCharacterEntity) private readonly characters: Repository<PlayerCharacterEntity>,
  ) {}

  async listPools() {
    return this.loadPools();
  }

  async draw(playerId: string, poolKey = 'starter', count = 1) {
    if (![1, 10, 100].includes(count)) {
      throw new BadRequestException('draw count must be 1, 10, or 100');
    }
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    const pool = (await this.loadPools()).find((item) => item.key === poolKey);
    if (!pool) throw new NotFoundException('gacha pool not found');

    const costAmount = Number(pool.cost?.amount || 0) * count;
    const costCurrency = this.normalizeCurrency(pool.cost?.currency || 'gold');
    if (costCurrency === 'gold') {
      if (player.gold < costAmount) {
        throw new BadRequestException('not enough gold');
      }
      player.gold -= costAmount;
      await this.players.save(player);
    }

    const results = [];
    for (let index = 0; index < count; index += 1) {
      const entry = this.pickWeighted(pool.entries);
      results.push(await this.applyEntry(playerId, entry));
    }

    const record = await this.records.save(this.records.create({
      playerId,
      poolKey,
      drawCount: count,
      results,
      cost: { currency: costCurrency, amount: costAmount },
    }));
    await this.dailyGoals.recordEvent(playerId, 'gacha_draw', 1, { recordId: record.id, poolKey, count });
    return { player, poolKey, count, cost: record.cost, results, recordId: record.id };
  }

  private async applyEntry(playerId: string, entry: GachaEntry) {
    if (entry.type === 'character') {
      const configId = entry.characterConfigId || entry.entryId;
      const characterConfig = await this.findCharacterConfig(configId);
      const rarity = characterConfig?.rarity || entry.rarity;
      const existing = await this.characters.findOne({ where: { playerId, characterConfigId: configId } });
      if (existing) {
        const shards = await this.inventory.grant(playerId, [{
          itemConfigId: `${configId}_shard`,
          itemType: 'fragment',
          quantity: rarity === 'epic' ? 30 : 10,
          payload: { duplicateCharacter: configId, rarity },
        }], 'gacha_duplicate');
        return { ...entry, ...this.entryFromConfig(characterConfig), duplicate: true, convertedTo: shards[0] };
      }
      const character = await this.characters.save(this.characters.create({
        playerId,
        characterConfigId: configId,
        attributeType: characterConfig?.attributeType || entry.attributeType || 'FIRE',
        professionType: characterConfig?.professionType || entry.professionType || 'PHYSICAL_MELEE_DPS',
        level: 1,
        exp: 0,
        skillSlots: this.skillSlotsFromConfig(characterConfig),
        equipment: {
          configId,
          rarity,
          weaponName: characterConfig?.weaponName || '',
        },
      }));
      return { ...entry, ...this.entryFromConfig(characterConfig), duplicate: false, character };
    }

    const granted = await this.inventory.grant(playerId, [{
      itemConfigId: entry.itemConfigId || entry.entryId,
      itemType: entry.itemType || 'material',
      quantity: Number(entry.quantity || 1),
      payload: { rarity: entry.rarity, name: entry.name || entry.entryId },
    }], 'gacha');
    return { ...entry, granted: granted[0] };
  }

  private pickWeighted(entries: GachaEntry[]) {
    const valid = entries.filter((entry) => entry.weight > 0);
    if (valid.length === 0) throw new BadRequestException('gacha pool has no valid entries');
    const total = valid.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of valid) {
      roll -= entry.weight;
      if (roll <= 0) return entry;
    }
    return valid[valid.length - 1];
  }

  private normalizeCurrency(currency: string) {
    return currency === 'premiumCurrency' ? 'gold' : currency;
  }

  private async loadPools(): Promise<GachaPool[]> {
    const config = await this.configs.getContentConfig('gacha_pools');
    const payload = config.payload as { pools?: GachaPool[] } | null;
    return payload?.pools?.length ? payload.pools : [DEFAULT_POOL];
  }

  private async findCharacterConfig(configId: string): Promise<CharacterConfig | null> {
    const config = await this.configs.getContentConfig('characters');
    const payload = config.payload as { characters?: CharacterConfig[] } | null;
    return payload?.characters?.find((character) => character.id === configId) || null;
  }

  private entryFromConfig(config: CharacterConfig | null) {
    if (!config) return {};
    return {
      name: config.name,
      rarity: config.rarity || 'rare',
      attributeType: config.attributeType,
      professionType: config.professionType,
      professionName: config.professionName,
      weaponName: config.weaponName || '',
      skills: config.skills || [],
    };
  }

  private skillSlotsFromConfig(config: CharacterConfig | null) {
    const skills = config?.skills || [];
    return {
      configId: config?.id,
      configuredSkills: skills,
      skillSlots: Object.fromEntries(
        skills
          .filter((skill) => skill.slot)
          .map((skill) => [String(skill.slot), skill]),
      ),
    };
  }
}
