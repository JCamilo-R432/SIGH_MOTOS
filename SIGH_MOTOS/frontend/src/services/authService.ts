import api from './api'
import type { User } from '@/types'

export interface LoginResponse {
  token: string
  user: User
}

export const authService = {
  login: async (credentials: { email: string; password: string }): Promise<LoginResponse> => {
    const { data } = await api.post('/auth/login', credentials)
    // Backend devuelve { success: true, data: { token, user } }
    if (data.data?.token && data.data?.user) return data.data
    if (data.token && data.user) return data
    throw new Error('Respuesta de login inesperada')
  },

  // GET /api/v1/auth/me — requiere token en Authorization header
  me: async (): Promise<User> => {
    const { data } = await api.get('/auth/me')
    return data.data ?? data.user ?? data
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await api.post('/security/change-password', { currentPassword, newPassword })
  },
}
