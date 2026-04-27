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
    if (data.invoices) return { data: data.invoices, total: data.total ?? data.invoices.length, page: data.page ?? 1, limit: data.limit ?? 50, totalPages: data.totalPages ?? 1 }
    return data
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
