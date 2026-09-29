import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  AchievementProgressEntity,
  BattleRecordEntity,
  DungeonProgressEntity,
  FriendAssistRecordEntity,
  FriendshipEntity,
  InventoryItemEntity,
  PlayerCharacterEntity,
  PlayerEntity,
  QuestProgressEntity,
  RankingEntryEntity,
  ShopPurchaseEntity,
  WorldBossChestEntity,
  WorldBossStateEntity,
} from '../database/entities';
import { IdempotencyService } from '../common/idempotency.service';
import { InventoryGrantItem, InventoryService } from '../inventory/inventory.service';
import { FriendsAssistService } from '../friends-assist/friends-assist.service';
import { RankingService } from '../ranking/ranking.service';
import { DungeonsService } from '../dungeons/dungeons.service';

type Reward = { exp?: number; gold?: number; materials?: Record<string, number> };
type FeatureStats = {
  battles: number;
  dungeons: number;
  characterCount: number;
  equipmentMaxLevel: number;
  dungeonTypes: number;
  assists: number;
  equipmentUpgrades: number;
};
type QuestDefinition = {
  id: string;
  name: string;
  type: 'MAIN' | 'DAILY' | 'WEEKLY';
  description: string;
  objective: { id: string; description: string; event: 'dungeon_clear' | 'equipment_upgrade' | 'friend_assist'; target: number };
  reward: Reward;
};
type AchievementDefinition = {
  id: string;
  name: string;
  description: string;
  category: string;
  rarity: string;
  target: number;
  current: (stats: FeatureStats) => number;
  reward: Reward;
  icon: string;
  hidden?: boolean;
};

const QUESTS: QuestDefinition[] = [
  { id: 'main_001', name: '初入游戏', type: 'MAIN', description: '完成第一次副本挑战', objective: { id: 'obj_001', description: '完成任意副本1次', event: 'dungeon_clear', target: 1 }, reward: { exp: 100, gold: 1000 } },
  { id: 'daily_001', name: '每日副本', type: 'DAILY', description: '完成3次副本', objective: { id: 'obj_daily_001', description: '完成任意副本3次', event: 'dungeon_clear', target: 3 }, reward: { exp: 50, gold: 500 } },
  { id: 'daily_002', name: '每日强化', type: 'DAILY', description: '强化装备1次', objective: { id: 'obj_daily_002', description: '强化任意装备1次', event: 'equipment_upgrade', target: 1 }, reward: { exp: 30, gold: 300 } },
  { id: 'weekly_001', name: '团队协作', type: 'WEEKLY', description: '使用一次好友助战', objective: { id: 'obj_weekly_001', description: '完成一次好友助战', event: 'friend_assist', target: 1 }, reward: { gold: 1000, materials: { generic_battle_material: 3 } } },
];

const ACHIEVEMENTS: AchievementDefinition[] = [
  { id: 'combat_001', name: '初出茅庐', description: '完成第一次战斗', category: 'COMBAT', rarity: 'COMMON', target: 1, current: (s) => s.battles, reward: { exp: 100, gold: 500 }, icon: 'combat_001.png' },
  { id: 'combat_002', name: '百战不殆', description: '完成100次战斗', category: 'COMBAT', rarity: 'RARE', target: 100, current: (s) => s.battles, reward: { exp: 1000, gold: 5000 }, icon: 'combat_002.png' },
  { id: 'dungeon_001', name: '副本探索者', description: '完成四种副本各1次', category: 'DUNGEON', rarity: 'EPIC', target: 4, current: (s) => s.dungeonTypes, reward: { exp: 500, gold: 2000, materials: { generic_battle_material: 5 } }, icon: 'dungeon_001.png' },
  { id: 'character_001', name: '角色收集家', description: '拥有10个角色', category: 'CHARACTER', rarity: 'RARE', target: 10, current: (s) => s.characterCount, reward: { exp: 300, gold: 1500 }, icon: 'character_001.png' },
  { id: 'equipment_001', name: '装备大师', description: '拥有1件强化+50的装备', category: 'EQUIPMENT', rarity: 'LEGENDARY', target: 50, current: (s) => s.equipmentMaxLevel, reward: { exp: 2000, gold: 10000, materials: { generic_battle_material: 20 } }, icon: 'equipment_001.png', hidden: true },
];

