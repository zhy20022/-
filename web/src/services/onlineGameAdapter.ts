import { isFormalOnlineMode } from '../config'
import { LegacyPlayerRef, ensureOnlineSession, getApiErrorMessage, onlineApi } from './onlineApi'

export interface OnlineLegacyCharacter {
  character_id: string
  name: string
  profession_type: string
  attribute_type: string
  level: number
  exp: number
  max_level: number
  exp_to_next_level: number
  exp_progress: number
  star: number
  is_locked: boolean
  stats: {
    hp: number
    attack: number
    defense: number
    magic_attack: number
    magic_defense: number
  }
  equipment?: Record<string, unknown>
  skills?: Record<string, unknown>
  online_raw?: Record<string, unknown>
}

export interface OnlineLegacyDungeon {
  dungeon_id: string
  name: string
  dungeon_type: string
  attribute_type: string
  is_unlocked: boolean
  description: string
  duration: number
  difficulty: string
  difficulty_key: string
  difficulty_order: number
  monster_multiplier: number
  reward_multiplier: number
  recommended_level_bonus: number
  reward_config: {
    type: 'experience'
    base_exp: number
    base_gold: number
    spawn_start_time: number
    spawn_interval: number
    spawn_wave_count: number
    allowed_monster_types: string[]
    character_exp_per_single_kill: number
    character_exp_per_five_group_kills: number
  }
  reward_preview: {
    reward_type: string
    title: string
    main: string
    details: string[]
    thresholds: Array<{ label: string; amount: number }>
  }
  recommendation: {
    recommended_level: number
    recommended_attribute: string
    enemy_attribute: string
    attribute_hint: string
    party_size: number
    formation: Array<{ role: string; count: number }>
    summary: string
    roster_status?: {
      matching_attribute_count: number
      recommended_level_ready_count: number
      max_level_count: number
      party_size: number
      ready: boolean
      hint: string
    }
  }
  progress: {
    completion_count: number
    total_attempts: number
    sweep_unlocked: boolean
    sweep_unlock_count: number
    best_record: { duration?: number; rewards?: unknown }
  }
  progress_summary: {
    completion_count: number
    total_attempts: number
    best_time_text: string
    best_reward_text: string
    sweep_unlocked: boolean
    sweep_text: string
    sweep_unlock_count: number
  }
  online_raw?: Record<string, unknown>
}

const attributeNameMap: Record<string, string> = {
  FIRE: '火',
  WATER: '水',
  WIND: '风',
  EARTH: '土',
  LIGHT: '光',
  DARK: '暗',
  THUNDER: '雷',
  WOOD: '木',
}

const difficultyNameMap: Record<string, string> = {
  normal: '普通',
  hard: '困难',
  nightmare: '噩梦',
}

const difficultyOrderMap: Record<string, number> = {
  normal: 1,
  hard: 2,
  nightmare: 3,
}

const characterNameFromConfigId = (configId: string) => {
  const parts = String(configId || '').split('_')
  if (parts.length <= 2) return configId || '未知角色'
  return parts.slice(2).join(' ')
}

const normalizeAttribute = (value: string) => {
  const normalized = String(value || '').toUpperCase()
  if (normalized === 'LIGHTNING') return 'THUNDER'
  if (normalized === 'HOLY') return 'LIGHT'
  if (normalized === 'SHADOW') return 'DARK'
  return normalized
}

const estimateStats = (level: number, professionType: string) => {
  const isTank = professionType.includes('TANK')
  const isHealer = professionType.includes('HEALER') || professionType.includes('SUPPORT')
  const isMagic = professionType.includes('MAGIC') || professionType.includes('HEALER')
  const hp = Math.round((isTank ? 980 : isHealer ? 650 : 720) + level * (isTank ? 42 : 28))
  const attack = Math.round((isHealer ? 70 : 120) + level * (isMagic ? 7 : 9))
  return {
    hp,
    attack,
    defense: Math.round((isTank ? 85 : 48) + level * (isTank ? 5 : 3)),
    magic_attack: Math.round((isMagic ? 130 : 70) + level * (isMagic ? 9 : 5)),
    magic_defense: Math.round((isTank || isHealer ? 72 : 45) + level * 4),
  }
}

