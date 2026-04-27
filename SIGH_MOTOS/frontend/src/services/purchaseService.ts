import api from './api'
import type { PurchaseOrder, Supplier, PaginatedResponse } from '@/types'

export interface PurchaseOrderFilters {
  page?: number
  limit?: number
  supplierId?: string
  status?: string
}

export interface CreatePurchaseOrderPayload {
  supplierId: string
  items: { productId: string; quantity: number; unitCost: number }[]
  expectedDate?: string
  notes?: string
}

export const purchaseService = {
  getOrders: async (filters: PurchaseOrderFilters = {}): Promise<PaginatedResponse<PurchaseOrder>> => {
    const { data } = await api.get('/purchases/orders', { params: filters })
    if (Array.isArray(data)) return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 }
    if (data.orders) return { data: data.orders, total: data.total ?? data.orders.length, page: data.page ?? 1, limit: data.limit ?? 50, totalPages: data.totalPages ?? 1 }
    return data
  },

  getOrder: async (id: string): Promise<PurchaseOrder> => {
    const { data } = await api.get(`/purchases/orders/${id}`)
    return data.order ?? data
  },

  createOrder: async (payload: CreatePurchaseOrderPayload): Promise<PurchaseOrder> => {
    const { data } = await api.post('/purchases/orders', payload)
    return data.order ?? data
  },

  receiveOrder: async (id: string, items?: { productId: string; receivedQty: number }[]): Promise<PurchaseOrder> => {
    const { data } = await api.put(`/purchases/orders/${id}/receive`, { items })
    return data.order ?? data
  },

  cancelOrder: async (id: string, reason?: string): Promise<void> => {
    await api.post(`/purchases/orders/${id}/cancel`, { reason })
  },

  getSuppliers: async (search?: string): Promise<Supplier[]> => {
    const { data } = await api.get('/suppliers', { params: { search, limit: 50 } })
    return Array.isArray(data) ? data : data.suppliers ?? data.data ?? []
  },

  createSupplier: async (payload: Partial<Supplier>): Promise<Supplier> => {
    const { data } = await api.post('/suppliers', payload)
    return data.supplier ?? data
  },

  updateSupplier: async (id: string, payload: Partial<Supplier>): Promise<Supplier> => {
    const { data } = await api.put(`/suppliers/${id}`, payload)
    return data.supplier ?? data
  },
}
