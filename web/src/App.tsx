import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { useOrientation } from './hooks/useOrientation'
import OrientationToggle from './components/OrientationToggle'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import MainMenu from './pages/MainMenu'
import CharacterPage from './pages/CharacterPage'
import DungeonPage from './pages/DungeonPage'
import MultiplayerRoomPage from './pages/MultiplayerRoomPage'
import GachaPage from './pages/GachaPage'
import CraftingPage from './pages/CraftingPage'
import InventoryPage from './pages/InventoryPage'
import BattlePage from './pages/BattlePage'
import ShopPage from './pages/ShopPage'
import SocialPage from './pages/SocialPage'
import QuestPage from './pages/QuestPage'
import AchievementPage from './pages/AchievementPage'
import EnhancementPage from './pages/EnhancementPage'
import AdminPage from './pages/AdminPage'
import WorldBossPage from './pages/WorldBossPage'
import TeamRecordsPage from './pages/TeamRecordsPage'
import OnlineProgressPage from './pages/OnlineProgressPage'
import OnlineAdminPage from './pages/OnlineAdminPage'
import './App.css'

function App() {
  const { isAuthenticated } = useAuthStore()
  const { isPortrait, isMobile } = useOrientation()
  const [isTransitioning, setIsTransitioning] = useState(false)

  // 监听方向变化，添加过渡动画
  useEffect(() => {
    setIsTransitioning(true)
    const timer = setTimeout(() => {
      setIsTransitioning(false)
    }, 400) // 与CSS动画时长一致

    return () => clearTimeout(timer)
  }, [isPortrait])

  // 根据方向设置容器类名
  const containerClassName = [
    'app',
    'app-orientation-container',
    isPortrait ? 'portrait' : 'landscape',
    isTransitioning ? 'orientation-transitioning' : '',
    isMobile ? 'mobile' : 'desktop',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={containerClassName}>
      {/* 横竖屏切换按钮 - 仅在已登录时显示 */}
      {isAuthenticated && <OrientationToggle position="top-right" />}
      
      <Routes>
        <Route path="/login" element={!isAuthenticated ? <LoginPage /> : <Navigate to="/" />} />
        <Route path="/register" element={!isAuthenticated ? <RegisterPage /> : <Navigate to="/login" />} />
        <Route path="/" element={isAuthenticated ? <MainMenu /> : <Navigate to="/login" />} />
        <Route path="/characters" element={isAuthenticated ? <CharacterPage /> : <Navigate to="/login" />} />
        <Route path="/dungeons" element={isAuthenticated ? <DungeonPage /> : <Navigate to="/login" />} />
        <Route path="/dungeons/multiplayer" element={isAuthenticated ? <MultiplayerRoomPage /> : <Navigate to="/login" />} />
        <Route path="/gacha" element={isAuthenticated ? <GachaPage /> : <Navigate to="/login" />} />
        <Route path="/crafting" element={isAuthenticated ? <CraftingPage /> : <Navigate to="/login" />} />
        <Route path="/inventory" element={isAuthenticated ? <InventoryPage /> : <Navigate to="/login" />} />
        <Route path="/battle" element={isAuthenticated ? <BattlePage /> : <Navigate to="/login" />} />
        <Route path="/shop" element={isAuthenticated ? <ShopPage /> : <Navigate to="/login" />} />
        <Route path="/social" element={isAuthenticated ? <SocialPage /> : <Navigate to="/login" />} />
        <Route path="/quests" element={isAuthenticated ? <QuestPage /> : <Navigate to="/login" />} />
        <Route path="/achievements" element={isAuthenticated ? <AchievementPage /> : <Navigate to="/login" />} />
        <Route path="/enhancement" element={isAuthenticated ? <EnhancementPage /> : <Navigate to="/login" />} />
        <Route path="/admin" element={isAuthenticated ? <AdminPage /> : <Navigate to="/login" />} />
        <Route path="/world-boss" element={isAuthenticated ? <WorldBossPage /> : <Navigate to="/login" />} />
        <Route path="/team-records" element={isAuthenticated ? <TeamRecordsPage /> : <Navigate to="/login" />} />
        <Route path="/online-progress" element={isAuthenticated ? <OnlineProgressPage /> : <Navigate to="/login" />} />
        <Route path="/online-admin" element={isAuthenticated ? <OnlineAdminPage /> : <Navigate to="/login" />} />
      </Routes>
    </div>
  )
}

export default App
