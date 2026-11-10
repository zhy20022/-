import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { getOnlineApiBase, isFormalOnlineMode } from '../config'
import './LoginPage.css'

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const pending = useRef(false)
  const [backendState, setBackendState] = useState<'connecting' | 'ready' | 'unavailable'>('connecting')

  useEffect(() => {
    if (!isFormalOnlineMode()) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setBackendState('unavailable')
      controller.abort()
    }, 90000)
    const base = getOnlineApiBase().replace(/\/api$/, '')
    void fetch(`${base}/api/health/ready`, { signal: controller.signal }).then(response => {
      if (!controller.signal.aborted) setBackendState(response.ok ? 'ready' : 'unavailable')
    }).catch(() => {
      if (!controller.signal.aborted) setBackendState('unavailable')
    }).finally(() => window.clearTimeout(timeout))
    return () => { controller.abort(); window.clearTimeout(timeout) }
  }, [])
  
  const navigate = useNavigate()
  const { login, loginGuest, sessionError } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending.current) return
    pending.current = true
    setError('')
    setLoading(true)

    try {
      const result = await login(username, password)
      if (result.success) navigate('/')
      else setError(result.message)
    } finally {
      setLoading(false)
      pending.current = false
    }
  }

  const handleGuestLogin = async () => {
    if (pending.current) return
    pending.current = true
    setError('')
    setLoading(true)
    try {
      const result = await loginGuest()
      if (result.success) navigate('/')
      else setError(result.message)
    } finally {
      pending.current = false
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <h1>灾异志</h1>
        <h2>登录</h2>
        {isFormalOnlineMode() && backendState !== 'ready' && (
          <p role="status">{backendState === 'connecting' ? '正在连接服务器，首次唤醒可能需要约一分钟。'
            : '服务器暂未就绪，请稍后重试。'}</p>
        )}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          
          <div className="form-group">
            <label>密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          
          {(error || sessionError) && <div role="alert" className="error-message">{error || sessionError}</div>}
          
          <button type="submit" disabled={loading || isFormalOnlineMode() && backendState === 'connecting'}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
        {isFormalOnlineMode() && (
          <button type="button" onClick={() => void handleGuestLogin()} disabled={loading || backendState === 'connecting'}>游客登录</button>
        )}
        
        <div className="register-link">
          还没有账号？<Link to="/register">立即注册</Link>
        </div>
      </div>
    </div>
  )
}

export default LoginPage