const SHOP_ITEMS: Array<{
  id: string;
  name: string;
  attribute: string;
  kind: 'equipment' | 'material';
  cost: Record<string, number>;
  limit: number;
  description: string;
}> = ['FIRE', 'WATER', 'WIND', 'EARTH', 'LIGHT', 'DARK', 'THUNDER', 'WOOD'].flatMap((attribute) => [
  { id: `equip_${attribute.toLowerCase()}`, name: `${attribute}系装备箱`, attribute, kind: 'equipment' as const, cost: { equipment_material: 5 } as Record<string, number>, limit: 5, description: `兑换获得${attribute}属性套装部件` },
  { id: `material_${attribute.toLowerCase()}`, name: `${attribute}属性材料包`, attribute, kind: 'material' as const, cost: { exclusive_material: 10 } as Record<string, number>, limit: 10, description: `兑换获得${attribute}属性专属材料` },
]);

@Injectable()
export class OnlineFeaturesService {
  constructor(
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    @InjectRepository(InventoryItemEntity) private readonly inventory: Repository<InventoryItemEntity>,
    @InjectRepository(PlayerCharacterEntity) private readonly characters: Repository<PlayerCharacterEntity>,
    @InjectRepository(BattleRecordEntity) private readonly battles: Repository<BattleRecordEntity>,
    @InjectRepository(DungeonProgressEntity) private readonly dungeonProgress: Repository<DungeonProgressEntity>,
    @InjectRepository(QuestProgressEntity) private readonly questsProgress: Repository<QuestProgressEntity>,
    @InjectRepository(AchievementProgressEntity) private readonly achievementsProgress: Repository<AchievementProgressEntity>,
    @InjectRepository(ShopPurchaseEntity) private readonly shopPurchases: Repository<ShopPurchaseEntity>,
    @InjectRepository(WorldBossStateEntity) private readonly worldBossStates: Repository<WorldBossStateEntity>,
    @InjectRepository(WorldBossChestEntity) private readonly worldBossChests: Repository<WorldBossChestEntity>,
    @InjectRepository(FriendshipEntity) private readonly friendships: Repository<FriendshipEntity>,
    private readonly idempotency: IdempotencyService,
    private readonly inventoryService: InventoryService,
    private readonly friends: FriendsAssistService,
    private readonly ranking: RankingService,
    private readonly dungeons: DungeonsService,
  ) {}

  async shop(playerId: string) {
    const [rows, purchases] = await Promise.all([
      this.inventory.find({ where: { playerId, itemType: In(['material', 'fragment', 'consumable']) } }),
      this.shopPurchases.find({ where: { playerId, periodKey: this.monthKey() } }),
    ]);
    const items = SHOP_ITEMS.map((item) => {
      const purchased = purchases.find((row) => row.itemId === item.id)?.quantity || 0;
      return {
        item_id: item.id,
        name: item.name,
        attribute_type: item.attribute,
        cost: item.cost,
        icon: '',
        description: item.description,
        purchase_limit: item.limit,
        purchased_count: purchased,
        remaining_count: Math.max(0, item.limit - purchased),
      };
    });
    return {
      success: true,
      period_key: this.monthKey(),
      items: this.groupByAttribute(items),
      materials: Object.fromEntries(rows.map((row) => [row.id, {
        material_type: row.itemConfigId,
        attribute_type: row.payload?.attributeType || null,
        count: row.quantity,
      }])),
    };
  }

