import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IdempotencyService } from '../common/idempotency.service';
import { BattleRecordEntity, DungeonProgressEntity, InventoryItemEntity, MultiplayerRoomEntity, PlayerCharacterEntity, PlayerEntity, OperationRequestEntity } from '../database/entities';
import { BattleSimulationService, ServerBattle } from '../battle-settlement/battle-simulation.service';
import { FriendsAssistService } from '../friends-assist/friends-assist.service';
import { InventoryService, InventoryGrantItem } from '../inventory/inventory.service';
import { GameConfigsService } from '../configs/configs.service';
import { bossMaterialCount, playbackTime, sweepClearCount, sweepRequirement } from './dungeon-rules';

export interface OnlineDungeon {
  dungeonId: string;
  name: string;
  dungeonType: 'SINGLE' | 'SQUAD' | 'TEAM' | 'SERVER_BOSS';
  attributeType: string;
  difficulty: 'normal' | 'hard' | 'nightmare';
  duration: number;
  timeline?: { bossSpawnTime: number; trashWaveCount: number; trashInterval: number; bossEncounters: number };
  sweepUnlockCount: number;
  rewardConfig: {
    type: 'experience' | 'boss';
    fullExp: number;
    gold: number;
    spawnStartTime: number;
    spawnInterval: number;
    spawnWaveCount: number;
    allowedMonsterTypes: Array<'SINGLE' | 'GROUP_5'>;
    characterExpPerSingleKill: number;
    characterExpPerFiveGroupKills: number;
  };
}

const ATTRIBUTE_DEFS = [
  ['fire', 'FIRE', '火系经验本'],
  ['wood', 'WOOD', '木系经验本'],
  ['wind', 'WIND', '风系经验本'],
  ['water', 'WATER', '水系经验本'],
  ['earth', 'EARTH', '土系经验本'],
  ['lightning', 'THUNDER', '雷系经验本'],
  ['holy', 'LIGHT', '光系经验本'],
  ['shadow', 'DARK', '暗系经验本'],
] as const;

const DIFFICULTIES = [
  ['normal', '', 531, 100],
  ['hard', '_hard', 1381, 250],
  ['nightmare', '_nightmare', 2960, 600],
] as const;

