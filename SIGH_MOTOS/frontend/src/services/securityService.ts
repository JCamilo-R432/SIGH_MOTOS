import api from './api'
import type { User, AuditLog, PaginatedResponse } from '@/types'

export interface CreateUserPayload {
  name: string
  email: string
  password: string
  role: 'ADMIN' | 'SELLER' | 'WAREHOUSE'
}

export interface UpdateUserPayload {
  name?: string
  email?: string
  role?: 'ADMIN' | 'SELLER' | 'WAREHOUSE'
  isActive?: boolean
  password?: string
}

export const securityService = {
  getUsers: async (): Promise<User[]> => {
    const { data } = await api.get('/security/users')
    return Array.isArray(data) ? data : data.users ?? data.data ?? []
  },

  createUser: async (payload: CreateUserPayload): Promise<User> => {
    const { data } = await api.post('/security/users', payload)
    return data.user ?? data
  },

  updateUser: async (id: string, payload: UpdateUserPayload): Promise<User> => {
    const { data } = await api.put(`/security/users/${id}`, payload)
    return data.user ?? data
  },

  toggleUserStatus: async (id: string, isActive: boolean): Promise<User> => {
    const { data } = await api.patch(`/security/users/${id}/status`, { isActive })
    return data.user ?? data
  },

  getAuditLogs: async (params: { page?: number; limit?: number; userId?: string; startDate?: string; endDate?: string } = {}): Promise<PaginatedResponse<AuditLog>> => {
    const { data } = await api.get('/security/audit-logs', { params })
    if (Array.isArray(data)) return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 }
    if (data.logs) return { data: data.logs, total: data.total ?? data.logs.length, page: data.page ?? 1, limit: data.limit ?? 50, totalPages: data.totalPages ?? 1 }
    return data
  },
}
