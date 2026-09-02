import axios, { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { CHARACTER_POOL, CharacterPoolEntry } from '../data/characterPool'

interface DemoCharacter {
  character_id: string
  config_id?: string
  name: string
  profession_type: string
  attribute_type: string
  level: number
  exp: number
  max_level: number
  exp_to_next_level: number
  exp_progress: number
  rarity?: string
  weapon_name?: string
  skills?: CharacterPoolEntry['skills']
  stats?: Record<string, number>
}

interface DemoDungeon {
  dungeon_id: string
  name: string
  dungeon_type: string
  attribute_type: string
  is_unlocked: boolean
  description: string
  duration: number
  difficulty: string
  difficulty_key: string
  difficulty_order?: number
  recommended_level_bonus?: number
  monster_multiplier?: number
  reward_multiplier?: number
  reward_config?: Record<string, unknown>
  recommendation?: Record<string, unknown>
  reward_preview?: {
    reward_type: string
    title: string
    main: string
    details: string[]
    thresholds: Array<{ label: string; amount: number }>
  }
  progress: {
    completion_count: number
    total_attempts: number
    sweep_unlocked: boolean
    sweep_unlock_count: number
    best_record: Record<string, unknown>
  }
}

interface DemoBattle {
  battle_id: string
  dungeon_id: string
  character_ids: string[]
  started_at: number
  duration: number
  battle_speed: number
  stopped?: boolean
  settled?: boolean
  exp_crystals_awarded?: number
  character_rewards?: Record<string, {
    gained_exp: number
    before_level: number
    after_level: number
    before_exp: number
    after_exp: number
    leveled_up: boolean
  }>
}

interface DemoState {
  player: {
    player_id: string
    username: string
    level: number
    exp: number
    gold: number
  }
  characters: DemoCharacter[]
  dungeons: DemoDungeon[]
  inventory: Array<Record<string, unknown>>
  battles: Record<string, DemoBattle>
  gachaHistory: Array<Record<string, unknown>>
}

const demoKey = 'gamer_static_demo_state'

export const installStaticDemoApi = () => {
  if (import.meta.env.VITE_STATIC_DEMO !== 'true') return

  axios.defaults.adapter = async (config) => {
    const url = normalizeUrl(config)
    if (!url.startsWith('/api')) {
      return response(config, 404, { success: false, message: 'Static demo only handles /api requests.' })
    }
    try {
      return response(config, 200, handleDemoRequest(config, url))
    } catch (error) {
      return response(config, 500, {
        success: false,
        message: error instanceof Error ? error.message : 'Static demo request failed',
      })
    }
  }
}

const normalizeUrl = (config: InternalAxiosRequestConfig) => {
  const rawUrl = config.url || '/'
  if (rawUrl.startsWith('http')) {
    return new URL(rawUrl).pathname
  }
  return rawUrl
}

const response = (config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse => ({
  data,
  status,
  statusText: status >= 400 ? 'Error' : 'OK',
  headers: {},
  config,
})

const handleDemoRequest = (config: InternalAxiosRequestConfig, url: string) => {
  const state = loadState()
  const method = String(config.method || 'get').toLowerCase()
  const body = parseBody(config.data)

  if (url === '/api/auth/login' && method === 'post') {
    state.player.username = String(body.username || 'demo-player')
    saveState(state)
    return { success: true, message: '静态试玩登录成功', token: 'static-demo-token', player: state.player }
  }

  if (url === '/api/auth/register' && method === 'post') {
    state.player.username = String(body.username || 'demo-player')
    saveState(state)
    return { success: true, message: '静态试玩账号已创建', player: state.player }
  }

  if (url === '/api/auth/logout' && method === 'post') {
    return { success: true }
  }

  if (url === '/api/player/info') {
    return { success: true, player: state.player }
  }

  if (url === '/api/characters') {
    return { success: true, characters: state.characters }
  }

  const expPreview = url.match(/^\/api\/characters\/([^/]+)\/exp-preview$/)
  if (expPreview && method === 'get') {
    const character = state.characters.find((item) => item.character_id === expPreview[1])
    if (!character) return { success: false, message: '角色不存在' }
    const levelDelta = Number((config.params as Record<string, unknown> | undefined)?.level_delta || 1)
    return buildExpPreview(state, character, levelDelta)
  }

  const useExp = url.match(/^\/api\/characters\/([^/]+)\/use-exp$/)
  if (useExp && method === 'post') {
    const character = state.characters.find((item) => item.character_id === useExp[1])
    if (!character) return { success: false, message: '角色不存在' }
    const levelDelta = body.level_delta === undefined ? undefined : Number(body.level_delta)
    const amount = body.amount === undefined ? undefined : Number(body.amount)
    const result = applyCharacterExp(state, character, levelDelta, amount)
    saveState(state)
    return result
  }

  if (url === '/api/inventory') {
    return { success: true, inventory: { materials: state.inventory, weapons: [], equipment: [], items: [] } }
  }

  if (url === '/api/materials') {
    return { success: true, materials: state.inventory }
  }

  if (url.startsWith('/api/materials/transactions')) {
    return { success: true, transactions: [] }
  }

  if (url === '/api/dungeons') {
    return { success: true, dungeons: state.dungeons }
  }

  const dungeonStart = url.match(/^\/api\/dungeons\/([^/]+)\/start$/)
  if (dungeonStart && method === 'post') {
    const battle = createBattle(state, dungeonStart[1], body.character_ids || [])
    saveState(state)
    return { success: true, battle_id: battle.battle_id }
  }

  const dungeonDetail = url.match(/^\/api\/dungeons\/([^/]+)$/)
  if (dungeonDetail && method === 'get') {
    return { success: true, dungeon: state.dungeons.find((item) => item.dungeon_id === dungeonDetail[1]) || state.dungeons[0] }
  }

  const dungeonSweep = url.match(/^\/api\/dungeons\/([^/]+)\/sweep$/)
  if (dungeonSweep && method === 'post') {
    const dungeon = state.dungeons.find((item) => item.dungeon_id === dungeonSweep[1])
    const count = Math.min(Math.max(Number(body.count || 1), 1), 10)
    const expCrystals = getDungeonExpReward(dungeon) * count
    if (expCrystals > 0) {
      addMaterial(state, 'CHARACTER_EXP', '通用角色经验结晶', expCrystals)
    }
    if (dungeon) {
      dungeon.progress.total_attempts += count
      dungeon.progress.completion_count += count
      dungeon.progress.best_record = {
        duration: dungeon.duration,
        rewards: { exp_crystal: expCrystals }
      }
    }
    saveState(state)
    return {
      success: true,
      materials_awarded: [{ name: '通用角色经验结晶', material_type: 'CHARACTER_EXP', count: expCrystals || 120 }],
    }
  }

  if (url === '/api/battle/create' && method === 'post') {
    const battle = createBattle(state, body.dungeon_id, body.character_ids || [])
    saveState(state)
    return { success: true, battle_id: battle.battle_id }
  }

  const battleStart = url.match(/^\/api\/battle\/([^/]+)\/start$/)
  if (battleStart && method === 'post') {
    const battle = state.battles[battleStart[1]]
    if (battle) {
      battle.started_at = Date.now()
      battle.battle_speed = Number(body.battle_speed || 1)
      saveState(state)
    }
    return { success: true, battle_speed: battle?.battle_speed || 1 }
  }

  const battleSnapshot = url.match(/^\/api\/battle\/([^/]+)\/snapshot$/)
  if (battleSnapshot && method === 'get') {
    const battle = state.battles[battleSnapshot[1]]
    return { success: true, snapshot: buildSnapshot(state, battle) }
  }

  const battleResult = url.match(/^\/api\/battle\/([^/]+)\/result$/)
  if (battleResult && method === 'get') {
    const battle = state.battles[battleResult[1]]
    settleBattle(state, battle)
    saveState(state)
    return { success: true, result: buildResult(state, battle) }
  }

  const battleSpeed = url.match(/^\/api\/battle\/([^/]+)\/speed$/)
  if (battleSpeed && method === 'post') {
    const battle = state.battles[battleSpeed[1]]
    if (battle) {
      battle.battle_speed = Number(body.battle_speed || 1)
      saveState(state)
    }
    return { success: true, battle_speed: battle?.battle_speed || 1 }
  }

  const battleStop = url.match(/^\/api\/battle\/([^/]+)\/stop$/)
  if (battleStop && method === 'post') {
    const battle = state.battles[battleStop[1]]
    if (battle) {
      battle.stopped = true
      saveState(state)
    }
    return { success: true }
  }

  if (url === '/api/gacha/status') {
    return {
      success: true,
      history: state.gachaHistory,
      pity: { current: state.gachaHistory.length % 50, threshold: 50, remaining: 50 - (state.gachaHistory.length % 50), next_guaranteed: false },
      up_pool: buildStaticUpPool(),
      available_characters: CHARACTER_POOL,
    }
  }

  if (url === '/api/gacha/pull' && method === 'post') {
    const count = Number(body.pull_count || 1)
    const poolType = String(body.pool_type || 'STATIC_DEMO')
    const results = Array.from({ length: count }, () => createPulledCharacter(state, poolType))
    const history = {
      timestamp: new Date().toISOString(),
      pool_type: poolType,
      pull_count: count,
      cost: count * 1000,
      new_characters: results.filter((item) => !item.is_duplicate).length,
      duplicates: results.filter((item) => item.is_duplicate).length,
      essence_gained: results.reduce((sum, item) => sum + item.essence_gained, 0),
      results: results.map((item) => ({
        ...item.character,
        is_duplicate: item.is_duplicate,
        essence_gained: item.essence_gained,
      })),
    }
    state.gachaHistory.unshift(history)
    state.player.gold = Math.max(0, state.player.gold - count * 1000)
    saveState(state)
    return { success: true, results, history: state.gachaHistory, pity: { current: state.gachaHistory.length, threshold: 50 } }
  }

  if (url === '/api/social/assist-mode') {
    return { success: true, assist_enabled: false }
  }

  return { success: true, static_demo: true }
}

const parseBody = (data: unknown) => {
  if (!data) return {}
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return data as Record<string, unknown>
}

const loadState = (): DemoState => {
  const cached = localStorage.getItem(demoKey)
  if (cached) {
    try {
      const state = normalizeState(JSON.parse(cached) as DemoState)
      saveState(state)
      return state
    } catch {
      localStorage.removeItem(demoKey)
    }
  }
  const state = createDefaultState()
  saveState(state)
  return state
}

const saveState = (state: DemoState) => {
  localStorage.setItem(demoKey, JSON.stringify(state))
}

const attributeNames: Record<string, string> = {
  WATER: '水',
  EARTH: '土',
  THUNDER: '雷',
  WIND: '风',
  FIRE: '火',
  WOOD: '木',
  LIGHT: '光',
  DARK: '暗'
}

const difficultyNameMap: Record<string, string> = {
  normal: '普通',
  hard: '困难',
  nightmare: '噩梦'
}

const experienceDungeonAttributes = ['WATER', 'EARTH', 'THUNDER', 'WIND', 'FIRE', 'WOOD', 'LIGHT', 'DARK']
const experienceDungeonDifficulties = ['normal', 'hard', 'nightmare']

const createExperienceDungeons = () => (
  experienceDungeonAttributes.flatMap((attribute) => experienceDungeonDifficulties.map((difficulty) => (
    createDungeon(
      `demo_exp_${attribute.toLowerCase()}_${difficulty}`,
      `${attributeNames[attribute]}属性经验本·${difficultyNameMap[difficulty]}`,
      'SINGLE',
      attribute,
      difficulty,
      60
    )
  )))
)

const normalizeState = (state: DemoState): DemoState => {
  const defaultState = createDefaultState()
  state.player = state.player || defaultState.player
  state.characters = (state.characters && state.characters.length > 0 ? state.characters : defaultState.characters)
    .map(normalizeCharacter)
  state.dungeons = mergeDungeons(state.dungeons || [], defaultState.dungeons)
  state.inventory = normalizeInventory(state.inventory || defaultState.inventory)
  state.battles = state.battles || {}
  state.gachaHistory = state.gachaHistory || []
  return state
}

const mergeDungeons = (current: DemoDungeon[], required: DemoDungeon[]) => {
  const byId = new Map(current.map((dungeon) => [dungeon.dungeon_id, dungeon]))
  return required.map((dungeon) => ({
    ...dungeon,
    progress: byId.get(dungeon.dungeon_id)?.progress || dungeon.progress
  }))
}

const normalizeInventory = (inventory: Array<Record<string, unknown>>) => {
  const normalized = inventory.map((item) => {
    if (item.item_id === 'demo_exp_crystal' || item.material_type === 'demo_exp_crystal') {
      return {
        ...item,
        item_name: '通用角色经验结晶',
        material_type: 'CHARACTER_EXP'
      }
    }
    return item
  })
  if (!normalized.some((item) => item.material_type === 'CHARACTER_EXP')) {
    normalized.push({
      item_id: 'demo_exp_crystal',
      item_type: 'material',
      item_subtype: null,
      item_name: '通用角色经验结晶',
      material_type: 'CHARACTER_EXP',
      item_data: {},
      count: 3000,
      level: 0,
      is_locked: false,
      is_equipped: false
    })
  }
  return normalized
}

const normalizeCharacter = (character: DemoCharacter): DemoCharacter => {
  const level = Math.min(Math.max(Number(character.level || 1), 1), 100)
  const exp = Math.max(Number(character.exp || 0), 0)
  const expToNext = level >= 100 ? 0 : getExpToNextLevel(level)
  return {
    ...character,
    level,
    exp,
    max_level: 100,
    exp_to_next_level: expToNext,
    exp_progress: expToNext > 0 ? Math.min(1, exp / expToNext) : 1,
    stats: character.stats || getCharacterStats(level)
  }
}

const getExpToNextLevel = (level: number) => {
  if (level >= 100) return 0
  const base = 35
  const growth = 0.99
  return Math.max(1, Math.round(base + growth * level * level))
}

const getCharacterStats = (level: number) => ({
  hp: 900 + level * 36,
  attack: 90 + level * 7,
  defense: 45 + level * 4,
  magic_attack: 90 + level * 7,
  magic_defense: 45 + level * 4
})

const getTotalExpFromLevelOne = (level: number) => {
  let total = 0
  for (let current = 1; current < level; current += 1) {
    total += getExpToNextLevel(current)
  }
  return total
}

const getOwnedExpCrystals = (state: DemoState) => (
  state.inventory.reduce((sum, item) => (
    item.material_type === 'CHARACTER_EXP'
      ? sum + Number(item.count || 0)
      : sum
  ), 0)
)

const consumeExpCrystals = (state: DemoState, amount: number) => {
  let remaining = amount
  state.inventory = state.inventory.map((item) => {
    if (item.material_type !== 'CHARACTER_EXP' || remaining <= 0) return item
    const current = Number(item.count || 0)
    const used = Math.min(current, remaining)
    remaining -= used
    return { ...item, count: current - used }
  })
}

const addMaterial = (state: DemoState, materialType: string, itemName: string, count: number) => {
  const existing = state.inventory.find((item) => item.material_type === materialType)
  if (existing) {
    existing.count = Math.min(999999999, Number(existing.count || 0) + count)
    return
  }
  state.inventory.push({
    item_id: `demo_material_${materialType.toLowerCase()}`,
    item_type: 'material',
    item_subtype: null,
    item_name: itemName,
    material_type: materialType,
    item_data: {},
    count,
    level: 0,
    is_locked: false,
    is_equipped: false
  })
}

const buildExpPreview = (state: DemoState, character: DemoCharacter, levelDelta: number) => {
  const normalized = normalizeCharacter(character)
  const targetLevel = Math.min(100, normalized.level + Math.max(1, Math.floor(levelDelta || 1)))
  const requiredExp = Math.max(
    0,
    getTotalExpFromLevelOne(targetLevel) - getTotalExpFromLevelOne(normalized.level) - normalized.exp
  )
  const ownedExp = getOwnedExpCrystals(state)
  return {
    success: true,
    target_level: targetLevel,
    required_exp: requiredExp,
    owned_exp: ownedExp,
    need_more: Math.max(0, requiredExp - ownedExp),
    can_afford: ownedExp >= requiredExp,
    max_crystals: 999999999
  }
}

const applyCharacterExp = (
  state: DemoState,
  character: DemoCharacter,
  levelDelta?: number,
  amount?: number
) => {
  const owned = getOwnedExpCrystals(state)
  const normalized = normalizeCharacter(character)
  const requestedAmount = levelDelta !== undefined
    ? buildExpPreview(state, normalized, levelDelta).required_exp
    : Math.min(Math.max(Math.floor(amount || 0), 0), owned)

  if (requestedAmount <= 0 || owned < requestedAmount) {
    return {
      success: false,
      message: '经验结晶量不足',
      required_exp: requestedAmount,
      owned_exp: owned,
      need_more: Math.max(0, requestedAmount - owned)
    }
  }

  consumeExpCrystals(state, requestedAmount)
  let nextExp = normalized.exp + requestedAmount
  let nextLevel = normalized.level
  while (nextLevel < 100 && nextExp >= getExpToNextLevel(nextLevel)) {
    nextExp -= getExpToNextLevel(nextLevel)
    nextLevel += 1
  }
  if (nextLevel >= 100) {
    nextLevel = 100
    nextExp = 0
  }
  const updated = normalizeCharacter({ ...normalized, level: nextLevel, exp: nextExp, stats: getCharacterStats(nextLevel) })
  state.characters = state.characters.map((item) => (
    item.character_id === character.character_id ? updated : item
  ))
  return {
    success: true,
    message: `已提升到 Lv.${updated.level}`,
    character: updated,
    materials: state.inventory
  }
}

const applyBattleExpToCharacter = (character: DemoCharacter, gainedExp: number) => {
  const before = normalizeCharacter(character)
  let nextExp = before.exp + gainedExp
  let nextLevel = before.level
  while (nextLevel < 100 && nextExp >= getExpToNextLevel(nextLevel)) {
    nextExp -= getExpToNextLevel(nextLevel)
    nextLevel += 1
  }
  if (nextLevel >= 100) {
    nextLevel = 100
    nextExp = 0
  }
  const updated = normalizeCharacter({ ...before, level: nextLevel, exp: nextExp, stats: getCharacterStats(nextLevel) })
  return {
    updated,
    reward: {
      gained_exp: gainedExp,
      before_level: before.level,
      after_level: updated.level,
      before_exp: before.exp,
      after_exp: updated.exp,
      leveled_up: updated.level > before.level
    }
  }
}

const getBaseExpReward = (difficulty?: string) => {
  if (difficulty === 'nightmare') return 2960
  if (difficulty === 'hard') return 1381
  return 531
}

const getDungeonExpReward = (dungeon?: DemoDungeon) => {
  if (!dungeon || dungeon.reward_config?.type !== 'experience') return 0
  const base = Number(dungeon.reward_config.base_exp || getBaseExpReward(dungeon.difficulty_key))
  return Math.min(999999999, Math.max(0, Math.floor(base)))
}

const settleBattle = (state: DemoState, battle?: DemoBattle) => {
  if (!battle || battle.settled) return
  const dungeon = state.dungeons.find((item) => item.dungeon_id === battle.dungeon_id)
  const expCrystals = getDungeonExpReward(dungeon)
  if (expCrystals > 0) {
    addMaterial(state, 'CHARACTER_EXP', '通用角色经验结晶', expCrystals)
  }
  if (dungeon) {
    dungeon.progress.total_attempts += 1
    dungeon.progress.completion_count += 1
    dungeon.progress.best_record = {
      duration: battle.duration,
      rewards: { exp_crystal: expCrystals }
    }
  }

  const characterRewards: DemoBattle['character_rewards'] = {}
  state.characters = state.characters.map((character) => {
    if (!battle.character_ids.includes(character.character_id)) return character
    const battleExp = dungeon?.reward_config?.type === 'experience' ? 120 : 45
    const { updated, reward } = applyBattleExpToCharacter(character, battleExp)
    characterRewards[character.character_id] = reward
    return updated
  })
  battle.exp_crystals_awarded = expCrystals
  battle.character_rewards = characterRewards
  battle.settled = true
}

const createDefaultState = (): DemoState => ({
  player: {
    player_id: 'static-demo-player',
    username: 'demo-player',
    level: 1,
    exp: 0,
    gold: 100000,
  },
  characters: [
    normalizeCharacter({ ...toDemoCharacter(CHARACTER_POOL[0], 'owned'), level: 25 }),
    normalizeCharacter({ ...toDemoCharacter(CHARACTER_POOL[6], 'owned'), level: 18 }),
  ],
  dungeons: [
    ...createExperienceDungeons(),
    createDungeon('demo_squad_water', '水属性五人本试玩', 'SQUAD', 'WATER', 'hard', 90),
    createDungeon('demo_team_light', '光属性20人团本试玩', 'TEAM', 'LIGHT', 'nightmare', 180),
  ],
  inventory: [
    { item_id: 'demo_exp_crystal', item_type: 'material', item_subtype: null, item_name: '通用角色经验结晶', material_type: 'CHARACTER_EXP', item_data: {}, count: 3000, level: 0, is_locked: false, is_equipped: false },
  ],
  battles: {},
  gachaHistory: [],
})

const createDungeon = (
  dungeonId: string,
  name: string,
  dungeonType: string,
  attributeType: string,
  difficulty: string,
  duration: number,
): DemoDungeon => {
  const reward = getBaseExpReward(difficulty)
  const isExperience = dungeonType === 'SINGLE'
  return {
    dungeon_id: dungeonId,
    name,
    dungeon_type: dungeonType,
    attribute_type: attributeType,
    is_unlocked: true,
    description: isExperience
      ? '1人经验本。选择同属性角色挑战，战斗结束后获得通用角色经验结晶。'
      : '静态试玩模式中的多人副本预览，用于了解五人本和20人团本的成长方向。',
    duration,
    difficulty,
    difficulty_key: difficulty,
    difficulty_order: difficulty === 'nightmare' ? 3 : difficulty === 'hard' ? 2 : 1,
    recommended_level_bonus: difficulty === 'nightmare' ? 55 : difficulty === 'hard' ? 25 : 1,
    monster_multiplier: difficulty === 'nightmare' ? 2.2 : difficulty === 'hard' ? 1.45 : 1,
    reward_multiplier: difficulty === 'nightmare' ? 2.96 : difficulty === 'hard' ? 1.38 : 1,
    reward_config: isExperience
      ? { type: 'experience', base_exp: reward, material_type: 'CHARACTER_EXP' }
      : { type: dungeonType === 'TEAM' ? 'equipment_material' : 'exclusive_material', base_material: dungeonType === 'TEAM' ? 20 : 8 },
    reward_preview: isExperience
      ? {
        reward_type: 'experience',
        title: '经验结晶',
        main: `满时长 ${reward} 个通用角色经验结晶`,
        details: ['坚持15秒获得15%', '坚持30秒获得40%', '坚持45秒获得65%', '满60秒获得100%'],
        thresholds: [
          { label: '15秒', amount: Math.floor(reward * 0.15) },
          { label: '30秒', amount: Math.floor(reward * 0.4) },
          { label: '45秒', amount: Math.floor(reward * 0.65) },
          { label: '满时长', amount: reward }
        ]
      }
      : undefined,
    recommendation: {
      recommended_level: difficulty === 'nightmare' ? 55 : difficulty === 'hard' ? 25 : 1,
      recommended_attribute: attributeType,
      enemy_attribute: attributeType,
      attribute_hint: `新手期优先使用${attributeNames[attributeType] || attributeType}属性角色进入本副本。属性克制会在后续战斗调优中放大收益。`,
      party_size: dungeonType === 'TEAM' ? 20 : dungeonType === 'SQUAD' ? 5 : 1,
      summary: isExperience ? '单人培养入口，主要产出经验结晶。' : '多人内容入口，主要验证队伍配置和Boss机制。',
      formation: dungeonType === 'TEAM'
        ? [{ role: '坦克', count: 2 }, { role: '治疗', count: 4 }, { role: '输出/辅助', count: 14 }]
        : dungeonType === 'SQUAD'
          ? [{ role: '坦克', count: 1 }, { role: '治疗', count: 1 }, { role: '输出/辅助', count: 3 }]
          : [{ role: '任意已拥有角色', count: 1 }]
    },
    progress: {
      completion_count: 0,
      total_attempts: 0,
      sweep_unlocked: true,
      sweep_unlock_count: 1,
      best_record: {},
    },
  }
}

const createBattle = (state: DemoState, dungeonId: string, characterIds: string[]): DemoBattle => {
  const battleId = `demo-battle-${Date.now()}`
  const battle = {
    battle_id: battleId,
    dungeon_id: dungeonId,
    character_ids: characterIds.length ? characterIds : [state.characters[0]?.character_id].filter(Boolean),
    started_at: Date.now(),
    duration: 10,
    battle_speed: 1,
  }
  state.battles[battleId] = battle
  return battle
}

const toDemoCharacter = (entry: CharacterPoolEntry, idPrefix = 'demo'): DemoCharacter => ({
  character_id: `${idPrefix}_${entry.id}`,
  config_id: entry.id,
  name: entry.name,
  profession_type: entry.professionType,
  attribute_type: entry.attributeType,
  level: 1,
  exp: 0,
  max_level: 100,
  exp_to_next_level: getExpToNextLevel(1),
  exp_progress: 0,
  rarity: entry.rarity,
  weapon_name: entry.weaponName,
  skills: entry.skills,
  stats: getCharacterStats(1),
})

const getCharactersForPool = (poolType: string): CharacterPoolEntry[] => {
  if (poolType === 'WATER_EARTH_THUNDER') {
    return CHARACTER_POOL.filter((item) => ['WATER', 'EARTH', 'THUNDER'].includes(item.attributeType))
  }
  if (poolType === 'FIRE_WOOD_WIND') {
    return CHARACTER_POOL.filter((item) => ['FIRE', 'WOOD', 'WIND'].includes(item.attributeType))
  }
  if (poolType === 'LIGHT_DARK') {
    return CHARACTER_POOL.filter((item) => ['LIGHT', 'DARK'].includes(item.attributeType))
  }
  if (poolType === 'UP_POOL') {
    const upIds = new Set(['char_004_water_magic_melee_dps', 'char_035_fire_physical_melee_dps', 'char_052_light_magic_melee_dps'])
    const upCharacters = CHARACTER_POOL.filter((item) => upIds.has(item.id))
    return Math.random() < 0.5 ? upCharacters : [...CHARACTER_POOL]
  }
  return [...CHARACTER_POOL]
}

const createPulledCharacter = (state: DemoState, poolType: string) => {
  const candidates = getCharactersForPool(poolType)
  const entry = candidates[Math.floor(Math.random() * candidates.length)] || CHARACTER_POOL[0]
  const existing = state.characters.find((item) => item.config_id === entry.id || item.name === entry.name)
  if (existing) {
    return { character: existing, is_duplicate: true, essence_gained: entry.rarity === 'epic' ? 30 : 10 }
  }

  const character = normalizeCharacter(toDemoCharacter(entry, `demo_gacha_${Date.now()}`))
  state.characters.push(character)
  return { character, is_duplicate: false, essence_gained: 0 }
}

const buildStaticUpPool = () => {
  const upIds = new Set(['char_004_water_magic_melee_dps', 'char_035_fire_physical_melee_dps', 'char_052_light_magic_melee_dps'])
  const upCharacters = CHARACTER_POOL.filter((item) => upIds.has(item.id))
  return {
    title: '当期UP角色池',
    description: 'UP角色约50%概率命中；未命中时从64名角色中抽取。',
    up_rate: 0.5,
    up_character_names: upCharacters.map((item) => item.name),
    up_characters: upCharacters.map((item) => ({
      name: item.name,
      attribute_type: item.attributeType,
      profession_type: item.professionName,
    })),
  }
}

const buildSnapshot = (state: DemoState, battle?: DemoBattle) => {
  const elapsed = battle ? Math.min(battle.duration, Math.floor((Date.now() - battle.started_at) / 1000) * battle.battle_speed) : 0
  const success = Boolean(battle && elapsed >= battle.duration)
  return {
    flow_state: { code: success ? 'finished' : 'running', label: success ? 'Finished' : 'Running' },
    battle_state: { code: success ? 'completed' : 'running', label: success ? 'Completed' : 'Running' },
    current_time: elapsed,
    duration: battle?.duration || 10,
    player_units: (battle?.character_ids || [state.characters[0].character_id]).map((id) => {
      const character = state.characters.find((item) => item.character_id === id) || state.characters[0]
      return createUnit(character.character_id, character.name, 1000, 1000, true)
    }),
    enemy_units: [createUnit('demo_enemy_001', '静态试玩怪物', success ? 0 : Math.max(0, 800 - elapsed * 90), 800, !success)],
    battle_log: [
      '静态试玩战斗开始',
      `当前进度 ${elapsed}/${battle?.duration || 10}s`,
      success ? '战斗完成，奖励已生成' : '角色正在自动战斗',
    ],
    battle_events: [
      { time: elapsed, time_text: `${elapsed}s`, message: success ? '敌方单位被击败' : '试玩角色发动攻击', event_type: 'damage', payload: { amount: 120 + elapsed * 5, target_name: '静态试玩怪物' } },
    ],
    battle_speed: battle?.battle_speed || 1,
    result: success ? buildResult(state, battle) : null,
  }
}

const createUnit = (characterId: string, name: string, health: number, maxHealth: number, alive: boolean) => ({
  character_id: characterId,
  name,
  health,
  max_health: maxHealth,
  physical_health: health,
  max_physical_health: maxHealth,
  magical_health: health,
  max_magical_health: maxHealth,
  is_alive: alive,
})

const buildResult = (state: DemoState, battle?: DemoBattle) => ({
  battle_id: battle?.battle_id || 'demo-battle',
  player_id: state.player.player_id,
  dungeon_id: battle?.dungeon_id || 'demo_exp_fire_normal',
  state: { code: 'finished', label: 'Finished' },
  outcome: { success: true, code: 'success', label: 'Success' },
  duration: battle?.duration || 10,
  rewards: {
    reward_type: 'experience',
    rewards: {
      gold: 500,
      exp_crystal: battle?.exp_crystals_awarded || getDungeonExpReward(state.dungeons.find((item) => item.dungeon_id === battle?.dungeon_id))
    }
  },
  characters: battle?.character_rewards || {},
  materials: [{ material_type: 'CHARACTER_EXP', attribute_type: null, count: battle?.exp_crystals_awarded || 0 }],
  progress_summary: {
    completion_count: 1,
    total_attempts: 1,
    successful_attempts: 1,
    failed_attempts: 0,
    sweep_unlocked: true,
    sweep_unlock_count: 1,
    sweep_text: '静态试玩已解锁扫荡',
  },
  drops: {
    events: [],
    players: [],
    stats: { total_events: 0, rarity: {}, types: {} },
  },
  finished_at: new Date().toISOString(),
})
