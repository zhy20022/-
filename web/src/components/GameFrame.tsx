import { ReactNode, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowUp, Home } from 'lucide-react'
import NewPlayerGuide from './NewPlayerGuide'
import './GameFrame.css'

const titles: Record<string, string> = {
  '/': '灾异志', '/characters': '角色管理', '/dungeons': '副本选择', '/gacha': '角色抽取',
  '/materials': '背包', '/inventory': '背包', '/crafting': '制作系统', '/enhancement': '装备强化',
  '/shop': '活动商店', '/social': '好友与助战', '/quests': '任务', '/achievements': '成就',
  '/admin': '管理入口', '/online-admin': '在线运营后台', '/online-progress': '在线收益',
  '/world-boss': '世界首领', '/team-records': '团队记录', '/battle': '副本战斗',
  '/dungeons/multiplayer': '多人副本',
}

export default function GameFrame({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const top = useRef<HTMLDivElement>(null)
  const page = location.pathname === '/gacha' ? 'gacha' : location.pathname === '/characters' ? 'characters'
    : location.pathname.startsWith('/dungeons') ? 'dungeons' : location.pathname === '/battle' ? 'battle' : 'home'
  return (
    <main className="game-frame" ref={top}>
      <header className="game-page-heading">
        <h1>{titles[location.pathname] || '灾异志'}</h1>
        {location.pathname !== '/' && <button className="game-home-key" type="button" title="返回主界面"
          aria-label="返回主界面" onClick={() => navigate('/')}><Home size={20} /></button>}
      </header>
      <NewPlayerGuide page={page} />
      <div className="game-content">{children}</div>
      <button className="game-top-key" type="button" title="返回顶部" aria-label="返回顶部"
        onClick={() => {
          const scroller = top.current?.closest('.app')
          scroller?.scrollTo({ top: 0, behavior: 'smooth' })
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}><ArrowUp size={21} /></button>
    </main>
  )
}
