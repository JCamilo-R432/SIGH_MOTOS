import api from './api'
import type { CashRegister, TreasuryTransaction } from '@/types'

export interface OpenCashRegisterPayload {
  openingBalance: number
  notes?: string
}

export interface CloseCashRegisterPayload {
  actualBalance: number
  notes?: string
}

export interface CreateExpensePayload {
  concept: string
  amount: number
  paymentMethod: string
  cashRegisterId?: string
}

export const treasuryService = {
  getCurrentRegister: async (): Promise<CashRegister | null> => {
    try {
      const { data } = await api.get('/treasury/cash-register/current')
      return data.cashRegister ?? data
    } catch {
      return null
    }
  },

  openRegister: async (payload: OpenCashRegisterPayload): Promise<CashRegister> => {
    const { data } = await api.post('/treasury/cash-register/open', payload)
    return data.cashRegister ?? data
  },

  closeRegister: async (id: string, payload: CloseCashRegisterPayload): Promise<CashRegister> => {
    const { data } = await api.post(`/treasury/cash-register/${id}/close`, payload)
    return data.cashRegister ?? data
  },

  getRegisters: async (): Promise<CashRegister[]> => {
    const { data } = await api.get('/treasury/cash-register')
    return Array.isArray(data) ? data : data.registers ?? data.data ?? []
  },

  createExpense: async (payload: CreateExpensePayload): Promise<TreasuryTransaction> => {
    const { data } = await api.post('/treasury/expenses', payload)
    return data.transaction ?? data
  },

  getTransactions: async (cashRegisterId?: string): Promise<TreasuryTransaction[]> => {
    const params = cashRegisterId ? { cashRegisterId } : {}
    const { data } = await api.get('/treasury/transactions', { params })
    return Array.isArray(data) ? data : data.transactions ?? data.data ?? []
  },

  getDailyReport: async (date?: string): Promise<{
    openingBalance: number
    totalSales: number
    totalExpenses: number
    closingBalance: number
    transactions: TreasuryTransaction[]
  }> => {
    const { data } = await api.get('/treasury/daily-report', { params: { date } })
    return data
  },
}
