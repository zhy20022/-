import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { useOrientation } from './hooks/useOrientation'
import OrientationToggle from './components/OrientationToggle'
import MobileGameShell from './components/MobileGameShell'
import { isFormalOnlineMode } from './config'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import MainMenu from './pages/MainMenu'
import './App.css'
import SeasonScope from './components/SeasonTabs'
import './compact-layout.css'

const CharacterPage = lazy(() => import('./pages/CharacterPage'))
const DungeonPage = lazy(() => import('./pages/DungeonPage'))
const MultiplayerRoomPage = lazy(() => import('./pages/MultiplayerRoomPage'))
const GachaPage = lazy(() => import('./pages/GachaPage'))
const CraftingPage = lazy(() => import('./pages/CraftingPage'))
const InventoryPage = lazy(() => import('./pages/InventoryPage'))
const BattlePage = lazy(() => import('./pages/BattlePage'))
const ShopPage = lazy(() => import('./pages/ShopPage'))
const SocialPage = lazy(() => import('./pages/SocialPage'))
const QuestPage = lazy(() => import('./pages/QuestPage'))
const AchievementPage = lazy(() => import('./pages/AchievementPage'))
const EnhancementPage = lazy(() => import('./pages/EnhancementPage'))
const MaterialsPage = lazy(() => import('./pages/MaterialsPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const WorldBossPage = lazy(() => import('./pages/WorldBossPage'))
const TeamRecordsPage = lazy(() => import('./pages/TeamRecordsPage'))
const OnlineProgressPage = lazy(() => import('./pages/OnlineProgressPage'))
const OnlineAdminPage = lazy(() => import('./pages/OnlineAdminPage'))

function App() {
  const { isAuthenticated, loadPlayer } = useAuthStore()
  const location = useLocation()
  const { isPortrait, isMobile } = useOrientation()
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [sessionReady, setSessionReady] = useState(() => !isFormalOnlineMode() || isAuthenticated)

  const shellHiddenRoutes = ['/login', '/register', '/battle', '/dungeons/multiplayer']
  const showMobileShell = isAuthenticated && !shellHiddenRoutes.some((path) => location.pathname.startsWith(path))
  const seasonalRoute = ['/characters', '/dungeons', '/gacha', '/crafting', '/inventory', '/enhancement', '/materials', '/shop'].some(
    (path) => location.pathname === path,
  )

  useEffect(() => {
    if (isFormalOnlineMode() && !isAuthenticated) {
      void loadPlayer().finally(() => setSessionReady(true))
    } else setSessionReady(true)
  }, [])

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
    showMobileShell ? 'mobile-shell-active' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (!sessionReady) return <div role="status">正在恢复登录状态…</div>

  return (
    <div className={containerClassName}>
      {/* 横竖屏切换按钮 - 仅在已登录时显示 */}
      {isAuthenticated && <OrientationToggle position="top-right" />}
      {showMobileShell && <MobileGameShell />}
      
      <Suspense fallback={<div role="status">加载中...</div>}>
        {seasonalRoute && isAuthenticated ? <SeasonScope key={location.pathname}><GameRoutes isAuthenticated={isAuthenticated} /></SeasonScope>
          : <GameRoutes isAuthenticated={isAuthenticated} />}
      </Suspense>
    </div>
  )
}

function GameRoutes({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
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
        <Route path="/materials" element={isAuthenticated ? <MaterialsPage /> : <Navigate to="/login" />} />
        <Route path="/admin" element={isAuthenticated ? <AdminPage /> : <Navigate to="/login" />} />
        <Route path="/world-boss" element={isAuthenticated ? <WorldBossPage /> : <Navigate to="/login" />} />
        <Route path="/team-records" element={isAuthenticated ? <TeamRecordsPage /> : <Navigate to="/login" />} />
        <Route path="/online-progress" element={isAuthenticated ? <OnlineProgressPage /> : <Navigate to="/login" />} />
        <Route path="/online-admin" element={isAuthenticated ? <OnlineAdminPage /> : <Navigate to="/login" />} />
      </Routes>
  )
}

export default App
