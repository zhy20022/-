import { getProfessionLabel } from '../services/professionLabels'
import React, { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { completeNewPlayerGuideStep } from '../services/newPlayerGuide'
import { isExperienceSupportRole, isExperienceRoleWarningMuted, muteExperienceRoleWarningToday } from '../services/experienceRoleWarning'
import { useAuthStore } from '../stores/authStore'
import { createIdempotencyKey, getOnlineModeError, isFormalOnlineMode, loadOnlineDungeons, onlineApi } from '../services/onlineGameAdapter'
import './DungeonPage.css'
import '../components/DungeonRoster.css'
import ElementBadge from '../components/ElementBadge'
import { elementThemeStyle, getAttributeColor } from '../services/elementTheme'
import { safeErrorLog } from '../services/safeErrorLog'
import { compareCharactersByNumber, getCharacterNumber, CharacterNumberSource } from '../services/characterCatalog'
import { SeasonTabs } from '../components/SeasonTabs'
import { getSeasonNumber } from '../services/seasons'
import { EQUIPMENT_SLOTS, equipmentPieces } from '../services/characterEquipment'
import { Shield, Swords } from 'lucide-react'

interface DungeonProgress {
  completion_count: number
  total_attempts: number
  sweep_unlocked: boolean
  sweep_unlock_count?: number
  best_record: {
    duration?: number
    rewards?: any
  }
}

interface Dungeon {
  season?: number
  dungeon_id: string
  name: string
  dungeon_type: string
  attribute_type: string
  is_unlocked: boolean
  description?: string
  duration?: number
  difficulty?: string
  difficulty_key?: string
  difficulty_order?: number
  recommended_level_bonus?: number
  monster_multiplier?: number
  reward_multiplier?: number
  difficulty_unlock?: string
  reward_config?: any
  monster_config?: any
  boss_config?: BossConfigPayload
  recommendation?: DungeonRecommendation
  reward_preview?: DungeonRewardPreview
  boss_summary?: DungeonBossSummary
  progress_summary?: DungeonProgressSummary
  progress?: DungeonProgress
}

interface Character extends CharacterNumberSource {
  character_id: string
  name: string
  profession_type: string
  attribute_type: string
  level: number
  star?: number
  equipment?: Record<string, any>
  stats?: Record<string, number>
}

type BossSkillTier = 'low' | 'mid' | 'high'

interface BossMechanicOption {
  mechanic_id: string
  boss_count: number
  shared_health: boolean
  sequential_activation: boolean
  mutual_strengthen: boolean
  strengthen_multiplier?: number
  description: string
}

interface BossConfigPayload {
  boss_type: string
  mechanic: BossMechanicOption
  skill_slots: Record<BossSkillTier, string[]>
  total_slots: number
  source: 'custom' | 'default' | string
}

interface DungeonRecommendation {
  recommended_level: number
  recommended_attribute: string
  enemy_attribute: string
  attribute_hint: string
  party_size: number
  formation: Array<{
    role: string
    count: number
  }>
  summary: string
  roster_status?: {
    matching_attribute_count: number
    recommended_level_ready_count: number
    max_level_count: number
    party_size: number
    ready: boolean
    hint: string
  }
}

interface DungeonRewardPreview {
  reward_type: string
  title: string
  main: string
  details: string[]
  thresholds: Array<{
    label: string
    amount: number
  }>
}

interface DungeonBossSummary {
  boss_type: string
  type_label: string
  mechanic_id: string
  description: string
  boss_count: number
  flags: string[]
  slot_total: number
  top_skills: Array<{
    skill_id: string
    name: string
    effect_tags?: string[]
  }>
}

interface DungeonProgressSummary {
  completion_count: number
  total_attempts: number
  best_time_text: string
  best_reward_text: string
  sweep_unlocked: boolean
  sweep_text: string
  sweep_unlock_count: number
}

type TabType = 'SINGLE' | 'SQUAD' | 'TEAM' | 'SERVER_BOSS' | 'ALL'
type FilterAttribute = 'FIRE' | 'WATER' | 'WIND' | 'EARTH' | 'LIGHT' | 'DARK' | 'THUNDER' | 'WOOD' | 'ALL'
type FilterDifficulty = 'normal' | 'hard' | 'nightmare' | 'ALL'

const normalizeDungeonType = (type: string) => {
  const typeMap: Record<string, Exclude<TabType, 'ALL'>> = {
    SINGLE: 'SINGLE',
    SQUAD: 'SQUAD',
    TEAM: 'TEAM',
    SERVER_BOSS: 'SERVER_BOSS',
    '1人本': 'SINGLE',
    '5人本': 'SQUAD',
    '20人本': 'TEAM',
    '世界boss本': 'SERVER_BOSS'
  }
  return typeMap[type] || type
}

const normalizeAttribute = (attribute: string) => {
  const attributeMap: Record<string, Exclude<FilterAttribute, 'ALL'>> = {
    FIRE: 'FIRE',
    WATER: 'WATER',
    WIND: 'WIND',
    EARTH: 'EARTH',
    LIGHT: 'LIGHT',
    DARK: 'DARK',
    THUNDER: 'THUNDER',
    WOOD: 'WOOD',
    火: 'FIRE',
    水: 'WATER',
    风: 'WIND',
    土: 'EARTH',
    光: 'LIGHT',
    暗: 'DARK',
    雷: 'THUNDER',
    木: 'WOOD'
  }
  return attributeMap[attribute] || attribute
}

const normalizeDifficulty = (difficulty?: string) => {
  const difficultyMap: Record<string, Exclude<FilterDifficulty, 'ALL'>> = {
    normal: 'normal',
    hard: 'hard',
    nightmare: 'nightmare',
    普通: 'normal',
    困难: 'hard',
    噩梦: 'nightmare'
  }
  return difficultyMap[difficulty || ''] || 'normal'
}
const getAttributeName = (attribute: string) => ({
  WATER: '水', EARTH: '土', THUNDER: '雷', WIND: '风',
  FIRE: '火', WOOD: '木', LIGHT: '光', DARK: '暗',
}[normalizeAttribute(attribute)] || attribute)

const DungeonPage: React.FC = () => {
  const navigate = useNavigate()
  const { player } = useAuthStore()
  const [dungeons, setDungeons] = useState<Dungeon[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [selectedDungeon, setSelectedDungeon] = useState<Dungeon | null>(null)
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([])
  const [showCharacterSelect, setShowCharacterSelect] = useState(false)
  const [showRoleWarning, setShowRoleWarning] = useState(false)
  const [muteRoleWarning, setMuteRoleWarning] = useState(false)
  const startingBattle = useRef(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const dungeonLoadRequestRef = useRef(0)
  const characterLoadRequestRef = useRef(0)
  const mountedRef = useRef(true)
  
  // 标签页和筛选状态
  const [activeTab, setActiveTab] = useState<TabType>('ALL')
  const [filterAttribute, setFilterAttribute] = useState<FilterAttribute>('ALL')
  const [filterDifficulty, setFilterDifficulty] = useState<FilterDifficulty>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [difficultyOptions, setDifficultyOptions] = useState<Dungeon[] | null>(null)

  useEffect(() => {
    mountedRef.current = true
    loadDungeons()
    loadCharacters()
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadDungeons = async () => {
    const requestId = dungeonLoadRequestRef.current + 1
    dungeonLoadRequestRef.current = requestId
    try {
      setLoadError(null)
      setLoading(true)
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineDungeons(player)
        if (!Array.isArray(payload.dungeons)) {
          throw new Error('副本数据加载失败')
        }
        if (!mountedRef.current || requestId !== dungeonLoadRequestRef.current) return
        setDungeons(payload.dungeons)
        setCharacters(payload.characters)
        return
      }

      const response = await axios.get('/api/dungeons')
      if (!response.data?.success || !Array.isArray(response.data?.dungeons)) {
        throw new Error(response.data?.message || '副本数据加载失败')
      }
      if (!mountedRef.current || requestId !== dungeonLoadRequestRef.current) return
      setDungeons(response.data.dungeons)
    } catch (error) {
      safeErrorLog('dungeon.list', error)
      if (mountedRef.current && requestId === dungeonLoadRequestRef.current) {
        setLoadError(getOnlineModeError(error, '副本加载失败，请稍后重试'))
      }
    } finally {
      if (mountedRef.current && requestId === dungeonLoadRequestRef.current) setLoading(false)
    }
  }

  const loadCharacters = async () => {
    if (isFormalOnlineMode()) return
    const requestId = characterLoadRequestRef.current + 1
    characterLoadRequestRef.current = requestId
    try {
      const response = await axios.get('/api/characters')
      if (response.data.success) {
        if (!mountedRef.current || requestId !== characterLoadRequestRef.current) return
        setCharacters(response.data.characters)
      } else {
        throw new Error(response.data.message || '角色数据加载失败')
      }
    } catch (error) {
      safeErrorLog('dungeon.characters', error)
      if (mountedRef.current && requestId === characterLoadRequestRef.current) {
        setLoadError(getOnlineModeError(error, '角色加载失败，请稍后重试'))
      }
    }
  }

  const handleStartDungeon = (dungeon: Dungeon) => {
    const variants = dungeons.filter((entry) => normalizeDungeonType(entry.dungeon_type) === 'SINGLE'
      && normalizeAttribute(entry.attribute_type) === normalizeAttribute(dungeon.attribute_type))
      .sort((a, b) => (a.difficulty_order || 1) - (b.difficulty_order || 1))
    if (normalizeDungeonType(dungeon.dungeon_type) === 'SINGLE' && variants.length > 1) {
      setDifficultyOptions(variants)
      return
    }
    enterDungeon(dungeon)
  }

  const enterDungeon = (dungeon: Dungeon) => {
    setSelectedCharacters([])
    if (isFormalOnlineMode() || normalizeDungeonType(dungeon.dungeon_type) === 'SINGLE') {
      // 单人副本，直接选择角色
      setSelectedDungeon(dungeon)
      setShowCharacterSelect(true)
    } else {
      // 多人副本，跳转到多人房间
      navigate('/dungeons/multiplayer', { state: { dungeon_id: dungeon.dungeon_id } })
    }
  }

  const handleConfirmStart = async (roleConfirmed = false) => {
    if (startingBattle.current) return
    if (!selectedDungeon || selectedCharacters.length === 0) {
      alert('请选择角色')
      return
    }

    const expectedCount = normalizeDungeonType(selectedDungeon.dungeon_type) === 'SINGLE' ? 1
      : normalizeDungeonType(selectedDungeon.dungeon_type) === 'SQUAD' ? 5 : 20
    if (isFormalOnlineMode() && selectedCharacters.length !== expectedCount) {
      alert(`该副本需要选择${expectedCount}名角色，当前已选择${selectedCharacters.length}名`)
      return
    }

    const selectedCharacter = characters.find((item) => selectedCharacters.includes(item.character_id))
    if (!roleConfirmed && normalizeDungeonType(selectedDungeon.dungeon_type) === 'SINGLE'
      && selectedCharacter && isExperienceSupportRole(selectedCharacter.profession_type)
      && !isExperienceRoleWarningMuted(player?.player_id)) {
      setMuteRoleWarning(false)
      setShowRoleWarning(true)
      return
    }

    startingBattle.current = true
    try {
      if (isFormalOnlineMode()) {
        const character = characters.find((item: Character) => selectedCharacters.includes(item.character_id))
        if (!character) {
          alert('请选择当前在线账号拥有的角色')
          return
        }
        const playerId = player?.player_id
        if (!playerId) throw new Error('请重新登录')
        const startResponse = await onlineApi.post(`/dungeons/${playerId}/${selectedDungeon.dungeon_id}/start`, { characterIds: selectedCharacters }, {
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        })
        completeNewPlayerGuideStep('learn_dungeons')
        if (normalizeDungeonType(selectedDungeon.dungeon_type) === 'SINGLE') {
          completeNewPlayerGuideStep('run_exp_dungeon')
        }
        navigate('/battle', {
          state: {
            online_mode: true,
            player_id: playerId,
            dungeon_id: selectedDungeon.dungeon_id,
            dungeon: selectedDungeon,
            character_ids: selectedCharacters,
            characters: selectedCharacters.map(id => characters.find((item: Character) => item.character_id === id)).filter(Boolean),
            settlement_key: startResponse.data.battleSeed,
          }
        })
        return
      }

      const response = await axios.post(`/api/dungeons/${selectedDungeon.dungeon_id}/start`, {
        character_ids: selectedCharacters
      })
      if (response.data.success) {
        completeNewPlayerGuideStep('learn_dungeons')
        const isExperienceDungeon = selectedDungeon.reward_config?.type === 'experience' || selectedDungeon.dungeon_id.toLowerCase().includes('exp')
        if (normalizeDungeonType(selectedDungeon.dungeon_type) === 'SINGLE' && isExperienceDungeon) {
          completeNewPlayerGuideStep('run_exp_dungeon')
        }
        navigate('/battle', {
          state: {
            battle_id: response.data.battle_id,
            dungeon_id: selectedDungeon.dungeon_id,
            character_ids: selectedCharacters
          }
        })
      }
    } catch (error: any) {
      alert(getOnlineModeError(error, error.response?.data?.message || '开始副本失败'))
    } finally {
      startingBattle.current = false
    }
  }

  const handleRoleWarningDecision = (proceed: boolean) => {
    if (muteRoleWarning) muteExperienceRoleWarningToday(player?.player_id)
    setShowRoleWarning(false)
    if (proceed) void handleConfirmStart(true)
  }

  const handleCharacterToggle = (characterId: string) => {
    if (selectedCharacters.includes(characterId)) {
      setSelectedCharacters(selectedCharacters.filter(id => id !== characterId))
    } else {
      // 单人副本只能选1个角色
      if (normalizeDungeonType(selectedDungeon?.dungeon_type || '') === 'SINGLE') {
        setSelectedCharacters([characterId])
      } else {
        setSelectedCharacters([...selectedCharacters, characterId])
      }
    }
  }

  // 筛选和排序后的副本列表
  const filteredAndSortedDungeons = useMemo(() => {
    let filtered = dungeons.filter(dungeon => getSeasonNumber(dungeon) === 1)
    
    // 标签页筛选
    if (activeTab !== 'ALL') {
      filtered = filtered.filter(d => normalizeDungeonType(d.dungeon_type) === activeTab)
    }
    
    // 属性筛选
    if (filterAttribute !== 'ALL') {
      filtered = filtered.filter(d => normalizeAttribute(d.attribute_type) === filterAttribute)
    }

    if (filterDifficulty !== 'ALL') {
      filtered = filtered.filter(d => normalizeDifficulty(d.difficulty_key || d.difficulty) === filterDifficulty)
    }
    
    // 搜索筛选
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(d => 
        d.name.toLowerCase().includes(query)
      )
    }
    
    // 排序：按照属性顺序（水、土、雷、风、火、木、光、暗），然后按照副本类型顺序（1人本、5人本、20人本、世界boss本）
    const attributeOrder: Record<string, number> = {
      'WATER': 1,
      'EARTH': 2,
      'THUNDER': 3,
      'WIND': 4,
      'FIRE': 5,
      'WOOD': 6,
      'LIGHT': 7,
      'DARK': 8
    }
    
    const dungeonTypeOrder: Record<string, number> = {
      'SINGLE': 1,      // 1人本
      'SQUAD': 2,       // 5人本
      'TEAM': 3,        // 20人本
      'SERVER_BOSS': 4  // 世界boss本
    }
    
    filtered.sort((a, b) => {
      // 首先按属性排序
      const attrOrderA = attributeOrder[normalizeAttribute(a.attribute_type)] || 999
      const attrOrderB = attributeOrder[normalizeAttribute(b.attribute_type)] || 999
      if (attrOrderA !== attrOrderB) {
        return attrOrderA - attrOrderB
      }
      // 然后按副本类型排序（同一属性的副本对齐显示）
      const typeOrderA = dungeonTypeOrder[normalizeDungeonType(a.dungeon_type)] || 999
      const typeOrderB = dungeonTypeOrder[normalizeDungeonType(b.dungeon_type)] || 999
      if (typeOrderA !== typeOrderB) {
        return typeOrderA - typeOrderB
      }
      return (a.difficulty_order || 1) - (b.difficulty_order || 1)
    })
    
    const seenExperienceAttributes = new Set<string>()
    return filtered.filter((dungeon) => {
      if (normalizeDungeonType(dungeon.dungeon_type) !== 'SINGLE') return true
      const key = normalizeAttribute(dungeon.attribute_type)
      if (seenExperienceAttributes.has(key)) return false
      seenExperienceAttributes.add(key)
      return true
    })
  }, [dungeons, activeTab, filterAttribute, filterDifficulty, searchQuery])

  const getDungeonTypeShortText = (type: string) => {
    const typeMap: Record<string, string> = {
      'SINGLE': '经验本',
      'SQUAD': '材料本',
      'TEAM': '装备本',
      'SERVER_BOSS': '立绘本'
    }
    return typeMap[normalizeDungeonType(type)] || type
  }

  const getRecommendedLevelText = (dungeon: Dungeon) => {
    const recommendedLevel = dungeon.recommendation?.recommended_level
    return recommendedLevel ? `Lv.${recommendedLevel}+` : `Lv.${dungeon.recommended_level_bonus || 1}+`
  }
  
  // 处理扫荡
  const handleSweep = async (dungeon: Dungeon, e: React.MouseEvent) => {
    e.stopPropagation()
    
    if (!dungeon.progress?.sweep_unlocked) {
      alert(normalizeDungeonType(dungeon.dungeon_type) === 'SQUAD' ? '单人通关5次解锁扫荡'
        : normalizeDungeonType(dungeon.dungeon_type) === 'SINGLE' ? '通关10次解锁扫荡' : '无角色阵亡通关10次解锁扫荡')
      return
    }
    
    const count = parseInt(prompt('请输入扫荡次数（1-10）:', '1') || '1')
    if (isNaN(count) || count < 1 || count > 10) {
      alert('请输入1-10之间的数字')
      return
    }
    
    try {
      if (isFormalOnlineMode()) {
        const payload = await loadOnlineDungeons(player)
        const character = normalizeDungeonType(dungeon.dungeon_type) === 'SINGLE'
          ? payload.characters.find((item: Character) => normalizeAttribute(item.attribute_type) === normalizeAttribute(dungeon.attribute_type))
          : payload.characters[0]
        if (!character) {
          alert('没有可用于该属性经验副本的角色')
          return
        }
        const response = await onlineApi.post(`/dungeons/${payload.session.player.id}/${dungeon.dungeon_id}/sweep`, {
          characterId: character.character_id,
          count,
        }, { headers: { 'Idempotency-Key': createIdempotencyKey('dungeon-sweep') } })
        completeNewPlayerGuideStep('run_exp_dungeon')
        const awarded = response.data?.materialsAwarded || []
        alert(`扫荡成功：${awarded.length ? awarded.map((item: any) => `${item.name} x${item.count}`).join('，')
          : `经验结晶 ${response.data?.rewards?.expCrystals || 0}，金币 ${response.data?.rewards?.gold || 0}`}`)
        window.dispatchEvent(new Event('gamer:resources-changed'))
        await loadDungeons()
        return
      }
      const response = await axios.post(`/api/dungeons/${dungeon.dungeon_id}/sweep`, {
        count: count
      })
      if (response.data.success) {
        if (dungeon.reward_config?.type === 'experience' || dungeon.dungeon_id.toLowerCase().includes('exp')) {
          completeNewPlayerGuideStep('run_exp_dungeon')
        }
        const rewards = response.data.materials_awarded || []
        const rewardText = rewards.length > 0
          ? rewards.map((item: any) => `${item.name || item.material_type} x${item.count}`).join('，')
          : '无额外材料'
        alert(`扫荡成功！${rewardText}`)
        loadDungeons() // 重新加载副本列表
      }
    } catch (error: any) {
      alert(error.response?.data?.message || '扫荡失败')
    }
  }
  

  return (
    <div className="dungeon-page">
      <div className="page-container">
        <div className="page-header">
          <div className="header-top">
            <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
            <h1>副本选择</h1>
          </div>
        </div>

        {/* 标签页切换 */}

        <div className="dungeon-tabs">
          <button
            className={`tab-btn ${activeTab === 'ALL' ? 'active' : ''}`}
            onClick={() => setActiveTab('ALL')}
          >
            全部
          </button>
          <button
            className={`tab-btn ${activeTab === 'SINGLE' ? 'active' : ''}`}
            onClick={() => setActiveTab('SINGLE')}
          >
            1人经验本
          </button>
          <button
            className={`tab-btn ${activeTab === 'SQUAD' ? 'active' : ''}`}
            onClick={() => setActiveTab('SQUAD')}
          >
            5人材料本
          </button>
          <button
            className={`tab-btn ${activeTab === 'TEAM' ? 'active' : ''}`}
            onClick={() => setActiveTab('TEAM')}
          >
            20人装备本
          </button>
          <button
            className={`tab-btn ${activeTab === 'SERVER_BOSS' ? 'active' : ''}`}
            onClick={() => setActiveTab('SERVER_BOSS')}
          >
            20人立绘本
          </button>
        </div>
        
        {/* 筛选和搜索栏 */}
        <div className="dungeon-filters">
          <div className="search-section">
            <input
              type="text"
              placeholder="搜索副本名称..."
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
                <option value="WATER">水</option>
                <option value="EARTH">土</option>
                <option value="THUNDER">雷</option>
                <option value="WIND">风</option>
                <option value="FIRE">火</option>
                <option value="WOOD">木</option>
                <option value="LIGHT">光</option>
                <option value="DARK">暗</option>
              </select>
            </div>
            <div className="filter-group">
              <label>难度：</label>
              <select
                value={filterDifficulty}
                onChange={(e) => setFilterDifficulty(e.target.value as FilterDifficulty)}
                className="filter-select"
              >
                <option value="ALL">全部</option>
                <option value="normal">普通</option>
                <option value="hard">困难</option>
                <option value="nightmare">噩梦</option>
              </select>
            </div>
          </div>
        </div>

        {loadError && (
          <div className="error-message" role="alert">
            {loadError}
            <button type="button" onClick={() => { void loadDungeons(); void loadCharacters() }}>重试</button>
          </div>
        )}


        {loading ? (
          <div className="loading">加载中...</div>
          ) : loadError && dungeons.length === 0 ? (
            <div className="error-message error-state" role="alert">
              <span>副本列表暂时无法显示，请先处理上方错误。</span>
              <button type="button" onClick={() => { void loadDungeons(); void loadCharacters() }}>重试</button>
            </div>
          ) : (
          <div className="dungeons-grid">
            {filteredAndSortedDungeons.length === 0 ? (
              <div className="empty">暂无副本</div>
            ) : (
              filteredAndSortedDungeons.map((dungeon) => (
                <div
                  key={dungeon.dungeon_id}
                  className={`dungeon-card element-themed ${!dungeon.is_unlocked ? 'locked' : ''}`}
                  style={elementThemeStyle(dungeon.attribute_type)}
                >
                  <div className="dungeon-header">
                    <h3>{normalizeDungeonType(dungeon.dungeon_type) === 'SINGLE'
                      ? `${getAttributeName(dungeon.attribute_type)}属性经验本` : dungeon.name}</h3>
                    <div className="dungeon-badges">
                      <span
                        className="dungeon-type-badge"
                        style={{ backgroundColor: getAttributeColor(dungeon.attribute_type) }}
                      >
                        {getDungeonTypeShortText(dungeon.dungeon_type)}
                      </span>
                    </div>
                  </div>
                  
                  <div className="dungeon-info">
                    <div className="dungeon-quick-summary">
                      <span>推荐 {getRecommendedLevelText(dungeon)}</span>
                      <span>{getAttributeName(dungeon.recommendation?.recommended_attribute || dungeon.attribute_type)}系 · {dungeon.recommendation?.party_size || (normalizeDungeonType(dungeon.dungeon_type) === 'SINGLE' ? 1 : normalizeDungeonType(dungeon.dungeon_type) === 'SQUAD' ? 5 : 20)}人</span>
                      {dungeon.duration && <span>限时 {dungeon.duration}秒</span>}
                    </div>
                    {dungeon.reward_preview && (
                      <div className="dungeon-inline-reward">
                        <strong>{dungeon.reward_preview.title}</strong>
                        <span>{dungeon.reward_preview.main}</span>
                      </div>
                    )}
                    {normalizeDungeonType(dungeon.dungeon_type) !== 'SINGLE' && dungeon.boss_summary && (
                      <div className="dungeon-inline-boss">
                        {dungeon.boss_summary.type_label} · {dungeon.boss_summary.boss_count} Boss
                      </div>
                    )}
                    
                    {/* 副本进度显示 */}
                    {(dungeon.progress || dungeon.progress_summary) && (
                      <div className="dungeon-progress">
                        <div className="progress-item">
                          <span className="progress-label">完成次数：</span>
                          <span className="progress-value">{dungeon.progress_summary?.completion_count ?? dungeon.progress?.completion_count}</span>
                        </div>
                        <div className="progress-item">
                          <span className="progress-label">扫荡：</span>
                          <span className="progress-value">{dungeon.progress_summary?.sweep_text || (dungeon.progress?.sweep_unlocked ? '已解锁' : '未解锁')}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="dungeon-actions">
                    {dungeon.is_unlocked ? (
                      <>
                        {dungeon.progress?.sweep_unlocked && (
                          <button
                            className="btn-sweep"
                            onClick={(e) => handleSweep(dungeon, e)}
                          >
                            扫荡
                          </button>
                        )}
                        <button
                          className="btn-start"
                          onClick={() => handleStartDungeon(dungeon)}
                        >
                          开始挑战
                        </button>
                      </>
                    ) : (
                      <div className="locked-overlay">
                        <p className="locked-text">未解锁</p>
                        {dungeon.difficulty_unlock && (
                          <p className="locked-hint">{dungeon.difficulty_unlock}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {showRoleWarning && (
          <ExperienceRoleWarning
            checked={muteRoleWarning}
            onChange={setMuteRoleWarning}
            onDecision={handleRoleWarningDecision}
          />
        )}
        {difficultyOptions && (
          <div className="modal-overlay" onClick={() => setDifficultyOptions(null)}>
            <div className="modal-content difficulty-picker" role="dialog" aria-modal="true" aria-label="选择副本难度"
              onClick={(event) => event.stopPropagation()}>
              <div className="modal-header">
                <h2>选择副本难度</h2>
                <button className="close-btn" aria-label="关闭难度选择" onClick={() => setDifficultyOptions(null)}>×</button>
              </div>
              <div className="modal-body">
                {difficultyOptions.map((entry) => (
                  <button type="button" className="difficulty-option" key={entry.dungeon_id} disabled={!entry.is_unlocked}
                    onClick={() => { setDifficultyOptions(null); enterDungeon(entry) }}>
                    <strong>{entry.difficulty || '普通'}</strong>
                    <span>推荐等级 {getRecommendedLevelText(entry)}</span>
                    <small>{entry.is_unlocked ? (entry.progress?.sweep_unlocked ? '已解锁扫荡' : '通关10次解锁扫荡') : entry.difficulty_unlock || '未解锁'}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {showCharacterSelect && selectedDungeon && !showRoleWarning && (
          <CharacterSelectModal
            characters={characters}
            dungeon={selectedDungeon}
            selectedCharacters={selectedCharacters}
            onToggle={handleCharacterToggle}
            onConfirm={() => void handleConfirmStart()}
            onClose={() => {
              setShowCharacterSelect(false)
              setSelectedDungeon(null)
              setSelectedCharacters([])
            }}
            maxSelect={normalizeDungeonType(selectedDungeon.dungeon_type) === 'SINGLE' ? 1
              : isFormalOnlineMode() && normalizeDungeonType(selectedDungeon.dungeon_type) !== 'SQUAD' ? 20 : 5}
          />
        )}
        
      </div>
    </div>
  )
}

const ExperienceRoleWarning: React.FC<{
  checked: boolean
  onChange: (checked: boolean) => void
  onDecision: (proceed: boolean) => void
}> = ({ checked, onChange, onDecision }) => {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  return (
    <dialog ref={dialog} className="experience-role-warning" aria-labelledby="experience-role-warning-title"
      aria-describedby="experience-role-warning-description"
      onCancel={(event) => { event.preventDefault(); onDecision(false) }}>
      <h2 id="experience-role-warning-title">确认挑战经验副本</h2>
      <p id="experience-role-warning-description">
        坦克、治疗、辅助职业攻击力较弱，可能导致通关失败。是否继续使用该职业进入经验副本？
      </p>
      <p>建议优先使用输出职业刷经验结晶，再为坦克、治疗和辅助升级。</p>
      <label className="experience-role-warning-preference">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        当天不再弹出本提示
      </label>
      <div className="experience-role-warning-actions">
        <button className="btn-cancel" autoFocus onClick={() => onDecision(false)}>否，重新选择</button>
        <button className="btn-confirm" onClick={() => onDecision(true)}>是，继续进入</button>
      </div>
    </dialog>
  )
}

interface CharacterSelectModalProps {
  characters: Character[]
  dungeon: Dungeon
  selectedCharacters: string[]
  onToggle: (characterId: string) => void
  onConfirm: () => void
  onClose: () => void
  maxSelect: number
}

const CharacterSelectModal: React.FC<CharacterSelectModalProps> = ({
  characters,
  dungeon,
  selectedCharacters,
  onToggle,
  onConfirm,
  onClose,
  maxSelect
}) => {
  const [season, setSeason] = useState(1)
  const [attribute, setAttribute] = useState('ALL')
  const [profession, setProfession] = useState('ALL')
  const [type, setType] = useState('ALL')
  const [order, setOrder] = useState('number')
  const filteredCharacters = useMemo(() => characters.filter((character) => (
    getSeasonNumber(character) === season
    && (attribute === 'ALL' || normalizeAttribute(character.attribute_type) === attribute)
    && (profession === 'ALL' || character.profession_type.includes(profession))
    && (type === 'ALL' || character.profession_type.includes(type)
      || type === 'MAGIC' && ['HEALER', 'SUPPORT'].includes(character.profession_type))
  )).sort((a, b) => (
    order === 'level-desc' ? b.level - a.level || compareCharactersByNumber(a, b)
      : order === 'level-asc' ? a.level - b.level || compareCharactersByNumber(a, b)
        : compareCharactersByNumber(a, b)
  )), [characters, season, attribute, profession, type, order])
  const isExperienceDungeon = normalizeDungeonType(dungeon.dungeon_type) === 'SINGLE' && dungeon.reward_config?.type === 'experience'
  const requiredAttribute = normalizeAttribute(dungeon.attribute_type)
  const canSelectCharacter = (character: Character) => (
    !isExperienceDungeon || normalizeAttribute(character.attribute_type) === requiredAttribute
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content dungeon-roster-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>选择角色 ({selectedCharacters.length}/{maxSelect})</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <SeasonTabs value={season} onChange={setSeason} />
          <div className="roster-filters">
            <select aria-label="角色属性筛选" value={attribute} onChange={(event) => setAttribute(event.target.value)}>
              <option value="ALL">全部属性</option>
              {['WATER', 'EARTH', 'THUNDER', 'WIND', 'FIRE', 'WOOD', 'LIGHT', 'DARK'].map((value) => (
                <option key={value} value={value}>{getAttributeName(value)}</option>
              ))}
            </select>
            <select aria-label="角色职业筛选" value={profession} onChange={(event) => setProfession(event.target.value)}>
              <option value="ALL">全部职业</option>
              <option value="TANK">坦克</option><option value="DPS">输出</option>
              <option value="HEALER">治疗</option><option value="SUPPORT">辅助</option>
            </select>
            <select aria-label="角色类型筛选" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="ALL">全部类型</option>
              <option value="PHYSICAL">物理</option><option value="MAGIC">法术</option>
            </select>
            <select aria-label="角色等级排序" value={order} onChange={(event) => setOrder(event.target.value)}>
              <option value="number">角色编号</option>
              <option value="level-desc">等级从高到低</option><option value="level-asc">等级从低到高</option>
            </select>
          </div>
          {filteredCharacters.length === 0 && <p role="status">暂无符合条件的角色</p>}
          <div className="characters-select-grid">
            {filteredCharacters.map((char) => (
              <button type="button"
                key={char.character_id}
                aria-pressed={selectedCharacters.includes(char.character_id)}
                disabled={(selectedCharacters.length >= maxSelect && !selectedCharacters.includes(char.character_id)
                  && normalizeDungeonType(dungeon.dungeon_type) !== 'SINGLE') || !canSelectCharacter(char)}
                className={`character-select-card element-themed ${selectedCharacters.includes(char.character_id) ? 'selected' : ''} ${!canSelectCharacter(char) ? 'disabled' : ''}`}
                style={elementThemeStyle(char.attribute_type)}
                onClick={() => {
                  if (canSelectCharacter(char) && (maxSelect === 1 || selectedCharacters.length < maxSelect || selectedCharacters.includes(char.character_id))) {
                    onToggle(char.character_id)
                  }
                }}
              >
                <div className="roster-card-heading">
                  <small className="roster-number">#{getCharacterNumber(char) ?? '?'}</small>
                  <div className="roster-identity">
                    <h4>{char.name}</h4>
                    <span><ElementBadge attribute={char.attribute_type} /> {getProfessionLabel(char.profession_type)}</span>
                  </div>
                  <strong className="roster-level">Lv.{char.level}</strong>
                </div>
                <dl className="roster-stats">
                  {([['hp', '血量'], ['attack', '攻击'], ['defense', '防御'], ['magic_attack', '法攻'], ['magic_defense', '法防']] as const)
                    .map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{char.stats?.[key]?.toLocaleString() ?? '--'}</dd></div>)}
                </dl>
                <div className="roster-equipment" aria-label="角色装备">
                  <span className={`roster-exclusive ${char.equipment?.weapon ? 'equipped' : ''}`}
                    title={char.equipment?.weapon?.name || '未装备专属道具'}>
                    <Swords size={18} /><small>专属</small>
                  </span>
                  <div className="roster-gear">
                    {EQUIPMENT_SLOTS.map(([slot, label]) => {
                      const piece = equipmentPieces(char.equipment)[slot] as any
                      return <span key={slot} className={`roster-gear-slot ${piece ? 'equipped' : ''}`}
                        aria-label={`${label}槽位`} title={`${label}：${piece?.name || piece?.item_name || '未装备'}`}>
                        <Shield size={12} /><small>{label}</small>
                      </span>
                    })}
                  </div>
                </div>
                <div className="roster-stars" aria-label={`角色${char.star || char.equipment?.star || 1}星`}>
                  {'★'.repeat(Math.min(5, Math.max(1, char.star || char.equipment?.star || 1)))}
                  {'☆'.repeat(5 - Math.min(5, Math.max(1, char.star || char.equipment?.star || 1)))}
                </div>
                  {isExperienceDungeon && !canSelectCharacter(char) && (
                    <small>只能进入同属性经验本</small>
                  )}
                {selectedCharacters.includes(char.character_id) && (
                  <span className="roster-selected-label">已选择</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button
            className="btn-confirm"
            onClick={onConfirm}
            disabled={isFormalOnlineMode() ? selectedCharacters.length !== maxSelect : selectedCharacters.length === 0}
          >
            确认 ({selectedCharacters.length}/{maxSelect})
          </button>
        </div>
      </div>
    </div>
  )
}


export default DungeonPage
