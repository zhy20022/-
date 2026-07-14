import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import './WorldBossPage.css'

interface WorldBossRanking {
  rank?: number
  player_id: string
  username: string
  max_damage: number
  total_damage: number
  attempts: number
}

interface WorldBossSettlement {
  settlement_id: string
  total_damage: number
  reward_material_type: string
  reward_count: number
  created_at?: string
}

interface WorldBossChest {
  chest_id: string
  layer: number
  tier: number
  status: 'unopened' | 'opened'
  reward_payload?: {
    reward_type?: string
    material_count?: number
    granted_count?: number
  }
}

interface WorldBossLayerProgress {
  current_layer: number
  cleared_layers: number
  current_layer_damage: number
  current_layer_max_hp: number
  current_layer_progress: number
  next_milestone_layer: number
  layers_to_next_milestone: number
  milestone_fragments_available: number
}

interface WorldBossSeason {
  season_id: string
  status: string
  started_at?: string
  ends_at?: string
  settled_at?: string
}

interface WorldBossAnnouncement {
  announcement_id: string
  announcement_type: string
  title: string
  message: string
  created_at?: string
}

interface WorldBossLayerHistory {
  history_id: string
  layer: number
  tier: number
  cleared_by_username?: string
  trigger_damage: number
  chests_granted: number
  created_at?: string
}

interface WorldBossStatus {
  dungeon: {
    dungeon_id: string
    name: string
    attribute_type: string
    difficulty_key: string
    duration: number
    recommendation?: {
      summary: string
      formation: Array<{ role: string; count: number }>
    }
    boss_summary?: {
      type_label: string
      description: string
      boss_count: number
      flags: string[]
      slot_total: number
    }
  }
  season_id: string
  season?: WorldBossSeason
  settlement: {
    description: string
    reward_material_type?: string
    milestone_rule?: {
      interval_layers: number
      fragments_per_interval: number
      current_fragments: number
    }
    player_settlements?: WorldBossSettlement[]
  }
  layer_progress: WorldBossLayerProgress
  layer_history?: WorldBossLayerHistory[]
  announcements?: WorldBossAnnouncement[]
  chests: {
    unopened_count: number
    opened_count: number
    latest: WorldBossChest[]
    tier_rules: Array<{ tier: number; layer_range: string }>
  }
  ranking: WorldBossRanking[]
  player_ranking?: WorldBossRanking | null
  rules: {
    team_size: number
    score_basis: string
    future_source: string
  }
}

const formatNumber = (value?: number) => Number(value || 0).toLocaleString()
const formatPercent = (value?: number) => `${Math.round(Number(value || 0) * 100)}%`

const chestRewardText = (chest: WorldBossChest) => {
  const reward = chest.reward_payload
  if (!reward || chest.status !== 'opened') return 'Unopened'
  if (reward.reward_type === 'full_illustration') {
    return `Full illustration (${formatNumber(reward.granted_count || reward.material_count)} fragments)`
  }
  return `${formatNumber(reward.granted_count || reward.material_count)} fragments`
}

