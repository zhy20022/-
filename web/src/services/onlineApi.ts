import axios, { AxiosError } from 'axios'
import { getOnlineApiBase, isFormalOnlineMode } from '../config'

export interface OnlineSessionPlayer {
  id: string
  displayName: string
  level: number
  gold: number
}

export interface OnlineSession {
  accessToken: string
  player: OnlineSessionPlayer
  user?: { id: string; provider: 'guest' | 'password' | 'wechat' | 'apple'; status: string }
}

export interface LegacyPlayerRef {
  id?: string
  player_id?: string
  username?: string
  displayName?: string
}

const base = getOnlineApiBase()
const currentSessionKey = 'gamer_online_current_session'

export const onlineApi = axios.create({
  baseURL: base.endsWith('/api') ? base : `${base}/api`,
  timeout: 60000,
})

export const createIdempotencyKey = (scope: string) => {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${scope.replace(/[^A-Za-z0-9._:-]/g, '-')}:${suffix}`.slice(0, 128)
}

onlineApi.interceptors.request.use((config) => {
  // Public authentication must also work when an old token is expired or revoked.
  if (/(?:^|\/)auth\/(?:login|register|guest)(?:\?|$)/.test(config.url || '')) {
    config.headers.delete('Authorization')
    return config
  }
  const token = localStorage.getItem('gamer_online_access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export const ensureOnlineSession = async (
  legacyPlayer: LegacyPlayerRef | null | undefined,
  options: { forceRefresh?: boolean } = {},
): Promise<OnlineSession> => {
  const stableId = legacyPlayer?.id || legacyPlayer?.player_id || legacyPlayer?.username || 'local-player'
  const sessionKey = `gamer_online_session_${stableId}`
  const current = readSession(currentSessionKey)
  if (isFormalOnlineMode()) {
    const playerId = legacyPlayer?.id || legacyPlayer?.player_id
    if (!current || (playerId && current.player.id !== playerId)) {
      throw new axios.AxiosError('在线会话已失效或与当前账号不匹配，请返回登录页重新登录', 'ONLINE_SESSION_REQUIRED')
    }
    activateSession(current)
    return current
  }
  if (current && (!options.forceRefresh || current.player.id === legacyPlayer?.id || current.player.id === legacyPlayer?.player_id)) {
    activateSession(current)
    return current
  }
  const cached = localStorage.getItem(sessionKey)
  if (cached && !options.forceRefresh) {
    try {
      const session = JSON.parse(cached) as OnlineSession
      if (isSessionUsable(session)) {
        activateSession(session)
        return session
      }
    } catch {
      localStorage.removeItem(sessionKey)
    }
  }

  const response = await onlineApi.post('/auth/guest', {
    deviceId: `legacy:${stableId}`,
    displayName: legacyPlayer?.displayName || legacyPlayer?.username || `Player_${String(stableId).slice(0, 8)}`,
  })
  const session: OnlineSession = {
    accessToken: response.data.accessToken,
    player: response.data.player,
  }
  persistOnlineSession(session, stableId)
  return session
}

export const persistOnlineSession = (session: OnlineSession, identity?: string) => {
  if (!isSessionUsable(session)) throw new Error('在线登录响应无效，请重试')
  localStorage.setItem(currentSessionKey, JSON.stringify(session))
  localStorage.setItem(`gamer_online_session_${session.player.id}`, JSON.stringify(session))
  if (identity) localStorage.setItem(`gamer_online_session_${identity}`, JSON.stringify(session))
  activateSession(session)
}

export const requestGuestSession = async (): Promise<OnlineSession> => {
  const key = 'gamer_online_guest_device_id'
  let deviceId = localStorage.getItem(key)
  if (!deviceId || !/^[0-9a-f-]{36}$/i.test(deviceId)) {
    deviceId = crypto.randomUUID()
    localStorage.setItem(key, deviceId)
  }
  const response = await onlineApi.post('/auth/guest', { deviceId })
  return response.data
}

export const restoreOnlineSession = () => {
  const session = readSession(currentSessionKey)
  if (session) activateSession(session)
  return session
}

export const clearOnlineSession = () => {
  localStorage.removeItem('gamer_online_access_token')
  localStorage.removeItem('gamer_online_player_id')
  localStorage.removeItem(currentSessionKey)
  Object.keys(localStorage)
    .filter((key) => key.startsWith('gamer_online_session_'))
    .forEach((key) => localStorage.removeItem(key))
}

const readSession = (key: string) => {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as OnlineSession
    return isSessionUsable(session) ? session : null
  } catch {
    localStorage.removeItem(key)
    return null
  }
}

const activateSession = (session: OnlineSession) => {
  localStorage.setItem('gamer_online_access_token', session.accessToken)
  localStorage.setItem('gamer_online_player_id', session.player.id)
}

export const getApiErrorMessage = (error: unknown, fallback = '请求失败，请稍后重试') => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ message?: string | string[]; error?: string }>
    if (axiosError.code === 'ONLINE_SESSION_REQUIRED') return axiosError.message
    if (axiosError.response?.status === 401) return '登录信息无效或已过期，请重新登录'
    const message = axiosError.response?.data?.message
    if (Array.isArray(message)) return message.join('；')
    if (message) return message
    if (axiosError.response?.data?.error) return axiosError.response.data.error
    if (axiosError.code === 'ECONNABORTED') return '请求超时，请确认在线后端是否运行'
    if (!axiosError.response) return '无法连接在线后端，请检查 server-nest 或 VITE_ONLINE_API_URL'
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

const isSessionUsable = (session: OnlineSession & { success?: boolean }) => {
  if (!session || session.success === false || typeof session.accessToken !== 'string'
    || typeof session.player?.id !== 'string' || !session.player.id) return false
  const parts = session.accessToken.split('.')
  if (parts.length !== 3 || parts[0] !== 'online') return false
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(normalized)) as { exp?: number; playerId?: string }
    return Boolean(typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      && payload.exp > Math.floor(Date.now() / 1000) + 60
      && (!payload.playerId || payload.playerId === session.player.id))
  } catch {
    return false
  }
}
