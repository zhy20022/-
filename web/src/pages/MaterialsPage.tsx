import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { isFormalOnlineMode, isStaticDemoMode } from '../config'
import { useAuthStore } from '../stores/authStore'
import { loadOnlineProfile } from '../services/onlineGameAdapter'
import InventoryPanel from '../components/materials/InventoryPanel'
import CraftingPanel from '../components/materials/CraftingPanel'
import EnhancementPanel from '../components/materials/EnhancementPanel'
import ElementBadge from '../components/ElementBadge'
import './MaterialsPage.css'
import { compareCharactersByNumber } from '../services/characterCatalog'
import { getSeasonNumber } from '../services/seasons'

const tabs = [
  { key: 'overview', label: '材料总览' },
  { key: 'breakthrough', label: '突破材料' },
  { key: 'experience', label: '经验材料' },
  { key: 'equipment', label: '装备与强化材料' },
  { key: 'avatars', label: '角色头像' },
  { key: 'avatar-fragments', label: '立绘碎片' },
  { key: 'inventory', label: '背包' },
  { key: 'crafting', label: '制作' },
  { key: 'enhancement', label: '强化与突破' },
] as const
type Tab = (typeof tabs)[number]['key']

function AvatarPanel({ illustration = false }: { illustration?: boolean }) {
  const navigate = useNavigate()
  const player = useAuthStore((state) => state.player)
  const [characters, setCharacters] = useState<Array<{ character_id: string; name: string; attribute_type: string }>>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const rows = isFormalOnlineMode()
          ? (await loadOnlineProfile(player)).characters
          : await axios.get('/api/characters').then((response) => {
            if (response.status >= 400 || !response.data?.success) throw new Error('角色加载失败')
            return response.data.characters
          })
        if (active) setCharacters(rows.filter((row: any) => getSeasonNumber(row) === 1).sort(compareCharactersByNumber))
      } catch {
        if (active) setError('角色加载失败，请重新进入此分类')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [player])
  return (
    <section className="avatar-panel">
      <h2>{illustration ? '角色立绘兑换' : '选择角色'}</h2>
      {illustration && (isStaticDemoMode() || isFormalOnlineMode()) && <p className="capability-note">当前模式尚未接入立绘兑换。</p>}
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">加载中...</p>}
      <div className="materials-grid">
        {characters.map((character) => (
          <button className="material-card avatar-choice" key={character.character_id} onClick={() => navigate('/characters', {
            state: { characterId: character.character_id, tab: illustration ? 'illustration' : 'info' },
          })}>
            <ElementBadge attribute={character.attribute_type} />
            <strong>{character.name}</strong>
          </button>
        ))}
      </div>
    </section>
  )
}

export default function MaterialsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const requested = new URLSearchParams(location.search).get('tab')
  const activeTab: Tab = tabs.some((tab) => tab.key === requested) ? requested as Tab : 'overview'
  const inventoryCategory = ['overview', 'breakthrough', 'experience', 'equipment', 'avatar-fragments'].includes(activeTab)
    ? activeTab as 'overview' | 'breakthrough' | 'experience' | 'equipment' | 'avatar-fragments'
    : undefined
  return (
    <div className="materials-page">
      <div className="materials-container">
        <header className="materials-header">
          <button type="button" className="back-btn" onClick={() => navigate('/')}>返回主界面</button>
          <h1>背包</h1>
        </header>
        <nav className="materials-tabs" role="tablist" aria-label="材料分类">
          {tabs.map((tab) => (
            <button type="button" role="tab" key={tab.key} aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? 'active' : ''}
              onClick={() => navigate(`/materials?tab=${tab.key}`)}>{tab.label}</button>
          ))}
        </nav>
        <section role="tabpanel" aria-label={tabs.find((tab) => tab.key === activeTab)?.label}>
          {activeTab === 'crafting' ? <CraftingPanel />
            : activeTab === 'enhancement' ? <EnhancementPanel />
              : activeTab === 'avatars' ? <AvatarPanel />
                : <InventoryPanel key={activeTab} category={inventoryCategory} />}
          {activeTab === 'experience' && <AvatarPanel />}
          {activeTab === 'avatar-fragments' && (
            !isFormalOnlineMode() && !isStaticDemoMode()
              ? <AvatarPanel illustration />
              : <p className="capability-note">立绘兑换暂未开放</p>
          )}
          {activeTab === 'breakthrough' && (
            <div className="materials-action-links">
              <button onClick={() => navigate('/materials?tab=enhancement')}>装备突破</button>
              <button onClick={() => navigate('/materials?tab=avatars')}>专属武器详情</button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