const WorldBossPage: React.FC = () => {
  const navigate = useNavigate()
  const [bosses, setBosses] = useState<WorldBossStatus[]>([])
  const [selectedDungeonId, setSelectedDungeonId] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [manualDamage, setManualDamage] = useState('250000')
  const [busy, setBusy] = useState(false)

  const selectedBoss = useMemo(
    () => bosses.find((boss) => boss.dungeon.dungeon_id === selectedDungeonId) || bosses[0],
    [bosses, selectedDungeonId]
  )

  useEffect(() => {
    loadWorldBosses()
  }, [])

  useEffect(() => {
    if (!selectedDungeonId && bosses.length > 0) {
      setSelectedDungeonId(bosses[0].dungeon.dungeon_id)
    }
  }, [bosses, selectedDungeonId])

  const replaceSelectedBoss = (nextBoss: WorldBossStatus) => {
    setBosses((prev) => prev.map((item) => (
      item.dungeon.dungeon_id === nextBoss.dungeon.dungeon_id ? nextBoss : item
    )))
  }

  const loadWorldBosses = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/world-boss/dungeons')
      if (response.data.success) {
        setBosses(response.data.dungeons || [])
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to load world boss data')
    } finally {
      setLoading(false)
    }
  }

  const refreshSelectedBoss = async () => {
    if (!selectedBoss) return
    try {
      const response = await axios.get(`/api/world-boss/${selectedBoss.dungeon.dungeon_id}/status`)
      if (response.data.success) {
        replaceSelectedBoss(response.data)
        setMessage('World boss status refreshed')
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Refresh failed')
    }
  }

  const runMaintenance = async () => {
    setBusy(true)
    try {
      const response = await axios.post('/api/world-boss/seasons/maintenance')
      if (response.data.success) {
        await loadWorldBosses()
        const closed = response.data.maintenance?.closed_seasons?.length || 0
        setMessage(`Season maintenance complete. Closed seasons: ${closed}`)
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Season maintenance failed')
    } finally {
      setBusy(false)
    }
  }

  const submitManualDamage = async () => {
    if (!selectedBoss) return
    const damage = Number(manualDamage)
    if (!Number.isFinite(damage) || damage <= 0) {
      setMessage('Enter valid damage')
      return
    }
    setBusy(true)
    try {
      const response = await axios.post(`/api/world-boss/${selectedBoss.dungeon.dungeon_id}/damage`, {
        damage,
        duration: selectedBoss.dungeon.duration,
        source: 'manual_check'
      })
      if (response.data.success) {
        replaceSelectedBoss(response.data.status)
        const cleared = response.data.ranking?.layer_result?.cleared_layers?.length || 0
        setMessage(cleared > 0 ? `Cleared ${cleared} layers` : 'Damage added to current layer')
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Damage submit failed')
    } finally {
      setBusy(false)
    }
  }

  const settleRewards = async () => {
    if (!selectedBoss) return
    setBusy(true)
    try {
      const response = await axios.post(`/api/world-boss/${selectedBoss.dungeon.dungeon_id}/settle`, {
        season_id: selectedBoss.season_id
      })
      if (response.data.success) {
        replaceSelectedBoss(response.data.status)
        const reward = response.data.settlement?.reward_per_player || 0
        const paid = response.data.settlement?.paid_count || 0
        setMessage(`Shared settlement complete: ${reward} fragments each, paid ${paid}`)
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Settlement failed')
    } finally {
      setBusy(false)
    }
  }

  const openChest = async (chestId: string) => {
    if (!selectedBoss) return
    setBusy(true)
    try {
      const response = await axios.post(`/api/world-boss/${selectedBoss.dungeon.dungeon_id}/chests/${chestId}/open`)
      if (response.data.success) {
        replaceSelectedBoss(response.data.status)
        const reward = response.data.chest?.reward_payload
        setMessage(`Chest opened: ${formatNumber(reward?.granted_count || reward?.material_count)} fragments`)
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Open chest failed')
    } finally {
      setBusy(false)
    }
  }

  const openBatch = async () => {
    if (!selectedBoss) return
    setBusy(true)
    try {
      const response = await axios.post(`/api/world-boss/${selectedBoss.dungeon.dungeon_id}/chests/open-batch`, {
        season_id: selectedBoss.season_id,
        limit: 100
      })
      if (response.data.success) {
        replaceSelectedBoss(response.data.status)
        setMessage(`Opened ${response.data.opened_count || 0} chests, gained ${formatNumber(response.data.reward_summary?.total_fragments)} fragments`)
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Batch open failed')
    } finally {
      setBusy(false)
    }
  }

  const enterChallenge = () => {
    if (!selectedBoss) return
    navigate('/dungeons/multiplayer', {
      state: { dungeon_id: selectedBoss.dungeon.dungeon_id }
    })
  }

  return (
    <div className="world-boss-page">
      <div className="world-boss-shell">
        <header className="world-boss-header">
          <button onClick={() => navigate('/')} className="world-boss-back">Back</button>
          <div>
            <h1>World Boss</h1>
            <p>Global layer pushing, shared season rewards, tiered chests, and persistent season history.</p>
          </div>
        </header>

        {message && <div className="world-boss-message">{message}</div>}

        {loading ? (
          <div className="world-boss-message">Loading...</div>
        ) : !selectedBoss ? (
          <div className="world-boss-message">No world boss dungeons available.</div>
        ) : (
          <div className="world-boss-layout">
            <aside className="world-boss-list">
              <div className="world-boss-title-line">
                <h2>Bosses</h2>
                <button disabled={busy} onClick={loadWorldBosses}>Refresh</button>
              </div>
              {bosses.map((boss) => (
                <button
                  key={boss.dungeon.dungeon_id}
                  className={boss.dungeon.dungeon_id === selectedBoss.dungeon.dungeon_id ? 'active' : ''}
                  onClick={() => setSelectedDungeonId(boss.dungeon.dungeon_id)}
                >
                  <strong>{boss.dungeon.name}</strong>
                  <span>Layer {formatNumber(boss.layer_progress?.cleared_layers)} / {boss.dungeon.attribute_type}</span>
                </button>
              ))}
            </aside>

            <main className="world-boss-main">
              <section className="world-boss-panel boss-overview-panel">
                <div>
                  <span className="world-boss-kicker">Season {selectedBoss.season_id} / {selectedBoss.season?.status || 'active'}</span>
                  <h2>{selectedBoss.dungeon.name}</h2>
                  <p>{selectedBoss.dungeon.recommendation?.summary}</p>
                </div>
                <div className="world-boss-actions">
                  <button disabled={busy} onClick={enterChallenge}>Challenge Room</button>
                  <button disabled={busy} onClick={refreshSelectedBoss}>Refresh Status</button>
                  <button disabled={busy} onClick={runMaintenance}>Season Check</button>
                </div>
              </section>

              <section className="world-boss-panel layer-panel">
                <div className="world-boss-title-line">
                  <h3>Global Layers</h3>
                  <span>Next milestone: layer {formatNumber(selectedBoss.layer_progress.next_milestone_layer)}</span>
                </div>
                <div className="layer-metrics">
                  <div><span>Current layer</span><strong>{formatNumber(selectedBoss.layer_progress.current_layer)}</strong></div>
                  <div><span>Cleared</span><strong>{formatNumber(selectedBoss.layer_progress.cleared_layers)}</strong></div>
                  <div><span>Shared fragments</span><strong>{formatNumber(selectedBoss.layer_progress.milestone_fragments_available)}</strong></div>
                </div>
                <div className="layer-progress-track">
                  <div style={{ width: formatPercent(selectedBoss.layer_progress.current_layer_progress) }} />
                </div>
                <p className="world-boss-muted">
                  Current layer HP: {formatNumber(selectedBoss.layer_progress.current_layer_damage)} / {formatNumber(selectedBoss.layer_progress.current_layer_max_hp)}.
                  Layers to next milestone: {formatNumber(selectedBoss.layer_progress.layers_to_next_milestone)}.
                </p>
              </section>

              <section className="world-boss-grid">
                <div className="world-boss-panel">
                  <h3>Rules</h3>
                  <div className="world-boss-stat-row"><span>Team size</span><strong>{selectedBoss.rules.team_size}</strong></div>
                  <div className="world-boss-stat-row"><span>Duration</span><strong>{selectedBoss.dungeon.duration}s</strong></div>
                  <p className="world-boss-muted">{selectedBoss.rules.score_basis}</p>
                </div>

                <div className="world-boss-panel">
                  <h3>My Contribution</h3>
                  {selectedBoss.player_ranking ? (
                    <>
                      <div className="world-boss-stat-row"><span>Display rank</span><strong>#{selectedBoss.player_ranking.rank}</strong></div>
                      <div className="world-boss-stat-row"><span>Best damage</span><strong>{formatNumber(selectedBoss.player_ranking.max_damage)}</strong></div>
                      <div className="world-boss-stat-row"><span>Total damage</span><strong>{formatNumber(selectedBoss.player_ranking.total_damage)}</strong></div>
                    </>
                  ) : (
                    <p className="world-boss-muted">No attempts this season.</p>
                  )}
                  <div className="manual-score-row">
                    <input value={manualDamage} onChange={(event) => setManualDamage(event.target.value)} />
                    <button disabled={busy} onClick={submitManualDamage}>Submit Test Damage</button>
                  </div>
                </div>

                <div className="world-boss-panel">
                  <h3>Settlement</h3>
                  <div className="world-boss-stat-row"><span>Rule</span><strong>10 fragments / 50 layers</strong></div>
                  <div className="world-boss-stat-row"><span>Current claim</span><strong>{formatNumber(selectedBoss.settlement.milestone_rule?.current_fragments)}</strong></div>
                  <button disabled={busy} onClick={settleRewards}>Run Settlement</button>
                </div>
              </section>

              <section className="world-boss-panel announcement-panel">
                <div className="world-boss-title-line">
                  <h3>Announcements</h3>
                  <span>Season notices and milestone broadcasts</span>
                </div>
                <div className="announcement-list">
                  {(selectedBoss.announcements || []).length === 0 && <div className="world-boss-empty">No announcements yet.</div>}
                  {(selectedBoss.announcements || []).map((item) => (
                    <div className="announcement-row" key={item.announcement_id}>
                      <strong>{item.title}</strong>
                      <span>{item.message}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="world-boss-panel chest-panel">
                <div className="world-boss-title-line">
                  <h3>Layer Chests</h3>
                  <span>Unopened {formatNumber(selectedBoss.chests.unopened_count)} / Opened {formatNumber(selectedBoss.chests.opened_count)}</span>
                  <button disabled={busy || selectedBoss.chests.unopened_count <= 0} onClick={openBatch}>Open 100</button>
                </div>
                <div className="world-boss-tags">
                  {(selectedBoss.chests.tier_rules || []).map((rule) => (
                    <span key={rule.tier}>T{rule.tier}: {rule.layer_range}</span>
                  ))}
                </div>
                <div className="chest-list">
                  {selectedBoss.chests.latest.length === 0 && <div className="world-boss-empty">No chests yet.</div>}
                  {selectedBoss.chests.latest.map((chest) => (
                    <div className="chest-row" key={chest.chest_id}>
                      <div>
                        <strong>Layer {formatNumber(chest.layer)} T{chest.tier}</strong>
                        <span>{chestRewardText(chest)}</span>
                      </div>
                      <button disabled={busy || chest.status !== 'unopened'} onClick={() => openChest(chest.chest_id)}>
                        {chest.status === 'unopened' ? 'Open' : 'Opened'}
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="world-boss-grid two-column">
                <div className="world-boss-panel">
                  <div className="world-boss-title-line">
                    <h3>Layer History</h3>
                    <span>Recent clears</span>
                  </div>
                  <div className="history-list">
                    {(selectedBoss.layer_history || []).length === 0 && <div className="world-boss-empty">No cleared layers yet.</div>}
                    {(selectedBoss.layer_history || []).map((row) => (
                      <div className="history-row" key={row.history_id}>
                        <strong>Layer {formatNumber(row.layer)} / T{row.tier}</strong>
                        <span>{row.cleared_by_username || 'Unknown'} · {formatNumber(row.chests_granted)} chests</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="world-boss-panel">
                  <div className="world-boss-title-line">
                    <h3>Damage Ranking</h3>
                    <span>{selectedBoss.settlement.description}</span>
                  </div>
                  <div className="world-boss-ranking">
                    <div className="ranking-row header">
                      <span>Rank</span><span>Player</span><span>Best</span><span>Total</span><span>Runs</span>
                    </div>
                    {selectedBoss.ranking.length === 0 && <div className="world-boss-empty">No ranking records.</div>}
                    {selectedBoss.ranking.map((row) => (
                      <div className="ranking-row" key={row.player_id}>
                        <strong>#{row.rank}</strong>
                        <span>{row.username}</span>
                        <span>{formatNumber(row.max_damage)}</span>
                        <span>{formatNumber(row.total_damage)}</span>
                        <span>{row.attempts}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </main>
          </div>
        )}
      </div>
    </div>
  )
}

export default WorldBossPage