export const mapOnlineCharacter = (character: any): OnlineLegacyCharacter => {
  const level = Number(character.level || 1)
  const expToNext = Number(character.expToNextLevel || character.exp_to_next_level || 100)
  const exp = Number(character.exp || 0)
  const professionType = character.professionType || character.profession_type || 'UNKNOWN'
  const name =
    character.name ||
    character.displayName ||
    character.equipment?.name ||
    character.equipment?.characterName ||
    characterNameFromConfigId(character.characterConfigId || character.character_config_id)
  return {
    character_id: character.id || character.character_id,
    name,
    profession_type: professionType,
    attribute_type: normalizeAttribute(character.attributeType || character.attribute_type),
    level,
    exp,
    max_level: Number(character.maxLevel || character.max_level || 100),
    exp_to_next_level: expToNext,
    exp_progress: expToNext > 0 ? exp / expToNext : 0,
    star: Math.min(5, Math.floor(level / 20) + 1),
    is_locked: Boolean(character.locked || character.is_locked),
    stats: estimateStats(level, professionType),
    equipment: character.equipment || {},
    skills: character.skillSlots || character.skills || {},
    online_raw: character,
  }
}

const mapProgress = (progressRows: any[], dungeonId: string, sweepUnlockCount: number) => {
  const row = progressRows.find((item) => item.dungeonId === dungeonId || item.dungeon_id === dungeonId)
  const successfulAttempts = Number(row?.successfulAttempts ?? row?.successful_attempts ?? 0)
  const totalAttempts = Number(row?.totalAttempts ?? row?.total_attempts ?? 0)
  const bestDuration = Number(row?.bestDuration ?? row?.best_duration ?? row?.bestRecord?.duration ?? row?.best_record?.duration ?? 0)
  const sweepUnlocked = successfulAttempts >= sweepUnlockCount
  return {
    completion_count: successfulAttempts,
    total_attempts: totalAttempts,
    sweep_unlocked: sweepUnlocked,
    sweep_unlock_count: sweepUnlockCount,
    best_record: bestDuration > 0 ? { duration: bestDuration, rewards: row?.rewards } : {},
  }
}

