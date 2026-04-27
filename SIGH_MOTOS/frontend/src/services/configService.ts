import api from './api'

export interface BusinessConfig {
  id: string
  businessName: string
  nit: string
  address: string
  phone: string
  email?: string | null
  logoKey?: string | null
  taxRate: number
  resolutionDian?: string | null
  footer: string
  updatedAt: string
}

export const configService = {
  getConfig: async (): Promise<BusinessConfig> => {
    const { data } = await api.get('/config')
    return data.data ?? data
  },

  updateConfig: async (payload: Partial<Omit<BusinessConfig, 'id' | 'updatedAt'>>): Promise<BusinessConfig> => {
    const { data } = await api.put('/config', payload)
    return data.data ?? data
  },
}
