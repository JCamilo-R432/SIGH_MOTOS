import api from './api'
import type { PaginatedResponse } from '@/types'

export type DebtStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE'

export interface DebtPaymentRecord {
  id: string
  amount: number
  paymentMethod: string
  referenceDoc?: string
  note?: string
  timestamp: string
  performedBy?: { id: string; name: string }
}

export interface Debt {
  id: string
  saleId: string
  sale: { id: string; saleNumber: string; createdAt: string; totalAmount: number; paymentMethod: string }
  customerId: string
  customer: {
    id: string
    name: string
    phone?: string
    email?: string
    identificationNumber?: string
  }
  totalDebt: number
  paidAmount: number
  remainingBalance: number
  dueDate?: string
  status: DebtStatus
  createdAt: string
  updatedAt: string
  payments?: DebtPaymentRecord[]
}

export interface DebtSummary {
  counts: { pending: number; partial: number; overdue: number; total: number }
  amounts: { totalDebt: number; paidAmount: number; remainingBalance: number }
}

export const debtService = {
  listDebts: async (params: {
    status?: string
    customerId?: string
    page?: number
    limit?: number
  } = {}): Promise<PaginatedResponse<Debt>> => {
    const { data } = await api.get('/treasury/debts', { params })
    const payload = data.data ?? data
    if (Array.isArray(payload)) {
      return { data: payload, total: payload.length, page: 1, limit: payload.length, totalPages: 1 }
    }
    return payload
  },

  getDebt: async (id: string): Promise<Debt> => {
    const { data } = await api.get(`/treasury/debts/${id}`)
    return data.data ?? data
  },

  getSummary: async (): Promise<DebtSummary> => {
    const { data } = await api.get('/treasury/debts/summary')
    return data.data ?? data
  },

  registerPayment: async (
    id: string,
    payload: { amount: number; paymentMethod?: string; notes?: string; referenceDoc?: string }
  ): Promise<{ debt: Debt; payment: DebtPaymentRecord; saldoRestante: number; message: string }> => {
    const { data } = await api.patch(`/treasury/debts/${id}/pay`, payload)
    return data.data ?? data
  },
}
