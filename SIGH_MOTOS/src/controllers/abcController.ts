import type { Request, Response } from 'express'
import { prisma } from '../config/prisma'
import { logger } from '../config/logger'

const ok  = (res: Response, data: unknown) => res.status(200).json({ success: true, data })
const fail = (res: Response, msg: string, status = 500) => res.status(status).json({ success: false, error: msg })

function resolveRange(query: Record<string, unknown>): { startDate: Date; endDate: Date } {
  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
  const startDate = query.startDate ? new Date(String(query.startDate)) : firstDay
  const endDate   = query.endDate   ? new Date(String(query.endDate))   : now
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return { startDate: firstDay, endDate: now }
  }
  return { startDate, endDate }
}

/**
 * GET /api/v1/reports/abc-analysis?startDate=&endDate=
 *
 * Retorna análisis ABC de productos ordenados por ingresos totales.
 * Clasifica: A = top 80% acumulado, B = siguiente 15%, C = resto 5%.
 */
export async function getAbcAnalysis(req: Request, res: Response): Promise<Response> {
  try {
    const { startDate, endDate } = resolveRange(req.query as Record<string, unknown>)

    // Aggregate revenue per product from completed sales
    const rawData = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          status: 'COMPLETED',
          createdAt: { gte: startDate, lte: endDate },
        },
      },
      _sum: { lineTotal: true, quantity: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
    })

    if (rawData.length === 0) {
      return ok(res, [])
    }

    // Fetch product details for the relevant IDs
    const productIds = rawData.map((r) => r.productId)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { category: { select: { name: true } }, brand: { select: { name: true } } },
    })
    const productMap = new Map(products.map((p) => [p.id, p]))

    // Build sorted revenue list
    const sorted = rawData
      .map((r) => ({
        productId: r.productId,
        totalRevenue: Number(r._sum?.lineTotal ?? 0),
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)

    const grandTotal = sorted.reduce((s, i) => s + i.totalRevenue, 0)
    if (grandTotal === 0) return ok(res, [])

    let cumulative = 0
    const result = sorted.map((item) => {
      const pct  = (item.totalRevenue / grandTotal) * 100
      cumulative += pct
      const cls: 'A' | 'B' | 'C' = cumulative <= 80 ? 'A' : cumulative <= 95 ? 'B' : 'C'
      return {
        productId: item.productId,
        product: productMap.get(item.productId) ?? null,
        totalRevenue: item.totalRevenue,
        percentage: parseFloat(pct.toFixed(2)),
        cumulativePercentage: parseFloat(cumulative.toFixed(2)),
        class: cls,
      }
    })

    logger.info('[abcController] ABC analysis computed', { count: result.length, startDate, endDate })
    return ok(res, result)
  } catch (err) {
    logger.error('[abcController] getAbcAnalysis error', { err })
    return fail(res, 'Error al calcular análisis ABC')
  }
}

/**
 * GET /api/v1/reports/sales-trend?days=30
 * Serie temporal de ventas por día.
 */
export async function getSalesTrend(req: Request, res: Response): Promise<Response> {
  try {
    const days = Math.min(90, Math.max(7, Number(req.query.days ?? 30)))
    const since = new Date()
    since.setDate(since.getDate() - days)

    const sales = await prisma.sale.findMany({
      where: { status: 'COMPLETED', createdAt: { gte: since } },
      select: { createdAt: true, totalAmount: true },
      orderBy: { createdAt: 'asc' },
    })

    // Group by date
    const byDate = new Map<string, { total: number; count: number }>()
    for (const s of sales) {
      const d = s.createdAt.toISOString().slice(0, 10)
      const cur = byDate.get(d) ?? { total: 0, count: 0 }
      byDate.set(d, { total: cur.total + Number(s.totalAmount), count: cur.count + 1 })
    }

    // Fill gaps
    const trend = []
    for (let i = 0; i < days; i++) {
      const d = new Date(since)
      d.setDate(d.getDate() + i)
      const key = d.toISOString().slice(0, 10)
      const entry = byDate.get(key) ?? { total: 0, count: 0 }
      trend.push({ date: key, total: entry.total, count: entry.count })
    }

    return ok(res, trend)
  } catch (err) {
    logger.error('[abcController] getSalesTrend error', { err })
    return fail(res, 'Error al obtener tendencia de ventas')
  }
}

/**
 * GET /api/v1/reports/dashboard
 * KPIs rápidos para el dashboard principal.
 */
export async function getDashboardKpis(req: Request, res: Response): Promise<Response> {
  try {
    const today    = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

    const [salesTodayAgg, salesMonthAgg, expensesMonthAgg, lowStockCount, pendingInvoices] =
      await Promise.all([
        prisma.sale.aggregate({
          where: { status: 'COMPLETED', createdAt: { gte: today, lt: tomorrow } },
          _sum: { totalAmount: true },
        }),
        prisma.sale.aggregate({
          where: { status: 'COMPLETED', createdAt: { gte: monthStart } },
          _sum: { totalAmount: true },
        }),
        prisma.financialTransaction.aggregate({
          where: { type: 'EXPENSE', timestamp: { gte: monthStart } },
          _sum: { amount: true },
        }),
        // Field-to-field comparison requires raw SQL; use a safe threshold fallback
        prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::int AS count FROM "products"
          WHERE "isActive" = true AND "stockQuantity" <= "minStockLevel"
        `.then((rows) => Number(rows[0]?.count ?? 0))
          .catch(() => prisma.product.count({ where: { isActive: true, stockQuantity: { lte: 5 } } })),
        prisma.accountReceivable.count({ where: { status: { in: ['PENDING', 'PARTIALLY_PAID'] } } })
          .catch(() => 0),
      ])

    const [recentSales, lowStockProducts] = await Promise.all([
      prisma.sale.findMany({
        take: 5, orderBy: { createdAt: 'desc' },
        include: { customer: { select: { name: true } }, items: { include: { product: { select: { nameCommercial: true } } } } },
      }),
      prisma.product.findMany({
        where: { isActive: true, stockQuantity: { lte: 5 } },
        take: 10, orderBy: { stockQuantity: 'asc' },
        include: { category: { select: { name: true } } },
      }),
    ])

    return ok(res, {
      kpis: {
        salesToday: Number(salesTodayAgg._sum.totalAmount ?? 0),
        salesMonthTotal: Number(salesMonthAgg._sum.totalAmount ?? 0),
        expensesMonth: Number(expensesMonthAgg._sum.amount ?? 0),
        lowStockCount,
        pendingInvoices,
      },
      salesTrend: [],  // Caller can request /reports/sales-trend separately
      categorySales: [],
      recentSales,
      lowStockProducts,
    })
  } catch (err) {
    logger.error('[abcController] getDashboardKpis error', { err })
    return fail(res, 'Error al obtener dashboard')
  }
}
