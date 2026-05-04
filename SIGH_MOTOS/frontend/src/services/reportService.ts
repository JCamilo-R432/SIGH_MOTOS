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
      // Backend wraps response: { success: true, data: DashboardData }
      return (data as any)?.data ?? data
    } catch {
      // Fallback: compose from other endpoints
      const [kpisRes, salesRes, productsRes] = await Promise.allSettled([
        api.get('/reports/kpis'),
        api.get('/pos/sales', { params: { limit: 5 } }),
        api.get('/inventory/products', { params: { lowStock: true, limit: 10 } }),
      ])

      const rawKpis = kpisRes.status === 'fulfilled' ? kpisRes.value.data : null
      const kpisData = (rawKpis as any)?.data ?? rawKpis
      const kpis = kpisData?.kpis ?? {
        salesToday: 0, salesMonthTotal: 0, expensesMonth: 0, lowStockCount: 0, pendingInvoices: 0,
      }

      const rawSales = salesRes.status === 'fulfilled' ? salesRes.value.data : null
      const salesData = (rawSales as any)?.data ?? rawSales
      const recentSales = (Array.isArray(salesData)
        ? salesData
        : Array.isArray(salesData?.sales) ? salesData.sales : salesData?.data ?? []
      ).slice(0, 5)

      const rawProducts = productsRes.status === 'fulfilled' ? productsRes.value.data : null
      const productsData = (rawProducts as any)?.data ?? rawProducts
      const lowStockProducts = (Array.isArray(productsData)
        ? productsData
        : Array.isArray(productsData?.products) ? productsData.products : productsData?.data ?? []
      ).slice(0, 10)

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
