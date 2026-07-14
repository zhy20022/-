import { create } from 'zustand'
import axios from 'axios'

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
  login: (username: string, password: string) => Promise<{ success: boolean; message: string }>
  register: (username: string, password: string, email?: string) => Promise<{ success: boolean; message: string }>
  logout: () => void
  loadPlayer: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  player: null,
  token: null,

  login: async (username: string, password: string) => {
    try {
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
        message: error.response?.data?.message || '登录失败'
      }
    }
  },

  register: async (username: string, password: string, email?: string) => {
    try {
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
        message: error.response?.data?.message || '注册失败'
      }
    }
  },

  logout: async () => {
    try {
      await axios.post('/api/auth/logout')
    } catch (error) {
      console.error('登出失败', error)
    }
    set({
      isAuthenticated: false,
      player: null,
      token: null
    })
  },

  loadPlayer: async () => {
    try {
      const response = await axios.get('/api/player/info')
      if (response.data.success) {
        set({
          isAuthenticated: true,
          player: response.data.player
        })
      }
    } catch (error) {
      set({
        isAuthenticated: false,
        player: null
      })
    }
  }
}))


