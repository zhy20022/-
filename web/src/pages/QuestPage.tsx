import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import './QuestPage.css'

interface QuestObjective {
  objective_id: string
  description: string
  target_type: string
  target_id: string | null
  target_count: number
  current_count: number
  is_completed: boolean
}

interface QuestReward {
  exp: number
  gold: number
  materials: Record<string, number>
  items: string[]
}

interface Quest {
  quest_id: string
  name: string
  quest_type: string
  description: string
  objectives: QuestObjective[]
  reward: QuestReward
  status: string
  accepted_at: string | null
  completed_at: string | null
}

const QuestPage: React.FC = () => {
  const navigate = useNavigate()
  const [quests, setQuests] = useState<Quest[]>([])
  const [selectedQuest, setSelectedQuest] = useState<Quest | null>(null)
  const [activeTab, setActiveTab] = useState<'all' | 'main' | 'side' | 'daily' | 'weekly'>('all')
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    loadQuests()
  }, [activeTab])

  const loadQuests = async () => {
    try {
      setLoading(true)
      const response = await axios.get(`/api/quests/list?type=${activeTab}`)
      if (response.data.success) {
        setQuests(response.data.quests)
        if (response.data.quests.length > 0 && !selectedQuest) {
          setSelectedQuest(response.data.quests[0])
        }
      }
    } catch (error) {
      console.error('加载任务失败', error)
      setFeedback({ type: 'error', message: '加载任务失败' })
    } finally {
      setLoading(false)
    }
  }

  const handleAcceptQuest = async (questId: string) => {
    try {
      const response = await axios.post(`/api/quests/${questId}/accept`)
      if (response.data.success) {
        setFeedback({ type: 'success', message: '任务接取成功' })
        loadQuests()
        if (response.data.quest) {
          setSelectedQuest(response.data.quest)
        }
      } else {
        setFeedback({ type: 'error', message: response.data.message || '任务接取失败' })
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.message || '任务接取失败'
      })
    }
  }

  const handleClaimReward = async (questId: string) => {
    try {
      const response = await axios.post(`/api/quests/${questId}/claim`)
      if (response.data.success) {
        setFeedback({ type: 'success', message: '奖励领取成功' })
        loadQuests()
        if (response.data.quest) {
          setSelectedQuest(response.data.quest)
        }
      } else {
        setFeedback({ type: 'error', message: response.data.message || '奖励领取失败' })
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.message || '奖励领取失败'
      })
    }
  }

  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      'LOCKED': '未解锁',
      'AVAILABLE': '可接取',
      'IN_PROGRESS': '进行中',
      'COMPLETED': '已完成',
      'CLAIMED': '已领取'
    }
    return statusMap[status] || status
  }

  const getStatusClass = (status: string) => {
    const classMap: Record<string, string> = {
      'LOCKED': 'locked',
      'AVAILABLE': 'available',
      'IN_PROGRESS': 'in-progress',
      'COMPLETED': 'completed',
      'CLAIMED': 'claimed'
    }
    return classMap[status] || ''
  }

  const getQuestTypeText = (type: string) => {
    const typeMap: Record<string, string> = {
      'MAIN': '主线',
      'SIDE': '支线',
      'DAILY': '日常',
      'WEEKLY': '周常',
      'ACHIEVEMENT': '成就'
    }
    return typeMap[type] || type
  }

  return (
    <div className="quest-page">
      <div className="quest-container">
        <div className="quest-header">
          <div className="header-top">
            <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
            <h1>任务</h1>
          </div>
        </div>

        {feedback && (
          <div className={`quest-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <div className="quest-content">
          <div className="quest-sidebar">
            <div className="quest-tabs">
              <button
                className={activeTab === 'all' ? 'active' : ''}
                onClick={() => setActiveTab('all')}
              >
                全部
              </button>
              <button
                className={activeTab === 'main' ? 'active' : ''}
                onClick={() => setActiveTab('main')}
              >
                主线
              </button>
              <button
                className={activeTab === 'side' ? 'active' : ''}
                onClick={() => setActiveTab('side')}
              >
                支线
              </button>
              <button
                className={activeTab === 'daily' ? 'active' : ''}
                onClick={() => setActiveTab('daily')}
              >
                日常
              </button>
              <button
                className={activeTab === 'weekly' ? 'active' : ''}
                onClick={() => setActiveTab('weekly')}
              >
                周常
              </button>
            </div>

            <div className="quest-list">
              {loading ? (
                <div className="loading">加载中...</div>
              ) : quests.length === 0 ? (
                <div className="empty">暂无任务</div>
              ) : (
                quests.map((quest) => (
                  <div
                    key={quest.quest_id}
                    className={`quest-card ${selectedQuest?.quest_id === quest.quest_id ? 'selected' : ''} ${getStatusClass(quest.status)}`}
                    onClick={() => setSelectedQuest(quest)}
                  >
                    <div className="quest-card-header">
                      <span className="quest-type">{getQuestTypeText(quest.quest_type)}</span>
                      <span className={`quest-status ${getStatusClass(quest.status)}`}>
                        {getStatusText(quest.status)}
                      </span>
                    </div>
                    <h3 className="quest-name">{quest.name}</h3>
                    <div className="quest-progress">
                      {quest.objectives.map((obj) => (
                        <div key={obj.objective_id} className="objective-progress">
                          <span>{obj.description}</span>
                          <span>{obj.current_count}/{obj.target_count}</span>
                        </div>
                      ))}
                    </div>
                    <div className="quest-reward-preview">
                      {quest.reward.exp > 0 && <span>经验 +{quest.reward.exp}</span>}
                      {quest.reward.gold > 0 && <span>金币 +{quest.reward.gold}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="quest-detail">
            {selectedQuest ? (
              <div className="quest-detail-content">
                <div className="quest-detail-header">
                  <h2>{selectedQuest.name}</h2>
                  <span className={`quest-status-badge ${getStatusClass(selectedQuest.status)}`}>
                    {getStatusText(selectedQuest.status)}
                  </span>
                </div>
                <div className="quest-type-badge">{getQuestTypeText(selectedQuest.quest_type)}</div>
                
                <div className="quest-description">
                  <p>{selectedQuest.description}</p>
                </div>

                <div className="quest-objectives">
                  <h3>任务目标</h3>
                  {selectedQuest.objectives.map((obj) => (
                    <div
                      key={obj.objective_id}
                      className={`objective-item ${obj.is_completed ? 'completed' : ''}`}
                    >
                      <div className="objective-info">
                        <span className="objective-desc">{obj.description}</span>
                        <span className="objective-count">
                          {obj.current_count} / {obj.target_count}
                        </span>
                      </div>
                      <div className="objective-progress-bar">
                        <div
                          className="objective-progress-fill"
                          style={{
                            width: `${(obj.current_count / obj.target_count) * 100}%`
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="quest-reward">
                  <h3>任务奖励</h3>
                  <div className="reward-items">
                    {selectedQuest.reward.exp > 0 && (
                      <div className="reward-item">
                        <span className="reward-icon">⭐</span>
                        <span>经验 +{selectedQuest.reward.exp}</span>
                      </div>
                    )}
                    {selectedQuest.reward.gold > 0 && (
                      <div className="reward-item">
                        <span className="reward-icon">💰</span>
                        <span>金币 +{selectedQuest.reward.gold}</span>
                      </div>
                    )}
                    {Object.keys(selectedQuest.reward.materials).length > 0 && (
                      <div className="reward-item">
                        <span className="reward-icon">📦</span>
                        <span>材料</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="quest-actions">
                  {selectedQuest.status === 'AVAILABLE' && (
                    <button
                      className="btn-accept"
                      onClick={() => handleAcceptQuest(selectedQuest.quest_id)}
                    >
                      接取任务
                    </button>
                  )}
                  {selectedQuest.status === 'COMPLETED' && (
                    <button
                      className="btn-claim"
                      onClick={() => handleClaimReward(selectedQuest.quest_id)}
                    >
                      领取奖励
                    </button>
                  )}
                  {selectedQuest.status === 'IN_PROGRESS' && (
                    <div className="quest-in-progress">任务进行中...</div>
                  )}
                  {selectedQuest.status === 'CLAIMED' && (
                    <div className="quest-claimed">奖励已领取</div>
                  )}
                  {selectedQuest.status === 'LOCKED' && (
                    <div className="quest-locked">任务未解锁</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="quest-detail-empty">
                <p>请选择一个任务查看详情</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default QuestPage



