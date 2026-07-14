import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import './AchievementPage.css'

interface Achievement {
  achievement_id: string
  name: string
  description: string
  category: string
  rarity: string
  unlocked: boolean
  unlocked_at: string | null
  reward: Record<string, any>
  icon: string
  hidden: boolean
  progress: Record<string, any>
}

const AchievementPage: React.FC = () => {
  const navigate = useNavigate()
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedRarity, setSelectedRarity] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    loadAchievements()
  }, [selectedCategory, selectedRarity])

  const loadAchievements = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (selectedCategory !== 'all') {
        params.append('category', selectedCategory)
      }
      if (selectedRarity !== 'all') {
        params.append('rarity', selectedRarity)
      }
      const response = await axios.get(`/api/achievements/list?${params.toString()}`)
      if (response.data.success) {
        setAchievements(response.data.achievements)
      }
    } catch (error) {
      console.error('加载成就失败', error)
      setFeedback({ type: 'error', message: '加载成就失败' })
    } finally {
      setLoading(false)
    }
  }

  const handleCheckAchievements = async () => {
    try {
      const response = await axios.post('/api/achievements/check')
      if (response.data.success) {
        const count = response.data.newly_unlocked.length
        if (count > 0) {
          setFeedback({ type: 'success', message: `解锁了 ${count} 个成就！` })
        } else {
          setFeedback({ type: 'success', message: '暂无新成就解锁' })
        }
        loadAchievements()
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.message || '检查成就失败'
      })
    }
  }

  const getCategoryText = (category: string) => {
    const categoryMap: Record<string, string> = {
      'COMBAT': '战斗',
      'DUNGEON': '副本',
      'CHARACTER': '角色',
      'EQUIPMENT': '装备',
      'SOCIAL': '社交',
      'COLLECTION': '收集',
      'MILESTONE': '里程碑'
    }
    return categoryMap[category] || category
  }

  const getRarityText = (rarity: string) => {
    const rarityMap: Record<string, string> = {
      'COMMON': '普通',
      'RARE': '稀有',
      'EPIC': '史诗',
      'LEGENDARY': '传说'
    }
    return rarityMap[rarity] || rarity
  }

  const getRarityClass = (rarity: string) => {
    const classMap: Record<string, string> = {
      'COMMON': 'common',
      'RARE': 'rare',
      'EPIC': 'epic',
      'LEGENDARY': 'legendary'
    }
    return classMap[rarity] || 'common'
  }

  const unlockedCount = achievements.filter(a => a.unlocked).length
  const totalCount = achievements.length

  return (
    <div className="achievement-page">
      <div className="achievement-container">
        <div className="achievement-header">
          <h1>成就</h1>
          <div className="header-actions">
            <button onClick={handleCheckAchievements} className="btn-check">
              检查成就
            </button>
            <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
          </div>
        </div>

        <div className="achievement-stats">
          <div className="stat-item">
            <span className="stat-label">完成度</span>
            <span className="stat-value">
              {unlockedCount} / {totalCount}
            </span>
            <div className="stat-progress-bar">
              <div
                className="stat-progress-fill"
                style={{ width: `${totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {feedback && (
          <div className={`achievement-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <div className="achievement-filters">
          <div className="filter-group">
            <label>分类：</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="all">全部</option>
              <option value="combat">战斗</option>
              <option value="dungeon">副本</option>
              <option value="character">角色</option>
              <option value="equipment">装备</option>
              <option value="social">社交</option>
              <option value="collection">收集</option>
              <option value="milestone">里程碑</option>
            </select>
          </div>
          <div className="filter-group">
            <label>稀有度：</label>
            <select
              value={selectedRarity}
              onChange={(e) => setSelectedRarity(e.target.value)}
            >
              <option value="all">全部</option>
              <option value="common">普通</option>
              <option value="rare">稀有</option>
              <option value="epic">史诗</option>
              <option value="legendary">传说</option>
            </select>
          </div>
        </div>

        <div className="achievement-grid">
          {loading ? (
            <div className="loading">加载中...</div>
          ) : achievements.length === 0 ? (
            <div className="empty">暂无成就</div>
          ) : (
            achievements.map((achievement) => (
              <div
                key={achievement.achievement_id}
                className={`achievement-card ${achievement.unlocked ? 'unlocked' : 'locked'} ${getRarityClass(achievement.rarity)}`}
              >
                <div className="achievement-icon">
                  {achievement.icon ? (
                    <img src={achievement.icon} alt={achievement.name} />
                  ) : (
                    <div className="icon-placeholder">🏆</div>
                  )}
                </div>
                <div className="achievement-info">
                  <div className="achievement-header-info">
                    <h3 className="achievement-name">{achievement.name}</h3>
                    <span className={`rarity-badge ${getRarityClass(achievement.rarity)}`}>
                      {getRarityText(achievement.rarity)}
                    </span>
                  </div>
                  <p className="achievement-description">{achievement.description}</p>
                  <div className="achievement-category">
                    {getCategoryText(achievement.category)}
                  </div>
                  {achievement.unlocked && achievement.unlocked_at && (
                    <div className="achievement-unlocked-time">
                      解锁时间：{new Date(achievement.unlocked_at).toLocaleDateString()}
                    </div>
                  )}
                  {achievement.reward && Object.keys(achievement.reward).length > 0 && (
                    <div className="achievement-reward">
                      <span className="reward-label">奖励：</span>
                      {achievement.reward.exp > 0 && (
                        <span className="reward-item">经验 +{achievement.reward.exp}</span>
                      )}
                      {achievement.reward.gold > 0 && (
                        <span className="reward-item">金币 +{achievement.reward.gold}</span>
                      )}
                    </div>
                  )}
                </div>
                {achievement.unlocked && (
                  <div className="achievement-checkmark">✓</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default AchievementPage



