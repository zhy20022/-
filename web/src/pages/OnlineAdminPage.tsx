import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getApiErrorMessage, onlineApi } from '../services/onlineApi'
import './OnlineAdminPage.css'

interface OnlineAdminSummary {
  players: number
  activeIdleSessions: number
  dailyGoalRows: number
  battleRecords: number
  rankingEntries: number
  recentIdleClaims: Array<{ id: string; playerId: string; goldGranted: number; createdAt: string }>
  recentBattles: Array<{ id: string; playerId: string; dungeonId: string; success: boolean; damageScore: number; createdAt: string }>
}

interface OnlineAdminPlayer {
  id: string
  displayName: string
  level: number
  gold: number
  premiumCurrency: number
  createdAt: string
}

interface PlayerOperations {
  player: OnlineAdminPlayer
  inventory: Array<{ id: string; itemConfigId: string; itemType: string; quantity: number }>
  dailyGoals: Array<{ id: string; dateKey: string; goalKey: string; progress: number; claimed: boolean }>
  idleSessions: Array<{ id: string; stageId: string; status: string; createdAt: string }>
  idleClaims: Array<{ id: string; stageId: string; goldGranted: number; createdAt: string }>
  battleRecords: Array<{ id: string; dungeonId: string; success: boolean; damageScore: number; duration: number }>
  rankings: Array<{ id: string; rankingKey: string; seasonId: string; score: number }>
}

