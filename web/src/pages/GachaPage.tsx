import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuthStore } from '../stores/authStore'
import NewPlayerGuide from '../components/NewPlayerGuide'
import { completeNewPlayerGuideStep } from '../services/newPlayerGuide'
import { createIdempotencyKey, getOnlineModeError, isFormalOnlineMode, loadOnlineProfile, onlineApi } from '../services/onlineGameAdapter'
import './GachaPage.css'

interface GachaResultItem {
  character: {
    name: string
    attribute_type: string
    profession_type: string
  }
  is_duplicate: boolean
  essence_gained: number
}

interface GachaHistoryItem {
  timestamp: string
  pool_type: string
  pull_count: number
  cost: number
  new_characters: number
  duplicates: number
  essence_gained: number
  pity_triggered?: number
  results?: Array<{
    name: string
    attribute_type: string
    profession_type: string
    is_duplicate: boolean
    essence_gained: number
  }>
}

interface GachaPity {
  current: number
  threshold: number
  remaining: number
  next_guaranteed: boolean
  description?: string
}

interface UpPoolInfo {
  title: string
  description: string
  up_rate: number
  up_character_names: string[]
  up_characters?: Array<{
    name: string
    attribute_type: string
    profession_type: string
  }>
}

const poolOptions = [
  { value: 'WATER_EARTH_THUNDER', label: '水土雷池', desc: '水、土、雷属性角色' },
  { value: 'FIRE_WOOD_WIND', label: '火木风池', desc: '火、木、风属性角色' },
  { value: 'LIGHT_DARK', label: '光暗池', desc: '光、暗属性角色' },
  { value: 'UP_POOL', label: 'UP池', desc: '配置化概率提升角色池' }
]

