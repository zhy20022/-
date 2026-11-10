import { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SEASONS } from '../services/seasons'
import './SeasonTabs.css'

export function SeasonTabs({ value, onChange }: { value: number; onChange: (season: number) => void }) {
  return (
    <nav className="season-tabs" aria-label="赛季分页" role="tablist">
      {SEASONS.map((season) => (
        <button key={season.id} type="button" role="tab"
          aria-selected={value === season.id} onClick={() => onChange(season.id)}>
          {season.name}
        </button>
      ))}
    </nav>
  )
}

export default function SeasonScope({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const requested = Number(new URLSearchParams(location.search).get('season') || 1)
  const season = SEASONS.some((entry) => entry.id === requested) ? requested : 1
  return (
    <div className="season-scope">
      <SeasonTabs value={season} onChange={(next) => {
        const params = new URLSearchParams(location.search)
        params.set('season', String(next))
        navigate(`${location.pathname}?${params}`, { replace: true, state: location.state })
      }} />
      {season === 1 ? children : (
        <section className="season-empty" role="tabpanel">
          <h2>{SEASONS.find((entry) => entry.id === season)?.name}</h2>
          <p>尚未开启</p>
        </section>
      )}
    </div>
  )
}
