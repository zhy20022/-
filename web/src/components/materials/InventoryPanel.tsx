import React, { useEffect, useState, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuthStore } from '../../stores/authStore'
import { isFormalOnlineMode, isStaticDemoMode } from '../../config'
import { ensureOnlineSession, getApiErrorMessage, onlineApi } from '../../services/onlineApi'
import { loadOnlineInventory } from '../../services/onlineInventoryAdapter'
import { MaterialCategory, matchesMaterialCategory } from '../../services/materialCatalog'
import { safeErrorLog } from '../../services/safeErrorLog'
import MaterialDetail from './MaterialDetail'
import '../../pages/InventoryPage.css'

interface InventoryItem {
  item_id: string
  itemConfigId?: string
  material_type?: string
  attribute_type?: string | null
  item_type: string
  item_subtype: string | null
  item_name: string
  item_data: any
  count: number
  level: number
  is_locked: boolean
  is_equipped: boolean
}

interface MaterialTransaction {
  transaction_id: string
  material_type: string
  attribute_type: string | null
  transaction_type: string
  amount: number
  balance_after: number
  source: string | null
  description: string | null
  created_at: string | null
}

const InventoryPanel: React.FC<{ category?: MaterialCategory }> = ({ category }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const query = new URLSearchParams(location.search)
  const { player } = useAuthStore()
  const [inventory, setInventory] = useState<{
    materials: InventoryItem[]
    weapons: InventoryItem[]
    equipment: InventoryItem[]
    items: InventoryItem[]
  }>({
    materials: [],
    weapons: [],
    equipment: [],
    items: []
  })
  const [activeTab, setActiveTab] = useState<'materials' | 'weapons' | 'equipment' | 'items'>('materials')
  const [transactions, setTransactions] = useState<MaterialTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const pending = useRef(new Set<string>())
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [search, setSearch] = useState(query.get('search') || '')
  const [attribute, setAttribute] = useState(query.get('attribute') || '')
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)

  useEffect(() => {
    loadInventory()
    loadMaterialTransactions()
  }, [])

  const loadInventory = async () => {
    try {
      setLoading(true)
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineInventory(player)
        setInventory(payload.inventory)
        setTransactions([])
        setFeedback(null)
        return
      }
      const response = await axios.get('/api/inventory')
      if (response.status < 400 && response.data.success && response.data.inventory) {
        setInventory(response.data.inventory)
        setFeedback(null)
      } else {
        setFeedback({ type: 'error', message: response.data.message || '加载背包失败' })
      }
    } catch (error) {
      safeErrorLog('inventory.load', error)
      setFeedback({ type: 'error', message: '加载背包失败，请稍后重试' })
    } finally {
      setLoading(false)
    }
  }

  const loadMaterialTransactions = async () => {
    if (isFormalOnlineMode()) return
    try {
      const response = await axios.get('/api/materials/transactions?limit=8')
      if (response.data.success) {
        setTransactions(response.data.transactions || [])
      }
    } catch (error) {
      safeErrorLog('inventory.transactions', error)
    }
  }

  const handleLock = async (itemId: string) => {
    try {
      if (isFormalOnlineMode()) {
        const session = await ensureOnlineSession(player)
        const response = await onlineApi.post(`/inventory/${session.player.id}/items/${itemId}/lock`)
        if (response.data?.success === false) throw new Error('锁定失败')
        setFeedback({ type: 'success', message: '物品已锁定' })
        await loadInventory()
        return
      }
      const response = await axios.post(`/api/inventory/${itemId}/lock`)
      if (response.data.success) {
        setFeedback({ type: 'success', message: '物品已锁定' })
        loadInventory()
      } else {
        setFeedback({ type: 'error', message: response.data.message || '锁定失败' })
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.message || '锁定失败，请稍后重试'
      })
    }
  }

  const handleUnlock = async (itemId: string) => {
    try {
      if (isFormalOnlineMode()) {
        const session = await ensureOnlineSession(player)
        const response = await onlineApi.post(`/inventory/${session.player.id}/items/${itemId}/unlock`)
        if (response.data?.success === false) throw new Error('解锁失败')
        setFeedback({ type: 'success', message: '物品已解锁' })
        await loadInventory()
        return
      }
      const response = await axios.post(`/api/inventory/${itemId}/unlock`)
      if (response.data.success) {
        setFeedback({ type: 'success', message: '物品已解锁' })
        loadInventory()
      } else {
        setFeedback({ type: 'error', message: response.data.message || '解锁失败' })
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.message || '解锁失败，请稍后重试'
      })
    }
  }

  const handleDismantle = async (itemId: string) => {
    if (isFormalOnlineMode()) {
      try {
        const session = await ensureOnlineSession(player)
        const preview = await onlineApi.get(`/inventory/${session.player.id}/items/${itemId}/dismantle-preview`)
        if (preview.data?.success === false) throw new Error('分解预览失败')
        const rewardText = (preview.data?.materials || [])
          .map((material: any) => `${material.materialType || material.itemConfigId} x${material.quantity}`)
          .join('、')
        if (!confirm(`确定分解这件物品吗？${rewardText ? `\n预计获得：${rewardText}` : ''}`)) return
        const response = await onlineApi.post(`/inventory/${session.player.id}/items/${itemId}/dismantle`)
        if (response.data?.success === false) throw new Error('分解失败')
        const actualText = (response.data?.materials || [])
          .map((material: any) => `${material.materialType || material.itemConfigId} x${material.quantity}`)
          .join('、')
        setFeedback({ type: 'success', message: `分解成功${actualText ? `，获得 ${actualText}` : ''}` })
        window.dispatchEvent(new Event('gamer:resources-changed'))
        await loadInventory()
      } catch (error) {
        setFeedback({ type: 'error', message: getApiErrorMessage(error, '分解失败，请稍后重试') })
      }
      return
    }

    let previewText = ''
    try {
      const preview = await axios.get(`/api/inventory/${itemId}/dismantle/preview`)
      if (preview.data.success && Array.isArray(preview.data.materials)) {
        previewText = preview.data.materials
          .map((material: any) => `${material.attribute_type ? `${material.attribute_type} ` : ''}${material.material_type}×${material.count}`)
          .join('、')
      }
    } catch (error) {
      safeErrorLog('inventory.dismantlePreview', error)
    }

    const confirmMessage = previewText
      ? `确定要分解这个物品吗？\n预计获得：${previewText}`
      : '确定要分解这个物品吗？'
    if (!confirm(confirmMessage)) {
      return
    }

    try {
      const response = await axios.post(`/api/inventory/${itemId}/dismantle`)
      if (response.data.success) {
        const materialText = Array.isArray(response.data.materials) && response.data.materials.length > 0
          ? `，获得${response.data.materials.map((material: any) => `${material.attribute_type ? `${material.attribute_type} ` : ''}${material.material_type}×${material.count}`).join('、')}`
          : ''
        setFeedback({ type: 'success', message: `${response.data.message || '分解成功'}${materialText}` })
        loadInventory()
        loadMaterialTransactions()
      } else {
        setFeedback({ type: 'error', message: response.data.message || '分解失败' })
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.message || '分解失败，请稍后重试'
      })
    }
  }

  const runAction = async (itemId: string, action: () => Promise<void>) => {
    if (isStaticDemoMode() || pending.current.has(itemId)) return
    pending.current.add(itemId)
    setPendingIds([...pending.current])
    try { await action() } finally {
      pending.current.delete(itemId)
      setPendingIds([...pending.current])
    }
  }

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(location.search)
    if (value) params.set(key, value)
    else params.delete(key)
    navigate(`${location.pathname}?${params}`, { replace: true, state: location.state })
  }

  const renderItems = (rows: InventoryItem[]) => {
    const items = rows.filter((item) => (
      item.item_name.toLowerCase().includes(search.toLowerCase())
      && (!attribute || (item.attribute_type || item.item_data?.attributeType || item.item_data?.attribute_type) === attribute)
    ))
    if (items.length === 0) {
      return <div className="empty-state">暂无物品</div>
    }

    return (
      <div className="items-grid">
        {items.map((item) => (
          <div key={item.item_id} className={`item-card ${item.is_locked ? 'locked' : ''}`}>
            <div className="item-header">
              <h3>{item.item_name}</h3>
              {item.is_locked && <span className="lock-badge">已锁定</span>}
            </div>
            <div className="item-info">
              <p>类型: {item.item_type}</p>
              {item.item_subtype && <p>分类: {item.item_subtype}</p>}
              {item.item_data?.attribute_type && <p>属性: {item.item_data.attribute_type}</p>}
              {item.item_data?.quality && <p>品质: {item.item_data.quality}</p>}
              {item.item_data?.attack_bonus !== undefined && <p>攻击: {item.item_data.attack_bonus}</p>}
              {item.item_data?.hp_bonus !== undefined && <p>生命: {item.item_data.hp_bonus}</p>}
              {item.item_data?.defense_bonus !== undefined && <p>防御: {item.item_data.defense_bonus}</p>}
              {item.level > 0 && <p>等级: {item.level}</p>}
              <p>数量: {item.count}</p>
            </div>
            <button type="button" onClick={() => setSelectedItem(item)}>详情</button>
            <div className="item-actions">
              {item.is_locked ? (
                <button disabled={isStaticDemoMode() || pendingIds.includes(item.item_id)} onClick={() => void runAction(item.item_id, () => handleUnlock(item.item_id))} className="unlock-btn">
                  解锁
                </button>
              ) : (
                <>
                  <button disabled={isStaticDemoMode() || pendingIds.includes(item.item_id)} onClick={() => void runAction(item.item_id, () => handleLock(item.item_id))} className="lock-btn">
                    锁定
                  </button>
                  {(item.item_type === 'weapon' || item.item_type === 'equipment') && (
                    <button disabled={isStaticDemoMode() || pendingIds.includes(item.item_id) || item.is_equipped} onClick={() => void runAction(item.item_id, () => handleDismantle(item.item_id))} className="dismantle-btn">
                      分解
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="inventory-panel">
        {isStaticDemoMode() && <p className="capability-note">静态试玩：库存可查看；锁定、分解、制作及强化尚未接入。</p>}
        {feedback && (
          <div className={`inventory-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <div className="materials-filters">
          <input aria-label="搜索材料" placeholder="搜索名称" value={search} onChange={(event) => { setSearch(event.target.value); updateFilter('search', event.target.value) }} />
          <select aria-label="材料属性" value={attribute} onChange={(event) => { setAttribute(event.target.value); updateFilter('attribute', event.target.value) }}>
            <option value="">全部属性</option>
            {[...new Set(Object.values(inventory).flat().map((item) => item.attribute_type || item.item_data?.attributeType || item.item_data?.attribute_type).filter(Boolean))].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button type="button" onClick={() => void loadInventory()}>刷新</button>
        </div>
        {!category && <div className="inventory-tabs">
          <button
            className={activeTab === 'materials' ? 'active' : ''}
            onClick={() => setActiveTab('materials')}
          >
            材料 ({inventory.materials.length})
          </button>
          <button
            className={activeTab === 'weapons' ? 'active' : ''}
            onClick={() => setActiveTab('weapons')}
          >
            武器 ({inventory.weapons.length})
          </button>
          <button
            className={activeTab === 'equipment' ? 'active' : ''}
            onClick={() => setActiveTab('equipment')}
          >
            装备 ({inventory.equipment.length})
          </button>
          <button
            className={activeTab === 'items' ? 'active' : ''}
            onClick={() => setActiveTab('items')}
          >
            道具 ({inventory.items.length})
          </button>
        </div>}

        {loading ? (
          <div>加载中...</div>
        ) : (
          <>
            {category ? renderItems(Object.values(inventory).flat().filter((item) => matchesMaterialCategory(item, category))) : (
              renderItems(inventory[activeTab])
            )}
          </>
        )}

        {activeTab === 'materials' && transactions.length > 0 && (
          <section className="material-transactions">
            <h2>最近材料流水</h2>
            <div className="transaction-list">
              {transactions.map((transaction) => (
                <div key={transaction.transaction_id} className="transaction-row">
                  <span>{transaction.transaction_type}</span>
                  <strong>
                    {transaction.attribute_type ? `${transaction.attribute_type} ` : ''}
                    {transaction.material_type}
                    {transaction.amount > 0 ? ` +${transaction.amount}` : ` ${transaction.amount}`}
                  </strong>
                  <span>余额 {transaction.balance_after}</span>
                  <small>{transaction.description || transaction.source || '系统'}</small>
                </div>
              ))}
            </div>
          </section>
        )}
      {selectedItem && (
        <MaterialDetail
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onNavigate={(path) => navigate(path)}
        />
      )}
    </div>
  )
}

export default InventoryPanel
