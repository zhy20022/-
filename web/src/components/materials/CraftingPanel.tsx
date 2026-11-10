import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { isFormalOnlineMode, isStaticDemoMode } from '../../config'
import { useAuthStore } from '../../stores/authStore'
import { createIdempotencyKey, ensureOnlineSession, onlineApi } from '../../services/onlineApi'
import { loadOnlineMaterials } from '../../services/onlineInventoryAdapter'
import { loadOnlineProfile } from '../../services/onlineGameAdapter'
import { equipmentSlotForMode } from '../../services/materialCatalog'
import { safeErrorLog } from '../../services/safeErrorLog'
import '../../pages/CraftingPage.css'

interface Material {
  material_type: string
  attribute_type: string | null
  count: number
}

interface CostPreview {
  material_type: string
  attribute_type: string | null
  required: number
  owned: number
  enough: boolean
}

const CraftingPanel: React.FC = () => {
  const navigate = useNavigate()
  const { player } = useAuthStore()
  const [materials, setMaterials] = useState<Record<string, Material>>({})
  const [loading, setLoading] = useState(true)
  const [craftingType, setCraftingType] = useState<'exclusive' | 'equipment'>('exclusive')
  const [selectedCharacter, setSelectedCharacter] = useState<string>('')
  const [selectedAttribute, setSelectedAttribute] = useState<string>('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedSlot, setSelectedSlot] = useState<string>('')
  const [characters, setCharacters] = useState<any[]>([])
  const [costPreview, setCostPreview] = useState<CostPreview[]>([])
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [craftedItem, setCraftedItem] = useState<any | null>(null)
  const [previewReady, setPreviewReady] = useState(false)
  const [canCraft, setCanCraft] = useState(false)
  const [goldPreview, setGoldPreview] = useState<{ required: number; owned: number; enough: boolean } | null>(null)
  const [crafting, setCrafting] = useState(false)
  const previewSequence = useRef(0)
  const pending = useRef(false)
  const operation = useRef<{ signature: string; key: string } | null>(null)
  const previewSignature = useRef('')
  const currentPreviewSignature = `${craftingType}:${selectedAttribute}`

  useEffect(() => {
    if (isStaticDemoMode()) { setLoading(false); return }
    loadMaterials()
    loadCharacters()
    return () => { previewSequence.current++ }
  }, [])

  useEffect(() => {
    if (isStaticDemoMode() || loading) return
    loadCraftingPreview()
  }, [craftingType, selectedAttribute, materials, loading])

  const loadMaterials = async () => {
    try {
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineMaterials(player)
        setMaterials(payload.materials)
        return
      }
      const response = await axios.get('/api/materials')
      if (response.data.success) {
        setMaterials(response.data.materials)
      } else {
        setFeedback({ type: 'error', message: response.data.message || '加载材料失败' })
      }
    } catch (error) {
      safeErrorLog('crafting.materials', error)
      setFeedback({ type: 'error', message: '加载材料失败，请稍后重试' })
    } finally {
      setLoading(false)
    }
  }

  const loadCharacters = async () => {
    try {
      if (isFormalOnlineMode()) {
        const profile = await loadOnlineProfile(player)
        setCharacters(profile.characters)
        return
      }
      const response = await axios.get('/api/characters')
      if (response.data.success) {
        setCharacters(response.data.characters)
      } else {
        setFeedback({ type: 'error', message: response.data.message || '加载角色失败' })
      }
    } catch (error) {
      safeErrorLog('crafting.characters', error)
      setFeedback({ type: 'error', message: '加载角色失败，请稍后重试' })
    }
  }

  const loadCraftingPreview = async () => {
    const sequence = ++previewSequence.current
    const signature = `${craftingType}:${selectedAttribute}`
    previewSignature.current = ''
    setPreviewReady(false)
    setCanCraft(false)
    setCostPreview([])
    setGoldPreview(null)
    if (craftingType === 'equipment' && !selectedAttribute) {
      setCostPreview([])
      return
    }
    try {
      if (isFormalOnlineMode()) {
        const session = await ensureOnlineSession(player)
        const response = await onlineApi.post(`/workshop/${session.player.id}/crafting/preview`, {
          craftingType,
          attributeType: selectedAttribute || undefined,
        })
        if (sequence !== previewSequence.current) return
        if (response.data?.success !== true || !response.data?.preview) throw new Error('制作预览失败')
        setCostPreview((response.data.preview.costs || []).map((cost: any) => ({
          material_type: cost.materialType,
          attribute_type: cost.attributeType,
          required: cost.required,
          owned: cost.owned,
          enough: cost.enough,
        })))
        previewSignature.current = signature
        setPreviewReady(true)
        setCanCraft(response.data.preview.canCraft === true)
        setGoldPreview(response.data.preview.gold || null)
        return
      }
      const response = await axios.post('/api/crafting/preview', {
        crafting_type: craftingType,
        attribute_type: selectedAttribute
      })
      if (sequence !== previewSequence.current) return
      if (response.status < 400 && response.data.success && response.data.preview) {
        setCostPreview(response.data.preview?.costs || [])
        previewSignature.current = signature
        setPreviewReady(true)
        setCanCraft((response.data.preview.costs || []).length > 0 && response.data.preview.costs.every((cost: CostPreview) => cost.enough))
      } else {
        throw new Error(response.data?.message || '制作预览失败')
      }
    } catch (error) {
      if (sequence === previewSequence.current) {
        setCostPreview([])
        setFeedback({ type: 'error', message: '制作预览加载失败，请重试' })
      }
    }
  }

  const handleCraftExclusive = async () => {
    if (!beginCraft(`exclusive:${selectedCharacter}`)) return
    if (!selectedCharacter) {
      setFeedback({ type: 'error', message: '请选择角色' })
      finishCraft()
      return
    }

    try {
      setFeedback({ type: 'info', message: '正在制作专属道具...' })
      if (isFormalOnlineMode()) {
        const session = await ensureOnlineSession(player)
        const response = await onlineApi.post(`/workshop/${session.player.id}/crafting/exclusive`, { characterId: selectedCharacter }, {
          headers: { 'Idempotency-Key': operation.current!.key },
        })
        if (!response.data?.success || !response.data.item) throw new Error('制作失败')
        operation.current = null
        setFeedback({ type: 'success', message: response.data?.message || '专属武器制作成功' })
        setCraftedItem({ ...response.data?.item?.payload, item_id: response.data?.item?.id, item_name: response.data?.item?.payload?.name })
        window.dispatchEvent(new Event('gamer:resources-changed'))
        await loadMaterials()
        return
      }
      const response = await axios.post('/api/crafting/exclusive-item', {
        character_id: selectedCharacter
      })

      if (response.data.success) {
        operation.current = null
        setFeedback({ type: 'success', message: response.data.message })
        setCraftedItem(response.data.item || null)
        if (response.data.materials) {
          setMaterials(response.data.materials)
        } else {
          await loadMaterials()
        }
      } else {
        setFeedback({ type: 'error', message: response.data.message || '制作失败' })
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.message || '制作失败，请稍后重试'
      })
    } finally {
      finishCraft()
    }
  }

  const handleCraftEquipment = async () => {
    if (!beginCraft(`equipment:${selectedAttribute}:${selectedCategory}:${selectedSlot}`)) return
    if (!selectedAttribute || !selectedCategory || !selectedSlot) {
      setFeedback({ type: 'error', message: '请选择属性、职业类别和部位' })
      finishCraft()
      return
    }

    try {
      setFeedback({ type: 'info', message: '正在制作套装部件...' })
      if (isFormalOnlineMode()) {
        const session = await ensureOnlineSession(player)
        const response = await onlineApi.post(`/workshop/${session.player.id}/crafting/equipment`, {
          attributeType: selectedAttribute,
          professionCategory: selectedCategory,
          slot: equipmentSlotForMode(selectedSlot, true),
        }, { headers: { 'Idempotency-Key': operation.current!.key } })
        if (!response.data?.success || !response.data.item) throw new Error('制作失败')
        operation.current = null
        setFeedback({ type: 'success', message: response.data?.message || '套装部件制作成功' })
        setCraftedItem({ ...response.data?.item?.payload, item_id: response.data?.item?.id, item_name: response.data?.item?.payload?.name })
        window.dispatchEvent(new Event('gamer:resources-changed'))
        await loadMaterials()
        return
      }
      const response = await axios.post('/api/crafting/equipment-set', {
        attribute_type: selectedAttribute,
        profession_category: selectedCategory,
        slot: selectedSlot
      })

      if (response.data.success) {
        operation.current = null
        setFeedback({ type: 'success', message: response.data.message })
        setCraftedItem(response.data.item || null)
        if (response.data.materials) {
          setMaterials(response.data.materials)
        } else {
          await loadMaterials()
        }
      } else {
        setFeedback({ type: 'error', message: response.data.message || '制作失败' })
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.message || '制作失败，请稍后重试'
      })
    } finally {
      finishCraft()
    }
  }

  const beginCraft = (signature: string) => {
    if (isStaticDemoMode() || pending.current || !previewReady || !canCraft || previewSignature.current !== currentPreviewSignature) return false
    pending.current = true
    setCrafting(true)
    if (operation.current?.signature !== signature) operation.current = { signature, key: createIdempotencyKey('workshop-craft') }
    return true
  }

  const finishCraft = () => { pending.current = false; setCrafting(false) }

  const materialTypeAliases: Record<string, string[]> = {
    EXCLUSIVE_ITEM: ['EXCLUSIVE_ITEM', 'exclusive_material', '专属道具材料'],
    EQUIPMENT_SET: ['EQUIPMENT_SET', 'equipment_material', '套装材料'],
    ILLUSTRATION_PIECE: ['ILLUSTRATION_PIECE', 'illustration_piece', '立绘拼图碎片']
  }

  const attributeLabels: Record<string, string> = {
    FIRE: '火',
    WATER: '水',
    THUNDER: '雷',
    WOOD: '木',
    WIND: '风',
    EARTH: '土',
    LIGHT: '光',
    DARK: '暗'
  }

  const getMaterialCount = (materialType: string, attribute?: string) => {
    const aliases = materialTypeAliases[materialType] || [materialType]
    const attrLabel = attribute ? attributeLabels[attribute] || attribute : null
    return Object.values(materials).reduce((total, material) => {
      const typeMatches = aliases.includes(material.material_type)
      const attrMatches = !attrLabel || material.attribute_type === attrLabel || material.attribute_type === attribute
      return typeMatches && attrMatches ? total + material.count : total
    }, 0)
  }

  const renderCostPreview = () => {
    if (costPreview.length === 0) return null
    return (
      <div className="cost-preview">
        {goldPreview && <div className={goldPreview.enough ? 'cost-row enough' : 'cost-row lacking'}>
          <span>金币</span><strong>{goldPreview.owned} / {goldPreview.required}</strong>
        </div>}
        {costPreview.map((cost) => (
          <div key={`${cost.material_type}_${cost.attribute_type || 'all'}`} className={cost.enough ? 'cost-row enough' : 'cost-row lacking'}>
            <span>{cost.attribute_type ? `${cost.attribute_type} ` : ''}{cost.material_type}</span>
            <strong>{cost.owned} / {cost.required}</strong>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="crafting-panel">
        {isStaticDemoMode() ? <p className="capability-note">静态试玩尚未接入制作，材料不会被消耗。</p> : (
        <button type="button" disabled={crafting} onClick={() => void loadCraftingPreview()}>刷新制作预览</button>)}
        {feedback && (
          <div className={`crafting-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        {craftedItem && (
          <div className="crafted-result">
            <div>
              <span>本次产物</span>
              <strong>{craftedItem.name || craftedItem.item_name || '已制作物品'}</strong>
              <p>{craftedItem.description || craftedItem.slot || craftedItem.equipment_slot || '已进入背包，可在角色详情中穿戴。'}</p>
            </div>
            <div className="crafted-result-actions">
              <button onClick={() => navigate('/materials?tab=inventory')}>查看背包</button>
              <button onClick={() => navigate('/characters')}>前往角色</button>
            </div>
          </div>
        )}

        <div className="crafting-tabs">
          <button
            className={craftingType === 'exclusive' ? 'active' : ''}
            disabled={crafting}
            onClick={() => {
              setCraftingType('exclusive')
              setCraftedItem(null)
            }}
          >
            专属道具
          </button>
          <button
            className={craftingType === 'equipment' ? 'active' : ''}
            disabled={crafting}
            onClick={() => {
              setCraftingType('equipment')
              setCraftedItem(null)
            }}
          >
            套装部件
          </button>
        </div>

        {loading ? (
          <div>加载中...</div>
        ) : (
          <>
            {craftingType === 'exclusive' ? (
              <div className="crafting-section">
                <h2>制作专属道具</h2>
                <div className="crafting-info">
                  {!isFormalOnlineMode() && <p>当前拥有：{getMaterialCount('EXCLUSIVE_ITEM')}个</p>}
                  {renderCostPreview()}
                </div>

                <div className="form-group">
                  <label>选择角色</label>
                  <select
                    value={selectedCharacter}
                    aria-label="制作角色"
                    disabled={crafting || isStaticDemoMode()}
                    onChange={(e) => setSelectedCharacter(e.target.value)}
                  >
                    <option value="">请选择角色</option>
                    {characters.map((char) => (
                      <option key={char.character_id} value={char.character_id}>
                        {char.name}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleCraftExclusive}
                  disabled={isStaticDemoMode() || crafting || !selectedCharacter || !previewReady || !canCraft || previewSignature.current !== currentPreviewSignature}
                  className="craft-btn"
                >
                  制作专属道具
                </button>
              </div>
            ) : (
              <div className="crafting-section">
                <h2>制作套装部件</h2>
                <div className="crafting-info">
                  {!isFormalOnlineMode() && <p>当前拥有：{selectedAttribute ? getMaterialCount('EQUIPMENT_SET', selectedAttribute) : getMaterialCount('EQUIPMENT_SET')}个</p>}
                  {renderCostPreview()}
                </div>

                <div className="form-group">
                  <label>选择属性</label>
                  <select
                    value={selectedAttribute}
                    aria-label="制作属性"
                    disabled={crafting || isStaticDemoMode()}
                    onChange={(e) => setSelectedAttribute(e.target.value)}
                  >
                    <option value="">请选择属性</option>
                    <option value="FIRE">火</option>
                    <option value="WATER">水</option>
                    <option value="THUNDER">雷</option>
                    <option value="WOOD">木</option>
                    <option value="WIND">风</option>
                    <option value="EARTH">土</option>
                    <option value="LIGHT">光</option>
                    <option value="DARK">暗</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>选择职业类别</label>
                  <select
                    value={selectedCategory}
                    aria-label="制作职业类别"
                    disabled={crafting || isStaticDemoMode()}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                  >
                    <option value="">请选择类别</option>
                    <option value="A">A（物理坦克、法系坦克）</option>
                    <option value="B">B（物理近战、物理远程）</option>
                    <option value="C">C（法系近战、法系远程）</option>
                    <option value="D">D（治疗、辅助）</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>选择部位</label>
                  <select
                    value={selectedSlot}
                    aria-label="制作部位"
                    disabled={crafting || isStaticDemoMode()}
                    onChange={(e) => setSelectedSlot(e.target.value)}
                  >
                    <option value="">请选择部位</option>
                    <option value="HELMET">头盔</option>
                    <option value="ACCESSORY">饰品</option>
                    <option value="CHEST">胸</option>
                    <option value="GLOVES">手</option>
                    <option value="LEGS">腿</option>
                    <option value="BOOTS">脚</option>
                  </select>
                </div>

                <button
                  onClick={handleCraftEquipment}
                  disabled={isStaticDemoMode() || crafting || !selectedAttribute || !selectedCategory || !selectedSlot || !previewReady || !canCraft || previewSignature.current !== currentPreviewSignature}
                  className="craft-btn"
                >
                  制作套装部件
                </button>
              </div>
            )}
          </>
        )}
    </div>
  )
}

export default CraftingPanel
