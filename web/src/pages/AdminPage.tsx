import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import './AdminPage.css'

interface PoolCharacter {
  character_id: string
  name: string
  attribute_type: string
  profession_type: string
}

interface UpPoolConfig {
  title: string
  description: string
  up_rate: number
  up_character_names: string[]
  up_characters?: PoolCharacter[]
}

interface ExclusiveWeaponTemplate {
  template_key: string
  name: string
  description: string
  cooldown: number
  damage_multiplier: number
  physical_damage_ratio: number
  magical_damage_ratio: number
  target_type: 'SINGLE' | 'ALL'
  target_count: number
  is_heal: boolean
  heal_ratio: number
  effect_tags: string[]
  impact_hint: string
}

const emptyTemplate: ExclusiveWeaponTemplate = {
  template_key: 'physical_dps',
  name: '',
  description: '',
  cooldown: 10,
  damage_multiplier: 1.5,
  physical_damage_ratio: 0.5,
  magical_damage_ratio: 0.5,
  target_type: 'SINGLE',
  target_count: 1,
  is_heal: false,
  heal_ratio: 0,
  effect_tags: [],
  impact_hint: ''
}

const templateLabels: Record<string, string> = {
  physical_dps: '物理输出',
  magic_dps: '法系输出',
  tank: '坦克',
  healer: '治疗',
  support: '辅助'
}

