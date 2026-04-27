import api from './api'
import type { Sale, CreateSalePayload, Customer, PaginatedResponse } from '@/types'

export const posService = {
  createSale: async (payload: CreateSalePayload): Promise<Sale> => {
    const { data } = await api.post('/pos/sales', payload)
    return data.data ?? data.sale ?? data
  },

  getSales: async (params: { page?: number; limit?: number; startDate?: string; endDate?: string } = {}): Promise<PaginatedResponse<Sale>> => {
    const { data } = await api.get('/pos/sales', { params })
    const payload = data.data ?? data
    if (Array.isArray(payload)) return { data: payload, total: payload.length, page: 1, limit: payload.length, totalPages: 1 }
    if (payload.data && payload.meta) return { data: payload.data, total: payload.meta.total, page: payload.meta.page, limit: payload.meta.limit, totalPages: payload.meta.totalPages }
    if (payload.sales) return { data: payload.sales, total: payload.total ?? payload.sales.length, page: payload.page ?? 1, limit: payload.limit ?? 50, totalPages: payload.totalPages ?? 1 }
    return payload
  },

  getSale: async (id: string): Promise<Sale> => {
    const { data } = await api.get(`/pos/sales/${id}`)
    return data.data ?? data.sale ?? data
  },

  cancelSale: async (id: string, reason: string): Promise<void> => {
    await api.post(`/pos/sales/${id}/cancel`, { reason })
  },

  searchProduct: async (query: string): Promise<import('@/types').Product | null> => {
    try {
      const { data } = await api.get('/inventory/products', {
        params: { search: query, limit: 1 },
      })
      const products = Array.isArray(data) ? data : data.products ?? data.data ?? []
      return products[0] ?? null
    } catch {
      return null
    }
  },

  scanProduct: async (code: string): Promise<import('@/types').Product | null> => {
    try {
      const { data } = await api.get('/pos/products/scan', { params: { code } })
      const p: Record<string, unknown> = data.data ?? data
      if (!p || typeof p !== 'object' || !p['id']) return null
      return {
        id:          p['id'] as string,
        sku:         (p['skuInternal']  ?? p['sku'])  as string,
        barcode:     (p['barcodeExternal'] ?? p['barcode']) as string | undefined,
        name:        (p['nameCommercial'] ?? p['name']) as string,
        description: p['descriptionTech'] as string | undefined,
        categoryId:  (p['categoryId'] ?? '') as string,
        category:    p['category'] as import('@/types').Category | undefined,
        brandId:     p['brandId'] as string | undefined,
        brand:       p['brand']   as import('@/types').Brand | undefined,
        costPrice:   Number(p['costPriceAvg']   ?? p['costPrice']   ?? 0),
        salePrice:   Number(p['salePriceBase']  ?? p['salePrice']   ?? 0),
        taxRate:     Number(p['taxRate'] ?? 19),
        stock:       Number(p['stockQuantity']  ?? p['stock']       ?? 0),
        minStock:    Number(p['minStockLevel']  ?? p['minStock']    ?? 5),
        binLocation: (p['locationBin'] ?? p['binLocation']) as string | undefined,
        imageUrl:    p['imageKey'] as string | undefined,
        isActive:    Boolean(p['isActive'] ?? true),
        createdAt:   p['createdAt'] as string,
        updatedAt:   p['updatedAt'] as string,
      } as import('@/types').Product
    } catch {
      return null
    }
  },

  searchCustomers: async (query: string): Promise<Customer[]> => {
    const { data } = await api.get('/customers', { params: { search: query, limit: 10 } })
    return Array.isArray(data) ? data : data.customers ?? data.data ?? []
  },

  createCustomer: async (payload: { name: string; phone?: string; email?: string; documentNumber?: string }): Promise<Customer> => {
    const { data } = await api.post('/customers', payload)
    return data.customer ?? data
  },
}