export const mapOnlineDungeon = (dungeon: any, progressRows: any[] = [], characters: OnlineLegacyCharacter[] = []): OnlineLegacyDungeon => {
  const difficulty = dungeon.difficulty || 'normal'
  const attribute = normalizeAttribute(dungeon.attributeType || dungeon.attribute_type)
  const rewardConfig = dungeon.rewardConfig || dungeon.reward_config || {}
  const fullExp = Number(rewardConfig.fullExp || rewardConfig.base_exp || 0)
  const gold = Number(rewardConfig.gold || rewardConfig.base_gold || 0)
  const sweepUnlockCount = Number(dungeon.sweepUnlockCount || dungeon.sweep_unlock_count || 50)
  const progress = mapProgress(progressRows, dungeon.dungeonId || dungeon.dungeon_id, sweepUnlockCount)
  const matchingCount = characters.filter((character) => normalizeAttribute(character.attribute_type) === attribute).length
  const readyCount = characters.filter((character) => normalizeAttribute(character.attribute_type) === attribute && character.level >= 1).length
  return {
    dungeon_id: dungeon.dungeonId || dungeon.dungeon_id,
    name: dungeon.name,
    dungeon_type: dungeon.dungeonType || dungeon.dungeon_type || 'SINGLE',
    attribute_type: attribute,
    is_unlocked: true,
    description: `仅限${attributeNameMap[attribute] || attribute}系角色进入，持续 60 秒，每 3 秒刷新一波单体或群体小怪。`,
    duration: Number(dungeon.duration || 60),
    difficulty: difficultyNameMap[difficulty] || difficulty,
    difficulty_key: difficulty,
    difficulty_order: difficultyOrderMap[difficulty] || 1,
    monster_multiplier: difficultyOrderMap[difficulty] || 1,
    reward_multiplier: 1,
    recommended_level_bonus: difficulty === 'normal' ? 1 : difficulty === 'hard' ? 25 : 55,
    reward_config: {
      type: 'experience',
      base_exp: fullExp,
      base_gold: gold,
      spawn_start_time: Number(rewardConfig.spawnStartTime || 0),
      spawn_interval: Number(rewardConfig.spawnInterval || 3),
      spawn_wave_count: Number(rewardConfig.spawnWaveCount || 20),
      allowed_monster_types: rewardConfig.allowedMonsterTypes || ['SINGLE', 'GROUP_5'],
      character_exp_per_single_kill: Number(rewardConfig.characterExpPerSingleKill || 1),
      character_exp_per_five_group_kills: Number(rewardConfig.characterExpPerFiveGroupKills || 1),
    },
    reward_preview: {
      reward_type: 'experience',
      title: '经验结晶与金币',
      main: `满时长：经验结晶 ${fullExp}，金币 ${gold}`,
      details: ['15秒/30秒/45秒分别获得 15%/40%/65% 经验结晶，满 60 秒获得 100% 并发放金币。', '击杀单体小怪或 5 个群体小怪会给参战角色 1 点直接经验。'],
      thresholds: [
        { label: '15秒', amount: Math.floor(fullExp * 0.15) },
        { label: '30秒', amount: Math.floor(fullExp * 0.4) },
        { label: '45秒', amount: Math.floor(fullExp * 0.65) },
        { label: '60秒', amount: fullExp },
      ],
    },
    recommendation: {
      recommended_level: difficulty === 'normal' ? 1 : difficulty === 'hard' ? 25 : 55,
      recommended_attribute: attribute,
      enemy_attribute: attribute,
      attribute_hint: `经验本要求同属性角色进入：${attributeNameMap[attribute] || attribute}系角色优先。`,
      party_size: 1,
      formation: [{ role: '任意同属性角色', count: 1 }],
      summary: '单人经验本用于获得通用角色经验结晶，并少量提升参战角色自身经验。',
      roster_status: {
        matching_attribute_count: matchingCount,
        recommended_level_ready_count: readyCount,
        max_level_count: characters.filter((character) => normalizeAttribute(character.attribute_type) === attribute && character.level >= 100).length,
        party_size: 1,
        ready: matchingCount > 0,
        hint: matchingCount > 0 ? `已有 ${matchingCount} 名同属性角色可挑战。` : `暂无${attributeNameMap[attribute] || attribute}系角色，请先去角色池抽取。`,
      },
    },
    progress,
    progress_summary: {
      completion_count: progress.completion_count,
      total_attempts: progress.total_attempts,
      best_time_text: progress.best_record.duration ? `${progress.best_record.duration.toFixed(1)}秒` : '暂无',
      best_reward_text: progress.completion_count > 0 ? `满额经验结晶 ${fullExp}` : '暂无记录',
      sweep_unlocked: progress.sweep_unlocked,
      sweep_text: progress.sweep_unlocked ? '已解锁' : `${progress.completion_count}/${sweepUnlockCount}`,
      sweep_unlock_count: sweepUnlockCount,
    },
    online_raw: dungeon,
  }
}

export const loadOnlineProfile = async (legacyPlayer: LegacyPlayerRef | null | undefined) => {
  const session = await ensureOnlineSession(legacyPlayer)
  const response = await onlineApi.get(`/players/${session.player.id}/profile`)
  const characters = (response.data?.characters || []).map(mapOnlineCharacter)
  return {
    session,
    player: response.data?.player || session.player,
    characters,
    inventory: response.data?.inventory || [],
    mails: response.data?.mails || [],
  }
}

export const loadOnlineDungeons = async (legacyPlayer: LegacyPlayerRef | null | undefined) => {
  const profile = await loadOnlineProfile(legacyPlayer)
  const [dungeonResponse, progressResponse] = await Promise.all([
    onlineApi.get('/dungeons'),
    onlineApi.get(`/battle-settlement/${profile.session.player.id}/progress`),
  ])
  const rawDungeons = dungeonResponse.data?.dungeons || []
  return {
    ...profile,
    dungeons: rawDungeons.map((dungeon: any) => mapOnlineDungeon(dungeon, progressResponse.data || [], profile.characters)),
  }
}

export const getOnlineModeError = (error: unknown, fallback: string) => getApiErrorMessage(error, fallback)

export { isFormalOnlineMode, onlineApi, ensureOnlineSession }
