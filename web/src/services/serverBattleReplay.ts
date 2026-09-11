export interface ServerBattleStatus {
  ready: boolean
  speed: number
  frame: { time: number; units: unknown[][] }
  units: Record<string, { isPlayer: boolean; definition?: { phases?: unknown[]; shared_health?: boolean } }>
  events: Array<{ time: number; event_type: string; message: string; payload?: Record<string, unknown> }>
  outcome: { success: boolean; duration: number; damageScore: number } | null
}

export function serverBattleSnapshot(status: ServerBattleStatus, duration: number) {
  const units = status.frame.units.map((row) => {
    const id = String(row[0])
    const meta = status.units[id]
    if (!meta) throw new Error('Missing battle unit metadata')
    const health = Number(row[1])
    const maxHealth = Number(row[6])
    return {
      character_id: id, name: String(row[5]), health, max_health: maxHealth,
      physical_health: health, max_physical_health: maxHealth,
      magical_health: 0, max_magical_health: 0, is_alive: health > 0,
      shield: Number(row[2]), phase: Number(row[3]) + 1,
      current_skills: Array.isArray(row[7]) ? row[7].map(String) : [],
      spawn_category: row[9] ? 'boss' : 'minion',
      boss_mechanic: { active: !row[4], shared_health: Boolean(row[8]) },
      isPlayer: meta.isPlayer,
    }
  })
  const events = status.events.map(event => ({ ...event, time_text: `${event.time.toFixed(1)}s` }))
  return {
    flow_state: { code: status.ready ? 'reward' : 'running', label: status.ready ? '结算中' : '战斗中' },
    battle_state: { code: status.ready ? 'completed' : 'running', label: status.ready ? '已结束' : '进行中' },
    current_time: status.frame.time, duration, battle_speed: status.speed,
    player_units: units.filter(unit => unit.isPlayer),
    enemy_units: units.filter(unit => !unit.isPlayer && unit.is_alive),
    battle_events: events, battle_log: events.map(event => event.message),
  }
}
