import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { getOnlineApiBase } from '../config'
import { OnlineSession, ensureOnlineSession, getApiErrorMessage, onlineApi } from '../services/onlineApi'
import './OnlineProgressPage.css'

type FeedbackType = 'success' | 'error' | 'info'

interface Feedback {
  type: FeedbackType
  message: string
}

interface CharacterRow {
  id: string
  characterConfigId: string
  attributeType: string
  professionType: string
  level: number
  exp: number
}

interface InventoryGrant {
  id?: string
  itemConfigId: string
  itemType: string
  quantity: number
}

interface IdleStage {
  stageId: string
  name?: string
  minClaimSeconds?: number
  maxClaimSeconds?: number
  requiredPower?: number
  goldPerHour?: number
  rewardsPerHour?: Array<{
    itemConfigId: string
    itemType: string
    quantity: number
  }>
}

interface IdlePreview {
  elapsedSeconds: number
  cappedSeconds: number
  maxClaimSeconds: number
  rewardMultiplier: number
  gold: number
  rewards: InventoryGrant[]
}

interface IdleSession {
  id: string
  stageId: string
  characterIds: string[]
  status: string
  startedAt: string
  lastClaimedAt: string
  metadata?: Record<string, unknown>
}

interface DailyGoal {
  goalKey: string
  title: string
  eventType: string
  target: number
  progress: number
  complete: boolean
  claimed: boolean
  rewards: {
    gold?: number
    items?: InventoryGrant[]
  }
}

interface DailyGoalList {
  dateKey: string
  goals: DailyGoal[]
}

const defaultStageId = 'default_idle_stage'

