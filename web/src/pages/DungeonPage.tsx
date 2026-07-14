import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import './DungeonPage.css'

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

interface Character {
  character_id: string
  name: string
  profession_type: string
  attribute_type: string
  level: number
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

interface BossSkillInfo {
  skill_id: string
  name: string
  skill_logic: string
  skill_tier: string
  cooldown: number
  skill_multiplier: number
  target_type: string
  description?: string
  effect_tags?: string[]
  telegraph?: string
  status_effects?: Array<{
    name: string
    status_type: string
    duration: number
    description?: string
  }>
}

interface BossConfigPayload {
  boss_type: string
  mechanic: BossMechanicOption
  skill_slots: Record<BossSkillTier, string[]>
  total_slots: number
  source: 'custom' | 'default' | string
}

interface BossConfigOptions {
  boss_types: Record<string, BossMechanicOption>
  skill_library: Record<string, BossSkillInfo>
  default_skill_slots: Record<BossSkillTier, string[]>
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

const DungeonPage: React.FC = () => {
  const navigate = useNavigate()
  const [dungeons, setDungeons] = useState<Dungeon[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [selectedDungeon, setSelectedDungeon] = useState<Dungeon | null>(null)
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([])
  const [showCharacterSelect, setShowCharacterSelect] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [loading, setLoading] = useState(true)
  
  // 标签页和筛选状态
  const [activeTab, setActiveTab] = useState<TabType>('ALL')
  const [filterAttribute, setFilterAttribute] = useState<FilterAttribute>('ALL')
  const [filterDifficulty, setFilterDifficulty] = useState<FilterDifficulty>('ALL')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadDungeons()
    loadCharacters()
  }, [])

  const loadDungeons = async () => {
    try {
      const response = await axios.get('/api/dungeons')
      if (response.data.success) {
        setDungeons(response.data.dungeons)
      }
    } catch (error) {
      console.error('加载副本失败', error)
    } finally {
      setLoading(false)
    }
  }

  const loadCharacters = async () => {
    try {
      const response = await axios.get('/api/characters')
      if (response.data.success) {
        setCharacters(response.data.characters)
      }
    } catch (error) {
      console.error('加载角色失败', error)
    }
  }

  const handleStartDungeon = (dungeon: Dungeon) => {
    if (normalizeDungeonType(dungeon.dungeon_type) === 'SINGLE') {
      // 单人副本，直接选择角色
      setSelectedDungeon(dungeon)
      setShowCharacterSelect(true)
    } else {
      // 多人副本，跳转到多人房间
      navigate('/dungeons/multiplayer', { state: { dungeon_id: dungeon.dungeon_id } })
    }
  }

  const handleConfirmStart = async () => {
    if (!selectedDungeon || selectedCharacters.length === 0) {
      alert('请选择角色')
      return
    }

    try {
      const response = await axios.post(`/api/dungeons/${selectedDungeon.dungeon_id}/start`, {
        character_ids: selectedCharacters
      })
      if (response.data.success) {
        navigate('/battle', {
          state: {
            battle_id: response.data.battle_id,
            dungeon_id: selectedDungeon.dungeon_id,
            character_ids: selectedCharacters
          }
        })
      }
    } catch (error: any) {
      alert(error.response?.data?.message || '开始副本失败')
    }
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
    let filtered = [...dungeons]
    
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
    
    return filtered
  }, [dungeons, activeTab, filterAttribute, filterDifficulty, searchQuery])

