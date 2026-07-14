import React, { useEffect, useState, useRef } from 'react'
import axios from 'axios'
import EventNotification from '../components/EventNotification'
import './ShopPage.css'

interface ShopItem {
  item_id: string
  name: string
  attribute_type: string
  cost: Record<string, number>
  icon: string
  description: string
  period_key?: string
  purchase_limit?: number
  purchased_count?: number
  remaining_count?: number | null
}

type ShopPayload = Record<string, ShopItem[]>

interface ActiveEvent {
  event: {
    event_id: string
    name: string
    event_type: string
    attribute_focus: string | null
    rewards: Record<string, number>
    description: string
  }
  refresh_at: string
}

const ShopPage: React.FC = () => {
  const [itemsByAttribute, setItemsByAttribute] = useState<ShopPayload>({})
  const [materials, setMaterials] = useState<Record<string, { material_type: string; attribute_type?: string | null; count: number }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [exchangingItemId, setExchangingItemId] = useState<string | null>(null)
  const [activeEvents, setActiveEvents] = useState<{ team_monthly?: ActiveEvent; server_quarterly?: ActiveEvent }>({})
  const [notification, setNotification] = useState<{ eventName: string } | null>(null)
  const lastEventIdsRef = useRef<{ team_monthly?: string; server_quarterly?: string }>({})

  const loadShop = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.get('/api/shop/items')
      if (response.data.success) {
        setItemsByAttribute(response.data.items || {})
        setMaterials(response.data.materials || {})
        setFeedback(null)
      } else {
        setError(response.data.message || '无法加载商店信息')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || '无法连接到商店接口')
    } finally {
      setLoading(false)
    }
  }

  const loadActiveEvents = async () => {
    try {
      const response = await axios.get('/api/events/active')
      if (response.data.success && response.data.events) {
        const events = response.data.events
        
        // 检查活动是否切换
        if (lastEventIdsRef.current.team_monthly && 
            events.team_monthly?.event?.event_id !== lastEventIdsRef.current.team_monthly) {
          // 团队活动已切换
          setNotification({
            eventName: events.team_monthly.event.name
          })
        }
        
        if (lastEventIdsRef.current.server_quarterly && 
            events.server_quarterly?.event?.event_id !== lastEventIdsRef.current.server_quarterly) {
          // 全服活动已切换
          setNotification({
            eventName: events.server_quarterly.event.name
          })
        }
        
        // 更新当前活动ID
        if (events.team_monthly?.event?.event_id) {
          lastEventIdsRef.current.team_monthly = events.team_monthly.event.event_id
        }
        if (events.server_quarterly?.event?.event_id) {
          lastEventIdsRef.current.server_quarterly = events.server_quarterly.event.event_id
        }
        
        setActiveEvents(events)
      }
    } catch (err: any) {
      console.error('加载活动信息失败:', err)
    }
  }

  useEffect(() => {
    loadShop()
    loadActiveEvents()
    
    // 每2分钟轮询一次活动信息
    const interval = setInterval(() => {
      loadActiveEvents()
    }, 2 * 60 * 1000) // 2分钟
    
    return () => clearInterval(interval)
  }, [])

  const renderMaterialSummary = () => {
    const entries = Object.values(materials)
    if (entries.length === 0) {
      return <span className="material-chip empty">暂无材料数据</span>
    }
    return entries.map((material) => (
      <span key={`${material.material_type}_${material.attribute_type || 'all'}`} className="material-chip">
        {material.material_type}
        {material.attribute_type ? ` · ${material.attribute_type}` : ''}：{material.count}
      </span>
    ))
  }

  const materialCostAliases: Record<string, string[]> = {
    exclusive_material: ['exclusive_material', 'exclusive_item', '专属道具材料'],
    equipment_material: ['equipment_material', 'equipment_set', '套装材料'],
    illustration_piece: ['illustration_piece', '立绘拼图碎片']
  }

  const getMaterialCount = (costType: string, attributeType: string) => {
    const aliases = materialCostAliases[costType] || [costType]
    return Object.values(materials).reduce((total, material) => {
      const typeMatches = aliases.includes(material.material_type)
      const attrMatches = costType !== 'equipment_material' || material.attribute_type === attributeType
      return typeMatches && attrMatches ? total + material.count : total
    }, 0)
  }

  const canAfford = (item: ShopItem) => {
    const hasMaterials = Object.entries(item.cost).every(([costType, amount]) => getMaterialCount(costType, item.attribute_type) >= amount)
    const hasLimit = item.remaining_count === null || item.remaining_count === undefined || item.remaining_count > 0
    return hasMaterials && hasLimit
  }

  const handleExchange = async (item: ShopItem) => {
    try {
      setExchangingItemId(item.item_id)
      setFeedback({ type: 'info', message: `正在兑换${item.name}...` })
      const response = await axios.post('/api/shop/exchange', { item_id: item.item_id })
      if (response.data.success) {
        setFeedback({ type: 'success', message: response.data.message || '兑换成功' })
        setMaterials(response.data.materials || {})
        loadShop()
      } else {
        setFeedback({ type: 'error', message: response.data.message || '兑换失败' })
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.response?.data?.message || '兑换失败，请稍后重试' })
    } finally {
      setExchangingItemId(null)
    }
  }

  if (loading) {
    return (
      <div className="shop-page">
        <div className="shop-container">
          <div className="shop-loading">商店加载中...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="shop-page">
        <div className="shop-container">
          <div className="shop-error">
            <p>{error}</p>
            <button onClick={loadShop}>重试</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shop-page">
      {/* 活动切换通知 */}
      {notification && (
        <EventNotification
          eventName={notification.eventName}
          onClose={() => setNotification(null)}
          duration={3000}
        />
      )}
      
      <div className="shop-container">
        <header className="shop-header">
          <div>
            <div className="header-top">
              <button onClick={() => window.location.href = '/'} className="back-btn">返回主界面</button>
              <h1>活动商店</h1>
            </div>
            <p>按照属性排列的兑换物品，所有材料可通过正常游玩获得</p>
          </div>
          <div className="material-summary">
            <label>材料持有：</label>
            <div className="material-chips">{renderMaterialSummary()}</div>
          </div>
        </header>

        {feedback && (
          <div className={`shop-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <div className="active-event-strip">
          {activeEvents.team_monthly?.event && (
            <div>
              <span>团队月度活动</span>
              <strong>{activeEvents.team_monthly.event.name}</strong>
              <small>{activeEvents.team_monthly.event.description}</small>
            </div>
          )}
          {activeEvents.server_quarterly?.event && (
            <div>
              <span>全服季度活动</span>
              <strong>{activeEvents.server_quarterly.event.name}</strong>
              <small>{activeEvents.server_quarterly.event.description}</small>
            </div>
          )}
        </div>

        {Object.keys(itemsByAttribute).length === 0 && (
          <div className="empty-shop">暂无可兑换物品</div>
        )}

        {Object.entries(itemsByAttribute).map(([attribute, items]) => (
          <section key={attribute} className="shop-section">
            <h2>{attribute} 属性物品</h2>
            <div className="shop-grid">
              {items.map((item) => (
                <div key={item.item_id} className="shop-card">
                  <div className="shop-card-icon" style={item.icon ? { backgroundImage: `url(${item.icon})` } : undefined}>
                    {!item.icon && item.name.slice(0, 1)}
                  </div>
                  <div className="shop-card-body">
                    <h3>{item.name}</h3>
                    <p className="shop-card-desc">{item.description}</p>
                    <div className="shop-card-cost">
                      {Object.entries(item.cost).map(([costType, amount]) => (
                        <span key={`${item.item_id}_${costType}`} className="cost-chip">
                          {costType}: {amount}
                        </span>
                      ))}
                    </div>
                    {item.purchase_limit !== undefined && (
                      <div className="shop-card-limit">
                        本期 {item.purchased_count || 0} / {item.purchase_limit}
                      </div>
                    )}
                  </div>
                  <button
                    className="shop-card-action"
                    onClick={() => handleExchange(item)}
                    disabled={!canAfford(item) || exchangingItemId === item.item_id}
                  >
                    {exchangingItemId === item.item_id ? '兑换中...' : '兑换'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

export default ShopPage