const OnlineProgressPage: React.FC = () => {
  const navigate = useNavigate()
  const { player } = useAuthStore()
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(null)
  const [characters, setCharacters] = useState<CharacterRow[]>([])
  const [stages, setStages] = useState<IdleStage[]>([])
  const [selectedStageId, setSelectedStageId] = useState(defaultStageId)
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([])
  const [idleSession, setIdleSession] = useState<IdleSession | null>(null)
  const [idlePreview, setIdlePreview] = useState<IdlePreview | null>(null)
  const [dailyGoals, setDailyGoals] = useState<DailyGoalList | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [loading, setLoading] = useState(false)
  const [trustStatus, setTrustStatus] = useState<Feedback | null>(null)

  const currentPlayerId = onlineSession?.player.id || ''
  const currentPlayerName = onlineSession?.player.displayName || '当前玩家'

  const selectedStage = useMemo(
    () => stages.find((stage) => stage.stageId === selectedStageId),
    [selectedStageId, stages],
  )

  useEffect(() => {
    void loadStaticConfigs()
  }, [])

  useEffect(() => {
    void bridgeOnlineSession()
  }, [player])

  useEffect(() => {
    if (onlineSession?.player.id) {
      void refreshPlayerData(onlineSession.player.id)
    }
  }, [onlineSession?.player.id])

  const bridgeOnlineSession = async (forceRefresh = false) => {
    try {
      const session = await ensureOnlineSession(player, { forceRefresh })
      setOnlineSession(session)
      if (forceRefresh) setFeedback({ type: 'success', message: '在线账号已重新绑定' })
    } catch (error) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error, '在线账号绑定失败') })
    }
  }

  const loadStaticConfigs = async () => {
    try {
      const response = await onlineApi.get('/configs/idle_stages')
      const loadedStages = response.data?.payload?.stages || []
      setStages(loadedStages)
      if (loadedStages.length > 0) {
        setSelectedStageId(loadedStages[0].stageId)
      }
    } catch (error) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error, '挂机配置加载失败') })
    }
  }

  const refreshPlayerData = async (playerId: string) => {
    try {
      setLoading(true)
      const [profileResponse, idleResponse, dailyResponse] = await Promise.all([
        onlineApi.get(`/players/${playerId}/profile`),
        onlineApi.get(`/idle/${playerId}/status`),
        onlineApi.get(`/daily-goals/${playerId}`),
      ])
      const loadedCharacters = profileResponse.data?.characters || []
      setCharacters(loadedCharacters)
      setSelectedCharacterIds((previous) => {
        const valid = previous.filter((id) => loadedCharacters.some((character: CharacterRow) => character.id === id))
        return valid.length > 0 ? valid : loadedCharacters.slice(0, 1).map((character: CharacterRow) => character.id)
      })
      setIdleSession(idleResponse.data?.session || null)
      setIdlePreview(idleResponse.data?.preview || null)
      setDailyGoals(dailyResponse.data)
      setFeedback(null)
    } catch (error) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error, '在线进度加载失败') })
    } finally {
      setLoading(false)
    }
  }

  const toggleCharacter = (characterId: string) => {
    setSelectedCharacterIds((previous) => (
      previous.includes(characterId)
        ? previous.filter((id) => id !== characterId)
        : [...previous, characterId]
    ))
  }

  const startIdle = async () => {
    if (!currentPlayerId) {
      setFeedback({ type: 'error', message: '缺少在线后端玩家 ID' })
      return
    }
    if (selectedCharacterIds.length === 0) {
      setFeedback({ type: 'error', message: '请至少选择 1 名角色' })
      return
    }
    try {
      const response = await onlineApi.post('/idle/start', {
        playerId: currentPlayerId,
        stageId: selectedStageId,
        characterIds: selectedCharacterIds,
      })
      setIdleSession(response.data.session)
      setIdlePreview(response.data.preview)
      setFeedback({ type: 'success', message: '挂机已开始，收益由服务器计算' })
      await loadDailyGoals(currentPlayerId)
    } catch (error) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error, '挂机开始失败') })
    }
  }

  const claimIdle = async () => {
    if (!currentPlayerId) return
    try {
      const response = await onlineApi.post(`/idle/${currentPlayerId}/claim`, {})
      const itemText = formatItems(response.data.rewards || [])
      const goldText = response.data.gold > 0 ? `金币 +${formatNumber(response.data.gold)}` : ''
      const rewardText = [goldText, itemText].filter(Boolean).join('，') || '暂无可领取物品'
      setFeedback({ type: 'success', message: `挂机收益领取成功：${rewardText}` })
      await refreshPlayerData(currentPlayerId)
    } catch (error) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error, '挂机收益领取失败') })
    }
  }

  const stopIdle = async () => {
    if (!currentPlayerId) return
    try {
      await onlineApi.post(`/idle/${currentPlayerId}/stop`, {})
      setFeedback({ type: 'info', message: '挂机已停止' })
      await refreshPlayerData(currentPlayerId)
    } catch (error) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error, '停止挂机失败') })
    }
  }

  const loadDailyGoals = async (playerId: string) => {
    const response = await onlineApi.get(`/daily-goals/${playerId}`)
    setDailyGoals(response.data)
  }

  const claimDailyGoal = async (goalKey: string) => {
    if (!currentPlayerId) return
    try {
      const response = await onlineApi.post(`/daily-goals/${currentPlayerId}/claim`, { goalKey })
      const goldText = response.data?.rewards?.gold > 0 ? `金币 +${formatNumber(response.data.rewards.gold)}` : ''
      const itemText = formatItems(response.data?.rewards?.items || [])
      setFeedback({
        type: 'success',
        message: `每日目标领取成功：${[goldText, itemText].filter(Boolean).join('，') || goalKey}`,
      })
      await loadDailyGoals(currentPlayerId)
    } catch (error) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error, '每日目标领取失败') })
    }
  }

  const verifyProtectedRanking = async () => {
    if (!currentPlayerId) {
      setTrustStatus({ type: 'error', message: '缺少在线后端玩家 ID' })
      return
    }
    try {
      await onlineApi.post('/ranking/damage_weekly/score', {
        playerId: currentPlayerId,
        score: 999999999,
        seasonId: 'client-check',
        payload: { source: 'frontend_probe' },
      })
      setTrustStatus({ type: 'error', message: '校验失败：核心排行榜接受了客户端提交' })
    } catch (error) {
      setTrustStatus({ type: 'success', message: `已拦截客户端刷分：${translateTrustError(getApiErrorMessage(error))}` })
    }
  }

  const completionCount = dailyGoals?.goals.filter((goal) => goal.complete).length || 0
  const claimedCount = dailyGoals?.goals.filter((goal) => goal.claimed).length || 0
  const idleClaimDisabled = !idlePreview || idlePreview.cappedSeconds < Number(selectedStage?.minClaimSeconds || 60)

  return (
    <div className="online-progress-page">
      <div className="online-progress-shell">
        <header className="online-progress-header">
          <button onClick={() => navigate('/')} className="online-back-btn">返回主界面</button>
          <div>
            <h1>在线收益</h1>
            <p>{currentPlayerName} · {currentPlayerId || '未绑定在线后端玩家'}</p>
          </div>
          <span className="online-api-pill">{getOnlineApiBase()}</span>
        </header>

        <section className="online-player-bar">
          <div className="online-bound-player">
            <span>已绑定在线账号</span>
            <strong>{currentPlayerId || '绑定中...'}</strong>
          </div>
          <button disabled={!player || loading} onClick={() => void bridgeOnlineSession(true)}>
            重新绑定
          </button>
          <button disabled={!currentPlayerId || loading} onClick={() => void refreshPlayerData(currentPlayerId)}>
            刷新
          </button>
        </section>

        {feedback && <div className={`online-feedback ${feedback.type}`}>{feedback.message}</div>}

        <main className="online-progress-grid">
          <section className="online-panel idle-panel">
            <div className="panel-title-row">
              <h2>挂机收益</h2>
              <span>{idleSession ? '运行中' : '未开始'}</span>
            </div>

            <div className="idle-stats">
              <div>
                <strong>{formatDuration(idlePreview?.cappedSeconds || 0)}</strong>
                <span>可领取时长</span>
              </div>
              <div>
                <strong>{formatNumber(idlePreview?.gold || 0)}</strong>
                <span>预计金币</span>
              </div>
              <div>
                <strong>{idlePreview?.rewardMultiplier?.toFixed(2) || '1.00'}x</strong>
                <span>队伍倍率</span>
              </div>
            </div>

            <div className="online-form-grid">
              <label>
                挂机场景
                <select value={selectedStageId} onChange={(event) => setSelectedStageId(event.target.value)}>
                  {stages.map((stage) => (
                    <option key={stage.stageId} value={stage.stageId}>
                      {stage.name || stage.stageId}
                    </option>
                  ))}
                </select>
              </label>
              <div className="stage-meta">
                <span>最低领取 {formatDuration(selectedStage?.minClaimSeconds || 60)}</span>
                <span>上限 {formatDuration(selectedStage?.maxClaimSeconds || 28800)}</span>
                <span>战力需求 {formatNumber(selectedStage?.requiredPower || 0)}</span>
              </div>
            </div>

            <div className="character-pick-list">
              {characters.length === 0 ? (
                <div className="online-empty">暂无在线角色</div>
              ) : characters.map((character) => (
                <button
                  key={character.id}
                  className={selectedCharacterIds.includes(character.id) ? 'selected' : ''}
                  onClick={() => toggleCharacter(character.id)}
                >
                  <strong>{character.characterConfigId}</strong>
                  <span>Lv.{character.level} · {character.attributeType}</span>
                </button>
              ))}
            </div>

            <div className="reward-preview">
              <span>预计物品</span>
              <strong>{formatItems(idlePreview?.rewards || []) || '等待累计'}</strong>
            </div>

            <div className="online-action-row">
              <button disabled={!currentPlayerId || selectedCharacterIds.length === 0} onClick={() => void startIdle()}>
                开始挂机
              </button>
              <button disabled={idleClaimDisabled} onClick={() => void claimIdle()}>
                领取收益
              </button>
              <button disabled={!idleSession} onClick={() => void stopIdle()}>
                停止
              </button>
            </div>
          </section>

          <section className="online-panel daily-panel">
            <div className="panel-title-row">
              <h2>每日目标</h2>
              <span>{completionCount}/{dailyGoals?.goals.length || 0} 完成 · {claimedCount} 已领</span>
            </div>

            <div className="daily-goal-list">
              {!dailyGoals ? (
                <div className="online-empty">每日目标未加载</div>
              ) : dailyGoals.goals.map((goal) => (
                <article key={goal.goalKey} className={`daily-goal-card ${goal.complete ? 'complete' : ''}`}>
                  <div>
                    <h3>{goal.title}</h3>
                    <p>{goal.progress}/{goal.target} · {formatDailyRewards(goal)}</p>
                  </div>
                  <button
                    disabled={!goal.complete || goal.claimed}
                    onClick={() => void claimDailyGoal(goal.goalKey)}
                  >
                    {goal.claimed ? '已领取' : '领取'}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="online-panel trust-panel">
            <div className="panel-title-row">
              <h2>可信校验</h2>
              <span>服务器裁决</span>
            </div>

            <div className="trust-check-card">
              <div>
                <strong>核心排行榜</strong>
                <p>damage_weekly 只接受战斗结算写入</p>
              </div>
              <button disabled={!currentPlayerId} onClick={() => void verifyProtectedRanking()}>
                测试拦截
              </button>
            </div>

            {trustStatus && <div className={`online-feedback compact ${trustStatus.type}`}>{trustStatus.message}</div>}

            <div className="trust-rule-list">
              <span>战斗奖励：读取 reward_rules</span>
              <span>挂机收益：读取 idle_stages</span>
              <span>每日目标：读取 daily_goals</span>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

const formatNumber = (value: number) => new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.floor(value)))

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  if (hours > 0) return `${hours}小时${minutes}分`
  return `${minutes}分${safeSeconds % 60}秒`
}

const formatItems = (items: InventoryGrant[]) => (
  items
    .filter((item) => item.quantity > 0)
    .map((item) => `${item.itemConfigId} x${formatNumber(item.quantity)}`)
    .join('，')
)

const formatDailyRewards = (goal: DailyGoal) => {
  const goldText = goal.rewards.gold ? `金币 x${formatNumber(goal.rewards.gold)}` : ''
  const itemText = formatItems(goal.rewards.items || [])
  return [goldText, itemText].filter(Boolean).join('，') || '无奖励'
}

const translateTrustError = (message: string) => {
  if (message.includes('server-authoritative')) return '该排行榜只能由服务器写入'
  return message
}

export default OnlineProgressPage