  const getDifficultyClass = (dungeon: Dungeon) => {
    return normalizeDifficulty(dungeon.difficulty_key || dungeon.difficulty)
  }

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
      alert(`扫荡功能未解锁，需要通关${dungeon.progress?.sweep_unlock_count || 50}次`)
      return
    }
    
    const count = parseInt(prompt('请输入扫荡次数（1-10）:', '1') || '1')
    if (isNaN(count) || count < 1 || count > 10) {
      alert('请输入1-10之间的数字')
      return
    }
    
    try {
      const response = await axios.post(`/api/dungeons/${dungeon.dungeon_id}/sweep`, {
        count: count
      })
      if (response.data.success) {
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
  
  // 查看详情
  const handleViewDetail = async (dungeon: Dungeon) => {
    try {
      const response = await axios.get(`/api/dungeons/${dungeon.dungeon_id}`)
      if (response.data.success) {
        setSelectedDungeon(response.data.dungeon)
        setShowDetail(true)
      }
    } catch (error) {
      console.error('获取副本详情失败', error)
    }
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
    return colorMap[normalizeAttribute(attribute)] || '#666'
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

        {loading ? (
          <div className="loading">加载中...</div>
        ) : (
          <div className="dungeons-grid">
            {filteredAndSortedDungeons.length === 0 ? (
              <div className="empty">暂无副本</div>
            ) : (
              filteredAndSortedDungeons.map((dungeon) => (
                <div
                  key={dungeon.dungeon_id}
                  className={`dungeon-card ${!dungeon.is_unlocked ? 'locked' : ''}`}
                >
                  <div className="dungeon-header">
                    <h3>{dungeon.name}</h3>
                    <div className="dungeon-badges">
                      <span
                        className="dungeon-type-badge"
                        style={{ backgroundColor: getAttributeColor(dungeon.attribute_type) }}
                      >
                        {getDungeonTypeShortText(dungeon.dungeon_type)}
                      </span>
                      <span className={`difficulty-badge ${getDifficultyClass(dungeon)}`}>
                        {dungeon.difficulty || '普通'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="dungeon-info">
                    <div className="info-item">
                      <span className="info-label">属性：</span>
                      <span>{dungeon.attribute_type}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">倍率：</span>
                      <span>怪物 x{dungeon.monster_multiplier || 1} / 奖励 x{dungeon.reward_multiplier || 1}</span>
                    </div>
                    <div className="dungeon-quick-summary">
                      <span>推荐 {getRecommendedLevelText(dungeon)}</span>
                      <span>{dungeon.recommendation?.recommended_attribute || dungeon.attribute_type} 属性</span>
                      <span>{dungeon.recommendation?.party_size || 1} 人配置</span>
                    </div>
                    {dungeon.reward_preview && (
                      <div className="dungeon-card-summary reward">
                        <strong>{dungeon.reward_preview.title}</strong>
                        <span>{dungeon.reward_preview.main}</span>
                      </div>
                    )}
                    {normalizeDungeonType(dungeon.dungeon_type) !== 'SINGLE' && dungeon.boss_summary && (
                      <div className="dungeon-card-summary boss">
                        <strong>{dungeon.boss_summary.type_label}</strong>
                        <span>{dungeon.boss_summary.flags.join(' / ')} · {dungeon.boss_summary.slot_total}槽</span>
                      </div>
                    )}
                    {dungeon.description && (
                      <p className="dungeon-description">{dungeon.description}</p>
                    )}
                    
                    {/* 副本进度显示 */}
                    {(dungeon.progress || dungeon.progress_summary) && (
                      <div className="dungeon-progress">
                        <div className="progress-item">
                          <span className="progress-label">完成次数：</span>
                          <span className="progress-value">{dungeon.progress_summary?.completion_count ?? dungeon.progress?.completion_count}</span>
                        </div>
                        <div className="progress-item">
                          <span className="progress-label">最佳时间：</span>
                          <span className="progress-value">{dungeon.progress_summary?.best_time_text || (dungeon.progress?.best_record?.duration ? `${dungeon.progress.best_record.duration.toFixed(1)}秒` : '暂无')}</span>
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
                        <button
                          className="btn-detail"
                          onClick={() => handleViewDetail(dungeon)}
                        >
                          详情
                        </button>
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

        {showCharacterSelect && selectedDungeon && (
          <CharacterSelectModal
            characters={characters}
            selectedCharacters={selectedCharacters}
            onToggle={handleCharacterToggle}
            onConfirm={handleConfirmStart}
            onClose={() => {
              setShowCharacterSelect(false)
              setSelectedDungeon(null)
              setSelectedCharacters([])
            }}
            maxSelect={normalizeDungeonType(selectedDungeon.dungeon_type) === 'SINGLE' ? 1 : 5}
          />
        )}
        
        {showDetail && selectedDungeon && (
          <DungeonDetailModal
            dungeon={selectedDungeon}
            onClose={() => {
              setShowDetail(false)
              setSelectedDungeon(null)
            }}
            getAttributeColor={getAttributeColor}
            onStart={() => {
              setShowDetail(false)
              handleStartDungeon(selectedDungeon)
            }}
            onSweep={(dungeon) => {
              handleSweep(dungeon, { stopPropagation: () => {} } as React.MouseEvent)
            }}
          />
        )}
      </div>
    </div>
  )
}

interface CharacterSelectModalProps {
  characters: Character[]
  selectedCharacters: string[]
  onToggle: (characterId: string) => void
  onConfirm: () => void
  onClose: () => void
  maxSelect: number
}

const CharacterSelectModal: React.FC<CharacterSelectModalProps> = ({
  characters,
  selectedCharacters,
  onToggle,
  onConfirm,
  onClose,
  maxSelect
}) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>选择角色 ({selectedCharacters.length}/{maxSelect})</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="characters-select-grid">
            {characters.map((char) => (
              <div
                key={char.character_id}
                className={`character-select-card ${selectedCharacters.includes(char.character_id) ? 'selected' : ''} ${selectedCharacters.length >= maxSelect && !selectedCharacters.includes(char.character_id) ? 'disabled' : ''}`}
                onClick={() => {
                  if (selectedCharacters.length < maxSelect || selectedCharacters.includes(char.character_id)) {
                    onToggle(char.character_id)
                  }
                }}
              >
                <div className="character-select-avatar">
                  <div className="character-level">Lv.{char.level}</div>
                </div>
                <div className="character-select-info">
                  <h4>{char.name}</h4>
                  <p>{char.profession_type}</p>
                </div>
                {selectedCharacters.includes(char.character_id) && (
                  <div className="select-checkmark">✓</div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button
            className="btn-confirm"
            onClick={onConfirm}
            disabled={selectedCharacters.length === 0}
          >
            确认 ({selectedCharacters.length}/{maxSelect})
          </button>
        </div>
      </div>
    </div>
  )
}

interface DungeonDetailModalProps {
  dungeon: Dungeon
  onClose: () => void
  getAttributeColor: (attribute: string) => string
  onStart: () => void
  onSweep: (dungeon: Dungeon) => void
}

const getDungeonTypeText = (type: string) => {
  const typeMap: Record<string, string> = {
    'SINGLE': '1人经验本',
    'SQUAD': '5人材料本',
    'TEAM': '20人装备本',
    'SERVER_BOSS': '20人立绘本'
  }
  return typeMap[normalizeDungeonType(type)] || type
}

const bossTypeText: Record<string, string> = {
  SINGLE: '单体 Boss',
  TWIN_SHARED: '双子共血',
  TWIN_SEPARATE: '双子相互强化',
  COUNCIL_SHARED: '议会共血',
  COUNCIL_SEQUENTIAL: '议会轮流主导'
}

const bossSlotText: Record<BossSkillTier, string> = {
  low: '底层槽',
  mid: '中层槽',
  high: '高层槽'
}

const bossSlotCounts: Record<BossSkillTier, number> = {
  low: 5,
  mid: 3,
  high: 1
}

const getEmptyBossSlots = (): Record<BossSkillTier, string[]> => ({
  low: Array(5).fill(''),
  mid: Array(3).fill(''),
  high: Array(1).fill('')
})

const DungeonDetailModal: React.FC<DungeonDetailModalProps> = ({
  dungeon,
  onClose,
  getAttributeColor,
  onStart,
  onSweep
}) => {
  const hasBossConfigEntry = normalizeDungeonType(dungeon.dungeon_type) !== 'SINGLE'
  const [bossOptions, setBossOptions] = useState<BossConfigOptions | null>(null)
  const [bossConfig, setBossConfig] = useState<BossConfigPayload | null>(dungeon.boss_config || null)
  const [bossType, setBossType] = useState(dungeon.boss_config?.boss_type || 'SINGLE')
  const [bossSkillSlots, setBossSkillSlots] = useState<Record<BossSkillTier, string[]>>(
    dungeon.boss_config?.skill_slots || getEmptyBossSlots()
  )
  const [bossFeedback, setBossFeedback] = useState('')
  const [savingBossConfig, setSavingBossConfig] = useState(false)

  const getEffectiveRewardAmount = (value: number | undefined) => {
    return Math.floor((value || 0) * (dungeon.reward_multiplier || 1))
  }

  useEffect(() => {
    setBossConfig(dungeon.boss_config || null)
    setBossType(dungeon.boss_config?.boss_type || 'SINGLE')
    setBossSkillSlots(dungeon.boss_config?.skill_slots || getEmptyBossSlots())
    setBossFeedback('')

    if (!hasBossConfigEntry) return

    let isMounted = true
    const loadBossConfig = async () => {
      try {
        const [optionResponse, configResponse] = await Promise.all([
          axios.get('/api/boss-config/options'),
          axios.get(`/api/dungeons/${dungeon.dungeon_id}/boss-config`)
        ])

        if (!isMounted) return
        if (optionResponse.data.success) {
          setBossOptions(optionResponse.data)
        }
        if (configResponse.data.success) {
          const nextConfig = configResponse.data.boss_config as BossConfigPayload
          setBossConfig(nextConfig)
          setBossType(nextConfig.boss_type)
          setBossSkillSlots(nextConfig.skill_slots)
        }
      } catch (error) {
        if (isMounted) setBossFeedback('Boss配置加载失败')
      }
    }

    loadBossConfig()
    return () => {
      isMounted = false
    }
  }, [dungeon.dungeon_id, dungeon.boss_config, hasBossConfigEntry])

  const bossSkillOptions = useMemo(() => {
    return Object.values(bossOptions?.skill_library || {})
  }, [bossOptions])

  const getBossSkillsForTier = (tier: BossSkillTier) => {
    const tierNeedle = `_${tier}_`
    const filtered = bossSkillOptions.filter(skill => skill.skill_id.includes(tierNeedle))
    return filtered.length > 0 ? filtered : bossSkillOptions
  }

  const updateBossSkillSlot = (tier: BossSkillTier, index: number, skillId: string) => {
    setBossSkillSlots(prev => ({
      ...prev,
      [tier]: prev[tier].map((currentSkillId, slotIndex) => (
        slotIndex === index ? skillId : currentSkillId
      ))
    }))
    setBossFeedback('')
  }

  const handleBossTypeChange = (nextBossType: string) => {
    setBossType(nextBossType)
    setBossFeedback('')
  }

  const saveBossConfig = async () => {
    setSavingBossConfig(true)
    setBossFeedback('')
    try {
      const response = await axios.post(`/api/dungeons/${dungeon.dungeon_id}/boss-config`, {
        boss_type: bossType,
        skill_slots: bossSkillSlots
      })
      if (response.data.success) {
        setBossConfig(response.data.boss_config)
        setBossSkillSlots(response.data.boss_config.skill_slots)
        setBossFeedback('Boss配置已保存')
      } else {
        setBossFeedback(response.data.message || 'Boss配置保存失败')
      }
    } catch (error: any) {
      setBossFeedback(error.response?.data?.message || 'Boss配置保存失败')
    } finally {
      setSavingBossConfig(false)
    }
  }

  // 获取奖励预览
  const getRewardPreview = () => {
    if (dungeon.reward_preview) {
      return [{
        type: dungeon.reward_preview.title,
        icon: '⭐',
        description: dungeon.reward_preview.main
      }]
    }
    if (!dungeon.reward_config) return null
    
    const rewardType = dungeon.reward_config.type
    const rewards: any[] = []
    
    if (rewardType === 'experience') {
      rewards.push({
        type: '经验',
        icon: '⭐',
        description: `满时长经验：${getEffectiveRewardAmount(dungeon.reward_config.base_exp)}点`
      })
    } else if (rewardType === 'exclusive_material') {
      rewards.push({
        type: '专属材料',
        icon: '💎',
        description: `基础材料：${dungeon.reward_config.base_material || 0}个`
      })
    } else if (rewardType === 'equipment_material') {
      rewards.push({
        type: '装备材料',
        icon: '⚔️',
        description: `基础材料：${dungeon.reward_config.base_material || 0}个`
      })
    } else if (rewardType === 'illustration_piece') {
      rewards.push({
        type: '立绘碎片',
        icon: '🖼️',
        description: '解锁角色立绘'
      })
    }
    
    return rewards
  }
  
  // 获取推荐等级（根据副本类型估算）
  const getRecommendedLevel = () => {
    if (dungeon.recommendation?.recommended_level) {
      return dungeon.recommendation.recommended_level
    }
    const typeMap: Record<string, number> = {
      'SINGLE': 1,
      'SQUAD': 10,
      'TEAM': 20,
      'SERVER_BOSS': 30
    }
    return (typeMap[normalizeDungeonType(dungeon.dungeon_type)] || 1) + (dungeon.recommended_level_bonus || 0)
  }
  
  const rewards = getRewardPreview()
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content dungeon-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{dungeon.name}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          {/* 基本信息 */}
          <div className="detail-section">
            <h3>基本信息</h3>
            <div className="detail-info-grid">
              <div className="info-item">
                <span className="info-label">类型：</span>
                <span>{getDungeonTypeText(dungeon.dungeon_type)}</span>
              </div>
              <div className="info-item">
                <span className="info-label">属性：</span>
                <span
                  style={{ color: getAttributeColor(dungeon.attribute_type) }}
                >
                  {dungeon.attribute_type}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">推荐等级：</span>
                <span>Lv.{getRecommendedLevel()}+</span>
              </div>
              <div className="info-item">
                <span className="info-label">难度：</span>
                <span>{dungeon.difficulty || '普通'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">难度倍率：</span>
                <span>怪物 x{dungeon.monster_multiplier || 1} / 奖励 x{dungeon.reward_multiplier || 1}</span>
              </div>
              {dungeon.duration && (
                <div className="info-item">
                  <span className="info-label">预计时长：</span>
                  <span>{dungeon.duration}秒</span>
                </div>
              )}
            </div>
            {dungeon.description && (
              <p className="detail-description">{dungeon.description}</p>
            )}
          </div>

          {dungeon.recommendation && (
            <div className="detail-section">
              <h3>战前建议</h3>
              <div className="recommendation-panel">
                <div className="recommendation-main">
                  <div>
                    <span className="recommendation-label">推荐属性</span>
                    <strong style={{ color: getAttributeColor(dungeon.recommendation.recommended_attribute) }}>
                      {dungeon.recommendation.recommended_attribute}
                    </strong>
                    <p>{dungeon.recommendation.attribute_hint}</p>
                  </div>
                  <div>
                    <span className="recommendation-label">队伍规模</span>
                    <strong>{dungeon.recommendation.party_size} 人</strong>
                    <p>{dungeon.recommendation.summary}</p>
                  </div>
                  <div>
                    <span className="recommendation-label">账号现状</span>
                    <strong className={dungeon.recommendation.roster_status?.ready ? 'ready-text' : 'warning-text'}>
                      {dungeon.recommendation.roster_status?.ready ? '推荐达标' : '仍需培养'}
                    </strong>
                    <p>{dungeon.recommendation.roster_status?.hint}</p>
                  </div>
                </div>
                <div className="formation-list">
                  {dungeon.recommendation.formation.map(item => (
                    <div key={item.role} className="formation-item">
                      <span>{item.role}</span>
                      <strong>x{item.count}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          
          {/* 奖励预览 */}
          {rewards && rewards.length > 0 && (
            <div className="detail-section">
              <h3>奖励预览</h3>
              <div className="rewards-grid">
                {rewards.map((reward, index) => (
                  <div key={index} className="reward-card">
                    <div className="reward-icon">{reward.icon}</div>
                    <div className="reward-info">
                      <h4>{reward.type}</h4>
                      <p>{reward.description}</p>
                    </div>
                  </div>
                ))}
              </div>
              {dungeon.reward_preview && (
                <div className="reward-thresholds">
                  {dungeon.reward_preview.thresholds.map(item => (
                    <div key={item.label} className="reward-threshold">
                      <span>{item.label}</span>
                      <strong>{item.amount}</strong>
                    </div>
                  ))}
                </div>
              )}
              {dungeon.reward_preview?.details && dungeon.reward_preview.details.length > 0 && (
                <div className="reward-notes">
                  {dungeon.reward_preview.details.map(detail => <p key={detail}>{detail}</p>)}
                </div>
              )}
            </div>
          )}
          
          {/* 掉落材料及装备显示 */}
          {dungeon.reward_config && (
            <div className="detail-section">
              <h3>掉落物品</h3>
              <div className="drops-list">
                {dungeon.reward_config.type === 'exclusive_material' && (
                  <div className="drop-item">
                    <span className="drop-icon">💎</span>
                    <span className="drop-name">专属材料</span>
                    <span className="drop-count">{dungeon.reward_config.base_material || 0}个</span>
                  </div>
                )}
                {dungeon.reward_config.type === 'equipment_material' && (
                  <div className="drop-item">
                    <span className="drop-icon">⚔️</span>
                    <span className="drop-name">装备材料</span>
                    <span className="drop-count">{dungeon.reward_config.base_material || 0}个</span>
                  </div>
                )}
                {dungeon.reward_config.type === 'illustration_piece' && (
                  <div className="drop-item">
                    <span className="drop-icon">🖼️</span>
                    <span className="drop-name">立绘碎片</span>
                    <span className="drop-count">随机</span>
                  </div>
                )}
                {dungeon.reward_config.type === 'experience' && (
                  <div className="drop-item">
                    <span className="drop-icon">⭐</span>
                    <span className="drop-name">经验值</span>
                    <span className="drop-count">{getEffectiveRewardAmount(dungeon.reward_config.base_exp)}点</span>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* 副本进度 */}
          {dungeon.progress && (
            <div className="detail-section">
              <h3>副本进度</h3>
              <div className="progress-info">
                <div className="progress-item">
                  <span className="progress-label">完成次数：</span>
                  <span className="progress-value">{dungeon.progress_summary?.completion_count ?? dungeon.progress.completion_count}</span>
                </div>
                <div className="progress-item">
                  <span className="progress-label">总挑战次数：</span>
                  <span className="progress-value">{dungeon.progress_summary?.total_attempts ?? dungeon.progress.total_attempts}</span>
                </div>
                <div className="progress-item">
                  <span className="progress-label">最佳时间：</span>
                  <span className="progress-value">{dungeon.progress_summary?.best_time_text || (dungeon.progress.best_record?.duration ? `${dungeon.progress.best_record.duration.toFixed(1)}秒` : '暂无')}</span>
                </div>
                <div className="progress-item">
                  <span className="progress-label">最佳收益：</span>
                  <span className="progress-value">{dungeon.progress_summary?.best_reward_text || '暂无记录'}</span>
                </div>
                <div className="progress-item">
                  <span className="progress-label">扫荡解锁：</span>
                  <span className="progress-value">
                    {dungeon.progress_summary?.sweep_unlocked || dungeon.progress.sweep_unlocked
                      ? '✓ 已解锁'
                      : `✗ 未解锁（${dungeon.progress_summary?.sweep_text || `需通关${dungeon.progress.sweep_unlock_count || 50}次`}）`}
                  </span>
                </div>
              </div>
            </div>
          )}
          
          {/* 怪物信息 */}
          <div className="detail-section">
            <h3>怪物信息</h3>
            <div className="monster-info">
              <p>• 小怪：单体小怪和群体小怪</p>
              <p>• 怪物属性：{dungeon.recommendation?.enemy_attribute || dungeon.attribute_type}</p>
              <p>• 推荐克制属性：{dungeon.recommendation?.recommended_attribute || dungeon.attribute_type}</p>
            </div>
          </div>

          {hasBossConfigEntry && dungeon.boss_summary && (
            <div className="detail-section">
              <h3>Boss 总览</h3>
              <div className="boss-summary-panel">
                <div>
                  <span className="recommendation-label">机制模板</span>
                  <strong>{dungeon.boss_summary.type_label}</strong>
                  <p>{dungeon.boss_summary.description}</p>
                </div>
                <div className="boss-summary-flags">
                  <span>Boss数量：{dungeon.boss_summary.boss_count}</span>
                  <span>{dungeon.boss_summary.slot_total} 个技能槽</span>
                  {dungeon.boss_summary.flags.map(flag => <span key={flag}>{flag}</span>)}
                </div>
                {dungeon.boss_summary.top_skills.length > 0 && (
                  <div className="boss-summary-skills">
                    {dungeon.boss_summary.top_skills.map(skill => (
                      <div key={skill.skill_id} className="boss-summary-skill">
                        <strong>{skill.name}</strong>
                        <span>{(skill.effect_tags || []).join(' / ') || '常规技能'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {hasBossConfigEntry && (
            <div className="detail-section">
              <h3>Boss 配置</h3>
              <div className="boss-config-panel">
                <div className="boss-config-top">
                  <label className="boss-config-field">
                    <span>当前机制</span>
                    <select
                      value={bossType}
                      onChange={(event) => handleBossTypeChange(event.target.value)}
                      disabled={!bossOptions}
                    >
                      {Object.entries(bossOptions?.boss_types || { [bossType]: bossConfig?.mechanic }).map(([type, mechanic]) => (
                        <option key={type} value={type}>
                          {bossTypeText[type] || type}（{mechanic?.mechanic_id || '未加载'}）
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="boss-mechanic-card">
                    <strong>{bossTypeText[bossType] || bossType}</strong>
                    <p>{(bossOptions?.boss_types[bossType] || bossConfig?.mechanic)?.description || '等待加载机制说明'}</p>
                    <div className="boss-mechanic-flags">
                      <span>Boss数量：{(bossOptions?.boss_types[bossType] || bossConfig?.mechanic)?.boss_count || 1}</span>
                      <span>{(bossOptions?.boss_types[bossType] || bossConfig?.mechanic)?.shared_health ? '共血量' : '独立血量'}</span>
                      <span>{(bossOptions?.boss_types[bossType] || bossConfig?.mechanic)?.mutual_strengthen ? '相互强化' : '无相互强化'}</span>
                      <span>{(bossOptions?.boss_types[bossType] || bossConfig?.mechanic)?.sequential_activation ? '轮流激活' : '同时在场'}</span>
                    </div>
                  </div>
                </div>

                <div className="boss-slot-grid">
                  {(Object.keys(bossSlotCounts) as BossSkillTier[]).map((tier) => (
                    <div key={tier} className="boss-slot-column">
                      <div className="boss-slot-title">
                        {bossSlotText[tier]} <span>{bossSlotCounts[tier]} 个</span>
                      </div>
                      {Array.from({ length: bossSlotCounts[tier] }).map((_, index) => {
                        const skillId = bossSkillSlots[tier]?.[index] || ''
                        const skillInfo = bossOptions?.skill_library?.[skillId]
                        return (
                          <div key={`${tier}-${index}`} className="boss-slot-row">
                            <span className="boss-slot-index">{index + 1}</span>
                            <select
                              value={skillId}
                              onChange={(event) => updateBossSkillSlot(tier, index, event.target.value)}
                              disabled={!bossOptions}
                            >
                              <option value="">选择技能</option>
                              {getBossSkillsForTier(tier).map(skill => (
                                <option key={skill.skill_id} value={skill.skill_id}>
                                  {skill.name} / {skill.skill_logic}
                                </option>
                              ))}
                            </select>
                            <div className="boss-skill-meta">
                              {skillInfo
                                ? `CD ${skillInfo.cooldown}s · 倍率 ${skillInfo.skill_multiplier} · ${skillInfo.target_type}`
                                : '未配置'}
                            </div>
                            {skillInfo && (
                              <div className="boss-skill-effects">
                                {skillInfo.effect_tags && skillInfo.effect_tags.length > 0 && (
                                  <div className="boss-skill-tags">
                                    {skillInfo.effect_tags.map(tag => <span key={tag}>{tag}</span>)}
                                  </div>
                                )}
                                {skillInfo.telegraph && <p>{skillInfo.telegraph}</p>}
                                {skillInfo.status_effects && skillInfo.status_effects.length > 0 && (
                                  <p>
                                    状态：{skillInfo.status_effects.map(status => `${status.name}/${status.status_type}/${status.duration}s`).join('，')}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>

                <div className="boss-config-actions">
                  <span className={bossFeedback.includes('失败') || bossFeedback.includes('未知') || bossFeedback.includes('无效') ? 'boss-feedback error' : 'boss-feedback'}>
                    {bossFeedback || `来源：${bossConfig?.source === 'custom' ? '已自定义' : '默认模板'}`}
                  </span>
                  <button
                    className="btn-confirm boss-save-btn"
                    onClick={saveBossConfig}
                    disabled={!bossOptions || savingBossConfig}
                  >
                    {savingBossConfig ? '保存中...' : '保存 Boss 配置'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          {dungeon.is_unlocked && (
            <>
              {dungeon.progress?.sweep_unlocked && (
                <button
                  className="btn-sweep"
                  onClick={() => onSweep(dungeon)}
                >
                  扫荡
                </button>
              )}
              <button
                className="btn-start"
                onClick={onStart}
              >
                开始挑战
              </button>
            </>
          )}
          <button className="btn-cancel" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}

export default DungeonPage
