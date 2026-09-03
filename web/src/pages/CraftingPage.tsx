import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { isFormalOnlineMode } from '../config'
import { useAuthStore } from '../stores/authStore'
import { onlineApi } from '../services/onlineApi'
import { loadOnlineMaterials } from '../services/onlineInventoryAdapter'
import { loadOnlineProfile } from '../services/onlineGameAdapter'
import './CraftingPage.css'

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

const CraftingPage: React.FC = () => {
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

  useEffect(() => {
    loadMaterials()
    loadCharacters()
  }, [])

  useEffect(() => {
    loadCraftingPreview()
  }, [craftingType, selectedAttribute, materials])

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
      console.error('加载材料失败', error)
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
      console.error('加载角色失败', error)
      setFeedback({ type: 'error', message: '加载角色失败，请稍后重试' })
    }
  }

  const loadCraftingPreview = async () => {
    if (craftingType === 'equipment' && !selectedAttribute) {
      setCostPreview([])
      return
    }
    try {
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineMaterials(player)
        const response = await onlineApi.post(`/workshop/${payload.session.player.id}/crafting/preview`, {
          craftingType,
          attributeType: selectedAttribute || undefined,
        })
        setCostPreview((response.data?.preview?.costs || []).map((cost: any) => ({
          material_type: cost.materialType,
          attribute_type: cost.attributeType,
          required: cost.required,
          owned: cost.owned,
          enough: cost.enough,
        })))
        return
      }
      const response = await axios.post('/api/crafting/preview', {
        crafting_type: craftingType,
        attribute_type: selectedAttribute
      })
      if (response.data.success) {
        setCostPreview(response.data.preview?.costs || [])
      }
    } catch (error) {
      setCostPreview([])
    }
  }

  const handleCraftExclusive = async () => {
    if (!selectedCharacter) {
      setFeedback({ type: 'error', message: '请选择角色' })
      return
    }

    try {
      setFeedback({ type: 'info', message: '正在制作专属道具...' })
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineMaterials(player)
        const response = await onlineApi.post(`/workshop/${payload.session.player.id}/crafting/exclusive`, { characterId: selectedCharacter })
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
        setFeedback({ type: 'success', message: response.data.message })
        setCraftedItem(response.data.item || null)
        if (response.data.materials) {
          setMaterials(response.data.materials)
          loadCraftingPreview()
        } else {
          loadMaterials()
        }
      } else {
        setFeedback({ type: 'error', message: response.data.message || '制作失败' })
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.message || '制作失败，请稍后重试'
      })
    }
  }

  const handleCraftEquipment = async () => {
    if (!selectedAttribute || !selectedCategory || !selectedSlot) {
      setFeedback({ type: 'error', message: '请选择属性、职业类别和部位' })
      return
    }

    try {
      setFeedback({ type: 'info', message: '正在制作套装部件...' })
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineMaterials(player)
        const response = await onlineApi.post(`/workshop/${payload.session.player.id}/crafting/equipment`, {
          attributeType: selectedAttribute,
          professionCategory: selectedCategory,
          slot: selectedSlot,
        })
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
        setFeedback({ type: 'success', message: response.data.message })
        setCraftedItem(response.data.item || null)
        if (response.data.materials) {
          setMaterials(response.data.materials)
          loadCraftingPreview()
        } else {
          loadMaterials()
        }
      } else {
        setFeedback({ type: 'error', message: response.data.message || '制作失败' })
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.message || '制作失败，请稍后重试'
      })
    }
  }

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
    <div className="crafting-page">
      <div className="page-container">
        <div className="header-top">
          <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
          <h1>制作系统</h1>
        </div>

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
              <button onClick={() => navigate('/inventory')}>查看背包</button>
              <button onClick={() => navigate('/characters')}>前往角色</button>
            </div>
          </div>
        )}

        <div className="crafting-tabs">
          <button
            className={craftingType === 'exclusive' ? 'active' : ''}
            onClick={() => {
              setCraftingType('exclusive')
              setCraftedItem(null)
            }}
          >
            专属道具
          </button>
          <button
            className={craftingType === 'equipment' ? 'active' : ''}
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
                  <p>需要材料：20个专属道具材料</p>
                  <p>当前拥有：{getMaterialCount('EXCLUSIVE_ITEM')}个</p>
                  {renderCostPreview()}
                </div>

                <div className="form-group">
                  <label>选择角色</label>
                  <select
                    value={selectedCharacter}
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
                  disabled={!selectedCharacter || getMaterialCount('EXCLUSIVE_ITEM') < 20}
                  className="craft-btn"
                >
                  制作专属道具
                </button>
              </div>
            ) : (
              <div className="crafting-section">
                <h2>制作套装部件</h2>
                <div className="crafting-info">
                  <p>需要材料：1个套装材料</p>
                  <p>当前拥有：{selectedAttribute ? getMaterialCount('EQUIPMENT_SET', selectedAttribute) : getMaterialCount('EQUIPMENT_SET')}个</p>
                  {renderCostPreview()}
                </div>

                <div className="form-group">
                  <label>选择属性</label>
                  <select
                    value={selectedAttribute}
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
                  disabled={!selectedAttribute || !selectedCategory || !selectedSlot || getMaterialCount('EQUIPMENT_SET', selectedAttribute) < 1}
                  className="craft-btn"
                >
                  制作套装部件
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default CraftingPage
