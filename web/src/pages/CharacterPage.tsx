import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import NewPlayerGuide from '../components/NewPlayerGuide'
import { completeNewPlayerGuideStep } from '../services/newPlayerGuide'
import { useAuthStore } from '../stores/authStore'
import { getOnlineModeError, isFormalOnlineMode, loadOnlineDungeons, loadOnlineProfile, mapOnlineCharacter, onlineApi } from '../services/onlineGameAdapter'
import { mapOnlineInventoryItem } from '../services/onlineInventoryAdapter'
import './CharacterPage.css'

interface CharacterStats {
  hp?: number
  attack?: number
  defense?: number
  magic_attack?: number
  magic_defense?: number
}

interface Character {
  character_id: string
  name: string
  profession_type: string
  attribute_type: string
  level: number
  exp: number
  max_level?: number
  exp_to_next_level?: number
  exp_progress?: number
  total_exp_to_current_level?: number
  total_exp_to_max_level?: number
  star?: number  // 星级（1-5星）
  is_locked?: boolean  // 是否锁定
  stats?: CharacterStats
  base_stats?: CharacterStats
  equipment_bonus?: CharacterStats
  equipment?: {
    weapon?: any
    equipment_set?: any
    illustrations?: any
  }
  skills?: {
    learned_skills?: string[]
    skill_slots?: any
  }
  skill_summary?: {
    low: Array<{ skill_id: string; name: string; skill_logic: string; skill_tier: string }>
    mid: Array<{ skill_id: string; name: string; skill_logic: string; skill_tier: string }>
    high: Array<{ skill_id: string; name: string; skill_logic: string; skill_tier: string }>
    total_configured: number
  }
  equipment_summary?: {
    has_weapon: boolean
    weapon_name?: string
    equipped_piece_count: number
    equipped_slots: string[]
  }
}

interface InventoryOption {
  item_id: string
  item_name: string
  item_type: string
  item_subtype: string | null
  item_data: any
  level: number
  is_equipped: boolean
  can_equip?: boolean
  slot?: string
  is_current_character_equipped?: boolean
}

interface SkillInfo {
  skill_id: string
  name: string
  skill_logic: string
  skill_tier: string
  cooldown: number
  skill_multiplier: number
  target_type: string
  description: string
}

interface MaterialEntry {
  material_type: string
  attribute_type: string | null
  count: number
}

interface GrowthDungeon {
  dungeon_id: string
  name: string
  difficulty?: string
  difficulty_order?: number
  reward_config?: any
  progress?: {
    sweep_unlocked: boolean
    sweep_unlock_count?: number
    completion_count?: number
  }
}

interface ExpPreview {
  target_level: number
  required_exp: number
  owned_exp: number
  need_more: number
  can_afford: boolean
  max_crystals: number
}

interface ExpShortage {
  required_exp: number
  owned_exp: number
  need_more: number
  message: string
}

interface IllustrationOption {
  illustration_id: string
  gender: 'male' | 'female'
  name: string
  unlocked: boolean
}

interface IllustrationStatus {
  material_count: number
  cost: number
  character?: {
    unlocked: string[]
    selected?: string | null
    selected_id?: string | null
    selected_path?: string | null
    options: IllustrationOption[]
  }
}

type SortOption = 'level_asc' | 'level_desc' | 'star_asc' | 'star_desc' | 'name_asc' | 'name_desc'
type FilterAttribute = 'FIRE' | 'WATER' | 'WIND' | 'EARTH' | 'LIGHT' | 'DARK' | 'THUNDER' | 'WOOD' | 'ALL'
type FilterProfession = 'TANK' | 'DPS' | 'HEALER' | 'SUPPORT' | 'ALL'
type FilterType = 'PHYSICAL' | 'MAGIC' | 'ALL'

interface BattleSoulInfo {
  level: number
  essence_count: number
  bonus: number
  upgrade_cost: number
  can_upgrade: boolean
  max_level: number
}

