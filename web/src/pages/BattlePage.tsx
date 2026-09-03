import React, { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { io, Socket } from 'socket.io-client'
import axios from 'axios'
import { getSocketUrl } from '../config'
import { getOnlineModeError, onlineApi } from '../services/onlineGameAdapter'
import './BattlePage.css'

interface StateInfo {
  code: string
  label: string
}

interface CharacterUpdate {
  gained_exp: number
  before_level: number
  after_level: number
  before_exp: number
  after_exp: number
  leveled_up: boolean
}

interface MaterialAward {
  material_type: string
  attribute_type?: string | null
  count: number
}

interface DropOwner {
  player_id: string | null
  player_name: string
}

interface DropItemPayload {
  item_id: string
  name: string
  item_type: string
  quantity: number
  rarity: string
  quality: string
  icon?: string
  classifications?: Record<string, string>
  stats?: Record<string, number>
  description?: string
}

interface DropEventEntry {
  sequence: number
  drop_id: string
  item: DropItemPayload
  owner: DropOwner
  source: string
  is_real_time: boolean
}

interface DropPlayerSummary {
  player_id: string | null
  player_name: string
  total_items: number
  total_quantity: number
  drops: DropEventEntry[]
}

interface DropSummary {
  events: DropEventEntry[]
  players: DropPlayerSummary[]
  stats: {
    total_events: number
    rarity: Record<string, number>
    types: Record<string, number>
  }
  assist?: {
    enabled: boolean
    currency_per_drop: number
    total_currency: number
  }
}

interface PlayerBattleResult {
  player_id: string
  player_name?: string
  characters?: Record<string, CharacterUpdate>
  materials?: MaterialAward[]
  progress?: any
  progress_summary?: BattleResultPayload['progress_summary']
  drops?: DropPlayerSummary
}

interface BattleEvent {
  time: number
  time_text: string
  message: string
  event_type: string
  payload?: Record<string, unknown>
}

interface BossMechanicInfo {
  mechanic_id?: string
  shared_health?: boolean
  mutual_strengthen?: boolean
  sequential_activation?: boolean
  skill_slot_total?: number
  active?: boolean
  strengthened?: boolean
}

interface TeamStatusPayload {
  phase_index?: number
  phase_name?: string
  phase_count?: number
  phase_reached?: number
  pressure?: number
  pressure_peak?: number
  pressure_average?: number
  performance_score?: number
  reward_tier?: string
  role_profile?: {
    score?: number
    rating?: string
    counts?: Record<string, number>
    notes?: string[]
    players?: Array<Record<string, unknown>>
  }
  pressure_events?: Array<{
    time?: number
    pressure?: number
    damage?: number
    phase?: string
  }>
}

interface BattleResultPayload {
  battle_id: string
  player_id: string
  dungeon_id: string
  state: StateInfo
  outcome?: {
    success: boolean
    code: string
    label: string
  }
  duration: number
  rewards?: Record<string, unknown>
  characters?: Record<string, CharacterUpdate>
  materials?: MaterialAward[]
  progress?: any
  progress_summary?: {
    completion_count: number
    total_attempts: number
    successful_attempts: number
    failed_attempts: number
    sweep_unlocked: boolean
    sweep_unlock_count: number
    sweep_text: string
  }
  drops?: DropSummary
  team_performance?: TeamStatusPayload | null
  team_record?: Record<string, unknown> | null
  player_results?: Record<string, PlayerBattleResult>
  current_player_result?: PlayerBattleResult
  room_cleanup?: {
    room_id: string
    status: string
  }
  finished_at: string
  error?: string
}

interface SpeedState {
  current_speed: number
  requested_speed: number
  is_multiplayer: boolean
  can_use_4x: boolean
  agreements: Record<string, boolean>
  agreed_count: number
  total_players: number
  pending_4x: boolean
}

interface BattleSnapshot {
  flow_state: StateInfo
  battle_state: StateInfo
  current_time: number
  duration: number
  player_units: Array<{
    character_id: string
    name: string
    health: number
    max_health: number
    physical_health: number
    max_physical_health: number
    magical_health: number
    max_magical_health: number
    spawn_category?: string | null
    boss_type?: string | null
    boss_mechanic?: BossMechanicInfo | null
    boss_group_id?: string | null
    skill_slots?: {
      low: unknown[]
      mid: unknown[]
      high: unknown[]
      total: number
    } | null
    is_alive: boolean
  }>
  enemy_units: Array<{
    character_id: string
    name: string
    health: number
    max_health: number
    physical_health: number
    max_physical_health: number
    magical_health: number
    max_magical_health: number
    spawn_category?: string | null
    boss_type?: string | null
    boss_mechanic?: BossMechanicInfo | null
    boss_group_id?: string | null
    skill_slots?: {
      low: unknown[]
      mid: unknown[]
      high: unknown[]
      total: number
    } | null
    is_alive: boolean
  }>
  battle_log: string[]
  battle_events?: BattleEvent[]
  battle_speed?: number
  speed_state?: SpeedState
  result?: BattleResultPayload | null
  drops?: DropSummary
  team_status?: TeamStatusPayload | null
}

interface BattlePresentationItem {
  id: string
  kind: 'skill' | 'damage' | 'phase' | 'drop' | 'pressure'
  title: string
  value: string
  detail: string
  time?: string
}

const getPayloadText = (payload: Record<string, unknown> | undefined, key: string, fallback = '') => {
  const value = payload?.[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

const getPayloadNumber = (payload: Record<string, unknown> | undefined, key: string, fallback = 0) => {
  const value = payload?.[key]
  return typeof value === 'number' ? value : fallback
}

const buildBattlePresentationItems = (
  events: BattleEvent[],
  drops: DropEventEntry[],
  teamStatus?: TeamStatusPayload | null
): BattlePresentationItem[] => {
  const items: BattlePresentationItem[] = []
  const reversedEvents = [...events].reverse()
  const latestDamage = reversedEvents.find((event) => event.event_type === 'damage')
  const latestSkill = reversedEvents.find((event) => ['boss_skill', 'skill_effect', 'damage'].includes(event.event_type))
  const latestPhase = reversedEvents.find((event) => event.event_type === 'team_phase' || event.event_type === 'boss_mechanic')
  const latestPressure = teamStatus?.pressure_events?.slice(-1)[0]
  const latestDrop = drops[0]

  if (latestSkill) {
    const skillName = getPayloadText(latestSkill.payload, 'skill_name', latestSkill.message)
    const casterName = getPayloadText(latestSkill.payload, 'caster_name', 'Caster')
    items.push({
      id: `skill-${latestSkill.time}-${skillName}`,
      kind: 'skill',
      title: skillName,
      value: casterName,
      detail: latestSkill.message,
      time: latestSkill.time_text,
    })
  }

  if (latestDamage) {
    const amount = getPayloadNumber(latestDamage.payload, 'amount', getPayloadNumber(latestDamage.payload, 'raw_amount'))
    const targetName = getPayloadText(latestDamage.payload, 'target_name', latestDamage.message)
    items.push({
      id: `damage-${latestDamage.time}-${amount}`,
      kind: 'damage',
      title: 'Damage',
      value: amount.toLocaleString(),
      detail: targetName,
      time: latestDamage.time_text,
    })
  }

  if (latestPhase) {
    items.push({
      id: `phase-${latestPhase.time}-${latestPhase.message}`,
      kind: 'phase',
      title: latestPhase.event_type === 'team_phase' ? 'Team Phase' : 'Mechanic',
      value: latestPhase.message,
      detail: 'Battle state changed',
      time: latestPhase.time_text,
    })
  }

  if (latestPressure) {
    items.push({
      id: `pressure-${latestPressure.time}-${latestPressure.pressure}`,
      kind: 'pressure',
      title: 'Pressure Pulse',
      value: String(latestPressure.pressure ?? 0),
      detail: `${latestPressure.phase || 'Phase'} / raid damage ${Number(latestPressure.damage || 0).toLocaleString()}`,
      time: `${Number(latestPressure.time || 0).toFixed(1)}s`,
    })
  }

  if (latestDrop) {
    items.push({
      id: `drop-${latestDrop.drop_id}`,
      kind: 'drop',
      title: latestDrop.item.name,
      value: `x${latestDrop.item.quantity}`,
      detail: `${latestDrop.owner.player_name} / ${latestDrop.item.rarity}`,
    })
  }

  return items.slice(0, 5)
}

const BattlePage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [battleId, setBattleId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<BattleSnapshot | null>(null)
  const [battleSpeed, setBattleSpeed] = useState(1)
  const [speedSyncMessage, setSpeedSyncMessage] = useState('当前速度：1x')
  const [speedUpdating, setSpeedUpdating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [battleResult, setBattleResult] = useState<BattleResultPayload | null>(null)
  const [battleNotice, setBattleNotice] = useState('')
  const socketRef = useRef<Socket | null>(null)
  const pollRef = useRef<number | null>(null)
  const endTimeoutRef = useRef<number | null>(null)
  const redirectIntervalRef = useRef<number | null>(null)
  const onlineBattleTimerRef = useRef<number | null>(null)
  const battleSpeedRef = useRef(1)
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null)
  const [autoNavigate, setAutoNavigate] = useState(true)
  const [assistEnabled, setAssistEnabled] = useState(false)
  const [dropFeed, setDropFeed] = useState<DropEventEntry[]>([])
  const [dropFilters, setDropFilters] = useState<{ type: string; rarity: string; owner: string }>({
    type: 'all',
    rarity: 'all',
    owner: 'all'
  })
  const [dropSort, setDropSort] = useState<{ key: 'sequence' | 'rarity' | 'quantity'; order: 'asc' | 'desc' }>({
    key: 'sequence',
    order: 'desc'
  })
  const [dropPage, setDropPage] = useState(1)
  const DROP_PAGE_SIZE = 10
  const isOnlineMode = Boolean(location.state?.online_mode)

  const getBattleEventClass = (eventType: string) => {
    if (eventType === 'boss_mechanic') return 'mechanic'
    if (eventType === 'skill_telegraph') return 'telegraph'
    if (eventType === 'boss_skill') return 'boss-skill'
    if (eventType === 'skill_effect' || eventType === 'status') return 'effect'
    if (eventType === 'damage' || eventType === 'dot') return 'damage'
    if (eventType === 'heal') return 'heal'
    return 'normal'
  }

  const applySnapshot = (newSnapshot: BattleSnapshot) => {
    setSnapshot(newSnapshot)
    if (newSnapshot.speed_state?.current_speed) {
      setBattleSpeed(newSnapshot.speed_state.current_speed)
      setSpeedSyncMessage(
        newSnapshot.speed_state.pending_4x
          ? `4x申请中：${newSnapshot.speed_state.agreed_count}/${newSnapshot.speed_state.total_players} 已同意`
          : `当前速度：${newSnapshot.speed_state.current_speed}x`
      )
    } else if (newSnapshot.battle_speed) {
      setBattleSpeed(newSnapshot.battle_speed)
      setSpeedSyncMessage(`当前速度：${newSnapshot.battle_speed}x`)
    }
  }

  const fetchAssistMode = async () => {
    try {
      const response = await axios.get('/api/social/assist-mode')
      if (response.data.success) {
        setAssistEnabled(response.data.assist_enabled)
      }
    } catch (err) {
      console.error('获取助战状态失败', err)
    }
  }

  const handleAssistToggle = async (value: boolean) => {
    setAssistEnabled(value)
    try {
      await axios.post('/api/social/assist-mode', { enabled: value })
    } catch (err) {
      setAssistEnabled(!value)
      console.error('更新助战状态失败', err)
    }
  }

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const clearRedirectTimers = () => {
    if (endTimeoutRef.current !== null) {
      window.clearTimeout(endTimeoutRef.current)
      endTimeoutRef.current = null
    }
    if (redirectIntervalRef.current !== null) {
      window.clearInterval(redirectIntervalRef.current)
      redirectIntervalRef.current = null
    }
  }

  const stopOnlineBattleTimer = () => {
    if (onlineBattleTimerRef.current !== null) {
      window.clearInterval(onlineBattleTimerRef.current)
      onlineBattleTimerRef.current = null
    }
  }

  const startRedirectTimer = (result: BattleResultPayload, seconds = 5) => {
    clearRedirectTimers()
    setAutoNavigate(true)
    setRedirectCountdown(seconds)
    endTimeoutRef.current = window.setTimeout(() => {
      navigate('/dungeons', { state: { battleResult: result } })
    }, seconds * 1000)
    redirectIntervalRef.current = window.setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev === null) return prev
        if (prev <= 1) {
          if (redirectIntervalRef.current !== null) {
            window.clearInterval(redirectIntervalRef.current)
            redirectIntervalRef.current = null
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const cancelAutoNavigate = () => {
    clearRedirectTimers()
    setAutoNavigate(false)
    setRedirectCountdown(null)
  }
  
  useEffect(() => {
    setDropPage(1)
  }, [dropFilters, dropSort])

  useEffect(() => {
    fetchAssistMode()
  }, [])

  useEffect(() => {
    battleSpeedRef.current = battleSpeed
  }, [battleSpeed])
  
  useEffect(() => {
    const events = snapshot?.drops?.events ?? []
    if (events.length > 0) {
      setDropFeed((prev) => {
        if (prev.length > 0) {
          return prev
        }
        const sorted = [...events].sort((a, b) => b.sequence - a.sequence)
        return sorted.slice(0, 30)
      })
    }
  }, [snapshot?.drops])
  
  useEffect(() => {
    if (battleResult?.drops?.events) {
      const sorted = [...battleResult.drops.events].sort((a, b) => b.sequence - a.sequence)
      setDropFeed(sorted)
    }
  }, [battleResult?.drops])

  const navigateToDungeons = (result?: BattleResultPayload | null) => {
    clearRedirectTimers()
    navigate('/dungeons', { state: result ? { battleResult: result } : undefined })
  }
  
  const rarityOrderMap: Record<string, number> = {
    legendary: 0,
    epic: 1,
    rare: 2,
    uncommon: 3,
    common: 4
  }

  const handleBattleResult = (result: BattleResultPayload) => {
    setBattleResult(result)
    setSnapshot((prev) => (prev ? { ...prev, result } : prev))
    setBattleNotice(result.error ? '战斗结算遇到异常，请查看错误信息。' : '战斗已结算，奖励已同步。')
    stopPolling()
    if (!result.error) {
      startRedirectTimer(result)
    } else {
      cancelAutoNavigate()
    }
  }

  useEffect(() => {
    const dungeonId = location.state?.dungeon_id
    const existingBattleId = location.state?.battle_id
    const characterIds = location.state?.character_ids
    const battleAlreadyStarted = location.state?.battle_already_started
    if (!dungeonId) {
      navigate('/dungeons')
      return
    }

    if (location.state?.online_mode) {
      startOnlineExperienceBattle()
      return () => {
        stopOnlineBattleTimer()
        clearRedirectTimers()
      }
    }

    if (existingBattleId) {
      setBattleId(existingBattleId)
      connectWebSocket(existingBattleId)
      if (battleAlreadyStarted) {
        startPolling(existingBattleId)
      } else {
        startBattle(existingBattleId).then((started) => {
          if (started) {
            startPolling(existingBattleId)
          }
        })
      }
    } else {
      createBattle(dungeonId, characterIds)
    }

    return () => {
      stopPolling()
      stopOnlineBattleTimer()
      clearRedirectTimers()
      // 清理WebSocket连接
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
    }
  }, [])

  const startOnlineExperienceBattle = () => {
    const dungeon = location.state?.dungeon
    const characters = location.state?.characters || []
    const selectedCharacter = characters[0]
    const dungeonId = location.state?.dungeon_id
    const playerId = location.state?.player_id
    if (!playerId || !dungeonId || !selectedCharacter?.character_id) {
      setBattleNotice('在线战斗缺少玩家、角色或副本信息，请返回副本页重新进入。')
      setLoading(false)
      return
    }
    const newBattleId = `online-${Date.now()}`
    setBattleId(newBattleId)
    setLoading(false)
    setBattleResult(null)
    setBattleNotice('正式在线模式：战斗展示在前端播放，最终奖励由服务器结算落库。')
    const duration = Number(dungeon?.duration || 60)
    const totalWaves = Number(dungeon?.reward_config?.spawn_wave_count || 20)
    const spawnInterval = Number(dungeon?.reward_config?.spawn_interval || 3)
    const maxHealth = Math.max(600, 700 + Number(selectedCharacter?.level || 1) * 35)
    const startedAt = Date.now()

    const tick = () => {
      const currentTime = Math.min(duration, ((Date.now() - startedAt) / 1000) * battleSpeedRef.current)
      const waves = Math.min(totalWaves, Math.max(0, Math.floor(currentTime / spawnInterval) + 1))
      const singleKills = Math.floor(waves / 2)
      const groupKills = (waves - singleKills) * 5
      const enemyHealth = Math.max(0, Math.round(300 - (currentTime % spawnInterval) * 120))
      const battleEvents: BattleEvent[] = [
        {
          time: currentTime,
          time_text: `${currentTime.toFixed(1)}s`,
          message: `${selectedCharacter?.name || '角色'} 正在清理第 ${waves || 1} 波经验小怪`,
          event_type: 'skill_effect',
          payload: { caster_name: selectedCharacter?.name || '角色', skill_name: '循环技能' },
        },
        {
          time: currentTime,
          time_text: `${currentTime.toFixed(1)}s`,
          message: `已击杀单体 ${singleKills}，群体 ${groupKills}`,
          event_type: 'damage',
          payload: { amount: singleKills + groupKills, target_name: '经验小怪' },
        },
      ]
      applySnapshot({
        flow_state: { code: currentTime >= duration ? 'reward' : 'running', label: currentTime >= duration ? '结算中' : '战斗中' },
        battle_state: { code: currentTime >= duration ? 'completed' : 'running', label: currentTime >= duration ? '已完成' : '进行中' },
        current_time: currentTime,
        duration,
        player_units: [{
          character_id: selectedCharacter?.character_id || 'online_character',
          name: selectedCharacter?.name || '在线角色',
          health: maxHealth,
          max_health: maxHealth,
          physical_health: maxHealth,
          max_physical_health: maxHealth,
          magical_health: 0,
          max_magical_health: 0,
          is_alive: true,
        }],
        enemy_units: currentTime >= duration ? [] : [{
          character_id: `online_wave_${waves}`,
          name: waves % 2 === 0 ? '群体经验小怪' : '单体经验小怪',
          health: enemyHealth,
          max_health: 300,
          physical_health: enemyHealth,
          max_physical_health: 300,
          magical_health: 0,
          max_magical_health: 0,
          spawn_category: 'minion',
          is_alive: enemyHealth > 0,
        }],
        battle_log: battleEvents.map((event) => event.message),
        battle_events: battleEvents,
        battle_speed: battleSpeedRef.current,
      })

      if (currentTime >= duration) {
        stopOnlineBattleTimer()
        void settleOnlineExperienceBattle(playerId, dungeonId, selectedCharacter?.character_id, duration, singleKills, groupKills)
      }
    }

    tick()
    onlineBattleTimerRef.current = window.setInterval(tick, 1000)
  }

  const settleOnlineExperienceBattle = async (
    playerId: string,
    dungeonId: string,
    characterId: string,
    duration: number,
    singleMonstersKilled: number,
    groupMonstersKilled: number,
  ) => {
    try {
      const response = await onlineApi.post('/battle-settlement', {
        playerId,
        dungeonId,
        characterIds: [characterId],
        success: true,
        duration,
        singleMonstersKilled,
        groupMonstersKilled,
        clientTrace: { source: 'battle-page-online-mode' },
      })
      const serverRewards = response.data?.serverRewards || {}
      const progress = response.data?.progress || {}
      window.dispatchEvent(new Event('gamer:resources-changed'))
      handleBattleResult({
        battle_id: response.data?.record?.id || battleId || `online-${Date.now()}`,
        player_id: playerId,
        dungeon_id: dungeonId,
        state: { code: 'finished', label: '已结算' },
        outcome: { success: response.data?.outcome === 'success', code: response.data?.outcome || 'success', label: response.data?.outcome === 'success' ? '通关' : '失败' },
        duration: serverRewards.cappedDuration || duration,
        rewards: { serverRewards },
        materials: (response.data?.rewards || []).map((item: any) => ({
          material_type: item.payload?.name || item.itemConfigId,
          attribute_type: item.payload?.attributeType || null,
          count: Number(item.quantity || 0),
        })),
        progress,
        progress_summary: {
          completion_count: Number(progress.successfulAttempts || 0),
          total_attempts: Number(progress.totalAttempts || 0),
          successful_attempts: Number(progress.successfulAttempts || 0),
          failed_attempts: Number(progress.failedAttempts || 0),
          sweep_unlocked: Number(progress.successfulAttempts || 0) >= 50,
          sweep_unlock_count: 50,
          sweep_text: Number(progress.successfulAttempts || 0) >= 50 ? '已解锁' : `${Number(progress.successfulAttempts || 0)}/50`,
        },
        finished_at: new Date().toISOString(),
      })
    } catch (error) {
      setBattleNotice(getOnlineModeError(error, '在线战斗结算失败，请确认 server-nest 正在运行。'))
      cancelAutoNavigate()
    }
  }

  const createBattle = async (dungeonId: string, selectedCharacterIds?: string[]) => {
    setLoading(true)
    setBattleResult(null)
    setSnapshot(null)
    cancelAutoNavigate()
    stopPolling()
    try {
      let characterIds = selectedCharacterIds || []
      if (characterIds.length === 0) {
        const charsResponse = await axios.get('/api/characters')
        const characters = charsResponse.data.characters || []
        characterIds = characters.slice(0, 1).map((c: any) => c.character_id)
      }

      if (characterIds.length === 0) {
        alert('请先抽取角色')
        navigate('/gacha')
        return
      }

      // 创建战斗
      const response = await axios.post('/api/battle/create', {
        dungeon_id: dungeonId,
        character_ids: characterIds,
        assist_enabled: assistEnabled
      })

      if (response.data.success) {
        const newBattleId = response.data.battle_id
        setBattleId(newBattleId)

        // 连接WebSocket
        connectWebSocket(newBattleId)

        // 开始战斗
        const started = await startBattle(newBattleId)
        if (started) {
          startPolling(newBattleId)
        }
      } else {
        alert(response.data.message)
        navigate('/dungeons')
      }
    } catch (error: any) {
      alert(error.response?.data?.message || '创建战斗失败')
      navigate('/dungeons')
    } finally {
      setLoading(false)
    }
  }

  const startPolling = (id: string) => {
    stopPolling()
    pollRef.current = window.setInterval(async () => {
      try {
        const response = await axios.get(`/api/battle/${id}/snapshot`)
        if (response.data.success) {
          const newSnapshot: BattleSnapshot = response.data.snapshot
          applySnapshot(newSnapshot)

          if (newSnapshot.result) {
            stopPolling()
            fetchBattleResult(id)
          } else {
            const flowCode = newSnapshot.flow_state?.code
            if (flowCode && ['completed', 'failed', 'reward', 'finished'].includes(flowCode)) {
              stopPolling()
              // 如果后端结果尚未到达，尝试获取最终结果
              fetchBattleResult(id)
            }
          }
        }
      } catch (error) {
        console.error('获取战斗快照失败', error)
        setBattleNotice('战斗同步暂时中断，正在继续尝试恢复。')
      }
    }, 1000)
  }

  const fetchBattleResult = async (id: string) => {
    try {
      const response = await axios.get(`/api/battle/${id}/result`)
      if (response.data.success) {
        const result: BattleResultPayload = response.data.result
        handleBattleResult(result)
      }
    } catch (error: any) {
      if (error.response?.status === 202) {
        setBattleNotice('战斗已结束，正在等待服务器写入结算。')
        window.setTimeout(() => fetchBattleResult(id), 1200)
        return
      }
      setBattleNotice(error.response?.data?.message || '读取战斗结算失败，请稍后重试。')
    }
  }

  const connectWebSocket = (battleId: string) => {
    const socket = io(getSocketUrl(), {
      transports: ['websocket']
    })

    socket.on('connect', () => {
      console.log('WebSocket连接成功')
      setBattleNotice('战斗同步已连接。')
      socket.emit('battle_join', { battle_id: battleId })
    })

    socket.on('disconnect', () => {
      setBattleNotice('战斗同步连接断开，正在等待重连。')
    })

    socket.on('connect_error', () => {
      setBattleNotice('战斗同步连接失败，轮询会继续拉取战斗状态。')
    })

    socket.on('battle_tick', (data: { snapshot: BattleSnapshot }) => {
      applySnapshot(data.snapshot)
    })

    socket.on('battle_end', (data: { result: BattleResultPayload }) => {
      stopPolling()
      fetchBattleResult(battleId)
    })
    
    socket.on('dungeon_drop', (data: { drop: DropEventEntry }) => {
      if (data?.drop) {
        setDropFeed((prev) => {
          const next = [data.drop, ...prev]
          return next.slice(0, 30)
        })
      }
    })

    socketRef.current = socket
  }

  const startBattle = async (battleId: string) => {
    try {
      const response = await axios.post(`/api/battle/${battleId}/start`, {
        battle_speed: battleSpeed
      })

      if (response.data.success) {
        if (response.data.speed_state?.current_speed) {
          setBattleSpeed(response.data.speed_state.current_speed)
          setSpeedSyncMessage(`当前速度：${response.data.speed_state.current_speed}x`)
        }
        return true
      }
    } catch (error: any) {
      alert(error.response?.data?.message || '开始战斗失败')
    }
    return false
  }

  const handleSpeedChange = async (speed: number) => {
    setSpeedUpdating(true)
    setSpeedSyncMessage(`正在请求 ${speed}x...`)
    if (isOnlineMode) {
      setBattleSpeed(speed)
      setSpeedSyncMessage(`当前速度：${speed}x`)
      setSpeedUpdating(false)
      return
    }
    if (battleId) {
      try {
        const response = await axios.post(`/api/battle/${battleId}/speed`, { battle_speed: speed })
        if (response.data.success) {
          const speedState = response.data.speed_state as SpeedState | undefined
          setBattleSpeed(speedState?.current_speed || response.data.battle_speed || speed)
          setSpeedSyncMessage(response.data.message || `当前速度：${speedState?.current_speed || speed}x`)
        }
      } catch (error) {
        console.error('更新战斗速度失败', error)
        setSpeedSyncMessage('速度同步失败，请稍后重试')
      } finally {
        setSpeedUpdating(false)
      }
    } else {
      setBattleSpeed(speed)
      setSpeedSyncMessage(`准备以 ${speed}x 开始`)
      setSpeedUpdating(false)
    }
  }

  const handleStopBattle = async () => {
    if (isOnlineMode) {
      stopOnlineBattleTimer()
      navigateToDungeons()
      return
    }
    if (battleId) {
      try {
        await axios.post(`/api/battle/${battleId}/stop`)
        stopPolling()
        navigateToDungeons()
      } catch (error) {
        console.error('停止战斗失败', error)
      }
    }
  }
  
  const dropSummary = battleResult?.drops
  const ownerOptions = dropSummary?.players ?? []
  const isMultiplayerResult = Boolean(snapshot?.speed_state?.is_multiplayer || ownerOptions.length > 1)
  const playerResultRows = useMemo(() => {
    const results = battleResult?.player_results || {}
    const rows = Object.values(results)
    const currentPlayerId = battleResult?.current_player_result?.player_id || battleResult?.player_id
    return rows.sort((a, b) => {
      if (a.player_id === currentPlayerId) return -1
      if (b.player_id === currentPlayerId) return 1
      return String(a.player_name || a.player_id).localeCompare(String(b.player_name || b.player_id))
    })
  }, [battleResult?.player_results, battleResult?.current_player_result?.player_id, battleResult?.player_id])
  const currentPlayerResult = battleResult?.current_player_result
  const filteredDrops = useMemo(() => {
    if (!dropSummary?.events) {
      return []
    }
    return [...dropSummary.events]
      .filter((event) => dropFilters.type === 'all' || event.item.item_type === dropFilters.type)
      .filter((event) => dropFilters.rarity === 'all' || event.item.rarity === dropFilters.rarity)
      .filter((event) => {
        if (dropFilters.owner === 'all') return true
        if (dropFilters.owner === '__unassigned__') {
          return !event.owner.player_id
        }
        return event.owner.player_id === dropFilters.owner
      })
      .sort((a, b) => {
        if (dropSort.key === 'rarity') {
          const aOrder = rarityOrderMap[a.item.rarity] ?? 999
          const bOrder = rarityOrderMap[b.item.rarity] ?? 999
          return dropSort.order === 'desc' ? aOrder - bOrder : bOrder - aOrder
        }
        if (dropSort.key === 'quantity') {
          return dropSort.order === 'desc'
            ? b.item.quantity - a.item.quantity
            : a.item.quantity - b.item.quantity
        }
        return dropSort.order === 'desc'
          ? b.sequence - a.sequence
          : a.sequence - b.sequence
      })
  }, [dropSummary, dropFilters, dropSort])
  const totalDropPages = Math.max(1, Math.ceil(filteredDrops.length / DROP_PAGE_SIZE))
  const paginatedDrops = filteredDrops.slice(
    (dropPage - 1) * DROP_PAGE_SIZE,
    dropPage * DROP_PAGE_SIZE
  )
  const currentDropFeed = dropFeed.slice(0, 10)
  const bossFocusEvent = useMemo(() => {
    const events = snapshot?.battle_events || []
    return [...events].reverse().find(event =>
      ['skill_telegraph', 'boss_skill', 'boss_mechanic'].includes(event.event_type)
    )
  }, [snapshot?.battle_events])
  const progressPercent = snapshot
    ? Math.min(100, Math.max(0, (snapshot.current_time / Math.max(snapshot.duration || 1, 1)) * 100))
    : 0
  const rewardRows = useMemo(() => {
    const rewards = battleResult?.rewards as any
    if (!rewards?.rewards) return []
    return Object.entries(rewards.rewards)
      .filter(([, value]) => typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')
      .map(([key, value]) => ({ key, value: String(value) }))
  }, [battleResult?.rewards])
  const teamStatus = battleResult?.team_performance || snapshot?.team_status
  const roleCounts = teamStatus?.role_profile?.counts || {}
  const presentationItems = useMemo(
    () => buildBattlePresentationItems(snapshot?.battle_events || [], currentDropFeed, teamStatus),
    [snapshot?.battle_events, currentDropFeed, teamStatus]
  )
  
  useEffect(() => {
    setDropPage((prev) => {
      if (prev > totalDropPages) {
        return totalDropPages
      }
      return prev
    })
  }, [totalDropPages])

  if (loading) {
    return (
      <div className="battle-page">
        <div className="loading">加载中...</div>
      </div>
    )
  }

  return (
    <div className="battle-page">
      <div className="battle-container">
        <div className="battle-header">
          <h1>战斗中</h1>
          <div className="battle-assist-toggle">
            <label>
              <input
                type="checkbox"
                checked={assistEnabled}
                onChange={(e) => handleAssistToggle(e.target.checked)}
              />
              <span>助战模式（掉落转换为1000通用金钱）</span>
            </label>
          </div>
          <div className="battle-controls">
            <button onClick={() => handleSpeedChange(1)} className={battleSpeed === 1 ? 'active' : ''} disabled={speedUpdating}>
              1x
            </button>
            <button onClick={() => handleSpeedChange(2)} className={battleSpeed === 2 ? 'active' : ''} disabled={speedUpdating}>
              2x
            </button>
            <button onClick={() => handleSpeedChange(4)} className={battleSpeed === 4 ? 'active' : ''} disabled={speedUpdating}>
              4x
            </button>
            <button onClick={handleStopBattle} className="stop-btn">停止</button>
          </div>
        </div>

        {battleNotice && <div className="battle-notice">{battleNotice}</div>}

        {snapshot && (
          <>
            <div className="battle-info">
              <div className="battle-info-grid">
                <div>
                  <span>时间</span>
                  <strong>{Math.floor(snapshot.current_time)}s / {snapshot.duration}s</strong>
                </div>
                <div>
                  <span>流程状态</span>
                  <strong>{snapshot.flow_state?.label ?? '未知'}</strong>
                </div>
                <div>
                  <span>战斗状态</span>
                  <strong>{snapshot.battle_state?.label ?? '未知'}</strong>
                </div>
                <div>
                  <span>速度同步</span>
                  <strong>{speedSyncMessage}</strong>
                </div>
              </div>
              <div className="battle-progress-bar">
                <div style={{ width: `${progressPercent}%` }} />
              </div>
              {snapshot.speed_state?.is_multiplayer && (
                <div className="speed-consensus">
                  4x同意：{snapshot.speed_state.agreed_count}/{snapshot.speed_state.total_players}
                  {snapshot.speed_state.pending_4x ? '，等待队友确认' : ''}
                </div>
              )}
            </div>

            {teamStatus && (
              <div className="team-status-panel">
                <div className="team-status-main">
                  <div>
                    <span>Team Phase</span>
                    <strong>{teamStatus.phase_name || '-'}</strong>
                    <small>{teamStatus.phase_reached ?? 0}/{teamStatus.phase_count ?? 0}</small>
                  </div>
                  <div>
                    <span>Pressure</span>
                    <strong>{teamStatus.pressure ?? 0}</strong>
                    <small>Peak {teamStatus.pressure_peak ?? 0} / Avg {teamStatus.pressure_average ?? 0}</small>
                  </div>
                  <div>
                    <span>Role Score</span>
                    <strong>{teamStatus.role_profile?.score ?? 0}</strong>
                    <small>{teamStatus.role_profile?.rating || '-'}</small>
                  </div>
                  <div>
                    <span>Reward Tier</span>
                    <strong>{teamStatus.reward_tier || '-'}</strong>
                    <small>Perf {teamStatus.performance_score ?? '-'}</small>
                  </div>
                </div>
                <div className="team-role-strip">
                  <span>Tank {roleCounts.tank ?? 0}</span>
                  <span>Healer {roleCounts.healer ?? 0}</span>
                  <span>Support {roleCounts.support ?? 0}</span>
                  <span>DPS {roleCounts.dps ?? 0}</span>
                </div>
              </div>
            )}

            {bossFocusEvent && (
              <div className={`boss-focus-alert ${getBattleEventClass(bossFocusEvent.event_type)}`}>
                <span>[{bossFocusEvent.time_text}]</span>
                <strong>{bossFocusEvent.message}</strong>
              </div>
            )}

            {presentationItems.length > 0 && (
              <div className="battle-presentation-panel">
                <div className="battle-presentation-header">
                  <h3>Battle Highlights</h3>
                  <span>skills, damage, phase shifts, pressure, and drops</span>
                </div>
                <div className="battle-presentation-grid">
                  {presentationItems.map((item) => (
                    <div key={item.id} className={`battle-highlight-card ${item.kind}`}>
                      <div>
                        <span>{item.time || item.kind}</span>
                        <strong>{item.title}</strong>
                      </div>
                      <em>{item.value}</em>
                      <p>{item.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
             
            <div className="drop-feed">
              <div className="drop-feed-header">
                <h3>实时掉落</h3>
                <span>{currentDropFeed.length > 0 ? `最新 ${currentDropFeed.length} 条` : '等待掉落'}</span>
              </div>
              <div className="drop-feed-items">
                {currentDropFeed.length === 0 && <p className="drop-feed-empty">本场战斗尚未掉落任何道具</p>}
                {currentDropFeed.map((drop) => (
                  <div key={drop.drop_id} className={`drop-feed-card rarity-${drop.item.rarity}`}>
                    <div
                      className="drop-feed-icon"
                      style={drop.item.icon ? { backgroundImage: `url(${drop.item.icon})` } : undefined}
                    >
                      {!drop.item.icon && drop.item.name.slice(0, 1)}
                    </div>
                    <div className="drop-feed-info">
                      <div className="drop-feed-name">
                        {drop.item.name} ×{drop.item.quantity}
                      </div>
                      <div className="drop-feed-meta">
                        <span>{drop.owner.player_name}</span>
                        <span>{drop.source === 'boss' ? 'Boss掉落' : '战斗掉落'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {battleResult && (
              <div className="battle-result">
                <h3>战斗结果</h3>
                <p>结果: {battleResult.outcome?.label ?? battleResult.state?.label ?? '未知'}</p>
                <p>总耗时: {typeof battleResult.duration === 'number' ? battleResult.duration.toFixed(1) : '-'}s</p>
                {battleResult.room_cleanup?.status === 'removed' && (
                  <p className="battle-result-note">多人房间已完成清理，队员可从结算页返回副本列表。</p>
                )}
                {(battleResult.outcome?.code === 'failed' || battleResult.state?.code === 'failed') && (
                  <div className="battle-failure-hints">
                    <h4>挑战失败，建议先完成以下提升再尝试：</h4>
                    <ul>
                      <li>提升角色等级：在副本或任务里刷经验，队伍平均等级越接近 100 越稳。</li>
                      <li>强化装备：先完成奖励系统的制作 / 升级，再为主力角色换上高级套装。</li>
                      <li>检查属性克制：针对副本属性多带相克的角色或技能，提高输出。</li>
                      <li>优化技能循环：确保技能槽里有群攻 / 控场技能，别忘了给治疗位留技能。</li>
                    </ul>
                  </div>
                )}
                {battleResult.error && (
                  <p className="battle-result-error">错误: {battleResult.error}</p>
                )}
                {battleResult.rewards && (
                  <div className="battle-result-section">
                    <h4>奖励结算</h4>
                    <div className="reward-result-grid">
                      <div className="reward-result-card primary">
                        <span>奖励类型</span>
                        <strong>{String((battleResult.rewards as any).reward_type || 'unknown')}</strong>
                      </div>
                      {rewardRows.map(row => (
                        <div key={row.key} className="reward-result-card">
                          <span>{row.key}</span>
                          <strong>{row.value}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {battleResult.team_performance && (
                  <div className="battle-result-section team-result-section">
                    <h4>20P Team Record</h4>
                    <div className="reward-result-grid">
                      <div className="reward-result-card primary">
                        <span>Tier</span>
                        <strong>{battleResult.team_performance.reward_tier || '-'}</strong>
                      </div>
                      <div className="reward-result-card">
                        <span>Performance</span>
                        <strong>{battleResult.team_performance.performance_score ?? 0}</strong>
                      </div>
                      <div className="reward-result-card">
                        <span>Phase</span>
                        <strong>{battleResult.team_performance.phase_reached ?? 0}/{battleResult.team_performance.phase_count ?? 0}</strong>
                      </div>
                      <div className="reward-result-card">
                        <span>Pressure Peak</span>
                        <strong>{battleResult.team_performance.pressure_peak ?? 0}</strong>
                      </div>
                      <div className="reward-result-card">
                        <span>Role Score</span>
                        <strong>{battleResult.team_performance.role_profile?.score ?? 0}</strong>
                      </div>
                    </div>
                    {battleResult.team_record?.record_id && (
                      <p className="team-record-note">Record saved: {String(battleResult.team_record.record_id)}</p>
                    )}
                  </div>
                )}
                {isMultiplayerResult && playerResultRows.length > 0 && (
                  <div className="battle-result-section multiplayer-settlement">
                    <h4>队员独立结算</h4>
                    <div className="multiplayer-settlement-grid">
                      {playerResultRows.map((playerResult) => {
                        const materialTotal = (playerResult.materials || []).reduce((sum, item) => sum + Number(item.count || 0), 0)
                        const characterEntries = Object.entries(playerResult.characters || {})
                        const levelUps = characterEntries.filter(([, info]) => info.leveled_up).length
                        const isCurrent = currentPlayerResult?.player_id === playerResult.player_id || battleResult.player_id === playerResult.player_id
                        return (
                          <div key={playerResult.player_id} className={`multiplayer-settlement-card ${isCurrent ? 'current' : ''}`}>
                            <div className="multiplayer-settlement-title">
                              <strong>{playerResult.player_name || playerResult.player_id}</strong>
                              {isCurrent && <span>我的结算</span>}
                            </div>
                            <div className="multiplayer-settlement-stats">
                              <span>材料：{materialTotal}</span>
                              <span>掉落：{playerResult.drops?.total_quantity ?? 0}</span>
                              <span>角色经验：{characterEntries.length}</span>
                              <span>升级：{levelUps}</span>
                            </div>
                            {(playerResult.materials || []).length > 0 && (
                              <ul>
                                {(playerResult.materials || []).slice(0, 3).map((material, index) => (
                                  <li key={`${playerResult.player_id}-${material.material_type}-${index}`}>
                                    {material.material_type}{material.attribute_type ? ` (${material.attribute_type})` : ''} × {material.count}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {playerResult.progress_summary && (
                              <p>
                                副本进度：{playerResult.progress_summary.completion_count}/{playerResult.progress_summary.sweep_unlock_count}
                                {playerResult.progress_summary.sweep_unlocked ? '，已解锁扫荡' : ''}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {battleResult.materials && battleResult.materials.length > 0 && (
                  <div className="battle-result-section">
                    <h4>获得材料</h4>
                    <ul>
                      {battleResult.materials.map((material, index) => (
                        <li key={`${material.material_type}-${material.attribute_type ?? 'all'}-${index}`}>
                          {material.material_type}
                          {material.attribute_type ? ` (${material.attribute_type})` : ''} × {material.count}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {battleResult.characters && Object.keys(battleResult.characters).length > 0 && (
                  <div className="battle-result-section">
                    <h4>角色经验</h4>
                    <ul>
                      {Object.entries(battleResult.characters).map(([charId, info]) => (
                        <li key={charId}>
                          角色 {charId}: +{info.gained_exp} EXP（Lv.{info.before_level} → Lv.{info.after_level}
                          {info.leveled_up ? ' ✓' : ''})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {dropSummary && (
                  <div className="battle-result-section drop-summary">
                    <div className="drop-summary-header">
                      <div>
                        <h4>{isMultiplayerResult ? '多人掉落归属' : '掉落展示'}</h4>
                        <p className="drop-summary-subtitle">
                          {isMultiplayerResult
                            ? '按队员分别汇总本场掉落，实时掉落和结算奖励都会保留归属。'
                            : '副本结算后自动汇总，失败也能保留至仓库'}
                        </p>
                      </div>
                      <div className="drop-summary-stats">
                        <span>总掉落：{dropSummary.stats?.total_events ?? dropSummary.events.length}</span>
                        <span>
                          装备/道具：
                          {(dropSummary.stats?.types?.equipment ?? 0) + (dropSummary.stats?.types?.prop ?? 0)}
                        </span>
                        <span>材料：{dropSummary.stats?.types?.material ?? 0}</span>
                      </div>
                    </div>
                    {dropSummary.assist?.enabled && (
                      <div className="assist-banner">
                        助战奖励：本场已转换 {dropSummary.assist.total_currency} 金币
                        （每次掉落 {dropSummary.assist.currency_per_drop} 金币）
                      </div>
                    )}
                    <div className="drop-filters">
                      <label>
                        类型
                        <select
                          value={dropFilters.type}
                          onChange={(e) => setDropFilters((prev) => ({ ...prev, type: e.target.value }))}
                        >
                          <option value="all">全部类型</option>
                          <option value="equipment">装备/饰品</option>
                          <option value="prop">局内道具</option>
                          <option value="material">材料</option>
                        </select>
                      </label>
                      <label>
                        稀有度
                        <select
                          value={dropFilters.rarity}
                          onChange={(e) => setDropFilters((prev) => ({ ...prev, rarity: e.target.value }))}
                        >
                          <option value="all">全部稀有度</option>
                          <option value="legendary">传说</option>
                          <option value="epic">史诗</option>
                          <option value="rare">稀有</option>
                          <option value="uncommon">精良</option>
                          <option value="common">普通</option>
                        </select>
                      </label>
                      <label>
                        所有者
                        <select
                          value={dropFilters.owner}
                          onChange={(e) => setDropFilters((prev) => ({ ...prev, owner: e.target.value }))}
                        >
                          <option value="all">所有队员</option>
                          <option value="__unassigned__">未分配</option>
                          {ownerOptions.map((player) => (
                            <option key={player.player_id ?? 'unassigned-option'} value={player.player_id ?? '__unassigned__'}>
                              {player.player_name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        排序
                        <select
                          value={dropSort.key}
                          onChange={(e) =>
                            setDropSort((prev) => ({ ...prev, key: e.target.value as 'sequence' | 'rarity' | 'quantity' }))
                          }
                        >
                          <option value="sequence">最近掉落</option>
                          <option value="rarity">稀有度</option>
                          <option value="quantity">数量</option>
                        </select>
                      </label>
                      <div className="drop-sort-order">
                        <button
                          className={dropSort.order === 'desc' ? 'active' : ''}
                          onClick={() => setDropSort((prev) => ({ ...prev, order: 'desc' }))}
                        >
                          降序
                        </button>
                        <button
                          className={dropSort.order === 'asc' ? 'active' : ''}
                          onClick={() => setDropSort((prev) => ({ ...prev, order: 'asc' }))}
                        >
                          升序
                        </button>
                      </div>
                    </div>
                    <div className="drop-player-grid">
                      {ownerOptions.length === 0 && (
                        <div className="drop-player-empty">暂无可展示的个人掉落记录</div>
                      )}
                      {ownerOptions.map((player) => (
                        <div key={player.player_id ?? 'unassigned'} className="player-drop-card">
                          <div className="player-drop-title">{player.player_name}</div>
                          <div className="player-drop-stat">
                            共 {player.total_items} 件 / {player.total_quantity} 份
                          </div>
                          <ul>
                            {player.drops.slice(0, 3).map((drop) => (
                              <li key={drop.drop_id}>
                                {drop.item.name} ×{drop.item.quantity}
                              </li>
                            ))}
                            {player.drops.length === 0 && <li>尚未获得掉落</li>}
                          </ul>
                        </div>
                      ))}
                    </div>
                    <div className="drop-table-wrapper">
                      <table className="drop-table">
                        <thead>
                          <tr>
                            <th>物品</th>
                            <th>所属</th>
                            <th>类型/稀有</th>
                            <th>数量</th>
                            <th>来源</th>
                            <th>标签</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedDrops.length === 0 && (
                            <tr>
                              <td colSpan={6}>未找到符合条件的掉落</td>
                            </tr>
                          )}
                          {paginatedDrops.map((drop) => {
                            const tags = drop.item.classifications
                              ? Object.entries(drop.item.classifications).slice(0, 3)
                              : []
                            return (
                              <tr key={drop.drop_id}>
                                <td>
                                  <div className="drop-item-cell">
                                    <div
                                      className="drop-table-icon"
                                      style={drop.item.icon ? { backgroundImage: `url(${drop.item.icon})` } : undefined}
                                    >
                                      {!drop.item.icon && drop.item.name.slice(0, 1)}
                                    </div>
                                    <div>
                                      <div className="drop-item-name">{drop.item.name}</div>
                                      <div className={`drop-rarity-badge rarity-${drop.item.rarity}`}>
                                        {drop.item.rarity.toUpperCase()}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td>{drop.owner.player_name}</td>
                                <td>
                                  {drop.item.item_type}
                                  <br />
                                  {drop.item.quality}
                                </td>
                                <td>×{drop.item.quantity}</td>
                                <td>{drop.source === 'reward' ? '结算' : drop.source === 'boss' ? 'Boss' : '战斗'}</td>
                                <td>
                                  <div className="drop-tag-group">
                                    {tags.map(([key, value]) => (
                                      <span key={`${drop.drop_id}-${key}`} className="classification-tag">
                                        {value}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="drop-pagination">
                      <button onClick={() => setDropPage(1)} disabled={dropPage === 1}>
                        «
                      </button>
                      <button onClick={() => setDropPage((prev) => Math.max(1, prev - 1))} disabled={dropPage === 1}>
                        ‹
                      </button>
                      <span>
                        第 {dropPage} / {totalDropPages} 页
                      </span>
                      <button
                        onClick={() => setDropPage((prev) => Math.min(totalDropPages, prev + 1))}
                        disabled={dropPage === totalDropPages}
                      >
                        ›
                      </button>
                      <button onClick={() => setDropPage(totalDropPages)} disabled={dropPage === totalDropPages}>
                        »
                      </button>
                    </div>
                  </div>
                )}
                {battleResult.progress && (
                  <div className="battle-result-section">
                    <h4>副本进度</h4>
                    <div className="progress-result-grid">
                      <div>
                        <span>完成次数</span>
                        <strong>{battleResult.progress_summary?.completion_count ?? String(battleResult.progress.completion_count || 0)}</strong>
                      </div>
                      <div>
                        <span>总挑战</span>
                        <strong>{battleResult.progress_summary?.total_attempts ?? String(battleResult.progress.total_attempts || 0)}</strong>
                      </div>
                      <div>
                        <span>成功/失败</span>
                        <strong>
                          {battleResult.progress_summary
                            ? `${battleResult.progress_summary.successful_attempts}/${battleResult.progress_summary.failed_attempts}`
                            : `${battleResult.progress.successful_attempts || 0}/${battleResult.progress.failed_attempts || 0}`}
                        </strong>
                      </div>
                      <div>
                        <span>扫荡</span>
                        <strong>{battleResult.progress_summary?.sweep_text || (battleResult.progress.sweep_unlocked ? '已解锁' : '未解锁')}</strong>
                      </div>
                    </div>
                  </div>
                )}
                <div className="battle-result-actions">
                  <button onClick={() => navigateToDungeons(battleResult)}>立即返回</button>
                  {autoNavigate ? (
                    <button onClick={cancelAutoNavigate}>留在此页</button>
                  ) : (
                    <button onClick={() => startRedirectTimer(battleResult)}>重新开始倒计时</button>
                  )}
                </div>
                {autoNavigate && redirectCountdown !== null && (
                  <p className="battle-result-countdown">
                    {redirectCountdown > 0
                      ? `将在 ${redirectCountdown}s 后自动返回副本列表`
                      : '即将返回副本列表...'}
                  </p>
                )}
              </div>
            )}

            <div className="battle-units">
              <div className="player-units">
                <h2>玩家单位</h2>
                {snapshot.player_units.map((unit) => {
                  const health = unit.health ?? unit.physical_health + unit.magical_health
                  const maxHealth = unit.max_health ?? unit.max_physical_health + unit.max_magical_health
                  return (
                    <div key={unit.character_id} className="unit-card">
                      <h3>{unit.name}</h3>
                      <div className="health-bars">
                        <div className="health-bar vitality">
                          <div className="health-label">HP</div>
                          <div className="health-bar-fill" style={{
                            width: `${(health / Math.max(maxHealth || 1, 1)) * 100}%`,
                            backgroundColor: '#38a169'
                          }}></div>
                          <div className="health-text">
                            {health} / {maxHealth}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="enemy-units">
                <h2>敌人单位</h2>
                <div className="enemy-unit-grid">
                {snapshot.enemy_units.map((unit) => {
                  const health = unit.health ?? unit.physical_health + unit.magical_health
                  const maxHealth = unit.max_health ?? unit.max_physical_health + unit.max_magical_health
                  const isBoss = unit.spawn_category === 'boss' || !!unit.boss_type
                  return (
                    <div key={unit.character_id} className={`unit-card enemy-unit-card ${isBoss ? 'boss-unit-card' : ''}`} title={`${unit.name} ${health}/${maxHealth}`}>
                      <h3>{unit.name}</h3>
                      {isBoss && (
                        <div className="boss-unit-badges">
                          <span>{unit.boss_type}</span>
                          {unit.boss_mechanic?.active === false && <span>待激活</span>}
                          {unit.boss_mechanic?.strengthened && <span>强化</span>}
                          {unit.boss_mechanic?.shared_health && <span>共血</span>}
                        </div>
                      )}
                      <div className="health-bars">
                        <div className="health-bar vitality">
                          <div className="health-label">HP</div>
                          <div className="health-bar-fill" style={{
                            width: `${(health / Math.max(maxHealth || 1, 1)) * 100}%`,
                            backgroundColor: '#38a169'
                          }}></div>
                          <div className="health-text">
                            {health} / {maxHealth}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                </div>
              </div>
            </div>

            {snapshot.battle_log && snapshot.battle_log.length > 0 && (
              <div className="battle-log">
                <h3>战斗日志</h3>
                <div className="log-content">
                  {(snapshot.battle_events && snapshot.battle_events.length > 0)
                    ? snapshot.battle_events.map((event, index) => (
                      <p key={`${event.time_text}-${index}`} className={`log-entry ${getBattleEventClass(event.event_type)}`}>
                        <span className="log-time">[{event.time_text}]</span>
                        <span>{event.message}</span>
                      </p>
                    ))
                    : snapshot.battle_log.map((log, index) => (
                      <p key={index} className="log-entry normal">{log}</p>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default BattlePage
