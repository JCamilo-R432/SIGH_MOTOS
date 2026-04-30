import api from './api'
import type { Invoice, PaginatedResponse } from '@/types'

export interface InvoiceFilters {
  page?: number
  limit?: number
  startDate?: string
  endDate?: string
  customerId?: string
  status?: string
}

export const invoiceService = {
  getInvoices: async (filters: InvoiceFilters = {}): Promise<PaginatedResponse<Invoice>> => {
    const { data } = await api.get('/invoices', { params: filters })
    if (Array.isArray(data)) return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 }
    // Unwrap { success: true, data: { invoices: [...], total, page, ... } }
    const payload = (data as any)?.data ?? data
    if (Array.isArray(payload)) return { data: payload, total: payload.length, page: 1, limit: payload.length, totalPages: 1 }
    if (payload?.invoices) {
      const invoices = Array.isArray(payload.invoices) ? payload.invoices : []
      return { data: invoices, total: payload.total ?? invoices.length, page: payload.page ?? 1, limit: payload.limit ?? 20, totalPages: payload.totalPages ?? 1 }
    }
    return { data: [], total: 0, page: 1, limit: 20, totalPages: 0 }
  },

  getInvoice: async (id: string): Promise<Invoice> => {
    const { data } = await api.get(`/invoices/${id}`)
    return data.invoice ?? data
  },

  cancelInvoice: async (id: string, reason: string): Promise<Invoice> => {
    const { data } = await api.post(`/invoices/${id}/cancel`, { reason })
    return data.invoice ?? data
  },

  sendToDian: async (id: string): Promise<Invoice> => {
    const { data } = await api.post(`/invoices/${id}/send-dian`)
    return data.invoice ?? data
  },

  downloadXml: async (id: string): Promise<Blob> => {
    const { data } = await api.get(`/invoices/${id}/xml`, { responseType: 'blob' })
    return data
  },
}