const AdminPage: React.FC = () => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [availableCharacters, setAvailableCharacters] = useState<PoolCharacter[]>([])
  const [upPool, setUpPool] = useState<UpPoolConfig>({
    title: '',
    description: '',
    up_rate: 0.5,
    up_character_names: []
  })
  const [templates, setTemplates] = useState<Record<string, ExclusiveWeaponTemplate>>({})
  const [templateOrder, setTemplateOrder] = useState<string[]>([])
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('physical_dps')
  const [templateDraft, setTemplateDraft] = useState<ExclusiveWeaponTemplate>(emptyTemplate)

  useEffect(() => {
    loadAdminData()
  }, [])

  useEffect(() => {
    if (templates[selectedTemplateKey]) {
      setTemplateDraft({
        ...templates[selectedTemplateKey],
        effect_tags: [...(templates[selectedTemplateKey].effect_tags || [])]
      })
    }
  }, [selectedTemplateKey, templates])

  const selectedNames = useMemo(() => new Set(upPool.up_character_names || []), [upPool.up_character_names])

  const loadAdminData = async () => {
    setLoading(true)
    try {
      const [poolResponse, templateResponse] = await Promise.all([
        axios.get('/api/admin/up-pool'),
        axios.get('/api/admin/exclusive-weapon-templates')
      ])
      if (poolResponse.data.success) {
        setUpPool(poolResponse.data.up_pool)
        setAvailableCharacters(poolResponse.data.available_characters || [])
      }
      if (templateResponse.data.success) {
        setTemplates(templateResponse.data.templates || {})
        setTemplateOrder(templateResponse.data.template_order || Object.keys(templateResponse.data.templates || {}))
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || '管理数据读取失败')
    } finally {
      setLoading(false)
    }
  }

  const toggleUpCharacter = (name: string) => {
    const next = selectedNames.has(name)
      ? upPool.up_character_names.filter((item) => item !== name)
      : [...upPool.up_character_names, name]
    setUpPool({ ...upPool, up_character_names: next })
  }

  const saveUpPool = async () => {
    try {
      const response = await axios.post('/api/admin/up-pool', upPool)
      if (response.data.success) {
        setUpPool(response.data.up_pool)
        setAvailableCharacters(response.data.available_characters || [])
        setMessage(response.data.message || 'UP池已保存')
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'UP池保存失败')
    }
  }

  const updateTemplateDraft = (patch: Partial<ExclusiveWeaponTemplate>) => {
    setTemplateDraft((current) => ({ ...current, ...patch }))
  }

  const saveTemplate = async () => {
    try {
      const response = await axios.post('/api/admin/exclusive-weapon-templates', templateDraft)
      if (response.data.success) {
        setTemplates(response.data.templates || {})
        setMessage(response.data.message || '专武技能模板已保存')
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || '专武技能模板保存失败')
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-container">
        <div className="admin-header">
          <button onClick={() => navigate('/')} className="admin-back">返回主界面</button>
          <div>
            <h1>管理入口</h1>
            <p>UP池和专属武器技能模板会直接影响后续抽卡与新制作专武。</p>
          </div>
        </div>

        {message && <div className="admin-message">{message}</div>}
        {loading ? (
          <div className="admin-loading">读取中...</div>
        ) : (
          <div className="admin-grid">
            <section className="admin-panel">
              <div className="panel-title">
                <h2>UP池管理</h2>
                <button onClick={saveUpPool}>保存UP池</button>
              </div>
              <label>
                池子标题
                <input value={upPool.title} onChange={(event) => setUpPool({ ...upPool, title: event.target.value })} />
              </label>
              <label>
                池子说明
                <textarea value={upPool.description} onChange={(event) => setUpPool({ ...upPool, description: event.target.value })} />
              </label>
              <label>
                UP权重
                <input
                  type="number"
                  min="0"
                  max="0.95"
                  step="0.05"
                  value={upPool.up_rate}
                  onChange={(event) => setUpPool({ ...upPool, up_rate: Number(event.target.value) })}
                />
              </label>
              <div className="selected-line">当前UP：{upPool.up_character_names.length ? upPool.up_character_names.join('、') : '未选择'}</div>
              <div className="character-picker">
                {availableCharacters.map((char) => (
                  <button
                    key={char.character_id}
                    className={selectedNames.has(char.name) ? 'selected' : ''}
                    onClick={() => toggleUpCharacter(char.name)}
                  >
                    <strong>{char.name}</strong>
                    <span>{char.attribute_type} / {char.profession_type}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="admin-panel">
              <div className="panel-title">
                <h2>专武技能模板</h2>
                <button onClick={saveTemplate}>保存模板</button>
              </div>
              <div className="template-tabs">
                {templateOrder.map((key) => (
                  <button
                    key={key}
                    className={selectedTemplateKey === key ? 'active' : ''}
                    onClick={() => setSelectedTemplateKey(key)}
                  >
                    {templateLabels[key] || key}
                  </button>
                ))}
              </div>
              <div className="template-form">
                <label>
                  技能名
                  <input value={templateDraft.name} onChange={(event) => updateTemplateDraft({ name: event.target.value })} />
                </label>
                <label>
                  描述
                  <textarea value={templateDraft.description} onChange={(event) => updateTemplateDraft({ description: event.target.value })} />
                </label>
                <div className="form-pair">
                  <label>
                    冷却
                    <input type="number" min="1" value={templateDraft.cooldown} onChange={(event) => updateTemplateDraft({ cooldown: Number(event.target.value) })} />
                  </label>
                  <label>
                    技能倍率
                    <input type="number" min="0" step="0.05" value={templateDraft.damage_multiplier} onChange={(event) => updateTemplateDraft({ damage_multiplier: Number(event.target.value) })} />
                  </label>
                </div>
                <div className="form-pair">
                  <label>
                    物理占比
                    <input type="number" min="0" step="0.05" value={templateDraft.physical_damage_ratio} onChange={(event) => updateTemplateDraft({ physical_damage_ratio: Number(event.target.value) })} />
                  </label>
                  <label>
                    法术占比
                    <input type="number" min="0" step="0.05" value={templateDraft.magical_damage_ratio} onChange={(event) => updateTemplateDraft({ magical_damage_ratio: Number(event.target.value) })} />
                  </label>
                </div>
                <div className="form-pair">
                  <label>
                    目标
                    <select value={templateDraft.target_type} onChange={(event) => updateTemplateDraft({ target_type: event.target.value as 'SINGLE' | 'ALL' })}>
                      <option value="SINGLE">单体</option>
                      <option value="ALL">全体</option>
                    </select>
                  </label>
                  <label>
                    目标数
                    <input type="number" min="1" value={templateDraft.target_count} onChange={(event) => updateTemplateDraft({ target_count: Number(event.target.value) })} />
                  </label>
                </div>
                <label className="check-line">
                  <input type="checkbox" checked={templateDraft.is_heal} onChange={(event) => updateTemplateDraft({ is_heal: event.target.checked })} />
                  治疗技能
                </label>
                <label>
                  治疗比例
                  <input type="number" min="0" step="0.05" value={templateDraft.heal_ratio} onChange={(event) => updateTemplateDraft({ heal_ratio: Number(event.target.value) })} />
                </label>
                <label>
                  标签
                  <input value={(templateDraft.effect_tags || []).join(',')} onChange={(event) => updateTemplateDraft({ effect_tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} />
                </label>
                <label>
                  释放提示
                  <input value={templateDraft.impact_hint} onChange={(event) => updateTemplateDraft({ impact_hint: event.target.value })} />
                </label>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminPage
