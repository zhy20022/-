import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import './InventoryPage.css'

interface InventoryItem {
  item_id: string
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

const InventoryPage: React.FC = () => {
  const navigate = useNavigate()
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

  useEffect(() => {
    loadInventory()
    loadMaterialTransactions()
  }, [])

  const loadInventory = async () => {
    try {
      const response = await axios.get('/api/inventory')
      if (response.data.success) {
        setInventory(response.data.inventory)
        setFeedback(null)
      } else {
        setFeedback({ type: 'error', message: response.data.message || '加载背包失败' })
      }
    } catch (error) {
      console.error('加载背包失败', error)
      setFeedback({ type: 'error', message: '加载背包失败，请稍后重试' })
    } finally {
      setLoading(false)
    }
  }

  const loadMaterialTransactions = async () => {
    try {
      const response = await axios.get('/api/materials/transactions?limit=8')
      if (response.data.success) {
        setTransactions(response.data.transactions || [])
      }
    } catch (error) {
      console.error('加载材料流水失败', error)
    }
  }

  const handleLock = async (itemId: string) => {
    try {
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
    let previewText = ''
    try {
      const preview = await axios.get(`/api/inventory/${itemId}/dismantle/preview`)
      if (preview.data.success && Array.isArray(preview.data.materials)) {
        previewText = preview.data.materials
          .map((material: any) => `${material.attribute_type ? `${material.attribute_type} ` : ''}${material.material_type}×${material.count}`)
          .join('、')
      }
    } catch (error) {
      console.error('加载分解预览失败', error)
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

  const renderItems = (items: InventoryItem[]) => {
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
              {item.count > 1 && <p>数量: {item.count}</p>}
            </div>
            <div className="item-actions">
              {item.is_locked ? (
                <button onClick={() => handleUnlock(item.item_id)} className="unlock-btn">
                  解锁
                </button>
              ) : (
                <>
                  <button onClick={() => handleLock(item.item_id)} className="lock-btn">
                    锁定
                  </button>
                  {(item.item_type === 'weapon' || item.item_type === 'equipment') && (
                    <button onClick={() => handleDismantle(item.item_id)} className="dismantle-btn">
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
    <div className="inventory-page">
      <div className="page-container">
        <div className="header-top">
          <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
          <h1>背包</h1>
        </div>

        {feedback && (
          <div className={`inventory-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <div className="inventory-tabs">
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
        </div>

        {loading ? (
          <div>加载中...</div>
        ) : (
          <>
            {activeTab === 'materials' && renderItems(inventory.materials)}
            {activeTab === 'weapons' && renderItems(inventory.weapons)}
            {activeTab === 'equipment' && renderItems(inventory.equipment)}
            {activeTab === 'items' && renderItems(inventory.items)}
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
      </div>
    </div>
  )
}

export default InventoryPage
