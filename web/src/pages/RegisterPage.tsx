import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import './RegisterPage.css'

const RegisterPage: React.FC = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  
  const navigate = useNavigate()
  const { register } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await register(username, password, email || undefined)
    
    if (result.success) {
      navigate('/login')
    } else {
      setError(result.message)
    }
    
    setLoading(false)
  }

  return (
    <div className="register-page">
      <div className="register-container">
        <h1>灾异志</h1>
        <h2>注册</h2>
        
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
          
          <div className="form-group">
            <label>邮箱（可选）</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>
          
          {error && <div className="error-message">{error}</div>}
          
          <button type="submit" disabled={loading}>
            {loading ? '注册中...' : '注册'}
          </button>
        </form>
        
        <div className="login-link">
          已有账号？<Link to="/login">立即登录</Link>
        </div>
      </div>
    </div>
  )
}

export default RegisterPage


