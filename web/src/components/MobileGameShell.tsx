import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { isFormalOnlineMode } from '../config'
import { loadOnlineProfile } from '../services/onlineGameAdapter'
import { useAuthStore } from '../stores/authStore'
import './MobileGameShell.css'

type ConnectionState = 'online' | 'local' | 'offline' | 'loading'

const primaryNavigation = [
  { path: '/', label: '主城', icon: '⌂' },
  { path: '/characters', label: '角色', icon: '◇' },
  { path: '/dungeons', label: '副本', icon: '⚔' },
  { path: '/gacha', label: '召唤', icon: '✦' },
  { path: '/inventory', label: '背包', icon: '▣' },
]

const compactNumber = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })

const MobileGameShell = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const player = useAuthStore((state) => state.player)
  const formalOnline = useMemo(() => isFormalOnlineMode(), [])
  const [gold, setGold] = useState(Number(player?.gold || 0))
  const [expPackages, setExpPackages] = useState(0)
  const [connection, setConnection] = useState<ConnectionState>(formalOnline ? 'loading' : 'local')

  useEffect(() => {
    setGold(Number(player?.gold || 0))
  }, [player?.gold])

  useEffect(() => {
    if (!player) return

    let active = true
    const refreshResources = async () => {
      try {
        if (formalOnline) {
          const profile = await loadOnlineProfile(player)
          if (!active) return
          const expItem = profile.inventory.find((item: any) => item.itemConfigId === 'character_exp_crystal')
          setGold(Number(profile.player?.gold ?? profile.session.player.gold ?? 0))
          setExpPackages(Number(expItem?.quantity || 0))
          setConnection('online')
          return
        }

        const [playerResponse, inventoryResponse] = await Promise.all([
          axios.get('/api/player/info'),
          axios.get('/api/inventory'),
        ])
        if (!active) return
        const materials = inventoryResponse.data?.inventory?.materials || inventoryResponse.data?.materials || []
        const expCount = materials
          .filter((item: any) => item.material_type === 'CHARACTER_EXP' || item.itemConfigId === 'character_exp_crystal')
          .reduce((total: number, item: any) => total + Number(item.count ?? item.quantity ?? 0), 0)
        setGold(Number(playerResponse.data?.player?.gold ?? player?.gold ?? 0))
        setExpPackages(expCount)
        setConnection('local')
      } catch {
        if (active) setConnection(formalOnline ? 'offline' : 'local')
      }
    }

    void refreshResources()
    const timer = window.setInterval(refreshResources, 30000)
    const handleResourceRefresh = () => void refreshResources()
    window.addEventListener('gamer:resources-changed', handleResourceRefresh)

    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('gamer:resources-changed', handleResourceRefresh)
    }
  }, [formalOnline, location.pathname, player?.player_id, player?.gold])

  const isActive = (path: string) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
  const connectionLabel = connection === 'online'
    ? '在线'
    : connection === 'offline'
      ? '连接中断'
      : connection === 'loading'
        ? '同步中'
        : '本地试玩'

  return (
    <>
      <header className="mobile-game-topbar" aria-label="玩家资源栏">
        <div className="mobile-player-summary">
          <span className={`mobile-connection-dot ${connection}`} aria-hidden="true" />
          <span className="mobile-player-copy">
            <strong>{player?.username || '玩家'}</strong>
            <small>{connectionLabel}</small>
          </span>
        </div>
        <div className="mobile-resource-list">
          <div className="mobile-resource-item gold">
            <span aria-hidden="true">●</span>
            <small>金币</small>
            <strong>{compactNumber.format(gold)}</strong>
          </div>
          <div className="mobile-resource-item exp">
            <span aria-hidden="true">◆</span>
            <small>经验包</small>
            <strong>{compactNumber.format(expPackages)}</strong>
          </div>
        </div>
      </header>

      <nav className="mobile-game-tabbar" aria-label="手机主导航">
        {primaryNavigation.map((item) => (
          <button
            key={item.path}
            type="button"
            className={isActive(item.path) ? 'active' : ''}
            aria-current={isActive(item.path) ? 'page' : undefined}
            onClick={() => navigate(item.path)}
          >
            <span className="mobile-nav-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  )
}

export default MobileGameShell