@Injectable()
export class DungeonsService {
  private readonly dungeons = this.buildDungeons();

  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly simulation: BattleSimulationService,
    private readonly friends: FriendsAssistService,
    private readonly inventory: InventoryService,
    private readonly configs: GameConfigsService,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
    @InjectRepository(PlayerCharacterEntity) private readonly characters: Repository<PlayerCharacterEntity>,
  ) {}

  list() {
    return {
      dungeons: this.dungeons,
      version: 1,
    };
  }

  get(dungeonId: string) {
    const dungeon = this.dungeons.find((item) => item.dungeonId === dungeonId);
    if (!dungeon) throw new NotFoundException('dungeon not found');
    return dungeon;
  }

  getOptional(dungeonId: string) {
    return this.dungeons.find((item) => item.dungeonId === dungeonId) || null;
  }

  assertCanEnter(dungeonId: string, characters: PlayerCharacterEntity[]) {
    const dungeon = this.get(dungeonId);
    const expected = { SINGLE: 1, SQUAD: 5, TEAM: 20, SERVER_BOSS: 20 }[dungeon.dungeonType];
    if (characters.length !== expected) {
      throw new BadRequestException(`dungeon requires exactly ${expected} characters`);
    }
    const character = characters[0];
    if (dungeon.dungeonType === 'SINGLE' && character && this.normalizeAttribute(character.attributeType) !== dungeon.attributeType) {
      throw new BadRequestException(`${dungeon.name} can only be entered by ${dungeon.attributeType} characters`);
    }
    return dungeon;
  }

  calculateExperienceRewards(
    dungeon: OnlineDungeon,
    duration: number,
    singleMonstersKilled = 0,
    groupMonstersKilled = 0,
  ) {
    const cappedDuration = Math.max(0, Math.min(Number(duration || 0), dungeon.duration));
    const thresholdRatio = cappedDuration >= 60 ? 1 : cappedDuration >= 45 ? 0.65 : cappedDuration >= 30 ? 0.4 : cappedDuration >= 15 ? 0.15 : 0;
    const maxWaves = Math.min(
      dungeon.rewardConfig.spawnWaveCount,
      Math.max(0, Math.floor(cappedDuration / dungeon.rewardConfig.spawnInterval) + 1),
    );
    const cappedSingleKills = Math.min(Math.max(0, Math.floor(singleMonstersKilled || 0)), maxWaves);
    const cappedGroupKills = Math.min(Math.max(0, Math.floor(groupMonstersKilled || 0)), (maxWaves - cappedSingleKills) * 5);
    const directCharacterExp =
      cappedSingleKills * dungeon.rewardConfig.characterExpPerSingleKill +
      Math.floor(cappedGroupKills / 5) * dungeon.rewardConfig.characterExpPerFiveGroupKills;

    return {
      success: cappedDuration >= dungeon.duration,
      expCrystals: Math.floor(dungeon.rewardConfig.fullExp * thresholdRatio),
      gold: cappedDuration >= dungeon.duration ? dungeon.rewardConfig.gold : 0,
      directCharacterExp,
      cappedDuration,
      thresholdRatio,
      cappedSingleKills,
      cappedGroupKills,
      maxWaves,
    };
  }

  async start(playerId: string, dungeonId: string, characterIds: string[], idempotencyKey?: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    if (!characterIds?.length || characterIds.length > 20 || new Set(characterIds).size !== characterIds.length) throw new BadRequestException('provide 1-20 unique characterIds');
    const battleSeed = idempotencyKey || randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(battleSeed)) throw new BadRequestException('battle start Idempotency-Key must be a UUID');
    const ticket = await this.idempotency.execute(playerId, 'battle-start', battleSeed, { dungeonId, characterIds }, async ({ manager, player }) => {
      if (player.flags?.activeBattleSeed && await manager.findOne(MultiplayerRoomEntity, {
        where: { battleSeed: String(player.flags.activeBattleSeed), status: 'in_battle' },
      })) throw new BadRequestException('settle the room battle before starting another');
      const owned = await manager.find(PlayerCharacterEntity, { where: { playerId, id: In(characterIds) }, lock: { mode: 'pessimistic_write' } });
      const ownedIds = new Set(owned.map((character) => character.id));
      const assistIds = characterIds.filter((characterId) => !ownedIds.has(characterId));
      const assistCharacters = await this.friends.resolveAssistCharacters(playerId, assistIds, manager);
      if (owned.length + assistCharacters.length !== characterIds.length) {
        throw new BadRequestException('all characters must belong to player or accepted friends');
      }
      if (owned.length === 0) throw new BadRequestException('at least one character must belong to player');
      const dungeon = this.get(dungeonId);
      if (dungeon.dungeonType === 'SINGLE' && assistCharacters.length > 0) {
        throw new BadRequestException('friend assist is available for multiplayer dungeons only');
      }
      const characters = characterIds.map((id) =>
        owned.find((character) => character.id === id) ||
        assistCharacters.find((character) => character.id === id)!,
      );
      const characterOwners = Object.fromEntries(characters.map((character) => [character.id, character.playerId]));
      this.assertCanEnter(dungeonId, characters);
      const snapshots = characters.map((character) => ({ ...character, attributeType: this.normalizeAttribute(character.attributeType) }));
      const serverBattle = await this.simulation.simulate({ seed: battleSeed, dungeon, characters: snapshots });
      player.flags = { ...player.flags, activeBattleSeed: battleSeed };
      await manager.save(player);
      return {
        battleSeed,
        playerId,
        characterIds,
        characterOwners,
        assistCharacterIds: assistCharacters.map((character) => character.id),
        dungeon,
        serverBattle,
        engineVersion: serverBattle.engineVersion,
        characters: characters.map((character) => ({
          id: character.id,
          level: character.level,
          attributeType: character.attributeType,
          skillSlots: character.skillSlots,
          equipment: character.equipment,
          equipmentSkillEffects: this.equipmentSkillEffects(character.equipment),
        })),
        serverTime: new Date().toISOString(),
      };
    });
    // Persist the result with the ticket, but do not disclose future outcomes at start.
    const publicTicket: Record<string, unknown> = { ...ticket };
    delete publicTicket.serverBattle;
    return publicTicket;
  }

  async battleStatus(playerId: string, battleSeed: string) {
    const started = await this.players.manager.findOne(OperationRequestEntity, { where: { playerId, operation: 'battle-start', idempotencyKey: battleSeed } });
    const ticket = started?.response;
    const result = ticket?.serverBattle as ServerBattle | undefined;
    if (!result) throw new NotFoundException('server battle not found');
    const elapsed = playbackTime(ticket!);
    const visible = Math.min(elapsed, result.duration);
    const frame = result.frames.filter((item) => item.time <= visible).at(-1) || result.frames[0];
    const ids = new Set(frame.units.map((row) => (row as unknown[])[0]));
    const rows = new Map(frame.units.map((row) => [(row as unknown[])[0], row as unknown[]]));
    const playback = ticket!.playback as { speed: number; agreedPlayerIds: string[]; totalPlayers: number } | undefined;
    return { battleSeed, engineVersion: result.engineVersion, speed: playback?.speed || 4,
      speedConsensus: playback ? { agreed: playback.agreedPlayerIds.length, total: playback.totalPlayers } : undefined,
      ready: elapsed >= result.duration,
      frame, units: Object.fromEntries(Object.entries(result.units).filter(([id]) => ids.has(id)).map(([id, metadata]) =>
        [id, { ...(metadata as Record<string, unknown>), name: rows.get(id)?.[5], maxHealth: rows.get(id)?.[6], currentSkillCycle: rows.get(id)?.[7] }])),
      events: result.events.filter((event) => event.time <= visible),
      outcome: elapsed >= result.duration ? { success: result.success, duration: result.duration, damageScore: result.damageScore } : null };
  }

  async startRoom(manager: EntityManager, dungeonId: string, members: Array<{ playerId: string; characterIds: string[] }>, battleSeed: string, roomId: string) {
    const playerIds = members.map((member) => member.playerId).sort();
    const players = await manager.find(PlayerEntity, {
      where: { id: In(playerIds) }, order: { id: 'ASC' }, lock: { mode: 'pessimistic_write' },
    });
    if (players.length !== playerIds.length) throw new NotFoundException('room player not found');
    if (players.some((player) => player.flags?.activeBattleSeed)) {
      throw new BadRequestException('finish the active battle before starting another room');
    }
    const characterIds = members.flatMap((member) => member.characterIds);
    const characters = await manager.find(PlayerCharacterEntity, {
      where: { id: In(characterIds) }, order: { id: 'ASC' }, lock: { mode: 'pessimistic_write' },
    });
    const ordered = characterIds.map((id) => characters.find((character) => character.id === id));
    if (ordered.some((character, index) => !character ||
        !members.some((member) => member.playerId === character.playerId && member.characterIds.includes(characterIds[index])))) {
      throw new BadRequestException('room characters must belong to their selecting members');
    }
    const roster = ordered as PlayerCharacterEntity[];
    const dungeon = this.assertCanEnter(dungeonId, roster);
    const serverBattle = await this.simulation.simulate({
      seed: battleSeed, dungeon,
      characters: roster.map((character) => ({ ...character, attributeType: this.normalizeAttribute(character.attributeType) })),
    });
    const serverTime = new Date().toISOString();
    const characterOwners = Object.fromEntries(roster.map((character) => [character.id, character.playerId]));
    // One simulation and clock are committed together with every member's entry.
    for (const player of players) {
      player.flags = { ...player.flags, activeBattleSeed: battleSeed };
      await manager.save(player);
      await manager.save(manager.create(OperationRequestEntity, {
        playerId: player.id, operation: 'battle-start', idempotencyKey: battleSeed,
        requestHash: createHash('sha256').update(JSON.stringify({ characterIds, dungeonId })).digest('hex'),
        response: {
          battleSeed, roomId, playerId: player.id, characterIds, characterOwners,
          assistCharacterIds: roster.filter((character) => character.playerId !== player.id).map((character) => character.id),
          dungeon, serverBattle, engineVersion: serverBattle.engineVersion, serverTime,
          playback: { elapsed: 0, updatedAt: serverTime, speed: 1, agreedPlayerIds: [], totalPlayers: members.length },
        },
      }));
    }
    return battleSeed;
  }

  async sweep(playerId: string, dungeonId: string, characterId: string, count: number, idempotencyKey?: string) {
    const dungeon = this.get(dungeonId);
    const sweepCount = Math.max(1, Math.min(10, Math.floor(count || 1)));
    return this.idempotency.execute(playerId, 'dungeon-sweep', idempotencyKey, { dungeonId, characterId, count: sweepCount }, async ({ manager, player }) => {
      const character = await manager.findOne(PlayerCharacterEntity, {
        where: { id: characterId, playerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!character) throw new NotFoundException('character not found');
      if (dungeon.dungeonType === 'SINGLE') this.assertCanEnter(dungeonId, [character]);
      let progress = await manager.findOne(DungeonProgressEntity, { where: { playerId, dungeonId }, lock: { mode: 'pessimistic_write' } });
      if (!progress || sweepClearCount(dungeon.dungeonType, progress) < dungeon.sweepUnlockCount) {
        throw new BadRequestException({ message: dungeon.dungeonType === 'SQUAD' ? 'requires 5 solo clears' : 'sweep is not unlocked',
          requiredClears: dungeon.sweepUnlockCount, currentClears: sweepClearCount(dungeon.dungeonType, progress) });
      }
      if (dungeon.dungeonType !== 'SINGLE') {
        const config = await this.configs.getContentConfig('reward_rules', manager);
        const rules = (config.payload as {
          battleSettlement?: {
            defaultSuccessRewards?: InventoryGrantItem[];
            dungeons?: Array<{ dungeonId: string; successRewards?: InventoryGrantItem[] }>;
          };
        } | null)?.battleSettlement;
        const configured = rules?.dungeons?.find((entry) => entry.dungeonId === dungeonId)?.successRewards;
        const bestBossCount = Number(progress.bestRecord?.maxBossesKilled || 0);
        const materialRewards: InventoryGrantItem[] | null = dungeon.dungeonType === 'SQUAD' || dungeon.dungeonType === 'TEAM'
          ? [{ itemConfigId: dungeon.dungeonType === 'SQUAD' ? 'exclusive_material' : 'equipment_material',
            itemType: 'material', quantity: bossMaterialCount(bestBossCount, bestBossCount, true),
            payload: { materialType: dungeon.dungeonType === 'SQUAD' ? 'EXCLUSIVE_ITEM' : 'EQUIPMENT_SET',
              name: dungeon.dungeonType === 'SQUAD' ? '角色专属道具制作材料' : '套装制作材料', attributeType: dungeon.attributeType } }]
          : null;
        if (materialRewards && bestBossCount < 1) throw new BadRequestException('complete a boss clear under the current reward rules first');
        const baseRewards = materialRewards || (configured?.length ? configured
          : rules?.defaultSuccessRewards?.length ? rules.defaultSuccessRewards
            : [{ itemConfigId: 'generic_battle_material', itemType: 'material', quantity: 1 }]);
        const rewards = await this.inventory.grant(playerId, baseRewards
          .filter((entry) => entry.quantity > 0)
          .map((entry) => ({ ...entry, quantity: entry.quantity * sweepCount })), 'dungeon_sweep', manager);
        progress.totalAttempts += sweepCount;
        progress.successfulAttempts += sweepCount;
        progress.bestRecord = { ...progress.bestRecord, lastSweepAt: new Date().toISOString(), lastSweepCount: sweepCount };
        await manager.save(progress);
        const record = await manager.save(manager.create(BattleRecordEntity, {
          playerId, dungeonId, success: true, duration: 0, damageScore: 0, characterIds: [characterId],
          rewards: { granted: rewards }, resultPayload: { mode: 'sweep', count: sweepCount },
        }));
        return { success: true, sweepCount, rewards: { items: rewards },
          materialsAwarded: rewards.map((entry) => ({ name: entry.payload?.name || entry.itemConfigId, count: entry.quantity })),
          player, progress, record };
      }
      const expCrystals = dungeon.rewardConfig.fullExp * sweepCount;
      const gold = dungeon.rewardConfig.gold * sweepCount;
      let expItem = await manager.findOne(InventoryItemEntity, { where: { playerId, itemConfigId: 'character_exp_crystal', itemType: 'material' }, lock: { mode: 'pessimistic_write' } });
      if (!expItem) {
        expItem = manager.create(InventoryItemEntity, { playerId, itemConfigId: 'character_exp_crystal', itemType: 'material', quantity: 0, payload: { materialType: 'CHARACTER_EXP', name: 'Universal Character Experience Crystal', source: 'experience_dungeon_sweep' } });
      }
      const before = expItem.quantity;
      expItem.quantity = Math.min(999_999_999, before + expCrystals);
      expItem.payload = { ...expItem.payload, lastSource: 'experience_dungeon_sweep' };
      await manager.save(expItem);
      player.gold += gold;
      await manager.save(player);
      progress.totalAttempts += sweepCount;
      progress.successfulAttempts += sweepCount;
      progress.bestRecord = { ...(progress.bestRecord || {}), lastSweepAt: new Date().toISOString(), lastSweepCount: sweepCount };
      progress = await manager.save(progress);
      const record = await manager.save(manager.create(BattleRecordEntity, {
        playerId,
        dungeonId,
        success: true,
        duration: 0,
        damageScore: 0,
        characterIds: [characterId],
        rewards: { gold, expCrystals: expItem.quantity - before },
        resultPayload: { mode: 'sweep', count: sweepCount },
      }));
      return {
        success: true,
        message: 'sweep completed',
        sweepCount,
        rewards: { gold, expCrystals: expItem.quantity - before, requestedExpCrystals: expCrystals, capped: expItem.quantity - before < expCrystals },
        materialsAwarded: [{ itemConfigId: 'character_exp_crystal', name: 'Experience Crystal', count: expItem.quantity - before }],
        player,
        progress,
        recordId: record.id,
      };
    });
  }

  private equipmentSkillEffects(equipment: Record<string, unknown>) {
    const effects: unknown[] = [];
    const seen = new Set<string>();
    const add = (effect: unknown) => {
      if (!effect || typeof effect !== 'object') return;
      const key = String((effect as Record<string, unknown>).id || JSON.stringify(effect));
      if (seen.has(key)) return;
      seen.add(key);
      effects.push(effect);
    };
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const payload = value as Record<string, unknown>;
      add(payload.specialSkill);
      add(payload.special_skill);
      Object.values(payload).forEach(visit);
    };
    visit(equipment);
    return effects;
  }

  private normalizeAttribute(value: string) {
    const normalized = String(value || '').toUpperCase();
    if (normalized === 'LIGHTNING') return 'THUNDER';
    if (normalized === 'HOLY') return 'LIGHT';
    if (normalized === 'SHADOW') return 'DARK';
    return normalized;
  }

  private buildDungeons(): OnlineDungeon[] {
    const teamBalance = JSON.parse(readFileSync(resolve(process.env.BATTLE_WORKER_ROOT || '..',
      'data/content/team-dungeon-balance.json'), 'utf8')) as Record<'SQUAD' | 'TEAM', {
        duration: number; bossSpawnTime: number; trashWaveCount: number; trashInterval: number;
      }>;
    const experience = ATTRIBUTE_DEFS.flatMap(([idPrefix, attributeType, name]) => (
      DIFFICULTIES.map(([difficulty, suffix, fullExp, gold]) => ({
        dungeonId: `${idPrefix}_type_single_001${suffix}`,
        name: difficulty === 'normal' ? name : `${name}-${difficulty}`,
        dungeonType: 'SINGLE' as const,
        attributeType,
        difficulty,
        duration: 60,
        sweepUnlockCount: 10,
        rewardConfig: {
          type: 'experience' as const,
          fullExp,
          gold,
          spawnStartTime: 0,
          spawnInterval: 3,
          spawnWaveCount: 20,
          allowedMonsterTypes: ['SINGLE', 'GROUP_5'] as Array<'SINGLE' | 'GROUP_5'>,
          characterExpPerSingleKill: 1,
          characterExpPerFiveGroupKills: 1,
        },
      }))
    ));
    const bosses: OnlineDungeon[] = ATTRIBUTE_DEFS.flatMap(([prefix, attributeType, name]) =>
      (['SQUAD', 'TEAM', 'SERVER_BOSS'] as const).map((dungeonType) => ({
        dungeonId: `${prefix}_type_${dungeonType.toLowerCase()}_001`,
        name: `${name.replace('经验本', '')}-${{ SQUAD: '五人本', TEAM: '二十人本', SERVER_BOSS: '全服Boss挑战' }[dungeonType]}`,
        attributeType, dungeonType, difficulty: 'normal' as const,
        duration: dungeonType === 'SERVER_BOSS' ? 180 : teamBalance[dungeonType].duration, sweepUnlockCount: sweepRequirement(dungeonType),
        ...(dungeonType === 'SERVER_BOSS' ? {} : { timeline: {
          bossSpawnTime: teamBalance[dungeonType].bossSpawnTime,
          trashWaveCount: teamBalance[dungeonType].trashWaveCount,
          trashInterval: teamBalance[dungeonType].trashInterval, bossEncounters: 1,
        } }),
        rewardConfig: { type: 'boss' as const, fullExp: 0, gold: 0, spawnStartTime: 0, spawnInterval: 3,
          spawnWaveCount: 0, allowedMonsterTypes: ['SINGLE', 'GROUP_5'], characterExpPerSingleKill: 0, characterExpPerFiveGroupKills: 0 },
      })));
    return [...experience, ...bosses];
  }
}
