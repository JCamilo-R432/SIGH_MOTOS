import api from './api'
import type { AbcProduct, InventoryValuation, ProductRotation, ProfitabilityItem, DashboardData } from '@/types'

export interface ReportParams {
  startDate?: string
  endDate?: string
  categoryId?: string
}

export const reportService = {
  getDashboard: async (): Promise<DashboardData> => {
    try {
      const { data } = await api.get('/reports/dashboard')
      return data
    } catch {
      // Fallback: compose from other endpoints
      const [kpisRes, salesRes, productsRes] = await Promise.allSettled([
        api.get('/reports/kpis'),
        api.get('/pos/sales', { params: { limit: 5 } }),
        api.get('/inventory/products', { params: { lowStock: true, limit: 10 } }),
      ])

      const kpis = kpisRes.status === 'fulfilled' ? kpisRes.value.data : {
        salesToday: 0, salesMonthTotal: 0, expensesMonth: 0, lowStockCount: 0, pendingInvoices: 0,
      }
      const recentSales = salesRes.status === 'fulfilled'
        ? (Array.isArray(salesRes.value.data) ? salesRes.value.data : salesRes.value.data.sales ?? []).slice(0, 5)
        : []
      const lowStockProducts = productsRes.status === 'fulfilled'
        ? (Array.isArray(productsRes.value.data) ? productsRes.value.data : productsRes.value.data.products ?? []).slice(0, 10)
        : []

      return {
        kpis,
        salesTrend: [],
        categorySales: [],
        recentSales,
        lowStockProducts,
      }
    }
  },

  getAbcAnalysis: async (params?: ReportParams): Promise<AbcProduct[]> => {
    const { data } = await api.get('/reports/abc-analysis', { params })
    return Array.isArray(data) ? data : data.products ?? data.data ?? []
  },

  getInventoryValuation: async (): Promise<InventoryValuation[]> => {
    const { data } = await api.get('/reports/inventory-valuation')
    return Array.isArray(data) ? data : data.categories ?? data.data ?? []
  },

  getProductRotation: async (params?: ReportParams): Promise<ProductRotation[]> => {
    const { data } = await api.get('/reports/product-rotation', { params })
    return Array.isArray(data) ? data : data.products ?? data.data ?? []
  },

  getProfitability: async (params?: ReportParams): Promise<ProfitabilityItem[]> => {
    const { data } = await api.get('/reports/profitability', { params })
    return Array.isArray(data) ? data : data.products ?? data.data ?? []
  },

  getSalesTrend: async (days = 30): Promise<import('@/types').SalesTrendPoint[]> => {
    const { data } = await api.get('/reports/sales-trend', { params: { days } })
    return Array.isArray(data) ? data : data.trend ?? data.data ?? []
  },
}
