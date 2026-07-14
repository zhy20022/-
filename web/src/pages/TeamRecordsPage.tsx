import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import './TeamRecordsPage.css'

interface Dungeon {
  dungeon_id: string
  name: string
  dungeon_type: string
  attribute_type: string
  difficulty_key?: string
}

interface TeamPhase {
  index: number
  name: string
  start: number
  base_pressure?: number
  reward_weight?: number
}

interface RolePlayer {
  player_id: string
  player_name?: string
  tank?: number
  healer?: number
  support?: number
  dps?: number
  characters?: number
}

interface DamagePlayer {
  player_id: string
  player_name?: string
  total_damage?: number
  hits?: number
  crit_count?: number
  characters?: Array<{
    character_id: string
    character_name?: string
    name?: string
    total_damage?: number
    hits?: number
    crit_count?: number
  }>
}

interface TeamRecord {
  record_id: string
  battle_id: string
  room_id?: string | null
  dungeon_id: string
  success: boolean
  duration: number
  phase_reached: number
  phase_count: number
  pressure_peak: number
  pressure_average: number
  role_score: number
  performance_score: number
  reward_tier: string
  participants?: Array<{
    player_id: string
    player_name?: string
    character_ids?: string[]
  }>
  performance_payload?: {
    phase_name?: string
    phase_reached?: number
    phase_count?: number
    phases?: TeamPhase[]
    current_phase?: TeamPhase
    role_profile?: {
      score?: number
      rating?: string
      counts?: Record<string, number>
      ideal?: Record<string, [number, number]>
      notes?: string[]
      players?: RolePlayer[]
    }
    pressure_events?: Array<{
      time?: number
      pressure?: number
      damage?: number
      phase?: string
    }>
    damage_summary?: {
      total_damage?: number
      players?: DamagePlayer[]
    }
  }
  rewards?: {
    reward_type?: string
    rewards?: Record<string, unknown>
  }
  created_at?: string
}

const normalizeDungeonType = (type: string) => {
  if (type === 'TEAM' || type.includes('20')) return 'TEAM'
  return type
}

const formatNumber = (value?: number) => Number(value || 0).toLocaleString()
const formatSeconds = (value?: number) => `${Number(value || 0).toFixed(1)}s`
const clampPercent = (value: number) => `${Math.max(0, Math.min(100, value)).toFixed(0)}%`

const pressureLabel = (value?: number) => {
  const pressure = Number(value || 0)
  if (pressure >= 80) return 'Critical'
  if (pressure >= 55) return 'High'
  if (pressure >= 30) return 'Stable'
  return 'Low'
}

const roleLabelMap: Record<string, string> = {
  tank: 'Tank',
  healer: 'Healer',
  support: 'Support',
  dps: 'DPS',
}

