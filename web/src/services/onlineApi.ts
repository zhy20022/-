import axios, { AxiosError } from 'axios'
import { getOnlineApiBase } from '../config'

export interface OnlineSessionPlayer {
  id: string
  displayName: string
  level: number
  gold: number
}

export interface OnlineSession {
  accessToken: string
  player: OnlineSessionPlayer
}

export interface LegacyPlayerRef {
  id?: string
  player_id?: string
  username?: string
  displayName?: string
}

const base = getOnlineApiBase()

export const onlineApi = axios.create({
  baseURL: base.endsWith('/api') ? base : `${base}/api`,
  timeout: 10000,
})

onlineApi.interceptors.request.use((config) => {
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
  const cached = localStorage.getItem(sessionKey)
  if (cached && !options.forceRefresh) {
    try {
      const session = JSON.parse(cached) as OnlineSession
      if (isSessionUsable(session)) {
        localStorage.setItem('gamer_online_access_token', session.accessToken)
        localStorage.setItem('gamer_online_player_id', session.player.id)
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
  localStorage.setItem(sessionKey, JSON.stringify(session))
  localStorage.setItem('gamer_online_access_token', session.accessToken)
  localStorage.setItem('gamer_online_player_id', session.player.id)
  return session
}

export const clearOnlineSession = () => {
  localStorage.removeItem('gamer_online_access_token')
  localStorage.removeItem('gamer_online_player_id')
  Object.keys(localStorage)
    .filter((key) => key.startsWith('gamer_online_session_'))
    .forEach((key) => localStorage.removeItem(key))
}

export const getApiErrorMessage = (error: unknown, fallback = '请求失败，请稍后重试') => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ message?: string | string[]; error?: string }>
    if (axiosError.response?.status === 401) return '权限校验失败，请重新绑定在线账号或检查后台令牌'
    const message = axiosError.response?.data?.message
    if (Array.isArray(message)) return message.join('；')
    if (message) return message
    if (axiosError.response?.data?.error) return axiosError.response.data.error
    if (axiosError.code === 'ECONNABORTED') return '请求超时，请确认在线后端是否运行'
    if (!axiosError.response) return '无法连接在线后端，请检查 server-nest 或 VITE_ONLINE_API_URL'
  }
  return fallback
}

const isSessionUsable = (session: OnlineSession) => {
  if (!session.accessToken || !session.player?.id) return false
  const parts = session.accessToken.split('.')
  if (parts.length !== 3 || parts[0] !== 'online') return false
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(normalized)) as { exp?: number }
    return Boolean(payload.exp && payload.exp > Math.floor(Date.now() / 1000) + 60)
  } catch {
    return false
  }
}
