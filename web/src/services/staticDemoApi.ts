import axios, { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { CHARACTER_POOL, CharacterPoolEntry } from '../data/characterPool'

interface DemoCharacter {
  character_id: string
  config_id?: string
  name: string
  profession_type: string
  attribute_type: string
  level: number
  rarity?: string
  weapon_name?: string
  skills?: CharacterPoolEntry['skills']
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
    return {
      success: true,
      materials_awarded: [{ name: '试玩经验结晶', material_type: 'demo_exp_crystal', count: 120 }],
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
      return JSON.parse(cached) as DemoState
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

const createDefaultState = (): DemoState => ({
  player: {
    player_id: 'static-demo-player',
    username: 'demo-player',
    level: 1,
    exp: 0,
    gold: 100000,
  },
  characters: [
    { ...toDemoCharacter(CHARACTER_POOL[0], 'owned'), level: 25 },
    { ...toDemoCharacter(CHARACTER_POOL[6], 'owned'), level: 18 },
  ],
  dungeons: [
    createDungeon('demo_exp_normal', '静态试玩经验本', 'SINGLE', 'FIRE', 'normal', 12),
    createDungeon('demo_material_hard', '静态试玩材料本', 'SQUAD', 'WATER', 'hard', 18),
    createDungeon('demo_team_nightmare', '静态试玩团队本', 'TEAM', 'LIGHT', 'nightmare', 24),
  ],
  inventory: [
    { item_id: 'demo_exp_crystal', item_type: 'material', item_subtype: null, item_name: '试玩经验结晶', item_data: {}, count: 3000, level: 0, is_locked: false, is_equipped: false },
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
): DemoDungeon => ({
  dungeon_id: dungeonId,
  name,
  dungeon_type: dungeonType,
  attribute_type: attributeType,
  is_unlocked: true,
  description: '这是 GitHub Pages 静态试玩模式中的副本，用于验证点击链接即可进入游戏。',
  duration,
  difficulty,
  difficulty_key: difficulty,
  progress: {
    completion_count: 0,
    total_attempts: 0,
    sweep_unlocked: true,
    sweep_unlock_count: 1,
    best_record: {},
  },
})

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
  rarity: entry.rarity,
  weapon_name: entry.weaponName,
  skills: entry.skills,
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

  const character = toDemoCharacter(entry, `demo_gacha_${Date.now()}`)
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
  dungeon_id: battle?.dungeon_id || 'demo_exp_normal',
  state: { code: 'finished', label: 'Finished' },
  outcome: { success: true, code: 'success', label: 'Success' },
  duration: battle?.duration || 10,
  rewards: { gold: 500, exp_crystal: 120 },
  materials: [{ material_type: 'demo_exp_crystal', attribute_type: 'FIRE', count: 120 }],
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
