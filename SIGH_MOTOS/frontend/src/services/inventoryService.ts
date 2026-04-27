import api from './api'
import type { Product, Category, InventoryMovement, PaginatedResponse } from '@/types'

export interface Brand {
  id: string
  name: string
  logoUrl?: string | null
  isActive: boolean
  createdAt: string
}

export interface ProductFilters {
  page?: number
  limit?: number
  search?: string
  categoryId?: string
  lowStock?: boolean
  isActive?: boolean
}

export interface CreateProductPayload {
  name: string
  sku?: string
  barcode?: string
  categoryId: string
  brandId?: string
  costPrice: number
  salePrice: number
  taxRate?: number
  stock?: number
  minStock?: number
  binLocation?: string
  description?: string
}

export interface AdjustStockPayload {
  quantity: number
  type: 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'RETURN'
  reason: string
}

export const inventoryService = {
  getProducts: async (filters: ProductFilters = {}): Promise<PaginatedResponse<Product>> => {
    const { data } = await api.get('/inventory/products', { params: filters })
    // Normalize: backend may return { data, total, page, limit } or array
    if (Array.isArray(data)) {
      return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 }
    }
    if (data.products) {
      return {
        data: data.products,
        total: data.total ?? data.products.length,
        page: data.page ?? 1,
        limit: data.limit ?? 50,
        totalPages: data.totalPages ?? 1,
      }
    }
    return data
  },

  getProduct: async (id: string): Promise<Product> => {
    const { data } = await api.get(`/inventory/products/${id}`)
    return data.product ?? data
  },

  createProduct: async (payload: CreateProductPayload): Promise<Product> => {
    const { data } = await api.post('/inventory/products', payload)
    return data.product ?? data
  },

  updateProduct: async (id: string, payload: Partial<CreateProductPayload>): Promise<Product> => {
    const { data } = await api.put(`/inventory/products/${id}`, payload)
    return data.product ?? data
  },

  deleteProduct: async (id: string): Promise<void> => {
    await api.delete(`/inventory/products/${id}`)
  },

  adjustStock: async (id: string, payload: AdjustStockPayload): Promise<InventoryMovement> => {
    const { data } = await api.post(`/inventory/products/${id}/adjust-stock`, payload)
    return data.movement ?? data
  },

  getCategories: async (): Promise<Category[]> => {
    const { data } = await api.get('/inventory/categories')
    return Array.isArray(data) ? data : data.categories ?? data.data ?? []
  },

  createCategory: async (name: string, description?: string): Promise<Category> => {
    const { data } = await api.post('/inventory/categories', { name, description })
    return data.category ?? data
  },

  getMovements: async (productId?: string): Promise<InventoryMovement[]> => {
    const params = productId ? { productId } : {}
    const { data } = await api.get('/inventory/movements', { params })
    return Array.isArray(data) ? data : data.movements ?? data.data ?? []
  },

  importFromExcel: async (file: File): Promise<{ imported: number; errors: string[] }> => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await api.post('/inventory/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  // ── Brands ──────────────────────────────────────────────────────────────

  getBrands: async (params?: { query?: string; isActive?: boolean; limit?: number }): Promise<Brand[]> => {
    const { data } = await api.get('/inventory/brands', { params: { ...params, limit: params?.limit ?? 100 } })
    const result = data.data ?? data
    return Array.isArray(result) ? result : result.data ?? []
  },

  createBrand: async (payload: { name: string; logoUrl?: string }): Promise<Brand> => {
    const { data } = await api.post('/inventory/brands', payload)
    return data.data ?? data
  },

  updateBrand: async (id: string, payload: { name?: string; logoUrl?: string; isActive?: boolean }): Promise<Brand> => {
    const { data } = await api.put(`/inventory/brands/${id}`, payload)
    return data.data ?? data
  },

  deleteBrand: async (id: string): Promise<void> => {
    await api.delete(`/inventory/brands/${id}`)
  },

  // ── Categories (full CRUD) ───────────────────────────────────────────────

  getAllCategories: async (params?: { query?: string; isActive?: boolean; limit?: number }): Promise<Category[]> => {
    const { data } = await api.get('/inventory/categories', { params: { ...params, limit: params?.limit ?? 100 } })
    const result = data.data ?? data
    return Array.isArray(result) ? result : result.data ?? []
  },

  createFullCategory: async (payload: { name: string; codePrefix: string; marginPercentage?: number }): Promise<Category> => {
    const { data } = await api.post('/inventory/categories', payload)
    return data.data ?? data
  },

  updateCategory: async (id: string, payload: { name?: string; codePrefix?: string; marginPercentage?: number; isActive?: boolean }): Promise<Category> => {
    const { data } = await api.put(`/inventory/categories/${id}`, payload)
    return data.data ?? data
  },

  deleteCategory: async (id: string): Promise<void> => {
    await api.delete(`/inventory/categories/${id}`)
  },
}
