import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { isFormalOnlineMode } from '../config'
import { ONLINE_ROUTE_COVERAGE, resolveFormalOnlineRoute } from '../services/onlineFeatureCoverage'
import './MainMenu.css'

const MainMenu: React.FC = () => {
  const navigate = useNavigate()
  const { player, logout } = useAuthStore()

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

  return (
    <div className="main-menu">
      <div className="menu-container">
        <h1>灾异纪元</h1>

        <div className="player-info">
          <p>欢迎，{player?.username || '玩家'}</p>
          <p>等级：{player?.level || 1} | 金币：{player?.gold || 0}</p>
        </div>


        <div className="menu-buttons">
          <button onClick={() => openMainRoute('/characters')}>角色管理</button>
          <button onClick={() => openMainRoute('/dungeons')}>副本选择</button>
          <button onClick={() => openMainRoute('/gacha')}>角色抽取</button>
          <button onClick={() => openMainRoute('/materials')}>背包</button>
          <button onClick={() => openMainRoute('/shop')}>活动商店</button>
          <button onClick={() => openMainRoute('/world-boss')}>全服 Boss</button>
          <button onClick={() => openMainRoute('/achievements')}>成就</button>
          <button onClick={() => openMainRoute('/admin')}>管理入口</button>
          <button onClick={() => navigate('/online-admin')}>在线后台</button>
          <button onClick={handleLogout} className="logout-btn">登出</button>
        </div>
      </div>
    </div>
  )
}

export default MainMenu