  async exchangeShopItem(playerId: string, itemId: string, idempotencyKey?: string) {
    const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
    if (!item) throw new NotFoundException('shop item not found');
    const periodKey = this.monthKey();
    return this.idempotency.execute(playerId, 'online-shop-exchange', idempotencyKey, { itemId, periodKey }, async ({ manager, player }) => {
      const purchaseRepo = manager.getRepository(ShopPurchaseEntity);
      let purchase = await purchaseRepo.findOne({ where: { playerId, itemId, periodKey }, lock: { mode: 'pessimistic_write' } });
      if ((purchase?.quantity || 0) >= item.limit) throw new BadRequestException('shop purchase limit reached');
      await this.consumeMaterials(manager, playerId, item.cost, item.attribute);
      const reward: InventoryGrantItem = item.kind === 'equipment'
        ? { itemConfigId: `shop_${item.attribute.toLowerCase()}_${Date.now()}`, itemType: 'equipment', quantity: 1, payload: { name: item.name, attributeType: item.attribute, quality: 'rare', slot: 'ACCESSORY', enhancementLevel: 0, baseStats: { hp_bonus: 100, attack_bonus: 50 } } }
        : { itemConfigId: `exclusive_material_${item.attribute.toLowerCase()}`, itemType: 'material', quantity: 1, payload: { name: `${item.attribute}专属材料`, attributeType: item.attribute, materialType: 'EXCLUSIVE_ITEM' } };
      const [savedReward] = await this.inventoryService.grant(playerId, [reward], 'online_shop', manager);
      purchase = purchase || purchaseRepo.create({ playerId, itemId, periodKey, quantity: 0 });
      purchase.quantity += 1;
      await purchaseRepo.save(purchase);
      return { success: true, message: '兑换成功', reward: savedReward, purchase: { purchased_count: purchase.quantity, remaining_count: item.limit - purchase.quantity }, player };
    });
  }

  async social(playerId: string) {
    const rows = await this.friends.listFriends(playerId);
    const player = await this.players.findOneByOrFail({ id: playerId });
    return {
      success: true,
      friends: rows.map((row) => ({
        friend_id: row.friend?.id || '',
        username: row.friend?.displayName || '',
        last_active_at: row.friend?.updatedAt || new Date().toISOString(),
        support_attribute: null,
        assist_available: true,
      })),
      assist_enabled: Boolean(player.flags?.['assistEnabled']),
    };
  }

  async addFriend(playerId: string, username: string) {
    const target = await this.players.findOne({ where: { displayName: username } });
    if (!target) throw new NotFoundException('player not found');
    if (target.id === playerId) throw new BadRequestException('cannot add yourself');
    const existing = await this.findFriendship(playerId, target.id);
    if (!existing) await this.friendships.save(this.friendships.create({ requesterPlayerId: playerId, addresseePlayerId: target.id, status: 'accepted' }));
    else if (existing.status !== 'accepted') {
      existing.status = 'accepted';
      await this.friendships.save(existing);
    }
    return this.social(playerId);
  }

  async removeFriend(playerId: string, friendId: string) {
    const rows = await this.friendships.find({
      where: [
        { requesterPlayerId: playerId, addresseePlayerId: friendId },
        { requesterPlayerId: friendId, addresseePlayerId: playerId },
      ],
    });
    if (rows.length) await this.friendships.remove(rows);
    return this.social(playerId);
  }

