import { create } from 'zustand'
import axios from 'axios'
import { isFormalOnlineMode } from '../config'
import { clearOnlineSession, getApiErrorMessage, onlineApi, persistOnlineSession, requestGuestSession, restoreOnlineSession } from '../services/onlineApi'
import type { OnlineSession } from '../services/onlineApi'
import { safeErrorLog } from '../services/safeErrorLog'

interface Player {
  player_id: string
  username: string
  level: number
  exp: number
  gold: number
}

interface AuthState {
  isAuthenticated: boolean
  player: Player | null
  token: string | null
  sessionError: string | null
  login: (username: string, password: string) => Promise<{ success: boolean; message: string }>
  loginGuest: () => Promise<{ success: boolean; message: string }>
  register: (username: string, password: string, email?: string) => Promise<{ success: boolean; message: string }>
  logout: () => void
  loadPlayer: () => Promise<void>
}

let authRevision = 0
let pendingAuthentication: number | null = null

const onlineAuthState = (session: OnlineSession) => ({
  isAuthenticated: true,
  player: {
    player_id: session.player.id,
    username: session.player.displayName,
    level: session.player.level,
    exp: 0,
    gold: session.player.gold,
  },
  token: session.accessToken,
  sessionError: null,
})

export const useAuthStore = create<AuthState>((set) => {
  const authenticateOnline = async (request: () => Promise<OnlineSession>, identity?: string) => {
    if (pendingAuthentication !== null) return { success: false, message: '登录请求处理中，请稍候' }
    const revision = ++authRevision
    pendingAuthentication = revision
    try {
      const session = await request()
      if (revision !== authRevision) return { success: false, message: '登录操作已取消，请重试' }
      persistOnlineSession(session, identity)
      set(onlineAuthState(session))
      return { success: true, message: '登录成功' }
    } catch (error) {
      return { success: false, message: getApiErrorMessage(error, '登录失败，请重试') }
    } finally {
      if (pendingAuthentication === revision) pendingAuthentication = null
    }
  }

  return {
  isAuthenticated: false,
  player: null,
  token: null,
  sessionError: null,

  login: async (username: string, password: string) => {
    try {
      if (isFormalOnlineMode()) {
        return await authenticateOnline(
          () => onlineApi.post('/auth/login', { username, password }).then((response) => response.data),
          username,
        )
      }

      const response = await axios.post('/api/auth/login', {
        username,
        password
      })

      if (response.data.success) {
        set({
          isAuthenticated: true,
          player: response.data.player,
          token: response.data.token || null
        })
        return { success: true, message: response.data.message }
      } else {
        return { success: false, message: response.data.message }
      }
    } catch (error: any) {
      return {
        success: false,
        message: getApiErrorMessage(error, error.response?.data?.message || '登录失败')
      }
    }
  },

  loginGuest: async () => {
    if (!isFormalOnlineMode()) return { success: false, message: '当前模式不支持在线游客登录' }
    return authenticateOnline(requestGuestSession)
  },

  register: async (username: string, password: string, email?: string) => {
    try {
      if (isFormalOnlineMode()) {
        return await authenticateOnline(
          () => onlineApi.post('/auth/register', { username, password, email }).then((response) => response.data),
          username,
        )
      }

      const response = await axios.post('/api/auth/register', {
        username,
        password,
        email
      })

      if (response.data.success) {
        return { success: true, message: response.data.message }
      } else {
        return { success: false, message: response.data.message }
      }
    } catch (error: any) {
      return {
        success: false,
        message: getApiErrorMessage(error, error.response?.data?.message || '注册失败')
      }
    }
  },

  logout: async () => {
    authRevision++
    pendingAuthentication = null
    try {
      if (isFormalOnlineMode()) {
        clearOnlineSession()
      } else {
        await axios.post('/api/auth/logout')
      }
    } catch (error) {
      safeErrorLog('auth.logout', error)
    }
    set({
      isAuthenticated: false,
      player: null,
      token: null,
      sessionError: null,
    })
  },

  loadPlayer: async () => {
    const revision = authRevision
    try {
      if (isFormalOnlineMode()) {
        const session = restoreOnlineSession()
        if (!session) {
          clearOnlineSession()
          throw new Error('请登录正式账号或选择游客登录')
        }
        try {
          const response = await onlineApi.get(`/players/${session.player.id}/profile`)
          if (revision !== authRevision) return
          if (response.data?.success === false || response.data?.player?.id !== session.player.id) {
            throw new Error('online profile does not match the session')
          }
          const restored = { ...session, player: response.data.player }
          persistOnlineSession(restored)
          set(onlineAuthState(restored))
        } catch (error) {
          if (revision !== authRevision) return
          if (axios.isAxiosError(error)) {
            if ([401, 403].includes(error.response?.status || 0)) clearOnlineSession()
            else {
              // An unavailable profile is not an authentication rejection; keep page retry reachable.
              set({ ...onlineAuthState(session), sessionError: getApiErrorMessage(error, '会话验证暂不可用，请重试') })
              return
            }
          }
          throw error
        }
        return
      }

      const response = await axios.get('/api/player/info')
      if (response.data.success) {
        set({
          isAuthenticated: true,
          player: response.data.player
        })
      }
    } catch (error) {
      if (revision !== authRevision) return
      set({
        isAuthenticated: false,
        player: null,
        token: null,
        sessionError: isFormalOnlineMode() ? getApiErrorMessage(error, '会话恢复失败，请重新登录') : null,
      })
    }
  }
  }
})


