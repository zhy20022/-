import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { isFormalOnlineMode } from '../config'
import { useAuthStore } from '../stores/authStore'
import { createIdempotencyKey, onlineApi } from '../services/onlineApi'
import { loadOnlineInventory, mapOnlineEnhancementPreview, mapOnlineInventoryItem } from '../services/onlineInventoryAdapter'
import './EnhancementPage.css'

interface EquipmentItem {
  item_id: string
  item_name: string
  item_type: string
  level: number
  item_data: any
}

interface EnhancementPreview {
  current_level: number
  next_level: number
  success_rate: number
  max_level?: number
  requires_breakthrough?: boolean
  action?: 'enhance' | 'breakthrough'
  costs: {
    gold: { required: number; owned: number; enough: boolean }
    material: { material_type: string; required: number; owned: number; enough: boolean }
  }
}

const EnhancementPage: React.FC = () => {
  const navigate = useNavigate()
  const { player } = useAuthStore()
  const [equipment, setEquipment] = useState<EquipmentItem[]>([])
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [enhancing, setEnhancing] = useState(false)
  const [preview, setPreview] = useState<EnhancementPreview | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    loadEquipment()
  }, [])

  useEffect(() => {
    loadEnhancementPreview()
  }, [selectedEquipment])

  const loadEquipment = async () => {
    try {
      setLoading(true)
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineInventory(player)
        const allEquipment = payload.inventory.equipment
        setEquipment(allEquipment)
        setSelectedEquipment((current) => allEquipment.find((item) => item.item_id === current?.item_id) || allEquipment[0] || null)
        return
      }
      const response = await axios.get('/api/inventory')
      if (response.data.success) {
        const allEquipment = response.data.inventory.equipment || []
        setEquipment(allEquipment)
        if (allEquipment.length > 0 && !selectedEquipment) {
          setSelectedEquipment(allEquipment[0])
        }
      }
    } catch (error) {
      console.error('加载装备失败', error)
      setFeedback({ type: 'error', message: '加载装备失败' })
    } finally {
      setLoading(false)
    }
  }

  const handleEnhance = async () => {
    if (!selectedEquipment) return

    try {
      setEnhancing(true)
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineInventory(player)
        const action = preview?.requires_breakthrough ? 'breakthrough' : 'enhance'
        const response = await onlineApi.post(`/workshop/${payload.session.player.id}/equipment/${selectedEquipment.item_id}/${action}`, {}, {
          headers: { 'Idempotency-Key': createIdempotencyKey(`workshop-${action}`) },
        })
        setFeedback({ type: response.data?.success ? 'success' : 'error', message: response.data?.message || (action === 'breakthrough' ? '突破完成' : '强化完成') })
        setSelectedEquipment(mapOnlineInventoryItem(response.data?.equipment))
        window.dispatchEvent(new Event('gamer:resources-changed'))
        await loadEquipment()
        return
      }
      const response = await axios.post('/api/equipment/enhance', {
        item_id: selectedEquipment.item_id,
        current_level: selectedEquipment.level || 0
      })
      if (response.data.success) {
        setFeedback({ type: 'success', message: response.data.message })
        loadEquipment()
        loadEnhancementPreview()
        // 更新选中的装备
        if (response.data.equipment) {
          setSelectedEquipment(response.data.equipment)
        }
      } else {
        setFeedback({ type: 'error', message: response.data.message || '强化失败' })
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.message || '强化失败'
      })
    } finally {
      setEnhancing(false)
    }
  }

  const loadEnhancementPreview = async () => {
    if (!selectedEquipment) {
      setPreview(null)
      return
    }
    try {
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineInventory(player)
        const response = await onlineApi.get(`/workshop/${payload.session.player.id}/equipment/${selectedEquipment.item_id}/enhancement`)
        setPreview(mapOnlineEnhancementPreview(response.data?.preview))
        return
      }
      const response = await axios.post('/api/equipment/enhance/preview', {
        item_id: selectedEquipment.item_id,
        current_level: selectedEquipment.level || 0
      })
      if (response.data.success) {
        setPreview(response.data.preview)
      }
    } catch (error) {
      setPreview(null)
    }
  }

  return (
    <div className="enhancement-page">
      <div className="enhancement-container">
        <div className="enhancement-header">
          <div className="header-top">
            <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
            <h1>装备强化</h1>
          </div>
        </div>

        {feedback && (
          <div className={`enhancement-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <div className="enhancement-content">
          <div className="equipment-list">
            <h2>选择装备</h2>
            {loading ? (
              <div className="loading">加载中...</div>
            ) : equipment.length === 0 ? (
              <div className="empty">暂无装备</div>
            ) : (
              <div className="equipment-grid">
                {equipment.map((item) => (
                  <div
                    key={item.item_id}
                    className={`equipment-card ${selectedEquipment?.item_id === item.item_id ? 'selected' : ''}`}
                    onClick={() => setSelectedEquipment(item)}
                  >
                    <div className="equipment-icon">⚔️</div>
                    <div className="equipment-info">
                      <h3>{item.item_name}</h3>
                      <p>等级: {item.level || 0}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="enhancement-detail">
            {selectedEquipment ? (
              <div className="enhancement-detail-content">
                <h2>{selectedEquipment.item_name}</h2>
                <div className="equipment-level">
                  <span>当前等级: {selectedEquipment.level || 0}</span>
                </div>
                {preview && (
                  <div className="enhancement-preview">
                    <div>
                      <span>成功率</span>
                      <strong>{Math.round(preview.success_rate * 100)}%</strong>
                    </div>
                    <div className={preview.costs.gold.enough ? 'enough' : 'lacking'}>
                      <span>金币</span>
                      <strong>{preview.costs.gold.owned} / {preview.costs.gold.required}</strong>
                    </div>
                    <div className={preview.costs.material.enough ? 'enough' : 'lacking'}>
                      <span>{preview.costs.material.material_type}</span>
                      <strong>{preview.costs.material.owned} / {preview.costs.material.required}</strong>
                    </div>
                  </div>
                )}
                <div className="enhancement-info">
                  <p>强化可以提升装备的基础属性</p>
                  <p>每次强化需要消耗材料和金币</p>
                  <p>强化有成功率，失败可能掉级</p>
                </div>
                <div className="enhancement-actions">
                  <button
                    className="btn-enhance"
                    onClick={handleEnhance}
                    disabled={enhancing || !!preview && (!preview.costs.gold.enough || !preview.costs.material.enough)}
                  >
                    {enhancing ? '处理中...' : preview?.requires_breakthrough ? '突破' : '强化'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="enhancement-detail-empty">
                <p>请选择一件装备进行强化</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default EnhancementPage
