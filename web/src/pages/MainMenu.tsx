import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { ensureOnlineSession, onlineApi } from '../services/onlineApi'
import { isFormalOnlineMode } from '../config'
import { ONLINE_ROUTE_COVERAGE, resolveFormalOnlineRoute } from '../services/onlineFeatureCoverage'
import NewPlayerGuide from '../components/NewPlayerGuide'
import './MainMenu.css'

const MainMenu: React.FC = () => {
  const navigate = useNavigate()
  const { player, logout } = useAuthStore()
  const [onlineHint, setOnlineHint] = useState({ idleClaimable: false, dailyClaimable: 0 })

  useEffect(() => {
    void loadOnlineHint()
  }, [player])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const openMainRoute = (path: string) => {
    if (!isFormalOnlineMode()) {
      navigate(path)
      return
    }
    const resolved = resolveFormalOnlineRoute(path)
    if (!resolved) {
      alert(`该入口仍在迁移到正式在线后端：${ONLINE_ROUTE_COVERAGE[path]?.note || path}`)
      return
    }
    navigate(resolved)
  }

  const loadOnlineHint = async () => {
    if (!player) return
    try {
      const session = await ensureOnlineSession(player)
      const [idleResponse, dailyResponse] = await Promise.all([
        onlineApi.get(`/idle/${session.player.id}/status`),
        onlineApi.get(`/daily-goals/${session.player.id}`),
      ])
      const idlePreview = idleResponse.data?.preview
      const idleClaimable = Boolean(idlePreview && idlePreview.cappedSeconds >= 60 && (idlePreview.gold > 0 || idlePreview.rewards?.length > 0))
      const dailyClaimable = (dailyResponse.data?.goals || []).filter((goal: { complete: boolean; claimed: boolean }) => goal.complete && !goal.claimed).length
      setOnlineHint({ idleClaimable, dailyClaimable })
    } catch {
      setOnlineHint({ idleClaimable: false, dailyClaimable: 0 })
    }
  }

  return (
    <div className="main-menu">
      <div className="menu-container">
        <h1>灾异纪元</h1>

        <div className="player-info">
          <p>欢迎，{player?.username || '玩家'}</p>
          <p>等级：{player?.level || 1} | 金币：{player?.gold || 0}</p>
        </div>

        <NewPlayerGuide page="home" />

        <div className="menu-buttons">
          <button onClick={() => openMainRoute('/characters')}>角色管理</button>
          <button onClick={() => openMainRoute('/dungeons')}>副本选择</button>
          <button onClick={() => openMainRoute('/gacha')}>角色抽取</button>
          <button onClick={() => openMainRoute('/crafting')}>制作系统</button>
          <button onClick={() => openMainRoute('/inventory')}>背包</button>
          <button onClick={() => navigate('/online-progress')} className={onlineHint.idleClaimable || onlineHint.dailyClaimable > 0 ? 'attention-btn' : ''}>
            在线收益{onlineHint.dailyClaimable > 0 ? ` · ${onlineHint.dailyClaimable}个可领` : onlineHint.idleClaimable ? ' · 可领取' : ''}
          </button>
          <button onClick={() => openMainRoute('/shop')}>活动商店</button>
          <button onClick={() => openMainRoute('/social')}>好友助战</button>
          <button onClick={() => openMainRoute('/world-boss')}>全服 Boss</button>
          <button onClick={() => openMainRoute('/quests')}>任务</button>
          <button onClick={() => openMainRoute('/achievements')}>成就</button>
          <button onClick={() => openMainRoute('/enhancement')}>装备强化</button>
          <button onClick={() => openMainRoute('/admin')}>管理入口</button>
          <button onClick={() => navigate('/online-admin')}>在线后台</button>
          <button onClick={handleLogout} className="logout-btn">登出</button>
        </div>
      </div>
    </div>
  )
}

export default MainMenu