  async setAssistMode(playerId: string, enabled: boolean) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    player.flags = { ...(player.flags || {}), assistEnabled: enabled };
    await this.players.save(player);
    return { success: true, assist_enabled: enabled };
  }

  async listQuests(playerId: string, type: string) {
    const rows = await this.questsProgress.find({ where: { playerId } });
    const definitions = QUESTS.filter((quest) => type === 'all' || quest.type.toLowerCase() === type.toLowerCase());
    const now = new Date();
    return { success: true, quests: await Promise.all(definitions.map(async (definition) => {
      const periodKey = this.questPeriodKey(definition, now);
      const stats = await this.questStats(playerId, definition, periodKey);
      return this.serializeQuest(definition, rows.find((row) => row.questId === definition.id && row.periodKey === periodKey), stats);
    })) };
  }

  async acceptQuest(playerId: string, questId: string) {
    const definition = this.questDefinition(questId);
    const periodKey = this.questPeriodKey(definition);
    return this.idempotency.execute(playerId, 'online-quest-accept', undefined, { questId, periodKey }, async ({ manager }) => {
      const questRepo = manager.getRepository(QuestProgressEntity);
      let row = await questRepo.findOne({ where: { playerId, questId, periodKey }, lock: { mode: 'pessimistic_write' } });
      if (row?.status === 'CLAIMED' || row?.status === 'IN_PROGRESS') throw new BadRequestException('quest already accepted');
      row = row || questRepo.create({ playerId, questId, periodKey, status: 'AVAILABLE', objectivesProgress: {} });
      row.status = 'IN_PROGRESS';
      row.acceptedAt = row.acceptedAt || new Date();
      const saved = await questRepo.save(row);
      return { success: true, quest: this.serializeQuest(definition, saved, await this.questStats(playerId, definition, periodKey, manager)) };
    });
  }

  async claimQuest(playerId: string, questId: string, idempotencyKey?: string) {
    const definition = this.questDefinition(questId);
    const periodKey = this.questPeriodKey(definition);
    return this.idempotency.execute(playerId, 'online-quest-claim', idempotencyKey, { questId, periodKey }, async ({ manager, player }) => {
      const row = await manager.getRepository(QuestProgressEntity).findOne({ where: { playerId, questId, periodKey }, lock: { mode: 'pessimistic_write' } });
      const current = this.serializeQuest(definition, row || undefined, await this.questStats(playerId, definition, periodKey, manager));
      if (current.status !== 'COMPLETED') throw new BadRequestException('quest is not complete');
      await this.grantReward(manager, player, definition.reward, 'quest');
      row!.status = 'CLAIMED';
      row!.claimedAt = new Date();
      const saved = await manager.getRepository(QuestProgressEntity).save(row!);
      return { success: true, quest: this.serializeQuest(definition, saved, await this.questStats(playerId, definition, periodKey, manager)), reward: definition.reward };
    });
  }

  async listAchievements(playerId: string, category: string, rarity: string) {
    const stats = await this.stats(playerId);
    const rows = await this.achievementsProgress.find({ where: { playerId } });
    const result = ACHIEVEMENTS
      .filter((item) => category === 'all' || item.category.toLowerCase() === category.toLowerCase())
      .filter((item) => rarity === 'all' || item.rarity.toLowerCase() === rarity.toLowerCase())
      .map((definition) => this.serializeAchievement(definition, rows.find((row) => row.achievementId === definition.id), stats));
    return { success: true, achievements: result };
  }

  async checkAchievements(playerId: string, idempotencyKey?: string) {
    return this.idempotency.execute(playerId, 'online-achievement-check', idempotencyKey, {}, async ({ manager, player }) => {
      const stats = await this.stats(playerId, manager);
      const achievementRepo = manager.getRepository(AchievementProgressEntity);
      const newlyUnlocked: Array<Record<string, unknown>> = [];
      for (const definition of ACHIEVEMENTS) {
        let row = await achievementRepo.findOne({
          where: { playerId, achievementId: definition.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!row) row = achievementRepo.create({ playerId, achievementId: definition.id, progress: {} });
        const current = definition.current(stats);
        row.progress = { current: Math.min(current, definition.target), target: definition.target };
        if (!row.unlocked && current >= definition.target) {
          row.unlocked = true;
          row.unlockedAt = new Date();
          await this.grantReward(manager, player, definition.reward, 'achievement');
          newlyUnlocked.push(this.serializeAchievement(definition, row, stats));
        }
        await achievementRepo.save(row);
      }
      return { success: true, newly_unlocked: newlyUnlocked };
    });
  }

  async worldBossList(playerId: string) {
    const dungeons = this.dungeons.list().dungeons.filter((dungeon) => dungeon.dungeonType === 'SERVER_BOSS');
    return { success: true, season_id: this.seasonKey(), dungeons: await Promise.all(dungeons.map((dungeon) => this.worldBossStatus(playerId, dungeon.dungeonId))) };
  }

  async worldBossStatus(playerId: string, dungeonId: string) {
    const dungeon = this.dungeons.get(dungeonId);
    if (dungeon.dungeonType !== 'SERVER_BOSS') throw new NotFoundException('world boss not found');
    const seasonId = this.seasonKey();
    await this.worldBossStates.createQueryBuilder()
      .insert()
      .values({ dungeonId, seasonId, currentLayer: 1, currentLayerDamage: 0, currentLayerMaxHp: 1000000, layerHistory: [], announcements: [] })
      .orIgnore()
      .execute();
    const state = await this.worldBossStates.findOneByOrFail({ dungeonId, seasonId });
    const ranking = await this.ranking.leaderboard(`world_boss:${dungeonId}`, seasonId, 100);
    const own = await this.ranking.getPlayerRank(playerId, `world_boss:${dungeonId}`, seasonId);
    const chests = await this.worldBossChests.find({ where: { playerId, dungeonId, seasonId }, order: { layer: 'DESC' }, take: 20 });
    return {
      dungeon: {
        dungeon_id: dungeon.dungeonId,
        name: dungeon.name,
        attribute_type: dungeon.attributeType,
        difficulty_key: dungeon.difficulty,
        duration: dungeon.duration,
        recommendation: { summary: '全服玩家共同推进层数并领取阶段宝箱。', formation: [{ role: '坦克', count: 4 }, { role: '治疗', count: 4 }, { role: '辅助', count: 3 }, { role: '输出', count: 9 }] },
        boss_summary: { type_label: '全服Boss', description: '所有玩家共享当前层生命值。', boss_count: 1, flags: ['共享层数'], slot_total: 9 },
      },
      season_id: seasonId,
      season: { season_id: seasonId, status: 'active' },
      layer_progress: { current_layer: state.currentLayer, cleared_layers: state.currentLayer - 1, current_layer_damage: state.currentLayerDamage, current_layer_max_hp: state.currentLayerMaxHp, current_layer_progress: state.currentLayerDamage / state.currentLayerMaxHp, next_milestone_layer: Math.ceil(state.currentLayer / 50) * 50, layers_to_next_milestone: Math.max(0, Math.ceil(state.currentLayer / 50) * 50 - state.currentLayer), milestone_fragments_available: Math.floor((state.currentLayer - 1) / 50) * 10 },
      layer_history: state.layerHistory,
      announcements: state.announcements,
      chests: {
        unopened_count: chests.filter((chest) => chest.status === 'unopened').length,
        opened_count: chests.filter((chest) => chest.status === 'opened').length,
        latest: chests.map((chest) => ({
          chest_id: chest.id,
          layer: chest.layer,
          tier: chest.tier,
          status: chest.status,
          reward_payload: chest.rewardPayload,
        })),
        tier_rules: [{ tier: 1, layer_range: '1-49' }, { tier: 2, layer_range: '50-99' }, { tier: 3, layer_range: '100+' }],
      },
      ranking: ranking.map((entry) => ({
        rank: entry.rank,
        player_id: entry.playerId,
        username: entry.playerName,
        max_damage: Number(entry.payload?.['maxDamage'] || entry.score),
        total_damage: entry.score,
        attempts: Number(entry.payload?.['attempts'] || 0),
      })),
      player_ranking: own?.entry ? {
        rank: own.rank,
        player_id: own.entry.playerId,
        username: own.entry.playerName,
        max_damage: Number(own.entry.payload?.['maxDamage'] || own.entry.score),
        total_damage: own.entry.score,
        attempts: Number(own.entry.payload?.['attempts'] || 0),
      } : null,
      settlement: { description: '每50层获得10个立绘碎片。', milestone_rule: { interval_layers: 50, fragments_per_interval: 10, current_fragments: Math.floor((state.currentLayer - 1) / 50) * 10 } },
      rules: { team_size: 20, score_basis: '按玩家累计贡献伤害排名。', future_source: 'server-authoritative' },
    };
  }

  async recordWorldBossDamage(manager: EntityManager, playerId: string, dungeonId: string, damage: number) {
    if (!Number.isSafeInteger(damage) || damage <= 0) return { success: true, damage: 0, cleared_layers: [] as number[] };
    const dungeon = this.dungeons.get(dungeonId);
    if (dungeon.dungeonType !== 'SERVER_BOSS') throw new NotFoundException('world boss not found');
    const seasonId = this.seasonKey();
    const states = manager.getRepository(WorldBossStateEntity);
    await states.createQueryBuilder()
      .insert()
      .values({ dungeonId, seasonId, currentLayer: 1, currentLayerDamage: 0, currentLayerMaxHp: 1000000, layerHistory: [], announcements: [] })
      .orIgnore()
      .execute();
    const state = await states.findOneOrFail({ where: { dungeonId, seasonId }, lock: { mode: 'pessimistic_write' } });
    state.currentLayerDamage += damage;
    const cleared: number[] = [];
    while (state.currentLayerDamage >= state.currentLayerMaxHp) {
      state.currentLayerDamage -= state.currentLayerMaxHp;
      const layer = state.currentLayer;
      state.currentLayer += 1;
      state.layerHistory = [{ history_id: `${dungeonId}-${seasonId}-${layer}`, layer, tier: layer >= 100 ? 3 : layer >= 50 ? 2 : 1, trigger_damage: damage, chests_granted: 1, created_at: new Date().toISOString() }, ...state.layerHistory].slice(0, 100);
      cleared.push(layer);
      const chestRepo = manager.getRepository(WorldBossChestEntity);
      const chest = await chestRepo.findOne({ where: { playerId, dungeonId, seasonId, layer } });
      if (!chest) await chestRepo.save(chestRepo.create({ playerId, dungeonId, seasonId, layer, tier: layer >= 100 ? 3 : layer >= 50 ? 2 : 1, status: 'unopened', rewardPayload: {} }));
    }
    await states.save(state);
    const rankingRepo = manager.getRepository(RankingEntryEntity);
    const rankingKey = `world_boss:${dungeonId}`;
    let rankingEntry = await rankingRepo.findOne({
      where: { playerId, rankingKey, seasonId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!rankingEntry) {
      rankingEntry = rankingRepo.create({
        playerId,
        playerName: (await manager.findOneByOrFail(PlayerEntity, { id: playerId })).displayName,
        rankingKey,
        seasonId,
        score: damage,
        payload: { maxDamage: damage, attempts: 1 },
      });
    } else {
      rankingEntry.score += damage;
      rankingEntry.payload = {
        ...rankingEntry.payload,
        maxDamage: Math.max(Number(rankingEntry.payload?.['maxDamage'] || 0), damage),
        attempts: Number(rankingEntry.payload?.['attempts'] || 0) + 1,
      };
    }
    await rankingRepo.save(rankingEntry);
    return { success: true, damage, cleared_layers: cleared };
  }

  async openChest(playerId: string, dungeonId: string, chestId: string, idempotencyKey?: string) {
    const result = await this.idempotency.execute(playerId, 'world-boss-chest', idempotencyKey, { dungeonId, chestId }, async ({ manager }) => {
      const chest = await manager.getRepository(WorldBossChestEntity).findOne({ where: { id: chestId, playerId, dungeonId }, lock: { mode: 'pessimistic_write' } });
      if (!chest) throw new NotFoundException('chest not found');
      if (chest.status !== 'unopened') throw new BadRequestException('chest already opened');
      const quantity = chest.tier >= 3 ? 5 : chest.tier >= 2 ? 2 : 1;
      const [reward] = await this.inventoryService.grant(playerId, [{ itemConfigId: 'illustration_piece', itemType: 'fragment', quantity, payload: { name: '立绘拼图碎片', source: 'world_boss_chest' } }], 'world_boss_chest', manager);
      chest.status = 'opened';
      chest.rewardPayload = { reward_type: 'illustration_piece', material_count: quantity, granted_count: quantity };
      chest.openedAt = new Date();
      await manager.save(chest);
      return { success: true, chest, reward };
    });
    return { ...result, status: await this.worldBossStatus(playerId, dungeonId) };
  }

  private async stats(playerId: string, manager?: EntityManager): Promise<FeatureStats> {
    const battlesRepo = manager?.getRepository(BattleRecordEntity) || this.battles;
    const progressRepo = manager?.getRepository(DungeonProgressEntity) || this.dungeonProgress;
    const charactersRepo = manager?.getRepository(PlayerCharacterEntity) || this.characters;
    const inventoryRepo = manager?.getRepository(InventoryItemEntity) || this.inventory;
    const assistsRepo = manager?.getRepository(FriendAssistRecordEntity);
    const battles = await battlesRepo.count({ where: { playerId, success: true } });
    const progress = await progressRepo.find({ where: { playerId } });
    const characterCount = await charactersRepo.count({ where: { playerId } });
    const equipment = await inventoryRepo.find({ where: { playerId, itemType: 'equipment' } });
    const assists = assistsRepo
      ? await assistsRepo.count({ where: [{ borrowerPlayerId: playerId }, { helperPlayerId: playerId }] })
      : (await this.friends.assistHistory(playerId)).length;
    const types = new Set(progress.filter((row) => row.successfulAttempts > 0).map((row) => row.dungeonId.split('_type_')[1]?.split('_')[0] || row.dungeonId));
    return { battles, dungeons: progress.reduce((sum, row) => sum + row.successfulAttempts, 0), characterCount, equipmentMaxLevel: Math.max(0, ...equipment.map((row) => Number(row.payload?.enhancementLevel || 0))), dungeonTypes: types.size, assists: Number(assists), equipmentUpgrades: 0 };
  }

  private async questStats(playerId: string, definition: QuestDefinition, periodKey: string, manager?: EntityManager): Promise<FeatureStats> {
    const stats = await this.stats(playerId, manager);
    if (definition.type === 'MAIN') return stats;
    const from = new Date(`${periodKey}T00:00:00+08:00`);
    const until = new Date(from.getTime() + (definition.type === 'WEEKLY' ? 7 : 1) * 24 * 60 * 60 * 1000);
    const db = manager || this.questsProgress.manager;
    // These columns are timestamp without time zone; compare in the database session's time zone.
    const periodFilter = `"createdAt" >= ($1::timestamptz AT TIME ZONE current_setting('TimeZone'))
      AND "createdAt" < ($3::timestamptz AT TIME ZONE current_setting('TimeZone'))`;
    if (definition.objective.event === 'dungeon_clear') {
      const records = await db.query(
        `SELECT "resultPayload" FROM battle_records WHERE "playerId" = $2 AND success = true AND ${periodFilter}`,
        [from, playerId, until],
      ) as Array<{ resultPayload: Record<string, unknown> }>;
      stats.dungeons = records.reduce((sum, record) =>
        sum + (record.resultPayload?.['mode'] === 'sweep' ? Number(record.resultPayload?.['count'] || 1) : 1), 0);
    } else if (definition.objective.event === 'friend_assist') {
      const [record] = await db.query(
        `SELECT count(*)::integer AS count FROM friend_assist_records WHERE "borrowerPlayerId" = $2 AND ${periodFilter}`,
        [from, playerId, until],
      ) as Array<{ count: number }>;
      stats.assists = record.count;
    } else if (definition.objective.event === 'equipment_upgrade') {
      const [record] = await db.query(
        `SELECT count(*)::integer AS count FROM operation_requests
         WHERE "playerId" = $2 AND operation = 'workshop-enhance' AND response->>'success' = 'true' AND ${periodFilter}`,
        [from, playerId, until],
      ) as Array<{ count: number }>;
      stats.equipmentUpgrades = record.count;
    }
    return stats;
  }

  private questPeriodKey(definition: QuestDefinition, now = new Date()) {
    if (definition.type === 'MAIN') return 'permanent';
    const date = this.shanghaiDate(now);
    if (definition.type === 'DAILY') return date;
    const monday = new Date(`${date}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return monday.toISOString().slice(0, 10);
  }

  private shanghaiDate(now: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const part = (type: string) => parts.find((item) => item.type === type)?.value || '01';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private serializeQuest(definition: QuestDefinition, row: QuestProgressEntity | undefined, stats: FeatureStats) {
    const current = definition.objective.event === 'dungeon_clear' ? stats.dungeons : definition.objective.event === 'friend_assist' ? stats.assists : stats.equipmentUpgrades;
    const storedStatus = row?.status;
    const status = storedStatus === 'CLAIMED' ? 'CLAIMED' : storedStatus === 'IN_PROGRESS' && current >= definition.objective.target ? 'COMPLETED' : storedStatus || 'AVAILABLE';
    return { quest_id: definition.id, name: definition.name, quest_type: definition.type, description: definition.description, objectives: [{ objective_id: definition.objective.id, description: definition.objective.description, target_type: definition.objective.event, target_id: null, target_count: definition.objective.target, current_count: Math.min(current, definition.objective.target), is_completed: current >= definition.objective.target }], reward: { exp: definition.reward.exp || 0, gold: definition.reward.gold || 0, materials: definition.reward.materials || {}, items: [] }, status, accepted_at: row?.acceptedAt?.toISOString() || null, completed_at: current >= definition.objective.target ? new Date().toISOString() : null };
  }

  private serializeAchievement(definition: AchievementDefinition, row: AchievementProgressEntity | undefined, stats: FeatureStats) {
    return { achievement_id: definition.id, name: definition.name, description: definition.description, category: definition.category, rarity: definition.rarity, unlocked: Boolean(row?.unlocked), unlocked_at: row?.unlockedAt?.toISOString() || null, reward: definition.reward, icon: definition.icon, hidden: Boolean(definition.hidden && !row?.unlocked), progress: { current: Math.min(definition.current(stats), definition.target), target: definition.target } };
  }

  private async grantReward(manager: EntityManager, player: PlayerEntity, reward: Reward, source: string) {
    player.exp += Number(reward.exp || 0);
    player.gold += Number(reward.gold || 0);
    await manager.save(player);
    const items = Object.entries(reward.materials || {}).map(([itemConfigId, quantity]) => ({ itemConfigId, itemType: 'material', quantity, payload: { source } }));
    if (items.length) await this.inventoryService.grant(player.id, items, source, manager);
  }

  private async consumeMaterials(manager: EntityManager, playerId: string, cost: Record<string, number>, attribute: string) {
    for (const [itemConfigId, amount] of Object.entries(cost)) {
      const aliases: Record<string, string[]> = {
        equipment_material: ['equipment_material', 'equipment_set', 'generic_battle_material'],
        exclusive_material: ['exclusive_material', 'exclusive_item', 'generic_battle_material'],
      };
      const acceptedIds = aliases[itemConfigId] || [itemConfigId, 'generic_battle_material'];
      const rows = (await manager.find(InventoryItemEntity, { where: { playerId, itemType: In(['material', 'fragment']), itemConfigId: In(acceptedIds) }, order: { createdAt: 'ASC' } }))
        .filter((row) => itemConfigId !== 'equipment_material' || !row.payload?.attributeType || row.payload.attributeType === attribute);
      let remaining = amount;
      for (const row of rows) {
        const used = Math.min(remaining, row.quantity);
        row.quantity -= used;
        remaining -= used;
        if (row.quantity <= 0) await manager.remove(row); else await manager.save(row);
        if (remaining <= 0) break;
      }
      if (remaining > 0) throw new BadRequestException('not enough shop materials');
    }
  }

  private groupByAttribute(items: Array<Record<string, unknown>>) {
    return items.reduce<Record<string, Array<Record<string, unknown>>>>((grouped, item) => {
      const key = String(item.attribute_type);
      (grouped[key] ||= []).push(item);
      return grouped;
    }, {});
  }

  private async findFriendship(playerId: string, friendId: string) {
    return this.friendships.findOne({ where: [{ requesterPlayerId: playerId, addresseePlayerId: friendId }, { requesterPlayerId: friendId, addresseePlayerId: playerId }] });
  }

  private questDefinition(questId: string) {
    const definition = QUESTS.find((item) => item.id === questId);
    if (!definition) throw new NotFoundException('quest not found');
    return definition;
  }

  private monthKey() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
  }

  private seasonKey() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === 'year')?.value || 0);
    const month = Number(parts.find((part) => part.type === 'month')?.value || 1);
    return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  }
}
