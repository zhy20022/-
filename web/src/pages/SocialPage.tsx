import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import './SocialPage.css'

interface Friend {
  friend_id: string
  username: string
  last_active_at: string
  support_attribute?: string
  assist_available: boolean
}

const SocialPage: React.FC = () => {
  const navigate = useNavigate()
  const [friends, setFriends] = useState<Friend[]>([])
  const [newFriend, setNewFriend] = useState('')
  const [assistEnabled, setAssistEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadFriends = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/social/friends')
      if (response.data.success) {
        setFriends(response.data.friends || [])
        setAssistEnabled(response.data.assist_enabled)
      } else {
        setError(response.data.message || '无法加载好友信息')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || '无法连接服务器')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFriends()
  }, [])

  const handleAddFriend = async () => {
    if (!newFriend.trim()) return
    try {
      const response = await axios.post('/api/social/friends', { username: newFriend.trim() })
      if (response.data.success) {
        setFriends(response.data.friends || [])
        setNewFriend('')
        setError(null)
      } else {
        setError(response.data.message || '添加好友失败')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || '添加好友失败')
    }
  }

  const handleRemoveFriend = async (friendId: string) => {
    try {
      const response = await axios.delete(`/api/social/friends/${friendId}`)
      if (response.data.success) {
        setFriends(response.data.friends || [])
      } else {
        setError(response.data.message || '删除好友失败')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || '删除好友失败')
    }
  }

  const handleAssistToggle = async (value: boolean) => {
    setAssistEnabled(value)
    try {
      await axios.post('/api/social/assist-mode', { enabled: value })
    } catch (err: any) {
      setAssistEnabled(!value)
      setError(err.response?.data?.message || '更新助战状态失败')
    }
  }

  return (
    <div className="social-page">
      <div className="social-container">
        <header className="social-header">
          <div>
            <div className="header-top">
              <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
              <h1>好友与助战</h1>
            </div>
            <p>参考失落的龙约：无限好友，无限制助战支援</p>
          </div>
          <div className="assist-toggle">
            <label>
              <input
                type="checkbox"
                checked={assistEnabled}
                onChange={(e) => handleAssistToggle(e.target.checked)}
              />
              <span>
                启用助战模式（副本掉落转换为每次 1000 金币）
              </span>
            </label>
          </div>
        </header>

        <section className="add-friend-section">
          <h2>添加好友</h2>
          <div className="add-friend-form">
            <input
              type="text"
              placeholder="输入好友用户名"
              value={newFriend}
              onChange={(e) => setNewFriend(e.target.value)}
            />
            <button onClick={handleAddFriend}>添加</button>
          </div>
          <p className="hint">好友数量无限制，可随时助战彼此的副本。</p>
        </section>

        {loading && <div className="social-loading">加载好友列表中...</div>}
        {error && <div className="social-error">{error}</div>}

        {!loading && friends.length === 0 && (
          <div className="empty-friends">还没有好友，快去添加吧！</div>
        )}

        <div className="friend-grid">
          {friends.map((friend) => (
            <div key={friend.friend_id} className="friend-card">
              <div className="friend-avatar">
                {friend.username.slice(0, 1).toUpperCase()}
              </div>
              <div className="friend-body">
                <h3>{friend.username}</h3>
                <p>最近上线：{new Date(friend.last_active_at).toLocaleString()}</p>
                <p>助战状态：{friend.assist_available ? '可支援' : '暂不可支援'}</p>
              </div>
              <button onClick={() => handleRemoveFriend(friend.friend_id)}>删除</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SocialPage







