import api from './api'
import type { User } from '@/types'

export interface LoginResponse {
  token: string
  user: User
}

export const authService = {
  /**
   * POST /auth/login  (ruta canónica del backend)
   * También acepta /security/login como fallback.
   */
  login: async (credentials: { email: string; password: string }): Promise<LoginResponse> => {
    try {
      const { data } = await api.post('/auth/login', credentials)
      // Normalize different response shapes
      if (data.token && data.user) return data
      if (data.data?.token && data.data?.user) return data.data
      if (data.accessToken) return { token: data.accessToken, user: data.user ?? data.data?.user }
      return data
    } catch {
      // Fallback: some deployments expose login at /security/login
      const { data } = await api.post('/security/login', credentials)
      if (data.token && data.user) return data
      if (data.data?.token) return data.data
      return data
    }
  },

  me: async (): Promise<User> => {
    try {
      const { data } = await api.get('/auth/me')
      return data.user ?? data.data ?? data
    } catch {
      const { data } = await api.get('/security/me')
      return data.user ?? data.data ?? data
    }
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await api.post('/auth/change-password', { currentPassword, newPassword })
  },
}