const OnlineAdminPage: React.FC = () => {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<OnlineAdminSummary | null>(null)
  const [players, setPlayers] = useState<OnlineAdminPlayer[]>([])
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [playerOps, setPlayerOps] = useState<PlayerOperations | null>(null)
  const [query, setQuery] = useState('')
  const [adminToken, setAdminToken] = useState(localStorage.getItem('gamer_online_admin_token') || 'dev-admin-token')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadDashboard()
  }, [])

  const adminHeaders = () => ({ 'x-admin-token': adminToken })

  const loadDashboard = async () => {
    try {
      const [summaryResponse, playersResponse] = await Promise.all([
        onlineApi.get('/admin/operations', { headers: adminHeaders() }),
        onlineApi.get('/admin/players', { headers: adminHeaders() }),
      ])
      setSummary(summaryResponse.data)
      setPlayers(playersResponse.data)
      setMessage('')
    } catch (error) {
      setMessage(getApiErrorMessage(error, '在线后台数据加载失败'))
    }
  }

  const searchPlayers = async () => {
    try {
      const response = await onlineApi.get('/admin/players', {
        headers: adminHeaders(),
        params: { q: query.trim() || undefined },
      })
      setPlayers(response.data)
      setMessage('')
    } catch (error) {
      setMessage(getApiErrorMessage(error, '玩家搜索失败'))
    }
  }

  const loadPlayerOperations = async (playerId: string) => {
    try {
      setSelectedPlayerId(playerId)
      const response = await onlineApi.get(`/admin/players/${playerId}/operations`, { headers: adminHeaders() })
      setPlayerOps(response.data)
      setMessage('')
    } catch (error) {
      setMessage(getApiErrorMessage(error, '玩家运营数据加载失败'))
    }
  }

  const saveAdminToken = () => {
    localStorage.setItem('gamer_online_admin_token', adminToken)
    setMessage('后台令牌已保存')
  }

  const sendTestMail = async () => {
    if (!selectedPlayerId) {
      setMessage('请先选择玩家')
      return
    }
    try {
      await onlineApi.post('/admin/mail', {
        playerId: selectedPlayerId,
        title: '运营测试邮件',
        body: '这是一封在线后台测试邮件。',
        rewards: [{ itemConfigId: 'daily_token', itemType: 'material', quantity: 1 }],
      }, { headers: adminHeaders() })
      setMessage('测试邮件已发送')
    } catch (error) {
      setMessage(getApiErrorMessage(error, '测试邮件发送失败'))
    }
  }

  return (
    <div className="online-admin-page">
      <div className="online-admin-shell">
        <header className="online-admin-header">
          <button onClick={() => navigate('/')} className="online-admin-back">返回主界面</button>
          <div>
            <h1>在线运营后台</h1>
            <p>查看 Nest 在线服的玩家、挂机、每日、背包、战斗和排行榜数据</p>
          </div>
        </header>

        {message && <div className="online-admin-message">{message}</div>}

        <section className="online-admin-token">
          <label>
            Admin Token
            <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} />
          </label>
          <button onClick={saveAdminToken}>保存</button>
          <button onClick={() => void loadDashboard()}>刷新总览</button>
        </section>

        {summary && (
          <section className="online-admin-stats">
            <div><strong>{summary.players}</strong><span>玩家</span></div>
            <div><strong>{summary.activeIdleSessions}</strong><span>挂机中</span></div>
            <div><strong>{summary.dailyGoalRows}</strong><span>日常进度</span></div>
            <div><strong>{summary.battleRecords}</strong><span>战斗记录</span></div>
            <div><strong>{summary.rankingEntries}</strong><span>排行榜记录</span></div>
          </section>
        )}

        <main className="online-admin-grid">
          <section className="online-admin-panel">
            <div className="online-admin-panel-title">
              <h2>玩家查询</h2>
              <button onClick={() => void searchPlayers()}>搜索</button>
            </div>
            <input className="online-admin-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="玩家名或玩家 ID" />
            <div className="online-admin-player-list">
              {players.map((item) => (
                <button
                  key={item.id}
                  className={selectedPlayerId === item.id ? 'selected' : ''}
                  onClick={() => void loadPlayerOperations(item.id)}
                >
                  <strong>{item.displayName}</strong>
                  <span>Lv.{item.level} · 金币 {item.gold}</span>
                  <small>{item.id}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="online-admin-panel">
            <div className="online-admin-panel-title">
              <h2>玩家复盘</h2>
              <button disabled={!selectedPlayerId} onClick={() => void sendTestMail()}>发测试邮件</button>
            </div>
            {!playerOps ? (
              <div className="online-admin-empty">选择一个玩家查看详情</div>
            ) : (
              <div className="online-admin-detail">
                <h3>{playerOps.player.displayName}</h3>
                <div className="online-admin-mini-stats">
                  <span>背包 {playerOps.inventory.length}</span>
                  <span>日常 {playerOps.dailyGoals.length}</span>
                  <span>挂机 {playerOps.idleSessions.length}</span>
                  <span>战斗 {playerOps.battleRecords.length}</span>
                  <span>排行 {playerOps.rankings.length}</span>
                </div>
                <DataBlock title="背包" rows={playerOps.inventory.map((item) => `${item.itemConfigId} x${item.quantity}`)} />
                <DataBlock title="每日目标" rows={playerOps.dailyGoals.map((goal) => `${goal.dateKey} ${goal.goalKey} ${goal.progress}${goal.claimed ? ' 已领' : ''}`)} />
                <DataBlock title="挂机记录" rows={playerOps.idleSessions.map((idle) => `${idle.stageId} · ${idle.status}`)} />
                <DataBlock title="战斗记录" rows={playerOps.battleRecords.map((battle) => `${battle.dungeonId} · ${battle.success ? '胜利' : '失败'} · ${battle.damageScore}`)} />
                <DataBlock title="排行榜" rows={playerOps.rankings.map((ranking) => `${ranking.rankingKey}/${ranking.seasonId} · ${ranking.score}`)} />
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}

const DataBlock: React.FC<{ title: string; rows: string[] }> = ({ title, rows }) => (
  <section className="online-admin-data-block">
    <h4>{title}</h4>
    {rows.length === 0 ? <p>暂无记录</p> : rows.slice(0, 8).map((row) => <p key={row}>{row}</p>)}
  </section>
)

export default OnlineAdminPage