const TeamRecordsPage: React.FC = () => {
  const navigate = useNavigate()
  const [dungeons, setDungeons] = useState<Dungeon[]>([])
  const [selectedDungeonId, setSelectedDungeonId] = useState('')
  const [records, setRecords] = useState<TeamRecord[]>([])
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const teamDungeons = useMemo(
    () => dungeons.filter((dungeon) => normalizeDungeonType(dungeon.dungeon_type) === 'TEAM'),
    [dungeons]
  )
  const selectedDungeon = teamDungeons.find((dungeon) => dungeon.dungeon_id === selectedDungeonId) || teamDungeons[0]
  const selectedRecord = records.find((record) => record.record_id === selectedRecordId) || records[0]

  useEffect(() => {
    loadDungeons()
  }, [])

  useEffect(() => {
    if (!selectedDungeonId && teamDungeons.length > 0) {
      setSelectedDungeonId(teamDungeons[0].dungeon_id)
    }
  }, [selectedDungeonId, teamDungeons])

  useEffect(() => {
    if (selectedDungeonId) {
      loadRecords(selectedDungeonId)
    }
  }, [selectedDungeonId])

  useEffect(() => {
    if (records.length > 0 && !records.some((record) => record.record_id === selectedRecordId)) {
      setSelectedRecordId(records[0].record_id)
    }
  }, [records, selectedRecordId])

  const loadDungeons = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/dungeons')
      if (response.data.success) {
        setDungeons(response.data.dungeons || [])
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to load team dungeons')
    } finally {
      setLoading(false)
    }
  }

  const loadRecords = async (dungeonId: string) => {
    setLoading(true)
    try {
      const response = await axios.get(`/api/battle/team-records?dungeon_id=${encodeURIComponent(dungeonId)}&limit=50`)
      if (response.data.success) {
        setRecords(response.data.records || [])
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to load team records')
    } finally {
      setLoading(false)
    }
  }

  const roleCounts = selectedRecord?.performance_payload?.role_profile?.counts || {}
  const roleIdeal = selectedRecord?.performance_payload?.role_profile?.ideal || {}
  const roleNotes = selectedRecord?.performance_payload?.role_profile?.notes || []
  const phases = selectedRecord?.performance_payload?.phases || []
  const phaseReached = Number(selectedRecord?.phase_reached || selectedRecord?.performance_payload?.phase_reached || 0)
  const pressureEvents = selectedRecord?.performance_payload?.pressure_events || []
  const damageSummary = selectedRecord?.performance_payload?.damage_summary
  const totalDamage = Number(damageSummary?.total_damage || 0)
  const rewardDetail = selectedRecord?.rewards?.rewards || {}

  const contributionRows = useMemo(() => {
    if (!selectedRecord) return []
    const byPlayer = new Map<string, {
      player_id: string
      player_name: string
      characters: number
      tank: number
      healer: number
      support: number
      dps: number
      total_damage: number
      hits: number
      crit_count: number
      top_character?: string
      top_character_damage?: number
    }>()

    const ensure = (playerId: string, playerName?: string) => {
      const key = playerId || 'unknown'
      if (!byPlayer.has(key)) {
        byPlayer.set(key, {
          player_id: key,
          player_name: playerName || key,
          characters: 0,
          tank: 0,
          healer: 0,
          support: 0,
          dps: 0,
          total_damage: 0,
          hits: 0,
          crit_count: 0,
        })
      }
      const row = byPlayer.get(key)!
      if (playerName && row.player_name === key) row.player_name = playerName
      return row
    }

    ;(selectedRecord.participants || []).forEach((participant) => {
      const row = ensure(participant.player_id, participant.player_name)
      row.characters = Math.max(row.characters, participant.character_ids?.length || 0)
    })

    ;(selectedRecord.performance_payload?.role_profile?.players || []).forEach((player) => {
      const row = ensure(player.player_id, player.player_name)
      row.characters = Math.max(row.characters, Number(player.characters || 0))
      row.tank = Number(player.tank || 0)
      row.healer = Number(player.healer || 0)
      row.support = Number(player.support || 0)
      row.dps = Number(player.dps || 0)
    })

    ;(selectedRecord.performance_payload?.damage_summary?.players || []).forEach((player) => {
      const row = ensure(player.player_id, player.player_name)
      row.total_damage = Number(player.total_damage || 0)
      row.hits = Number(player.hits || 0)
      row.crit_count = Number(player.crit_count || 0)
      const topCharacter = [...(player.characters || [])].sort((a, b) => Number(b.total_damage || 0) - Number(a.total_damage || 0))[0]
      if (topCharacter) {
        row.top_character = topCharacter.character_name || topCharacter.name || topCharacter.character_id
        row.top_character_damage = Number(topCharacter.total_damage || 0)
      }
    })

    return Array.from(byPlayer.values()).sort((a, b) => b.total_damage - a.total_damage)
  }, [selectedRecord])

  const rewardFactors = useMemo(() => {
    const rows = [
      { key: 'material_count', label: 'Total Material', tone: 'base' },
      { key: 'time_reward', label: 'Time Reward', tone: 'base' },
      { key: 'clear_bonus', label: 'Clear Bonus', tone: 'good' },
      { key: 'phase_bonus', label: 'Phase Bonus', tone: 'good' },
      { key: 'role_bonus', label: 'Role Bonus', tone: 'good' },
      { key: 'pressure_bonus', label: 'Pressure Bonus', tone: 'good' },
      { key: 'tier_bonus', label: 'Tier Bonus', tone: 'good' },
      { key: 'boss_drops', label: 'Boss Drops', tone: 'base' },
    ]
    return rows
      .filter((row) => rewardDetail[row.key] !== undefined)
      .map((row) => ({ ...row, value: String(rewardDetail[row.key]) }))
  }, [rewardDetail])

  const phaseRows = phases.length > 0
    ? phases
    : Array.from({ length: selectedRecord?.phase_count || 0 }, (_, index) => ({
      index,
      name: `Phase ${index + 1}`,
      start: index * 60,
    }))

  return (
    <div className="team-records-page">
      <div className="team-records-shell">
        <header className="team-records-header">
          <button onClick={() => navigate('/dungeons/multiplayer')}>Back</button>
          <div>
            <h1>20P Team Review</h1>
            <p>Stage flow, pressure spikes, member contribution, and reward breakdown.</p>
          </div>
          <button onClick={() => selectedDungeonId && loadRecords(selectedDungeonId)} disabled={!selectedDungeonId || loading}>
            Refresh
          </button>
        </header>

        {message && <div className="team-records-message">{message}</div>}

        <div className="team-records-layout">
          <aside className="team-records-sidebar">
            <h2>Team Dungeons</h2>
            {teamDungeons.map((dungeon) => (
              <button
                key={dungeon.dungeon_id}
                className={dungeon.dungeon_id === selectedDungeonId ? 'active' : ''}
                onClick={() => setSelectedDungeonId(dungeon.dungeon_id)}
              >
                <strong>{dungeon.name}</strong>
                <span>{dungeon.attribute_type} / {dungeon.difficulty_key || 'normal'}</span>
              </button>
            ))}
          </aside>

          <main className="team-records-main">
            <section className="team-records-panel record-list-panel">
              <div className="team-records-title">
                <div>
                  <h2>{selectedDungeon?.name || 'Team Dungeon'}</h2>
                  <span>{records.length} recent record(s)</span>
                </div>
              </div>

              {loading && <div className="team-records-empty">Loading...</div>}
              {!loading && records.length === 0 && (
                <div className="team-records-empty">No team clear records yet.</div>
              )}
              {!loading && records.length > 0 && (
                <div className="team-record-list">
                  {records.map((record) => (
                    <button
                      key={record.record_id}
                      className={record.record_id === selectedRecord?.record_id ? 'active' : ''}
                      onClick={() => setSelectedRecordId(record.record_id)}
                    >
                      <span className={`tier-badge tier-${String(record.reward_tier || 'c').toLowerCase()}`}>
                        {record.reward_tier || 'C'}
                      </span>
                      <div>
                        <strong>{record.success ? 'Clear' : 'Failed'} / {formatSeconds(record.duration)}</strong>
                        <span>{record.created_at ? new Date(record.created_at).toLocaleString() : record.battle_id}</span>
                      </div>
                      <em>{record.performance_score}</em>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {selectedRecord && (
              <section className="team-records-panel review-panel">
                <div className="team-records-title review-title">
                  <div>
                    <h2>Battle Report</h2>
                    <span>{selectedRecord.battle_id}</span>
                  </div>
                  <span className={`tier-badge large tier-${String(selectedRecord.reward_tier || 'c').toLowerCase()}`}>
                    {selectedRecord.reward_tier || 'C'}
                  </span>
                </div>

                <div className="record-hero-grid">
                  <div>
                    <span>Performance</span>
                    <strong>{selectedRecord.performance_score}</strong>
                    <em>{selectedRecord.success ? 'Clear recorded' : 'Failed attempt'}</em>
                  </div>
                  <div>
                    <span>Pressure</span>
                    <strong>{pressureLabel(selectedRecord.pressure_peak)}</strong>
                    <em>Peak {selectedRecord.pressure_peak}, avg {selectedRecord.pressure_average}</em>
                  </div>
                  <div>
                    <span>Stage</span>
                    <strong>{phaseReached}/{selectedRecord.phase_count}</strong>
                    <em>{selectedRecord.performance_payload?.phase_name || 'No active phase'}</em>
                  </div>
                  <div>
                    <span>Total Damage</span>
                    <strong>{formatNumber(totalDamage)}</strong>
                    <em>{formatSeconds(selectedRecord.duration)}</em>
                  </div>
                </div>

                <div className="report-section">
                  <div className="section-heading">
                    <h3>Stage Progress</h3>
                    <span>Which phase the team reached and how much pressure each phase adds.</span>
                  </div>
                  <div className="phase-timeline">
                    {phaseRows.map((phase) => {
                      const reached = Number(phase.index) < phaseReached
                      const current = Number(phase.index) === Math.max(0, phaseReached - 1)
                      return (
                        <div key={`${phase.index}-${phase.name}`} className={`${reached ? 'reached' : ''} ${current ? 'current' : ''}`}>
                          <span>{formatSeconds(phase.start)}</span>
                          <strong>{phase.name}</strong>
                          <em>pressure {phase.base_pressure ?? '-'} / reward x{phase.reward_weight ?? '-'}</em>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="report-grid">
                  <div className="report-section">
                    <div className="section-heading">
                      <h3>Pressure Events</h3>
                      <span>High pressure pulses that damaged the whole team.</span>
                    </div>
                    {pressureEvents.length === 0 ? (
                      <p className="team-records-muted">No high-pressure damage events recorded.</p>
                    ) : (
                      <div className="pressure-event-list">
                        {pressureEvents.map((event, index) => (
                          <div key={`${event.time}-${index}`}>
                            <span>{formatSeconds(event.time)}</span>
                            <strong>{pressureLabel(event.pressure)} {event.pressure}</strong>
                            <em>{event.phase || '-'} / raid damage {formatNumber(event.damage)}</em>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="report-section">
                    <div className="section-heading">
                      <h3>Role Check</h3>
                      <span>Composition score and missing role warnings.</span>
                    </div>
                    <div className="role-review-grid">
                      {['tank', 'healer', 'support', 'dps'].map((role) => {
                        const ideal = roleIdeal[role]
                        return (
                          <div key={role}>
                            <span>{roleLabelMap[role]}</span>
                            <strong>{formatNumber(roleCounts[role])}</strong>
                            <em>{ideal ? `ideal ${ideal[0]}-${ideal[1]}` : 'no ideal range'}</em>
                          </div>
                        )
                      })}
                    </div>
                    <div className="role-notes">
                      {roleNotes.length === 0 ? 'Composition is within the recommended range.' : roleNotes.join(', ')}
                    </div>
                  </div>
                </div>

                <div className="report-section">
                  <div className="section-heading">
                    <h3>Member Contribution</h3>
                    <span>Damage, critical hits, role coverage, and each player top contributor.</span>
                  </div>
                  <div className="contribution-table">
                    <div className="contribution-head">
                      <span>Player</span>
                      <span>Roles</span>
                      <span>Damage</span>
                      <span>Share</span>
                      <span>Top Character</span>
                    </div>
                    {contributionRows.length === 0 ? (
                      <div className="contribution-empty">No member contribution data stored for this record.</div>
                    ) : contributionRows.map((row) => (
                      <div className="contribution-row" key={row.player_id}>
                        <div>
                          <strong>{row.player_name}</strong>
                          <em>{row.characters} character(s), {row.hits} hit(s), {row.crit_count} crit(s)</em>
                        </div>
                        <div className="role-chips">
                          {['tank', 'healer', 'support', 'dps'].map((role) => (
                            <span key={role}>{roleLabelMap[role]} {formatNumber((row as any)[role])}</span>
                          ))}
                        </div>
                        <strong>{formatNumber(row.total_damage)}</strong>
                        <div className="share-meter">
                          <span style={{ width: clampPercent(totalDamage > 0 ? (row.total_damage / totalDamage) * 100 : 0) }} />
                          <em>{clampPercent(totalDamage > 0 ? (row.total_damage / totalDamage) * 100 : 0)}</em>
                        </div>
                        <div>
                          <strong>{row.top_character || '-'}</strong>
                          <em>{formatNumber(row.top_character_damage)}</em>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="report-section">
                  <div className="section-heading">
                    <h3>Reward Breakdown</h3>
                    <span>How the final reward tier was shaped by clear, phase, role, and pressure performance.</span>
                  </div>
                  <div className="reward-breakdown-grid">
                    <div>
                      <span>Reward Type</span>
                      <strong>{selectedRecord.rewards?.reward_type || '-'}</strong>
                    </div>
                    <div>
                      <span>Reward Tier</span>
                      <strong>{selectedRecord.reward_tier || 'C'}</strong>
                    </div>
                    {rewardFactors.map((factor) => (
                      <div className={factor.tone} key={factor.key}>
                        <span>{factor.label}</span>
                        <strong>{factor.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

export default TeamRecordsPage