const CharacterPage: React.FC = () => {
  const navigate = useNavigate()
  const { player } = useAuthStore()
  const [characters, setCharacters] = useState<Character[]>([])
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [loading, setLoading] = useState(true)
  const [battleSoulData, setBattleSoulData] = useState<Record<string, BattleSoulInfo>>({})
  
  // 筛选和排序状态
  const [searchQuery, setSearchQuery] = useState('')
  const [filterAttribute, setFilterAttribute] = useState<FilterAttribute>('ALL')
  const [filterProfession, setFilterProfession] = useState<FilterProfession>('ALL')
  const [filterType, setFilterType] = useState<FilterType>('ALL')
  const [sortOption, setSortOption] = useState<SortOption>('level_desc')

  useEffect(() => {
    loadCharacters()
    loadBattleSoulData()
  }, [])

  const loadBattleSoulData = async () => {
    if (isFormalOnlineMode()) return
    try {
      const response = await axios.get('/api/battle-soul/info')
      if (response.data.success) {
        setBattleSoulData(response.data.battle_soul || {})
      }
    } catch (error) {
      console.error('加载战魂数据失败', error)
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
        // 为角色添加默认星级（如果没有）
        const chars = response.data.characters.map((char: Character) => ({
          ...char,
          star: char.star || Math.min(5, Math.floor(char.level / 20) + 1), // 根据等级计算星级
          is_locked: char.is_locked || false
        }))
        setCharacters(chars)
      }
    } catch (error) {
      console.error('加载角色失败', error)
    } finally {
      setLoading(false)
    }
  }
  
  // 获取职业分类（坦克、输出、辅疗）
  const getProfessionCategory = (professionType: string): FilterProfession => {
    if (professionType.includes('坦克')) return 'TANK'
    if (professionType.includes('输出')) return 'DPS'
    if (professionType.includes('治疗') || professionType.includes('辅助')) return 'HEALER'
    return 'ALL'
  }
  
  // 获取职业类型（物理/法术）
  const getProfessionType = (professionType: string): FilterType => {
    if (professionType.includes('物理')) return 'PHYSICAL'
    if (professionType.includes('法系') || professionType.includes('魔法')) return 'MAGIC'
    return 'ALL'
  }
  
  // 筛选和排序后的角色列表
  const filteredAndSortedCharacters = useMemo(() => {
    let filtered = [...characters]
    
    // 搜索筛选
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(char => 
        char.name.toLowerCase().includes(query)
      )
    }
    
    // 属性筛选
    if (filterAttribute !== 'ALL') {
      filtered = filtered.filter(char => char.attribute_type === filterAttribute)
    }
    
    // 职业分类筛选
    if (filterProfession !== 'ALL') {
      filtered = filtered.filter(char => 
        getProfessionCategory(char.profession_type) === filterProfession
      )
    }
    
    // 职业类型筛选（物理/法术）
    if (filterType !== 'ALL') {
      filtered = filtered.filter(char => 
        getProfessionType(char.profession_type) === filterType
      )
    }
    
    // 排序
    filtered.sort((a, b) => {
      switch (sortOption) {
        case 'level_asc':
          return a.level - b.level
        case 'level_desc':
          return b.level - a.level
        case 'star_asc':
          return (a.star || 1) - (b.star || 1)
        case 'star_desc':
          return (b.star || 1) - (a.star || 1)
        case 'name_asc':
          return a.name.localeCompare(b.name)
        case 'name_desc':
          return b.name.localeCompare(a.name)
        default:
          return 0
      }
    })
    
    return filtered
  }, [characters, searchQuery, filterAttribute, filterProfession, filterType, sortOption])
  
  // 切换锁定状态
  const toggleLock = async (characterId: string, isLocked: boolean, e: React.MouseEvent) => {
    e.stopPropagation() // 阻止触发卡片点击
    try {
      const endpoint = isLocked ? `/api/characters/${characterId}/unlock` : `/api/characters/${characterId}/lock`
      const response = await axios.post(endpoint)
      if (response.data.success) {
        setCharacters(prev => prev.map(char => 
          char.character_id === characterId 
            ? { ...char, is_locked: !isLocked }
            : char
        ))
        // 如果当前选中的角色，也更新详情
        if (selectedCharacter?.character_id === characterId) {
          setSelectedCharacter({ ...selectedCharacter, is_locked: !isLocked })
        }
      }
    } catch (error) {
      console.error('切换锁定状态失败', error)
    }
  }

  const handleCharacterClick = (character: Character) => {
    setSelectedCharacter(character)
    setShowDetail(true)
  }

  const handleCloseDetail = () => {
    setShowDetail(false)
    setSelectedCharacter(null)
  }

  const handleCharacterUpdated = (updated: Character) => {
    const normalized = {
      ...updated,
      star: updated.star || Math.min(5, Math.floor(updated.level / 20) + 1),
      is_locked: updated.is_locked || false
    }
    setSelectedCharacter(normalized)
    setCharacters(prev => prev.map(char => char.character_id === updated.character_id ? normalized : char))
  }

  const getAttributeColor = (attribute: string) => {
    const colorMap: Record<string, string> = {
      'FIRE': '#ff4444',
      'WATER': '#4444ff',
      'WIND': '#44ff44',
      'EARTH': '#ff8844',
      'LIGHT': '#ffff44',
      'DARK': '#8844ff',
      'THUNDER': '#ff44ff',
      'ICE': '#44ffff',
      'WOOD': '#44aa44'  // 木属性
    }
    return colorMap[attribute] || '#666'
  }

  return (
    <div className="character-page">
      <div className="page-container">
        <div className="page-header">
          <div className="header-top">
            <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
            <h1>角色管理</h1>
          </div>
        </div>
        
        {/* 筛选和搜索栏 */}
        <NewPlayerGuide
          page="characters"
          ownedCharacterCount={characters.length}
          selectedCharacterAttribute={characters[0]?.attribute_type}
        />

        <div className="filter-bar">
          <div className="search-section">
            <input
              type="text"
              placeholder="搜索角色名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          
          <div className="filter-section">
            <div className="filter-group">
              <label>属性：</label>
              <select 
                value={filterAttribute} 
                onChange={(e) => setFilterAttribute(e.target.value as FilterAttribute)}
                className="filter-select"
              >
                <option value="ALL">全部</option>
                <option value="FIRE">火</option>
                <option value="WATER">水</option>
                <option value="WIND">风</option>
                <option value="EARTH">土</option>
                <option value="LIGHT">光</option>
                <option value="DARK">暗</option>
                <option value="THUNDER">雷</option>
                <option value="WOOD">木</option>
              </select>
            </div>
            
            <div className="filter-group">
              <label>职业：</label>
              <select 
                value={filterProfession} 
                onChange={(e) => setFilterProfession(e.target.value as FilterProfession)}
                className="filter-select"
              >
                <option value="ALL">全部</option>
                <option value="TANK">坦克</option>
                <option value="DPS">输出</option>
                <option value="HEALER">辅疗</option>
                <option value="SUPPORT">辅助</option>
              </select>
            </div>
            
            <div className="filter-group">
              <label>类型：</label>
              <select 
                value={filterType} 
                onChange={(e) => setFilterType(e.target.value as FilterType)}
                className="filter-select"
              >
                <option value="ALL">全部</option>
                <option value="PHYSICAL">物理</option>
                <option value="MAGIC">法术</option>
              </select>
            </div>
            
            <div className="filter-group">
              <label>排序：</label>
              <select 
                value={sortOption} 
                onChange={(e) => setSortOption(e.target.value as SortOption)}
                className="filter-select"
              >
                <option value="level_desc">等级降序</option>
                <option value="level_asc">等级升序</option>
                <option value="star_desc">星级降序</option>
                <option value="star_asc">星级升序</option>
                <option value="name_asc">名称升序</option>
                <option value="name_desc">名称降序</option>
              </select>
            </div>
          </div>
        </div>
        
        {loading ? (
          <div className="loading">加载中...</div>
        ) : (
          <>
            {filteredAndSortedCharacters.length === 0 ? (
              <div className="empty-state">
                <p>{characters.length === 0 ? '还没有角色，快去抽取吧！' : '没有找到符合条件的角色'}</p>
                {characters.length === 0 && (
                  <button onClick={() => navigate('/gacha')} className="btn-primary">前往抽取</button>
                )}
              </div>
            ) : (
              <div className="characters-grid">
                {filteredAndSortedCharacters.map((char) => (
                  <div
                    key={char.character_id}
                    className={`character-card ${char.is_locked ? 'locked' : ''}`}
                    onClick={() => handleCharacterClick(char)}
                  >
                    {/* 锁定图标 */}
                    <button
                      className={`lock-btn ${char.is_locked ? 'locked' : ''}`}
                      onClick={(e) => toggleLock(char.character_id, char.is_locked || false, e)}
                      title={char.is_locked ? '解锁' : '锁定'}
                    >
                      {char.is_locked ? '🔒' : '🔓'}
                    </button>
                    
                    {/* 星级显示 */}
                    {char.star && (
                      <div className="star-rating">
                        {'★'.repeat(char.star)}{'☆'.repeat(5 - char.star)}
                      </div>
                    )}
                    
                    <div className="character-avatar">
                      <div
                        className="attribute-badge"
                        style={{ backgroundColor: getAttributeColor(char.attribute_type) }}
                      >
                        {char.attribute_type}
                      </div>
                    </div>
                    <div className="character-info">
                      <h3 className="character-name">{char.name}</h3>
                      <div className="character-meta">
                        <span className="profession">{char.profession_type}</span>
                        <div className="meta-right">
                          <span className="level">Lv.{char.level}</span>
                          {battleSoulData[char.attribute_type] && (
                            <span className="battle-soul-level" title={`战魂等级: ${battleSoulData[char.attribute_type].level}`}>
                              战魂: {battleSoulData[char.attribute_type].level}级
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="exp-bar">
                        <div
                          className="exp-fill"
                          style={{ width: `${Math.round((char.exp_progress ?? (char.exp / Math.max(char.exp_to_next_level || 100, 1))) * 100)}%` }}
                        />
                        <span className="exp-text">
                          {char.level >= (char.max_level || 100) ? 'MAX' : `${char.exp}/${char.exp_to_next_level || 100}`}
                        </span>
                      </div>
                    </div>
                    <div className="character-stats-preview">
                      {char.stats && (
                        <>
                          <div className="stat-item">
                            <span>HP</span>
                            <span>{char.stats.hp || 0}</span>
                          </div>
                          <div className="stat-item">
                            <span>攻击</span>
                            <span>{char.stats.attack || 0}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {showDetail && selectedCharacter && (
          <CharacterDetailModal
            character={selectedCharacter}
            onClose={handleCloseDetail}
            getAttributeColor={getAttributeColor}
            onLockToggle={(characterId, isLocked) => toggleLock(characterId, isLocked, { stopPropagation: () => {} } as React.MouseEvent)}
            onNavigate={navigate}
            battleSoulData={battleSoulData}
            onBattleSoulUpgrade={loadBattleSoulData}
            onCharacterUpdated={handleCharacterUpdated}
          />
        )}
      </div>
    </div>
  )
}

interface CharacterDetailModalProps {
  character: Character
  onClose: () => void
  getAttributeColor: (attribute: string) => string
  onLockToggle: (characterId: string, isLocked: boolean) => void
  onNavigate: (path: string) => void
  battleSoulData: Record<string, BattleSoulInfo>
  onBattleSoulUpgrade: () => void
  onCharacterUpdated: (character: Character) => void
}

const CharacterDetailModal: React.FC<CharacterDetailModalProps> = ({
  character,
  onClose,
  getAttributeColor,
  onLockToggle,
  onNavigate,
  battleSoulData,
  onBattleSoulUpgrade,
  onCharacterUpdated
}) => {
  const { player } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'info' | 'skills' | 'equipment' | 'illustration' | 'battle-soul'>('info')
  const [upgrading, setUpgrading] = useState(false)
  const [equipmentOptions, setEquipmentOptions] = useState<{ weapons: InventoryOption[]; equipment: InventoryOption[] }>({ weapons: [], equipment: [] })
  const [equipmentFeedback, setEquipmentFeedback] = useState<string | null>(null)
  const [unlockedSkills, setUnlockedSkills] = useState<SkillInfo[]>([])
  const [skillSlots, setSkillSlots] = useState<Record<'low' | 'mid' | 'high', string[]>>({ low: [], mid: [], high: [] })
  const [skillFeedback, setSkillFeedback] = useState<string | null>(null)
  const [weaponActionItemId, setWeaponActionItemId] = useState<string | null>(null)
  const [materials, setMaterials] = useState<Record<string, MaterialEntry>>({})
  const [expAmount, setExpAmount] = useState(100)
  const [expLevelDelta, setExpLevelDelta] = useState(1)
  const [expPreview, setExpPreview] = useState<ExpPreview | null>(null)
  const [expShortage, setExpShortage] = useState<ExpShortage | null>(null)
  const [expFeedback, setExpFeedback] = useState<string | null>(null)
  const [expDungeons, setExpDungeons] = useState<GrowthDungeon[]>([])
  const [sweepingExp, setSweepingExp] = useState(false)
  const [illustrationStatus, setIllustrationStatus] = useState<IllustrationStatus | null>(null)
  const [illustrationFeedback, setIllustrationFeedback] = useState<string | null>(null)
  const [exchangingIllustrationId, setExchangingIllustrationId] = useState<string | null>(null)
  
  const battleSoulInfo = battleSoulData[character.attribute_type]
  const maxCharacterLevel = character.max_level || 100
  const expToNextLevel = character.exp_to_next_level || 0
  const isCharacterMaxLevel = character.level >= maxCharacterLevel
  const expProgressPercent = Math.round(
    (character.exp_progress ?? (expToNextLevel > 0 ? character.exp / expToNextLevel : 1)) * 100
  )
  const equippedPieces = character.equipment?.equipment_set && !character.equipment.equipment_set.name
    ? Object.entries(character.equipment.equipment_set as Record<string, any>)
    : []
  const statRows = [
    { key: 'hp', label: '生命值' },
    { key: 'attack', label: '攻击力' },
    { key: 'defense', label: '防御力' },
    { key: 'magic_attack', label: '魔法攻击' },
    { key: 'magic_defense', label: '魔法防御' }
  ] as const
  const configuredSkills = character.skill_summary
    ? [...character.skill_summary.low, ...character.skill_summary.mid, ...character.skill_summary.high]
    : []
  const equipmentSlots = ['头盔', '胸甲', '护腿', '靴子', '手套', '饰品']
  const equippedBySlot = new Map(equippedPieces.map(([slot, piece]) => [slot, piece]))
  const formatStats = (stats?: CharacterStats) => {
    if (!stats) return '无属性加成'
    const parts = statRows
      .filter(({ key }) => (stats[key] || 0) > 0)
      .map(({ key, label }) => `${label} +${stats[key] || 0}`)
    return parts.length > 0 ? parts.join(' / ') : '无属性加成'
  }
  const rawIllustrations = character.equipment?.illustrations
  const illustrationImagePath = typeof rawIllustrations === 'string'
    ? rawIllustrations
    : illustrationStatus?.character?.selected_path || rawIllustrations?.selected_path || null
  const getExclusiveInfo = (item: any) => item?.exclusive_info || item?.item_data?.exclusive_info || {}

  useEffect(() => {
    if (activeTab === 'equipment') {
      loadEquipmentOptions()
    }
    if (activeTab === 'skills') {
      loadSkillConfig()
    }
  }, [activeTab, character.character_id])

  useEffect(() => {
    loadMaterials()
    loadExpDungeons()
    loadIllustrationStatus()
  }, [character.character_id])

  useEffect(() => {
    loadExpPreview()
  }, [character.character_id, character.level, character.exp, expLevelDelta])

  const loadEquipmentOptions = async () => {
    if (isFormalOnlineMode()) {
      try {
        const profile = await loadOnlineProfile(player)
        const response = await onlineApi.get(`/players/${profile.session.player.id}/characters/${character.character_id}/equipment-options`)
        setEquipmentOptions({
          weapons: (response.data?.weapons || []).map(mapOnlineInventoryItem),
          equipment: (response.data?.equipment || []).map(mapOnlineInventoryItem)
        })
      } catch (error) {
        setEquipmentFeedback(getOnlineModeError(error, '加载可穿戴装备失败'))
      }
      return
    }
    try {
      const response = await axios.get(`/api/characters/${character.character_id}/equipment-options`)
      if (response.data.success) {
        setEquipmentOptions({
          weapons: response.data.weapons || [],
          equipment: response.data.equipment || []
        })
      }
    } catch (error) {
      console.error('加载可穿戴装备失败', error)
    }
  }

  const loadIllustrationStatus = async () => {
    if (isFormalOnlineMode()) return
    try {
      const response = await axios.get('/api/exchange/illustration/status', {
        params: { character_id: character.character_id }
      })
      if (response.data.success) {
        setIllustrationStatus({
          material_count: response.data.material_count || 0,
          cost: response.data.cost || 100,
          character: response.data.characters?.[0]
        })
      }
    } catch (error) {
      console.error('加载立绘兑换状态失败', error)
    }
  }

  const exchangeIllustration = async (option: IllustrationOption) => {
    setExchangingIllustrationId(option.illustration_id)
    setIllustrationFeedback(null)
    try {
      const response = await axios.post('/api/exchange/illustration', {
        character_id: character.character_id,
        illustration_id: option.illustration_id,
        gender: option.gender
      })
      if (response.data.success) {
        setIllustrationFeedback(response.data.message || '立绘已更新')
        if (response.data.illustration_status) {
          setIllustrationStatus((prev) => ({
            material_count: response.data.materials
              ? Object.values(response.data.materials as Record<string, MaterialEntry>).reduce((total, material) => (
                material.material_type === '立绘拼图碎片' ? total + material.count : total
              ), 0)
              : prev?.material_count || 0,
            cost: prev?.cost || 100,
            character: response.data.illustration_status
          }))
        } else {
          await loadIllustrationStatus()
        }
        if (response.data.character) {
          onCharacterUpdated(response.data.character)
        }
        loadMaterials()
      } else {
        setIllustrationFeedback(response.data.message || '立绘兑换失败')
      }
    } catch (error: any) {
      setIllustrationFeedback(error.response?.data?.message || '立绘兑换失败')
    } finally {
      setExchangingIllustrationId(null)
    }
  }

  const handleEquipItem = async (itemId: string) => {
    try {
      if (isFormalOnlineMode()) {
        const profile = await loadOnlineProfile(player)
        const response = await onlineApi.post(`/players/${profile.session.player.id}/characters/${character.character_id}/equip`, { itemId })
        setEquipmentFeedback(response.data?.message || '装备成功')
        onCharacterUpdated(mapOnlineCharacter(response.data.character))
        await loadEquipmentOptions()
        return
      }
      const response = await axios.post(`/api/characters/${character.character_id}/equip`, { item_id: itemId })
      if (response.data.success) {
        setEquipmentFeedback(response.data.message || '装备成功')
        onCharacterUpdated(mapOnlineCharacter(response.data.character))
        loadEquipmentOptions()
      } else {
        setEquipmentFeedback(response.data.message || '装备失败')
      }
    } catch (error: any) {
      setEquipmentFeedback(error.response?.data?.message || '装备失败')
    }
  }

  const handleUnequipItem = async (itemId: string, itemType?: string, slot?: string) => {
    try {
      if (isFormalOnlineMode()) {
        const profile = await loadOnlineProfile(player)
        const response = await onlineApi.post(`/players/${profile.session.player.id}/characters/${character.character_id}/unequip`, { itemId, slot: itemType === 'weapon' ? 'weapon' : slot })
        setEquipmentFeedback(response.data?.message || '卸下成功')
        onCharacterUpdated(mapOnlineCharacter(response.data.character))
        await loadEquipmentOptions()
        return
      }
      const response = await axios.post(`/api/characters/${character.character_id}/unequip`, {
        item_id: itemId,
        item_type: itemType,
        slot
      })
      if (response.data.success) {
        setEquipmentFeedback(response.data.message || '卸下成功')
        onCharacterUpdated(response.data.character)
        loadEquipmentOptions()
      } else {
        setEquipmentFeedback(response.data.message || '卸下失败')
      }
    } catch (error: any) {
      setEquipmentFeedback(error.response?.data?.message || '卸下失败')
    }
  }

  const handleExclusiveWeaponUpgrade = async (itemId?: string) => {
    if (!itemId) return
    try {
      setWeaponActionItemId(itemId)
      setEquipmentFeedback(null)
      const option = [...equipmentOptions.weapons, character.equipment?.weapon].find((item) => item?.item_id === itemId)
      const cost = getExclusiveInfo(option).upgrade_cost
      if (cost && !hasExclusiveMaterial(cost)) {
        setEquipmentFeedback(`专属道具材料不足，升级需要 ${cost} 个，当前只有 ${getExclusiveMaterialCount()} 个`)
        return
      }
      const response = await axios.post('/api/upgrade/exclusive-item', { item_id: itemId })
      if (response.data.success) {
        setEquipmentFeedback(response.data.message || '专属武器升级成功')
        if (response.data.character) {
          onCharacterUpdated(response.data.character)
        }
        loadEquipmentOptions()
        loadMaterials()
      } else {
        setEquipmentFeedback(response.data.message || '专属武器升级失败')
      }
    } catch (error: any) {
      setEquipmentFeedback(error.response?.data?.message || '专属武器升级失败')
    } finally {
      setWeaponActionItemId(null)
    }
  }

  const handleExclusiveWeaponBreakthrough = async (itemId?: string) => {
    if (!itemId) return
    try {
      setWeaponActionItemId(itemId)
      setEquipmentFeedback(null)
      const option = [...equipmentOptions.weapons, character.equipment?.weapon].find((item) => item?.item_id === itemId)
      const cost = getExclusiveInfo(option).breakthrough_cost
      if (cost && !hasExclusiveMaterial(cost)) {
        setEquipmentFeedback(`专属道具材料不足，突破需要 ${cost} 个，当前只有 ${getExclusiveMaterialCount()} 个`)
        return
      }
      const response = await axios.post('/api/breakthrough/exclusive-item', { item_id: itemId })
      if (response.data.success) {
        setEquipmentFeedback(response.data.message || '专属武器突破成功')
        if (response.data.character) {
          onCharacterUpdated(response.data.character)
        }
        loadEquipmentOptions()
        loadMaterials()
      } else {
        setEquipmentFeedback(response.data.message || '专属武器突破失败')
      }
    } catch (error: any) {
      setEquipmentFeedback(error.response?.data?.message || '专属武器突破失败')
    } finally {
      setWeaponActionItemId(null)
    }
  }
  
  const handleBattleSoulUpgrade = async () => {
    if (!battleSoulInfo || !battleSoulInfo.can_upgrade || upgrading) return
    
    try {
      setUpgrading(true)
      const response = await axios.post('/api/battle-soul/upgrade', {
        attribute_type: character.attribute_type
      })
      if (response.data.success) {
        alert(response.data.message)
        onBattleSoulUpgrade()
      } else {
        alert(response.data.message || '升级失败')
      }
    } catch (error: any) {
      alert(error.response?.data?.message || '升级失败')
    } finally {
      setUpgrading(false)
    }
  }

  const loadMaterials = async () => {
    try {
      if (isFormalOnlineMode()) {
        const profile = await loadOnlineProfile(player)
        const expCount = (profile.inventory || [])
          .filter((item: any) => item.itemConfigId === 'character_exp_crystal')
          .reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0)
        setMaterials({
          character_exp_crystal: {
            material_type: 'CHARACTER_EXP',
            attribute_type: null,
            count: expCount,
          },
        })
        return
      }

      const response = await axios.get('/api/materials')
      if (response.data.success) {
        setMaterials(response.data.materials || {})
      }
    } catch (error) {
      console.error('加载材料失败', error)
    }
  }

  const loadExpDungeons = async () => {
    try {
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineDungeons(player)
        setExpDungeons(payload.dungeons.filter((dungeon) => dungeon.reward_config?.type === 'experience'))
        return
      }

      const response = await axios.get('/api/dungeons')
      if (response.data.success) {
        const dungeons = (response.data.dungeons || []).filter(
          (dungeon: GrowthDungeon) => dungeon.reward_config?.type === 'experience'
        )
        setExpDungeons(dungeons)
      }
    } catch (error) {
      console.error('加载经验本失败', error)
    }
  }

  const loadExpPreview = async () => {
    if (isCharacterMaxLevel) {
      setExpPreview(null)
      setExpShortage(null)
      return
    }
    const maxDelta = Math.max(1, maxCharacterLevel - character.level)
    const normalizedDelta = Math.min(Math.max(expLevelDelta || 1, 1), maxDelta)
    try {
      if (isFormalOnlineMode()) {
        const profile = await loadOnlineProfile(player)
        const response = await onlineApi.get(`/players/${profile.session.player.id}/characters/${character.character_id}/exp-preview`, {
          params: { levelDelta: normalizedDelta }
        })
        setExpPreview({
          target_level: response.data.targetLevel,
          required_exp: response.data.requiredExpPackages,
          owned_exp: response.data.ownedExpPackages,
          need_more: response.data.needMoreExpPackages,
          can_afford: response.data.canAfford,
          max_crystals: response.data.ownedExpPackages,
        })
        setExpShortage(response.data.canAfford ? null : {
          required_exp: response.data.requiredExpPackages,
          owned_exp: response.data.ownedExpPackages,
          need_more: response.data.needMoreExpPackages,
          message: response.data.needMoreGold > 0
            ? `经验结晶或金币不足（缺金币 ${response.data.needMoreGold}）`
            : '经验结晶量不足'
        })
        return
      }

      const response = await axios.get(`/api/characters/${character.character_id}/exp-preview`, {
        params: { level_delta: normalizedDelta }
      })
      if (response.data.success) {
        const preview = response.data as ExpPreview
        setExpPreview(preview)
        setExpShortage(preview.can_afford ? null : {
          required_exp: preview.required_exp,
          owned_exp: preview.owned_exp,
          need_more: preview.need_more,
          message: '经验结晶量不足'
        })
      }
    } catch (error) {
      console.error('加载升级预览失败', error)
    }
  }

  const getCharacterExpCrystalCount = () => {
    return Object.values(materials).reduce((total, material) => {
      const typeMatches = material.material_type === '角色经验结晶' || material.material_type === 'CHARACTER_EXP'
      return typeMatches ? total + material.count : total
    }, 0)
  }

  const getExclusiveMaterialCount = () => {
    return Object.values(materials).reduce((total, material) => {
      const typeMatches = material.material_type === '专属道具材料' || material.material_type === 'EXCLUSIVE_ITEM'
      return typeMatches ? total + material.count : total
    }, 0)
  }

  const getExclusiveMaterialHint = (required?: number) => {
    const need = required || 0
    if (need <= 0) return ''
    const owned = getExclusiveMaterialCount()
    return owned >= need ? `材料 ${owned}/${need}` : `材料不足 ${owned}/${need}`
  }

  const hasExclusiveMaterial = (required?: number) => {
    const need = required || 0
    return need <= 0 || getExclusiveMaterialCount() >= need
  }

  const maxLevelDelta = Math.max(1, maxCharacterLevel - character.level)
  const normalizedLevelDelta = Math.min(Math.max(expLevelDelta || 1, 1), maxLevelDelta)
  const sweepableExperienceDungeon = [...expDungeons]
    .sort((a, b) => (b.difficulty_order || 0) - (a.difficulty_order || 0))
    .find((dungeon) => dungeon.progress?.sweep_unlocked)
  const canSweepExperienceDungeon = Boolean(sweepableExperienceDungeon)

  const handleUseExp = async () => {
    const owned = getCharacterExpCrystalCount()
    if (isCharacterMaxLevel) return
    const amount = Math.min(Math.max(expAmount, 1), owned)
    if (amount <= 0) return
    try {
      setExpFeedback(null)
      setExpShortage(null)
      if (isFormalOnlineMode()) {
        const profile = await loadOnlineProfile(player)
        const response = await onlineApi.post(`/players/${profile.session.player.id}/characters/${character.character_id}/use-exp`, { amount })
        completeNewPlayerGuideStep('level_character')
        onCharacterUpdated(response.data.character)
        setMaterials({
          character_exp_crystal: {
            material_type: 'CHARACTER_EXP',
            attribute_type: null,
            count: Number(response.data.ownedExpPackages || 0),
          },
        })
        setExpFeedback(`已消耗 ${response.data.consumedExpPackages || amount} 个经验结晶和 ${response.data.consumedGold || 0} 金币`)
        window.dispatchEvent(new Event('gamer:resources-changed'))
        await loadExpPreview()
        return
      }

      const response = await axios.post(`/api/characters/${character.character_id}/use-exp`, { amount })
      if (response.data.success) {
        completeNewPlayerGuideStep('level_character')
        onCharacterUpdated(response.data.character)
        setMaterials(response.data.materials || {})
        setExpFeedback(`已消耗 ${amount} 个经验结晶`)
        window.dispatchEvent(new Event('gamer:resources-changed'))
      } else {
        setExpFeedback(response.data.message || '使用经验失败')
      }
    } catch (error: any) {
      const payload = error.response?.data || {}
      if (payload.need_more !== undefined) {
        setExpShortage({
          required_exp: payload.required_exp || amount,
          owned_exp: payload.owned_exp || owned,
          need_more: payload.need_more || 0,
          message: payload.message || '经验结晶量不足'
        })
      }
      setExpFeedback(getOnlineModeError(error, payload.message || '使用经验失败'))
    }
  }

  const handleUseExpByLevel = async () => {
    if (isCharacterMaxLevel) return
    try {
      setExpFeedback(null)
      if (isFormalOnlineMode()) {
        const profile = await loadOnlineProfile(player)
        const response = await onlineApi.post(`/players/${profile.session.player.id}/characters/${character.character_id}/use-exp`, {
          levelDelta: normalizedLevelDelta
        })
        completeNewPlayerGuideStep('level_character')
        onCharacterUpdated(mapOnlineCharacter(response.data.character))
        setMaterials({
          character_exp_crystal: {
            material_type: 'CHARACTER_EXP',
            attribute_type: null,
            count: Number(response.data.ownedExpPackages || 0),
          },
        })
        setExpShortage(null)
        setExpFeedback(`已提升到 Lv.${response.data.character.level}，消耗经验结晶 ${response.data.consumedExpPackages || 0} 和金币 ${response.data.consumedGold || 0}`)
        window.dispatchEvent(new Event('gamer:resources-changed'))
        await loadExpPreview()
        return
      }

      const response = await axios.post(`/api/characters/${character.character_id}/use-exp`, {
        level_delta: normalizedLevelDelta
      })
      if (response.data.success) {
        completeNewPlayerGuideStep('level_character')
        onCharacterUpdated(response.data.character)
        setMaterials(response.data.materials || {})
        setExpShortage(null)
        setExpFeedback(`已提升到 Lv.${response.data.character.level}`)
        window.dispatchEvent(new Event('gamer:resources-changed'))
      } else {
        setExpFeedback(response.data.message || '升级失败')
      }
    } catch (error: any) {
      const payload = error.response?.data || {}
      if (payload.need_more !== undefined) {
        setExpShortage({
          required_exp: payload.required_exp || expPreview?.required_exp || 0,
          owned_exp: payload.owned_exp || getCharacterExpCrystalCount(),
          need_more: payload.need_more || 0,
          message: payload.message || '经验结晶量不足'
        })
      }
      setExpFeedback(getOnlineModeError(error, payload.message || '升级失败'))
    }
  }

  const handleGoToExperience = () => {
    onNavigate('/dungeons')
    onClose()
  }

  const handleSweepExperience = async () => {
    if (!sweepableExperienceDungeon || sweepingExp) return
    try {
      setSweepingExp(true)
      if (isFormalOnlineMode()) {
        const profile = await loadOnlineProfile(player)
        const response = await onlineApi.post(`/dungeons/${profile.session.player.id}/${sweepableExperienceDungeon.dungeon_id}/sweep`, {
          characterId: character.character_id,
          count: 1,
        })
        setExpFeedback(`已扫荡 ${sweepableExperienceDungeon.name}，获得经验结晶 ${response.data?.rewards?.expCrystals || 0}、金币 ${response.data?.rewards?.gold || 0}`)
        window.dispatchEvent(new Event('gamer:resources-changed'))
        await loadMaterials()
        await loadExpPreview()
        return
      }
      const response = await axios.post(`/api/dungeons/${sweepableExperienceDungeon.dungeon_id}/sweep`, { count: 1 })
      if (response.data.success) {
        setExpFeedback(`已扫荡 ${sweepableExperienceDungeon.name}`)
        await loadMaterials()
        await loadExpPreview()
      } else {
        setExpFeedback(response.data.message || '扫荡失败')
      }
    } catch (error: any) {
      setExpFeedback(error.response?.data?.message || '扫荡失败')
    } finally {
      setSweepingExp(false)
    }
  }

  const getDefaultSkillSlots = (skills: SkillInfo[]) => ({
    low: skills.filter((skill) => skill.skill_tier === '底级别').slice(0, 5).map((skill) => skill.skill_id),
    mid: skills.filter((skill) => skill.skill_tier === '中级别').slice(0, 3).map((skill) => skill.skill_id),
    high: skills.filter((skill) => skill.skill_tier === '高级别').slice(0, 1).map((skill) => skill.skill_id)
  })

  const loadSkillConfig = async () => {
    if (isFormalOnlineMode()) {
      try {
        const profile = await loadOnlineProfile(player)
        const response = await onlineApi.get(`/players/${profile.session.player.id}/characters/${character.character_id}/skills`)
        const skills = (response.data?.unlockedSkills || []).map((skill: any) => ({
          skill_id: skill.skillId,
          name: skill.name,
          skill_logic: skill.logic,
          skill_tier: skill.tier,
          cooldown: skill.cooldown,
          skill_multiplier: skill.skillMultiplier,
          target_type: skill.targetType,
          description: skill.description,
        }))
        setUnlockedSkills(skills)
        setSkillSlots(response.data?.skillSlots || { low: [], mid: [], high: [] })
        setSkillFeedback('正式在线技能配置已加载，9 个技能槽从 1 级起开放。')
      } catch (error) {
        setSkillFeedback(getOnlineModeError(error, '加载技能配置失败'))
      }
      return
    }

    try {
      const response = await axios.get(`/api/characters/${character.character_id}/skills`)
      if (response.data.success) {
        const skills = response.data.unlocked_skills || []
        setUnlockedSkills(skills)
        const slots = response.data.skill_slots || { low: [], mid: [], high: [] }
        const hasSavedSlots = ['low', 'mid', 'high'].some((tier) => (slots[tier] || []).length > 0)
        setSkillSlots(hasSavedSlots ? {
          low: slots.low || [],
          mid: slots.mid || [],
          high: slots.high || []
        } : getDefaultSkillSlots(skills))
        setSkillFeedback(response.data.message || null)
      }
    } catch (error: any) {
      setSkillFeedback(error.response?.data?.message || '加载技能配置失败')
    }
  }

  const updateSkillSlot = (tier: 'low' | 'mid' | 'high', index: number, skillId: string) => {
    setSkillSlots(prev => {
      const next = { ...prev, [tier]: [...prev[tier]] }
      next[tier][index] = skillId
      return next
    })
  }

  const saveSkillConfig = async () => {
    if (isFormalOnlineMode()) {
      try {
        const profile = await loadOnlineProfile(player)
        const response = await onlineApi.post(`/players/${profile.session.player.id}/characters/${character.character_id}/skills`, { skillSlots })
        setSkillFeedback(response.data?.message || '技能配置已保存')
        if (response.data?.character) onCharacterUpdated(mapOnlineCharacter(response.data.character))
      } catch (error) {
        setSkillFeedback(getOnlineModeError(error, '技能配置保存失败'))
      }
      return
    }

    try {
      const response = await axios.post(`/api/characters/${character.character_id}/skills/config`, {
        skill_slots: skillSlots
      })
      if (response.data.success) {
        setSkillFeedback(response.data.message || '技能配置已保存')
        if (response.data.character) {
          onCharacterUpdated(response.data.character)
        }
      } else {
        setSkillFeedback(response.data.message || '技能配置保存失败')
      }
    } catch (error: any) {
      setSkillFeedback(error.response?.data?.message || '技能配置保存失败')
    }
  }

  const renderSkillSelectors = (tier: 'low' | 'mid' | 'high', label: string, count: number) => {
    const tierName = tier === 'low' ? '底级别' : tier === 'mid' ? '中级别' : '高级别'
    const options = unlockedSkills.filter((skill) => skill.skill_tier.toLowerCase() === tier || skill.skill_tier === tierName)
    return (
      <div className="skill-slot-group">
        <h4>{label}</h4>
        {Array.from({ length: count }).map((_, index) => (
          <select
            key={`${tier}_${index}`}
            value={skillSlots[tier][index] || ''}
            onChange={(event) => updateSkillSlot(tier, index, event.target.value)}
          >
            <option value="">请选择技能</option>
            {options.map((skill) => (
              <option key={skill.skill_id} value={skill.skill_id}>
                {skill.name} · {skill.skill_logic}
              </option>
            ))}
          </select>
        ))}
      </div>
    )
  }
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content character-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="header-left">
            <h2>{character.name}</h2>
            {character.star && (
              <div className="star-rating-large">
                {'★'.repeat(character.star)}{'☆'.repeat(5 - character.star)}
              </div>
            )}
          </div>
          <div className="header-right">
            <button
              className={`lock-btn-large ${character.is_locked ? 'locked' : ''}`}
              onClick={() => onLockToggle(character.character_id, character.is_locked || false)}
              title={character.is_locked ? '解锁' : '锁定'}
            >
              {character.is_locked ? '🔒' : '🔓'}
            </button>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
        </div>
        
        <div className="modal-body">
          {/* 立绘展示区域 */}
          <div className="illustration-section">
            <div className="illustration-container">
              <div
                className="illustration-placeholder"
                style={{ 
                  background: `linear-gradient(135deg, ${getAttributeColor(character.attribute_type)}22, ${getAttributeColor(character.attribute_type)}44)`,
                  borderColor: getAttributeColor(character.attribute_type)
                }}
              >
                {illustrationImagePath ? (
                  <img 
                    src={illustrationImagePath} 
                    alt={character.name}
                    className="illustration-image"
                  />
                ) : (
                  <div className="illustration-fallback">
                    <div
                      className="attribute-badge-large"
                      style={{ backgroundColor: getAttributeColor(character.attribute_type) }}
                    >
                      {character.attribute_type}
                    </div>
                    <p>{character.name}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* 标签页 */}
          <div className="detail-tabs">
            <button
              className={`tab-btn ${activeTab === 'info' ? 'active' : ''}`}
              onClick={() => setActiveTab('info')}
            >
              基本信息
            </button>
            <button
              className={`tab-btn ${activeTab === 'skills' ? 'active' : ''}`}
              onClick={() => setActiveTab('skills')}
            >
              技能
            </button>
            <button
              className={`tab-btn ${activeTab === 'equipment' ? 'active' : ''}`}
              onClick={() => setActiveTab('equipment')}
            >
              装备
            </button>
            <button
              className={`tab-btn ${activeTab === 'illustration' ? 'active' : ''}`}
              onClick={() => setActiveTab('illustration')}
            >
              立绘
            </button>
            <button
              className={`tab-btn ${activeTab === 'battle-soul' ? 'active' : ''}`}
              onClick={() => setActiveTab('battle-soul')}
            >
              战魂
            </button>
          </div>
          
          {/* 基本信息标签页 */}
          {activeTab === 'info' && (
            <>
              <div className="character-detail-main">
                <div className="detail-info">
                  <div className="info-row">
                    <span className="info-label">职业：</span>
                    <span>{character.profession_type}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">属性：</span>
                    <span>{character.attribute_type}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">等级：</span>
                    <span>Lv.{character.level} / {maxCharacterLevel}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">经验：</span>
                    <span>{isCharacterMaxLevel ? 'MAX' : `${character.exp} / ${expToNextLevel}`}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">武器：</span>
                    <span>{character.equipment_summary?.weapon_name || '未装备'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">装备：</span>
                    <span>{character.equipment_summary?.equipped_piece_count || 0} / 6</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">技能：</span>
                    <span>{character.skill_summary?.total_configured || 0} / 9</span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3>等级培养</h3>
                <div className="growth-panel">
                  <div className="growth-summary">
                    <span>通用角色经验结晶</span>
                    <strong>{getCharacterExpCrystalCount()} / {expPreview?.max_crystals || 999999999}</strong>
                  </div>
                  <div className="growth-exp-bar">
                    <div style={{ width: `${isCharacterMaxLevel ? 100 : expProgressPercent}%` }} />
                    <span>{isCharacterMaxLevel ? '满级' : `${expProgressPercent}%`}</span>
                  </div>
                  <div className="growth-control-grid">
                    <div className="growth-control">
                      <label>自定义升几级</label>
                      <div className="growth-actions">
                        <input
                          type="number"
                          min={1}
                          max={maxLevelDelta}
                          value={normalizedLevelDelta}
                          onChange={(event) => setExpLevelDelta(Number(event.target.value))}
                          disabled={isCharacterMaxLevel}
                        />
                        <button
                          onClick={handleUseExpByLevel}
                          disabled={isCharacterMaxLevel || !expPreview || !expPreview.can_afford}
                        >
                          升级
                        </button>
                      </div>
                      <small>
                        目标 Lv.{expPreview?.target_level || Math.min(character.level + normalizedLevelDelta, maxCharacterLevel)}
                        ，需要 {expPreview?.required_exp || 0}
                      </small>
                    </div>
                    <div className="growth-control">
                      <label>总量滑块</label>
                      <input
                        className="growth-slider"
                        type="range"
                        min={0}
                        max={Math.max(getCharacterExpCrystalCount(), 1)}
                        value={Math.min(expAmount, Math.max(getCharacterExpCrystalCount(), 1))}
                        onChange={(event) => setExpAmount(Number(event.target.value))}
                        disabled={isCharacterMaxLevel || getCharacterExpCrystalCount() <= 0}
                      />
                      <div className="growth-actions">
                        <input
                          type="number"
                          min={1}
                          max={Math.max(getCharacterExpCrystalCount(), 1)}
                          value={expAmount}
                          onChange={(event) => setExpAmount(Number(event.target.value))}
                          disabled={isCharacterMaxLevel}
                        />
                        <button onClick={handleUseExp} disabled={getCharacterExpCrystalCount() <= 0 || isCharacterMaxLevel}>
                          使用
                        </button>
                      </div>
                    </div>
                  </div>
                  {expFeedback && <div className="growth-feedback">{expFeedback}</div>}
                  {expShortage && (
                    <div className="growth-shortage">
                      <span>{expShortage.message}：还差 {expShortage.need_more}，当前 {expShortage.owned_exp} / 需要 {expShortage.required_exp}</span>
                      <div className="growth-shortage-actions">
                        <button onClick={handleGoToExperience}>前往获取经验</button>
                        <button
                          onClick={handleSweepExperience}
                          disabled={!canSweepExperienceDungeon || sweepingExp}
                          title={canSweepExperienceDungeon ? `扫荡 ${sweepableExperienceDungeon?.name}` : '尚未解锁经验本扫荡'}
                        >
                          {sweepingExp ? '扫荡中...' : '扫荡'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {character.stats && (
                <div className="detail-section">
                  <h3>属性明细</h3>
                  <div className="stat-compare-table">
                    <div className="stat-compare-head">
                      <span>属性</span>
                      <span>基础</span>
                      <span>装备</span>
                      <span>最终</span>
                    </div>
                    {statRows.map(({ key, label }) => (
                      <div key={key} className="stat-compare-row">
                        <span>{label}</span>
                        <span>{character.base_stats?.[key] || 0}</span>
                        <span className={(character.equipment_bonus?.[key] || 0) > 0 ? 'stat-bonus' : ''}>
                          +{character.equipment_bonus?.[key] || 0}
                        </span>
                        <strong>{character.stats?.[key] || 0}</strong>
                      </div>
                    ))}
                  </div>
                  {configuredSkills.length > 0 && (
                    <div className="configured-skill-strip">
                      {configuredSkills.map((skill) => (
                        <span key={skill.skill_id}>{skill.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          
          {/* 技能标签页 */}
          {activeTab === 'skills' && (
            <div className="detail-section">
              <h3>9格技能配置</h3>
              {skillFeedback && <div className="skill-config-feedback">{skillFeedback}</div>}
              <div className="skill-config-grid">
                {renderSkillSelectors('low', '底级别技能 5格', 5)}
                {renderSkillSelectors('mid', '中级别技能 3格', 3)}
                {renderSkillSelectors('high', '高级别技能 1格', 1)}
              </div>
              <button className="save-skill-config-btn" onClick={saveSkillConfig}>
                保存技能配置
              </button>
              <div className="skills-detail-list">
                {unlockedSkills.map((skill) => (
                  <div key={skill.skill_id} className="skill-detail-card">
                    <div className="skill-icon">
                      <span>{skill.skill_tier.slice(0, 1)}</span>
                    </div>
                    <div className="skill-info">
                      <h4 className="skill-name">{skill.name}</h4>
                      <p className="skill-description">{skill.description}</p>
                      <div className="skill-meta">
                        <span className="skill-cooldown">{skill.skill_logic}</span>
                        <span className="skill-cost">{skill.target_type}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* 装备标签页 */}
          {activeTab === 'equipment' && (
            <div className="detail-section">
              <h3>装备</h3>
              {equipmentFeedback && <div className="equipment-feedback">{equipmentFeedback}</div>}
              {character.equipment ? (
                <div className="equipment-detail-list">
                  {character.equipment.weapon && (
                    <div className="equipment-detail-card">
                      <div className="equipment-icon">⚔️</div>
                      <div className="equipment-info">
                        <h4>{character.equipment.weapon.name || '未装备'}</h4>
                        <p>
                          专属武器 · Lv.{character.equipment.weapon.level || 0}
                          {getExclusiveInfo(character.equipment.weapon).max_level ? ` / ${getExclusiveInfo(character.equipment.weapon).max_level}` : ''}
                          {getExclusiveInfo(character.equipment.weapon).breakthrough_level !== undefined ? ` · 突破+${getExclusiveInfo(character.equipment.weapon).breakthrough_level}` : ''}
                        </p>
                        {getExclusiveInfo(character.equipment.weapon).bound_character_name && (
                          <p>绑定：{getExclusiveInfo(character.equipment.weapon).bound_character_name}</p>
                        )}
                        <p>{formatStats(character.equipment.weapon.stats)}</p>
                        <div className="exclusive-weapon-actions">
                          <button
                            className="equipment-action-btn"
                            onClick={() => handleUnequipItem(character.equipment?.weapon?.item_id, 'weapon')}
                          >
                            卸下
                          </button>
                          <button
                            className="equipment-action-btn"
                            onClick={() => handleExclusiveWeaponUpgrade(character.equipment?.weapon?.item_id)}
                            disabled={
                              !getExclusiveInfo(character.equipment.weapon).can_upgrade ||
                              !hasExclusiveMaterial(getExclusiveInfo(character.equipment.weapon).upgrade_cost) ||
                              weaponActionItemId === character.equipment.weapon.item_id
                            }
                          >
                            升级{getExclusiveInfo(character.equipment.weapon).upgrade_cost ? `(${getExclusiveInfo(character.equipment.weapon).upgrade_cost})` : ''}
                          </button>
                          <button
                            className="equipment-action-btn"
                            onClick={() => handleExclusiveWeaponBreakthrough(character.equipment?.weapon?.item_id)}
                            disabled={
                              !getExclusiveInfo(character.equipment.weapon).can_breakthrough ||
                              !hasExclusiveMaterial(getExclusiveInfo(character.equipment.weapon).breakthrough_cost) ||
                              weaponActionItemId === character.equipment.weapon.item_id
                            }
                          >
                            突破{getExclusiveInfo(character.equipment.weapon).breakthrough_cost ? `(${getExclusiveInfo(character.equipment.weapon).breakthrough_cost})` : ''}
                          </button>
                        </div>
                        {(getExclusiveInfo(character.equipment.weapon).upgrade_cost || getExclusiveInfo(character.equipment.weapon).breakthrough_cost) && (
                          <p className={!hasExclusiveMaterial(getExclusiveInfo(character.equipment.weapon).can_upgrade ? getExclusiveInfo(character.equipment.weapon).upgrade_cost : getExclusiveInfo(character.equipment.weapon).breakthrough_cost) ? 'material-warning' : 'material-ok'}>
                            {getExclusiveMaterialHint(getExclusiveInfo(character.equipment.weapon).can_upgrade ? getExclusiveInfo(character.equipment.weapon).upgrade_cost : getExclusiveInfo(character.equipment.weapon).breakthrough_cost)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {character.equipment.equipment_set?.name && (
                    <div className="equipment-detail-card">
                      <div className="equipment-icon">🛡️</div>
                      <div className="equipment-info">
                        <h4>{character.equipment.equipment_set.name || '未装备'}</h4>
                        <p>套装</p>
                      </div>
                    </div>
                  )}
                  <div className="equipment-slot-grid">
                    {equipmentSlots.map((slot) => {
                      const piece = equippedBySlot.get(slot)
                      return (
                        <div key={slot} className={`equipment-slot-card ${piece ? 'equipped' : ''}`}>
                          <div>
                            <h4>{slot}</h4>
                            <strong>{piece ? (piece.name || piece.item_name || '已装备') : '未装备'}</strong>
                            <p>{piece ? `Lv.${piece.level || 0} · ${formatStats(piece.stats)}` : '空槽位'}</p>
                          </div>
                          {piece && (
                            <button
                              className="equipment-action-btn"
                              onClick={() => handleUnequipItem(piece.item_id, 'equipment', slot)}
                            >
                              卸下
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* 战魂选项 */}
                  {battleSoulInfo && (
                    <div className="equipment-detail-card battle-soul-card">
                      <div className="equipment-icon">⭐</div>
                      <div className="equipment-info">
                        <h4>战魂等级: {battleSoulInfo.level}级</h4>
                        <p>属性加成: {(battleSoulInfo.bonus * 100).toFixed(0)}%</p>
                        {battleSoulInfo.level < battleSoulInfo.max_level ? (
                          <div className="battle-soul-upgrade-info">
                            <p>当前精华: {battleSoulInfo.essence_count}</p>
                            <p>升级需要: {battleSoulInfo.upgrade_cost} 精华</p>
                            <button
                              className={`btn-upgrade ${battleSoulInfo.can_upgrade ? '' : 'disabled'}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleBattleSoulUpgrade()
                              }}
                              disabled={!battleSoulInfo.can_upgrade || upgrading}
                            >
                              {upgrading ? '升级中...' : '升级战魂'}
                            </button>
                          </div>
                        ) : (
                          <p className="max-level">已满级</p>
                        )}
                      </div>
                    </div>
                  )}
                  {(!character.equipment?.weapon && !character.equipment?.equipment_set && !battleSoulInfo) && (
                    <p className="no-equipment">暂无装备</p>
                  )}
                </div>
              ) : (
                <div className="equipment-detail-list">
                  {battleSoulInfo && (
                    <div className="equipment-detail-card battle-soul-card">
                      <div className="equipment-icon">⭐</div>
                      <div className="equipment-info">
                        <h4>战魂等级: {battleSoulInfo.level}级</h4>
                        <p>属性加成: {(battleSoulInfo.bonus * 100).toFixed(0)}%</p>
                        {battleSoulInfo.level < battleSoulInfo.max_level ? (
                          <div className="battle-soul-upgrade-info">
                            <p>当前精华: {battleSoulInfo.essence_count}</p>
                            <p>升级需要: {battleSoulInfo.upgrade_cost} 精华</p>
                            <button
                              className={`btn-upgrade ${battleSoulInfo.can_upgrade ? '' : 'disabled'}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleBattleSoulUpgrade()
                              }}
                              disabled={!battleSoulInfo.can_upgrade || upgrading}
                            >
                              {upgrading ? '升级中...' : '升级战魂'}
                            </button>
                          </div>
                        ) : (
                          <p className="max-level">已满级</p>
                        )}
                      </div>
                    </div>
                  )}
                  {!battleSoulInfo && <p className="no-equipment">暂无装备</p>}
                </div>
              )}

              <div className="equipment-options">
                <h4>可穿戴武器</h4>
                {equipmentOptions.weapons.length === 0 ? (
                  <p className="no-equipment">暂无可穿戴武器</p>
                ) : (
                  <div className="equipment-option-list">
                    {equipmentOptions.weapons.map((item) => (
                      <div key={item.item_id} className="equipment-option-row">
                        <div className="equipment-option-main">
                          <span>{item.item_name}</span>
                          <small>
                            Lv.{item.level || 0}
                            {getExclusiveInfo(item).max_level ? ` / ${getExclusiveInfo(item).max_level}` : ''}
                            {getExclusiveInfo(item).breakthrough_level !== undefined ? ` · 突破+${getExclusiveInfo(item).breakthrough_level}` : ''}
                            {getExclusiveInfo(item).bound_character_name ? ` · 绑定${getExclusiveInfo(item).bound_character_name}` : ''}
                          </small>
                        </div>
                        <div className="equipment-option-actions">
                          <button
                            onClick={() => handleEquipItem(item.item_id)}
                            disabled={!item.can_equip || item.is_current_character_equipped}
                          >
                            {item.is_current_character_equipped ? '已穿戴' : '穿戴'}
                          </button>
                          <button
                            onClick={() => handleExclusiveWeaponUpgrade(item.item_id)}
                            disabled={
                              !getExclusiveInfo(item).can_upgrade ||
                              !hasExclusiveMaterial(getExclusiveInfo(item).upgrade_cost) ||
                              weaponActionItemId === item.item_id
                            }
                          >
                            升级
                          </button>
                          <button
                            onClick={() => handleExclusiveWeaponBreakthrough(item.item_id)}
                            disabled={
                              !getExclusiveInfo(item).can_breakthrough ||
                              !hasExclusiveMaterial(getExclusiveInfo(item).breakthrough_cost) ||
                              weaponActionItemId === item.item_id
                            }
                          >
                            突破
                          </button>
                        </div>
                        {(getExclusiveInfo(item).upgrade_cost || getExclusiveInfo(item).breakthrough_cost) && (
                          <small className={!hasExclusiveMaterial(getExclusiveInfo(item).can_upgrade ? getExclusiveInfo(item).upgrade_cost : getExclusiveInfo(item).breakthrough_cost) ? 'material-warning' : 'material-ok'}>
                            {getExclusiveMaterialHint(getExclusiveInfo(item).can_upgrade ? getExclusiveInfo(item).upgrade_cost : getExclusiveInfo(item).breakthrough_cost)}
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <h4>可穿戴装备</h4>
                {equipmentOptions.equipment.length === 0 ? (
                  <p className="no-equipment">暂无可穿戴装备</p>
                ) : (
                  <div className="equipment-option-list">
                    {equipmentOptions.equipment.map((item) => (
                      <div key={item.item_id} className="equipment-option-row">
                        <div className="equipment-option-main">
                          <span>{item.item_name}</span>
                          <small>{item.slot || item.item_data?.slot || '装备'} · Lv.{item.level || 0}</small>
                        </div>
                        <div className="equipment-option-actions">
                          <button
                            onClick={() => handleEquipItem(item.item_id)}
                            disabled={item.is_current_character_equipped}
                          >
                            {item.is_current_character_equipped ? '已穿戴' : '穿戴'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 立绘标签页 */}
          {activeTab === 'illustration' && (
            <div className="detail-section">
              <h3>立绘兑换</h3>
              {illustrationFeedback && <div className="illustration-feedback">{illustrationFeedback}</div>}
              <div className="illustration-status-panel">
                <div>
                  <span>立绘碎片</span>
                  <strong>{illustrationStatus?.material_count ?? 0}</strong>
                </div>
                <div>
                  <span>兑换消耗</span>
                  <strong>{illustrationStatus?.cost ?? 100}</strong>
                </div>
                <div>
                  <span>当前选择</span>
                  <strong>{illustrationStatus?.character?.selected === 'female' ? '女立绘' : illustrationStatus?.character?.selected === 'male' ? '男立绘' : '未选择'}</strong>
                </div>
              </div>
              <div className="illustration-option-grid">
                {(illustrationStatus?.character?.options || []).map((option) => {
                  const selected = illustrationStatus?.character?.selected_id === option.illustration_id
                  const canExchange = option.unlocked || (illustrationStatus?.material_count || 0) >= (illustrationStatus?.cost || 100)
                  return (
                    <div key={option.illustration_id} className={`illustration-option-card ${selected ? 'selected' : ''}`}>
                      <h4>{option.name}</h4>
                      <p>{option.unlocked ? '已解锁，可随时切换' : `需要${illustrationStatus?.cost ?? 100}个立绘拼图碎片`}</p>
                      <button
                        className="illustration-action-btn"
                        onClick={() => exchangeIllustration(option)}
                        disabled={!canExchange || exchangingIllustrationId === option.illustration_id || selected}
                      >
                        {selected
                          ? '使用中'
                          : exchangingIllustrationId === option.illustration_id
                            ? '处理中...'
                            : option.unlocked ? '切换' : '兑换'}
                      </button>
                    </div>
                  )
                })}
                {(illustrationStatus?.character?.options || []).length === 0 && (
                  <p className="no-equipment">暂无立绘选项</p>
                )}
              </div>
              {(illustrationStatus?.material_count || 0) < (illustrationStatus?.cost || 100) && (
                <div className="illustration-shortage">
                  立绘碎片不足。
                  <button onClick={() => onNavigate('/dungeons')}>前往立绘本</button>
                  <button onClick={() => onNavigate('/shop')}>前往活动商店</button>
                </div>
              )}
            </div>
          )}
          
          {/* 战魂标签页 */}
          {activeTab === 'battle-soul' && (
            <div className="detail-section">
              <h3>战魂</h3>
              {battleSoulInfo ? (
                <div className="battle-soul-detail">
                  <div className="battle-soul-status">
                    <div className="status-item">
                      <span className="status-label">当前等级：</span>
                      <span className="status-value">{battleSoulInfo.level} / {battleSoulInfo.max_level}</span>
                    </div>
                    <div className="status-item">
                      <span className="status-label">属性加成：</span>
                      <span className="status-value">{(battleSoulInfo.bonus * 100).toFixed(0)}%</span>
                    </div>
                    <div className="status-item">
                      <span className="status-label">当前精华：</span>
                      <span className="status-value">{battleSoulInfo.essence_count}</span>
                    </div>
                    {battleSoulInfo.level < battleSoulInfo.max_level && (
                      <div className="status-item">
                        <span className="status-label">升级需要：</span>
                        <span className="status-value">{battleSoulInfo.upgrade_cost} 精华</span>
                      </div>
                    )}
                  </div>
                  {battleSoulInfo.level < battleSoulInfo.max_level ? (
                    <div className="battle-soul-upgrade-section">
                      <button
                        className={`btn-upgrade-large ${battleSoulInfo.can_upgrade ? '' : 'disabled'}`}
                        onClick={handleBattleSoulUpgrade}
                        disabled={!battleSoulInfo.can_upgrade || upgrading}
                      >
                        {upgrading ? '升级中...' : `升级到 ${battleSoulInfo.level + 1} 级`}
                      </button>
                      {!battleSoulInfo.can_upgrade && (
                        <p className="upgrade-hint">精华不足，无法升级</p>
                      )}
                    </div>
                  ) : (
                    <div className="battle-soul-max-level">
                      <p>🎉 战魂已达到最高等级！</p>
                      <p>属性加成: 100%</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="no-battle-soul">暂无战魂数据</p>
              )}
            </div>
          )}
          
          {/* 操作按钮区域 */}
          <div className="action-buttons">
            <button
              className="action-btn enhance-btn"
              onClick={() => {
                onNavigate('/enhancement')
                onClose()
              }}
            >
              强化
            </button>
            <button
              className="action-btn breakthrough-btn"
              onClick={() => {
                onNavigate('/enhancement')
                onClose()
              }}
            >
              突破
            </button>
            <button
              className="action-btn skill-btn"
              onClick={() => {
                // TODO: 跳转到技能升级页面
                alert('技能升级功能开发中')
              }}
            >
              技能升级
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CharacterPage
