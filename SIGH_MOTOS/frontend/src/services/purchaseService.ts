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
    // Unwrap { success: true, data: { orders: [...], total, page, ... } }
    const payload = (data as any)?.data ?? data
    if (Array.isArray(payload)) return { data: payload, total: payload.length, page: 1, limit: payload.length, totalPages: 1 }
    if (payload?.orders) {
      const orders = Array.isArray(payload.orders) ? payload.orders : []
      return { data: orders, total: payload.total ?? orders.length, page: payload.page ?? 1, limit: payload.limit ?? 20, totalPages: payload.totalPages ?? 1 }
    }
    if (payload?.data) {
      const items = Array.isArray(payload.data) ? payload.data : []
      return { data: items, total: payload.meta?.total ?? payload.total ?? items.length, page: payload.meta?.page ?? payload.page ?? 1, limit: payload.meta?.limit ?? payload.limit ?? 20, totalPages: payload.meta?.totalPages ?? payload.totalPages ?? 1 }
    }
    return { data: [], total: 0, page: 1, limit: 20, totalPages: 0 }
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
