import axios, { AxiosResponse, InternalAxiosRequestConfig } from 'axios'

interface DemoCharacter {
  character_id: string
  name: string
  profession_type: string
  attribute_type: string
  level: number
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
      up_pool: null,
    }
  }

  if (url === '/api/gacha/pull' && method === 'post') {
    const count = Number(body.pull_count || 1)
    const results = Array.from({ length: count }, (_, index) => createPulledCharacter(state, index))
    const history = {
      timestamp: new Date().toISOString(),
      pool_type: body.pool_type || 'STATIC_DEMO',
      pull_count: count,
      cost: count * 1000,
      new_characters: results.length,
      duplicates: 0,
      essence_gained: 0,
      results: results.map((item) => ({ ...item.character, is_duplicate: false, essence_gained: 0 })),
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
    { character_id: 'demo_fire_001', name: '试玩火属性角色', profession_type: 'PHYSICAL_MELEE_DPS', attribute_type: 'FIRE', level: 25 },
    { character_id: 'demo_water_001', name: '试玩水属性角色', profession_type: 'HEALER', attribute_type: 'WATER', level: 18 },
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

const createPulledCharacter = (state: DemoState, index: number) => {
  const id = `demo_gacha_${Date.now()}_${index}`
  const character = {
    character_id: id,
    name: `试玩招募角色 ${state.characters.length + 1}`,
    profession_type: index % 2 === 0 ? 'MAGICAL_RANGED_DPS' : 'SUPPORT',
    attribute_type: index % 2 === 0 ? 'LIGHT' : 'DARK',
    level: 1,
  }
  state.characters.push(character)
  return { character, is_duplicate: false, essence_gained: 0 }
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