const GachaPage: React.FC = () => {
  const navigate = useNavigate()
  const { player, loadPlayer } = useAuthStore()
  const [poolType, setPoolType] = useState('WATER_EARTH_THUNDER')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [history, setHistory] = useState<GachaHistoryItem[]>([])
  const [pity, setPity] = useState<GachaPity | null>(null)
  const [upPool, setUpPool] = useState<UpPoolInfo | null>(null)
  const [onlineGold, setOnlineGold] = useState<number | null>(null)
  const [onlinePoolCosts, setOnlinePoolCosts] = useState<Record<string, number>>({})
  const [statusLoading, setStatusLoading] = useState(false)

  const selectedPool = useMemo(
    () => poolOptions.find((pool) => pool.value === poolType) || poolOptions[0],
    [poolType]
  )

  useEffect(() => {
    loadGachaStatus()
  }, [poolType])

  const loadGachaStatus = async () => {
    setStatusLoading(true)
    try {
      if (isFormalOnlineMode()) {
        const [profile, poolResponse] = await Promise.all([
          loadOnlineProfile(player),
          onlineApi.get('/gacha/pools'),
        ])
        setOnlineGold(Number(profile.player?.gold || 0))
        const costMap: Record<string, number> = {}
        ;(poolResponse.data || []).forEach((pool: any) => {
          costMap[pool.key] = Number(pool.cost?.amount || 0)
        })
        setOnlinePoolCosts(costMap)
        const currentPool = (poolResponse.data || []).find((pool: any) => pool.key === poolType)
        if (poolType === 'UP_POOL' && currentPool) {
          const entries = (currentPool.entries || []).filter((entry: any) => entry.type === 'character').slice(0, 8)
          setUpPool({
            title: currentPool.name || 'UP池',
            description: currentPool.description || '由后端配置控制的 UP 角色池',
            up_rate: 1,
            up_character_names: entries.map((entry: any) => entry.name || entry.characterConfigId),
            up_characters: entries.map((entry: any) => ({
              name: entry.name || entry.characterConfigId,
              attribute_type: entry.attributeType || '',
              profession_type: entry.professionType || '',
            })),
          })
        } else {
          setUpPool(null)
        }
        setHistory([])
        setPity({
          current: 0,
          threshold: 50,
          remaining: 50,
          next_guaranteed: false,
          description: '正式在线模式：抽卡记录已在数据库落库，保底细则后续接入。'
        })
        return
      }

      const response = await axios.get('/api/gacha/status', { params: { pool_type: poolType } })
      if (response.data.success) {
        setHistory(response.data.history || [])
        setPity(response.data.pity || null)
        setUpPool(response.data.up_pool || null)
      }
    } catch (error) {
      console.error('加载抽卡状态失败', error)
    } finally {
      setStatusLoading(false)
    }
  }

  const handlePull = async (pullCount: number) => {
    setLoading(true)
    setResult(null)

    try {
      if (isFormalOnlineMode()) {
        const profile = await loadOnlineProfile(player)
        const response = await onlineApi.post(`/gacha/${profile.session.player.id}/draw`, {
          poolKey: poolType,
          count: pullCount,
        }, { headers: { 'Idempotency-Key': createIdempotencyKey('gacha-draw') } })
        const onlineResults = (response.data.results || []).map((item: any) => ({
          character: {
            name: item.name || item.character?.name || item.characterConfigId || item.entryId,
            attribute_type: item.attributeType || item.character?.attributeType || '',
            profession_type: item.professionType || item.character?.professionType || '',
          },
          is_duplicate: Boolean(item.duplicate),
          essence_gained: Number(item.convertedTo?.quantity || 0),
        }))
        const newCharacters = onlineResults.filter((item: GachaResultItem) => !item.is_duplicate).length
        const duplicates = onlineResults.length - newCharacters
        const summary = {
          new_characters: newCharacters,
          duplicates,
          essence_gained: onlineResults.reduce((sum: number, item: GachaResultItem) => sum + item.essence_gained, 0),
          pity_triggered: 0,
        }
        setResult({
          success: true,
          message: `在线抽取完成，消耗 ${response.data.cost?.amount || 0} 金币`,
          results: onlineResults,
          summary,
        })
        setHistory((previous) => [{
          timestamp: new Date().toISOString(),
          pool_type: poolType,
          pull_count: pullCount,
          cost: Number(response.data.cost?.amount || 0),
          new_characters: newCharacters,
          duplicates,
          essence_gained: summary.essence_gained,
          results: onlineResults.map((item: GachaResultItem) => ({
            name: item.character.name,
            attribute_type: item.character.attribute_type,
            profession_type: item.character.profession_type,
            is_duplicate: item.is_duplicate,
            essence_gained: item.essence_gained,
          })),
        }, ...previous].slice(0, 8))
        window.dispatchEvent(new Event('gamer:resources-changed'))
        const refreshed = await loadOnlineProfile(player)
        setOnlineGold(Number(refreshed.player?.gold || 0))
        completeNewPlayerGuideStep('draw_character')
        return
      }

      const response = await axios.post('/api/gacha/pull', {
        pull_count: pullCount,
        pool_type: poolType
      })

      if (response.data.success) {
        completeNewPlayerGuideStep('draw_character')
        setResult(response.data)
        setHistory(response.data.history || [])
        setPity(response.data.pity || null)
        setUpPool(response.data.up_pool || null)
        await loadPlayer()
        window.dispatchEvent(new Event('gamer:resources-changed'))
      } else {
        alert(response.data.message)
      }
    } catch (error: any) {
      alert(getOnlineModeError(error, error.response?.data?.message || '抽取失败'))
    } finally {
      setLoading(false)
    }
  }

  const pityPercent = pity ? Math.min(100, Math.round((pity.current / pity.threshold) * 100)) : 0
  const results: GachaResultItem[] = result?.results || []
  const unitCost = onlinePoolCosts[poolType] || (isFormalOnlineMode() ? 160 : 1000)
  const currentGold = onlineGold ?? player?.gold ?? 0

  return (
    <div className="gacha-page">
      <div className="page-container">
        <div className="header-top">
          <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
          <h1>角色抽取</h1>
        </div>

        <div className="gacha-info-grid">
          <div className="gacha-info">
            <span>当前金币</span>
            <strong>{currentGold}</strong>
          </div>
          <div className="gacha-info">
            <span>当前卡池</span>
            <strong>{selectedPool.label}</strong>
            <small>{selectedPool.desc}</small>
          </div>
          <div className="gacha-info">
            <span>消耗</span>
            <strong>{unitCost} / {unitCost * 10} / {unitCost * 100}</strong>
            <small>单抽 / 10连 / 100连</small>
          </div>
        </div>

        <NewPlayerGuide page="gacha" ownedCharacterCount={result?.summary?.new_characters || results.length} />

        <div className="pool-selector">
          {poolOptions.map((pool) => (
            <button
              key={pool.value}
              className={poolType === pool.value ? 'active' : ''}
              onClick={() => setPoolType(pool.value)}
              disabled={loading}
            >
              <strong>{pool.label}</strong>
              <span>{pool.desc}</span>
            </button>
          ))}
        </div>

        <div className="pity-panel">
          <div className="pity-header">
            <strong>保底进度</strong>
            <span>{statusLoading ? '读取中...' : `${pity?.current ?? 0} / ${pity?.threshold ?? 50}`}</span>
          </div>
          <div className="pity-bar">
            <div style={{ width: `${pityPercent}%` }} />
          </div>
          <p>{pity?.next_guaranteed ? '下一抽若仍是重复角色，将补一个未拥有角色。' : pity?.description}</p>
        </div>

        {poolType === 'UP_POOL' && upPool && (
          <div className="up-pool-panel">
            <div>
              <strong>{upPool.title || 'UP池'}</strong>
              <span>UP权重 {(upPool.up_rate * 100).toFixed(0)}%</span>
            </div>
            <p>{upPool.description}</p>
            <div className="up-character-list">
              {(upPool.up_characters && upPool.up_characters.length > 0
                ? upPool.up_characters.map((char) => `${char.name} · ${char.attribute_type} · ${char.profession_type}`)
                : upPool.up_character_names
              ).map((text) => (
                <span key={text}>{text}</span>
              ))}
            </div>
          </div>
        )}

        <div className="pull-buttons">
          <button onClick={() => handlePull(1)} disabled={loading || currentGold < unitCost}>
            单抽
            <span>{unitCost}金币</span>
          </button>
          <button onClick={() => handlePull(10)} disabled={loading || currentGold < unitCost * 10}>
            10连
            <span>{unitCost * 10}金币</span>
          </button>
          <button onClick={() => handlePull(100)} disabled={loading || currentGold < unitCost * 100}>
            100连
            <span>{unitCost * 100}金币</span>
          </button>
        </div>

        {result && (
          <div className="pull-result">
            <div className="result-summary">
              <div>
                <h3>抽取结果</h3>
                <p>{result.message}</p>
              </div>
              <div className="summary-chips">
                <span>新角色 {result.summary?.new_characters ?? result.new_characters}</span>
                <span>重复 {result.summary?.duplicates ?? 0}</span>
                <span>精华 +{result.summary?.essence_gained ?? result.essence_gained}</span>
                {(result.summary?.pity_triggered || 0) > 0 && <span>触发保底 {result.summary.pity_triggered}</span>}
              </div>
            </div>

            <div className="result-grid">
              {results.map((item, index) => (
                <div key={`${item.character.name}_${index}`} className={`result-card ${item.is_duplicate ? 'duplicate' : 'new'}`}>
                  <div className="result-badge">{item.is_duplicate ? '重复' : '新'}</div>
                  <h4>{item.character.name}</h4>
                  <p>{item.character.attribute_type} · {item.character.profession_type}</p>
                  {item.is_duplicate && <small>转化精华 +{item.essence_gained}</small>}
                </div>
              ))}
            </div>
          </div>
        )}

        <section className="gacha-history">
          <h2>最近抽卡记录</h2>
          {history.length === 0 ? (
            <div className="history-empty">暂无抽卡记录</div>
          ) : (
            <div className="history-list">
              {history.slice(0, 8).map((entry, index) => (
                <div key={`${entry.timestamp}_${index}`} className="history-row">
                  <div>
                    <strong>{poolOptions.find((pool) => pool.value === entry.pool_type)?.label || entry.pool_type}</strong>
                    <span>{new Date(entry.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="history-stats">
                    <span>{entry.pull_count}抽</span>
                    <span>新 {entry.new_characters}</span>
                    <span>重复 {entry.duplicates}</span>
                    <span>精华 +{entry.essence_gained}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default GachaPage
