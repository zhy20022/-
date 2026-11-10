import React, { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import axios from 'axios'
import { isFormalOnlineMode, isStaticDemoMode } from '../../config'
import { useAuthStore } from '../../stores/authStore'
import { createIdempotencyKey, ensureOnlineSession, onlineApi } from '../../services/onlineApi'
import { loadOnlineInventory, mapOnlineEnhancementPreview, mapOnlineInventoryItem } from '../../services/onlineInventoryAdapter'
import { safeErrorLog } from '../../services/safeErrorLog'
import { getSeasonNumber } from '../../services/seasons'
import '../../pages/EnhancementPage.css'

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

const EnhancementPanel: React.FC = () => {
  const location = useLocation()
  const requestedItem = new URLSearchParams(location.search).get('itemId') || (location.state as { itemId?: string } | null)?.itemId
  const { player } = useAuthStore()
  const [equipment, setEquipment] = useState<EquipmentItem[]>([])
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [enhancing, setEnhancing] = useState(false)
  const [preview, setPreview] = useState<EnhancementPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewRequestRef = useRef(0)
  const pending = useRef(false)
  const previewIdentity = useRef('')
  const operation = useRef<{ signature: string; key: string } | null>(null)
  const selectionRef = useRef(selectedEquipment)
  selectionRef.current = selectedEquipment
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (isStaticDemoMode()) { setLoading(false); return }
    loadEquipment()
    return () => { previewRequestRef.current++ }
  }, [])

  useEffect(() => {
    if (isStaticDemoMode()) return
    loadEnhancementPreview()
  }, [selectedEquipment])

  const loadEquipment = async () => {
    try {
      setLoading(true)
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineInventory(player)
        const allEquipment = payload.inventory.equipment.filter(item => getSeasonNumber(item) === 1)
        setEquipment(allEquipment)
        setSelectedEquipment((current) => allEquipment.find((item) => item.item_id === (current?.item_id || requestedItem)) || allEquipment[0] || null)
        return
      }
      const response = await axios.get('/api/inventory')
      if (response.status < 400 && response.data.success) {
        const allEquipment = response.data.inventory.equipment || []
        setEquipment(allEquipment)
        if (allEquipment.length > 0 && !selectedEquipment) {
          setSelectedEquipment(allEquipment.find((item: EquipmentItem) => item.item_id === requestedItem) || allEquipment[0])
        }
      } else {
        throw new Error(response.data?.message || '加载装备失败')
      }
    } catch (error) {
      safeErrorLog('enhancement.equipment', error)
      setFeedback({ type: 'error', message: '加载装备失败' })
    } finally {
      setLoading(false)
    }
  }

  const handleEnhance = async () => {
    if (isStaticDemoMode() || pending.current || !selectedEquipment || previewLoading || !preview
      || previewIdentity.current !== `${selectedEquipment.item_id}:${selectedEquipment.level}`
      || !preview.costs.gold.enough || !preview.costs.material.enough) return
    pending.current = true
    const signature = `${selectedEquipment.item_id}:${selectedEquipment.level}:${preview.requires_breakthrough ? 'breakthrough' : 'enhance'}`
    if (operation.current?.signature !== signature) operation.current = { signature, key: createIdempotencyKey('workshop-enhancement') }

    try {
      setEnhancing(true)
      if (isFormalOnlineMode()) {
        const session = await ensureOnlineSession(player)
        const action = preview?.requires_breakthrough ? 'breakthrough' : 'enhance'
        const response = await onlineApi.post(`/workshop/${session.player.id}/equipment/${selectedEquipment.item_id}/${action}`, {}, {
          headers: { 'Idempotency-Key': operation.current!.key },
        })
        // A resolved enhancement failure with equipment is an actual paid outcome.
        if (!response.data?.equipment) throw new Error(response.data?.message || '强化请求失败')
        operation.current = null
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
        operation.current = null
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
      pending.current = false
    }
  }

  const loadEnhancementPreview = async () => {
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    previewIdentity.current = ''
    setPreview(null)
    setPreviewError(null)
    if (!selectedEquipment) {
      setPreviewLoading(false)
      return
    }
    try {
      setPreviewLoading(true)
      if (isFormalOnlineMode()) {
        const session = await ensureOnlineSession(player)
        const response = await onlineApi.get(`/workshop/${session.player.id}/equipment/${selectedEquipment.item_id}/enhancement`)
        if (response.status >= 400 || response.data?.success === false || !response.data?.preview) {
          throw new Error(response.data?.message || '强化预览加载失败')
        }
        if (requestId === previewRequestRef.current && selectionRef.current === selectedEquipment) {
          previewIdentity.current = `${selectedEquipment.item_id}:${selectedEquipment.level}`
          setPreview(mapOnlineEnhancementPreview(response.data.preview))
        }
        return
      }
      const response = await axios.post('/api/equipment/enhance/preview', {
        item_id: selectedEquipment.item_id,
        current_level: selectedEquipment.level || 0
      })
      if (response.status >= 400 || !response.data?.success || !response.data?.preview) {
        throw new Error(response.data?.message || '强化预览加载失败')
      }
      if (requestId === previewRequestRef.current && selectionRef.current === selectedEquipment) {
        previewIdentity.current = `${selectedEquipment.item_id}:${selectedEquipment.level}`
        setPreview(response.data.preview)
      }
    } catch (error: any) {
      if (requestId === previewRequestRef.current) {
        setPreviewError(error.response?.data?.message || error.message || '强化预览加载失败')
      }
    } finally {
      if (requestId === previewRequestRef.current) setPreviewLoading(false)
    }
  }

  return (
    <div className="enhancement-panel">
        {isStaticDemoMode() && <p className="capability-note">静态试玩尚未接入装备强化与突破，不会消耗材料。</p>}
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
                    role="button"
                    tabIndex={0}
                    aria-label={`选择${item.item_name}`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        if (!pending.current && selectedEquipment?.item_id !== item.item_id) {
                          setPreview(null); previewIdentity.current = ''; setSelectedEquipment(item)
                        }
                      }
                    }}
                    onClick={() => {
                      if (!pending.current && selectedEquipment?.item_id !== item.item_id) {
                        setPreview(null); previewIdentity.current = ''; setSelectedEquipment(item)
                      }
                    }}
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
                {previewLoading && <div className="enhancement-feedback info">正在加载强化预览...</div>}
                {previewError && <div className="enhancement-feedback error" role="alert">{previewError}<button onClick={() => void loadEnhancementPreview()}>重试预览</button></div>}
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
                    disabled={isStaticDemoMode() || enhancing || previewLoading || !preview || previewIdentity.current !== `${selectedEquipment.item_id}:${selectedEquipment.level}` || !preview.costs.gold.enough || !preview.costs.material.enough || selectedEquipment.level >= (preview.max_level || 50)}
                  >
                    {enhancing ? '处理中...' : previewLoading ? '等待预览...' : preview?.requires_breakthrough ? '突破' : '强化'}
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
  )
}

export default EnhancementPanel
