import { SaleStatus, PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import ExcelJS from 'exceljs';
import {
  getStartOfDay,
  getEndOfDay,
  getStartOfMonth,
  getEndOfMonth,
} from '../utils/dateUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroupEntry {
  name: string;
  revenue: number;
  cost: number;
  units: number;
}

interface SupplierEntry {
  name: string;
  totalOrders: number;
  totalDeliveryDays: number;
  totalValue: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toFloat(value: unknown): number {
  return parseFloat(String(value ?? 0)) || 0;
}

function mapGroupEntryToResult(entry: GroupEntry) {
  const gp = entry.revenue - entry.cost;
  return {
    name: entry.name,
    totalRevenue: parseFloat(entry.revenue.toFixed(2)),
    totalCost: parseFloat(entry.cost.toFixed(2)),
    grossProfit: parseFloat(gp.toFixed(2)),
    profitMarginPercentage:
      entry.revenue > 0 ? parseFloat(((gp / entry.revenue) * 100).toFixed(2)) : 0,
    unitsSold: entry.units,
  };
}

// ─── Dashboard Principal ──────────────────────────────────────────────────────

export async function getDashboardStats(_startDate?: Date, _endDate?: Date) {
  const now = new Date();
  const todayStart = getStartOfDay(now);
  const todayEnd   = getEndOfDay(now);
  const monthStart = getStartOfMonth(now);
  const monthEnd   = getEndOfMonth(now);

  // Window for 30-day trend (last 30 days including today)
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const [
    salesTodayAgg,
    salesMonthAgg,
    expensesMonthAgg,
    lowStockCountRaw,
    recentSalesRaw,
    salesTrendRaw,
    categorySalesRaw,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { status: SaleStatus.COMPLETED, createdAt: { gte: todayStart, lte: todayEnd } },
      _sum: { totalAmount: true },
      _count: { id: true },
    }),
    prisma.sale.aggregate({
      where: { status: SaleStatus.COMPLETED, createdAt: { gte: monthStart, lte: monthEnd } },
      _sum: { totalAmount: true },
      _count: { id: true },
    }),
    // FinancialTransaction uses `timestamp`, NOT `createdAt`
    prisma.financialTransaction.aggregate({
      where: { type: 'EXPENSE', timestamp: { gte: monthStart, lte: monthEnd } },
      _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: null } })),
    // Field-comparison requires raw SQL (stockQuantity <= minStockLevel)
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "products"
      WHERE "isActive" = true AND "stockQuantity" <= "minStockLevel"
    `,
    prisma.sale.findMany({
      where: { status: SaleStatus.COMPLETED },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id:            true,
        saleNumber:    true,
        totalAmount:   true,
        status:        true,
        paymentMethod: true,
        createdAt:     true,
        customer:      { select: { id: true, name: true } },
      },
    }),
    // 30-day daily sales series
    prisma.$queryRaw<Array<{ day: string; total: string; count: string }>>`
      SELECT
        TO_CHAR(DATE_TRUNC('day', "createdAt"), 'YYYY-MM-DD') AS day,
        CAST(SUM("totalAmount") AS NUMERIC)                   AS total,
        COUNT(*)::text                                         AS count
      FROM "sales"
      WHERE "status" = 'COMPLETED'
        AND "createdAt" >= ${thirtyDaysAgo}
        AND "createdAt" <= ${now}
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY day ASC
    `,
    // Category breakdown for current month
    prisma.$queryRaw<Array<{ category: string; total: string }>>`
      SELECT
        COALESCE(c.name, 'Sin Categoría')    AS category,
        CAST(SUM(si."lineTotal") AS NUMERIC) AS total
      FROM "sale_items" si
      JOIN "sales"    s ON s.id  = si."saleId"
      JOIN "products" p ON p.id  = si."productId"
      LEFT JOIN "categories" c ON c.id = p."categoryId"
      WHERE s."status"    = 'COMPLETED'
        AND s."createdAt" >= ${monthStart}
        AND s."createdAt" <= ${monthEnd}
      GROUP BY c.name
      ORDER BY total DESC
      LIMIT 8
    `,
  ]);

  // Low-stock products with frontend-compatible field names
  const lowStockProductsRaw = await prisma.$queryRaw<Array<{
    id:              string;
    name_commercial: string;
    sku_internal:    string;
    stock_quantity:  string;
    min_stock_level: string;
  }>>`
    SELECT
      id,
      "nameCommercial" AS name_commercial,
      "skuInternal"    AS sku_internal,
      "stockQuantity"  AS stock_quantity,
      "minStockLevel"  AS min_stock_level
    FROM "products"
    WHERE "isActive" = true
      AND "stockQuantity" <= "minStockLevel"
    ORDER BY "stockQuantity" ASC
    LIMIT 10
  `;

  // Gap-filled 30-day trend
  const trendMap = new Map(salesTrendRaw.map(r => [
    r.day,
    { total: parseFloat(String(r.total ?? 0)) || 0, count: parseInt(String(r.count ?? 0), 10) || 0 },
  ]));
  const salesTrend: Array<{ date: string; total: number; count: number }> = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split('T')[0]!;
    const entry = trendMap.get(key) ?? { total: 0, count: 0 };
    salesTrend.push({ date: key, total: parseFloat(entry.total.toFixed(2)), count: entry.count });
  }

  // Category totals with percentage
  const catTotals = categorySalesRaw.map(r => ({
    category: r.category,
    total: parseFloat(String(r.total ?? 0)) || 0,
  }));
  const grandCatTotal = catTotals.reduce((s, c) => s + c.total, 0);
  const categorySales = catTotals.map(c => ({
    category:   c.category,
    total:      parseFloat(c.total.toFixed(2)),
    percentage: grandCatTotal > 0
      ? parseFloat(((c.total / grandCatTotal) * 100).toFixed(2))
      : 0,
  }));

  const lowStockCount = Number(lowStockCountRaw[0]?.count ?? BigInt(0));

  logger.info('[reportService] getDashboardStats ejecutado');

  return {
    kpis: {
      salesToday:      toFloat(salesTodayAgg._sum.totalAmount),
      salesMonthTotal: toFloat(salesMonthAgg._sum.totalAmount),
      expensesMonth:   toFloat(expensesMonthAgg._sum.amount),
      lowStockCount,
      pendingInvoices: 0,
    },
    salesTrend,
    categorySales,
    recentSales: recentSalesRaw.map(s => ({
      id:            s.id,
      saleNumber:    s.saleNumber,
      total:         toFloat(s.totalAmount),
      totalAmount:   toFloat(s.totalAmount),
      subtotal:      toFloat(s.totalAmount),
      status:        s.status as 'COMPLETED' | 'CANCELLED' | 'PENDING',
      paymentMethod: s.paymentMethod,
      createdAt:     s.createdAt.toISOString(),
      customer:      s.customer ?? null,
      items:         [] as never[],
    })),
    lowStockProducts: lowStockProductsRaw.map(p => ({
      id:         p.id,
      name:       p.name_commercial,
      sku:        p.sku_internal,
      stock:      parseInt(String(p.stock_quantity ?? 0), 10),
      minStock:   parseInt(String(p.min_stock_level ?? 0), 10),
      // Minimal required fields to satisfy frontend Product interface
      categoryId: '',
      costPrice:  0,
      salePrice:  0,
      taxRate:    0,
      isActive:   true,
      createdAt:  '',
      updatedAt:  '',
    })),
  };
}

// ─── Rentabilidad Real ────────────────────────────────────────────────────────

export async function getProfitabilityReport(startDate: Date, endDate: Date) {
  const saleRefs = await prisma.sale.findMany({
    where: { status: SaleStatus.COMPLETED, createdAt: { gte: startDate, lte: endDate } },
    select: { id: true },
  });

  if (saleRefs.length === 0) {
    return {
      period: { startDate, endDate },
      summary: { totalRevenue: 0, totalCost: 0, grossProfit: 0, profitMarginPercentage: 0 },
      byCategory: [],
      byBrand: [],
    };
  }

  const items = await prisma.saleItem.findMany({
    where: { saleId: { in: saleRefs.map((s: { id: string }) => s.id) } },
    select: {
      lineTotal: true,
      quantity: true,
      product: {
        select: {
          costPriceAvg: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
        },
      },
    },
  });

  let totalRevenue = 0;
  let totalCost = 0;
  const byCat = new Map<string, GroupEntry>();
  const byBrand = new Map<string, GroupEntry>();

  for (const item of items) {
    const revenue = toFloat(item.lineTotal);
    const cost = toFloat(item.product.costPriceAvg) * item.quantity;
    totalRevenue += revenue;
    totalCost += cost;

    const catId = item.product.category?.id ?? 'no-category';
    const catEntry = byCat.get(catId) ?? {
      name: item.product.category?.name ?? 'Sin Categoría',
      revenue: 0,
      cost: 0,
      units: 0,
    };
    catEntry.revenue += revenue;
    catEntry.cost += cost;
    catEntry.units += item.quantity;
    byCat.set(catId, catEntry);

    const brandId = item.product.brand?.id ?? 'no-brand';
    const brandEntry = byBrand.get(brandId) ?? {
      name: item.product.brand?.name ?? 'Sin Marca',
      revenue: 0,
      cost: 0,
      units: 0,
    };
    brandEntry.revenue += revenue;
    brandEntry.cost += cost;
    brandEntry.units += item.quantity;
    byBrand.set(brandId, brandEntry);
  }

  const grossProfit = totalRevenue - totalCost;
  const profitMarginPercentage = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  logger.info(`[reportService] getProfitabilityReport: ${items.length} ítems procesados`);

  return {
    period: { startDate, endDate },
    summary: {
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      totalCost: parseFloat(totalCost.toFixed(2)),
      grossProfit: parseFloat(grossProfit.toFixed(2)),
      profitMarginPercentage: parseFloat(profitMarginPercentage.toFixed(2)),
    },
    byCategory: Array.from(byCat.values())
      .map(mapGroupEntryToResult)
      .sort((a, b) => b.grossProfit - a.grossProfit),
    byBrand: Array.from(byBrand.values())
      .map(mapGroupEntryToResult)
      .sort((a, b) => b.grossProfit - a.grossProfit),
  };
}

// ─── Envejecimiento de Inventario ─────────────────────────────────────────────

const STAGNANT_DAYS = 90;

export async function getInventoryAgingReport() {
  const products = await prisma.product.findMany({
    where: { isActive: true, stockQuantity: { gt: 0 } },
    select: {
      id: true,
      nameCommercial: true,
      skuInternal: true,
      stockQuantity: true,
      costPriceAvg: true,
      updatedAt: true,
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
    orderBy: { updatedAt: 'asc' },
  });

  const now = new Date();

  const result = products.map((p) => {
    const daysSince = Math.floor((now.getTime() - p.updatedAt.getTime()) / 86_400_000);
    const costAvg = toFloat(p.costPriceAvg);
    return {
      productId: p.id,
      productName: p.nameCommercial,
      sku: p.skuInternal,
      category: p.category?.name ?? 'Sin Categoría',
      brand: p.brand?.name ?? 'Sin Marca',
      stockQuantity: p.stockQuantity,
      costPriceAvg: costAvg,
      inventoryValue: parseFloat((costAvg * p.stockQuantity).toFixed(2)),
      lastMovementDate: p.updatedAt,
      daysSinceMovement: daysSince,
      status: daysSince >= STAGNANT_DAYS ? ('STAGNANT' as const) : ('ACTIVE' as const),
    };
  });

  const totalValue = result.reduce((acc, p) => acc + p.inventoryValue, 0);
  const stagnantCount = result.filter((p) => p.status === 'STAGNANT').length;

  logger.info(`[reportService] getInventoryAgingReport: ${result.length} productos, ${stagnantCount} estancados`);

  return {
    summary: {
      totalProducts: result.length,
      stagnantProducts: stagnantCount,
      totalInventoryValue: parseFloat(totalValue.toFixed(2)),
      stagnantThresholdDays: STAGNANT_DAYS,
    },
    products: result,
  };
}

// ─── Ventas por Categoría / Marca ─────────────────────────────────────────────

export async function getSalesByCategoryOrBrand(
  groupBy: 'CATEGORY' | 'BRAND',
  startDate: Date,
  endDate: Date,
) {
  const saleRefs = await prisma.sale.findMany({
    where: { status: SaleStatus.COMPLETED, createdAt: { gte: startDate, lte: endDate } },
    select: { id: true },
  });

  if (saleRefs.length === 0) return [];

  const items = await prisma.saleItem.findMany({
    where: { saleId: { in: saleRefs.map((s: { id: string }) => s.id) } },
    select: {
      lineTotal: true,
      quantity: true,
      product: {
        select: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
        },
      },
    },
  });

  const groupMap = new Map<string, { name: string; totalSales: number; unitsSold: number }>();

  for (const item of items) {
    const key =
      groupBy === 'CATEGORY'
        ? (item.product.category?.id ?? 'no-category')
        : (item.product.brand?.id ?? 'no-brand');
    const name =
      groupBy === 'CATEGORY'
        ? (item.product.category?.name ?? 'Sin Categoría')
        : (item.product.brand?.name ?? 'Sin Marca');

    const entry = groupMap.get(key) ?? { name, totalSales: 0, unitsSold: 0 };
    entry.totalSales += toFloat(item.lineTotal);
    entry.unitsSold += item.quantity;
    groupMap.set(key, entry);
  }

  return Array.from(groupMap.values())
    .map((v) => ({ name: v.name, totalSales: parseFloat(v.totalSales.toFixed(2)), unitsSold: v.unitsSold }))
    .sort((a, b) => b.totalSales - a.totalSales);
}

// ─── Top Clientes ─────────────────────────────────────────────────────────────

export async function getCustomerTopBuyers(limit: number) {
  const grouped = await prisma.sale.groupBy({
    by: ['customerId'],
    where: { status: SaleStatus.COMPLETED, customerId: { not: null } },
    _sum: { totalAmount: true },
    _count: { id: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
    take: limit,
  });

  const customerIds = grouped
    .map((r: { customerId: string | null }) => r.customerId)
    .filter((id: string | null): id is string => id !== null);

  const customers =
    customerIds.length > 0
      ? await prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true, phone: true, identificationNumber: true },
        })
      : [];

  const customerMap = new Map(
    customers.map((c: { id: string; name: string; phone: string | null; identificationNumber: string | null }) => [c.id, c]),
  );

  return grouped.map((r: { customerId: string | null; _sum: { totalAmount: unknown }; _count: { id: number } }) => {
    const c = r.customerId ? customerMap.get(r.customerId) : undefined;
    return {
      customerId: r.customerId,
      customerName: c?.name ?? 'Cliente No Encontrado',
      phone: c?.phone ?? null,
      identificationNumber: c?.identificationNumber ?? null,
      totalPurchases: toFloat(r._sum.totalAmount),
      transactionCount: r._count.id,
    };
  });
}

// ─── Rendimiento de Proveedores ───────────────────────────────────────────────

export async function getSupplierPerformanceReport() {
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: [PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
      receivedDate: { not: null },
    },
    select: {
      supplierId: true,
      createdAt: true,
      receivedDate: true,
      totalAmount: true,
      supplier: { select: { id: true, name: true } },
    },
  });

  const supplierMap = new Map<string, SupplierEntry>();

  for (const order of orders) {
    if (!order.receivedDate) continue;
    const days = Math.floor(
      (order.receivedDate.getTime() - order.createdAt.getTime()) / 86_400_000,
    );
    const entry = supplierMap.get(order.supplierId) ?? {
      name: order.supplier.name,
      totalOrders: 0,
      totalDeliveryDays: 0,
      totalValue: 0,
    };
    entry.totalOrders++;
    entry.totalDeliveryDays += days;
    entry.totalValue += toFloat(order.totalAmount);
    supplierMap.set(order.supplierId, entry);
  }

  return Array.from(supplierMap.entries())
    .map(([supplierId, data]: [string, SupplierEntry]) => {
      const avg = data.totalOrders > 0 ? data.totalDeliveryDays / data.totalOrders : 0;
      return {
        supplierId,
        supplierName: data.name,
        totalOrders: data.totalOrders,
        avgDeliveryDays: parseFloat(avg.toFixed(1)),
        totalPurchaseValue: parseFloat(data.totalValue.toFixed(2)),
        performance: avg <= 5 ? ('FAST' as const) : avg <= 15 ? ('NORMAL' as const) : ('SLOW' as const),
      };
    })
    .sort((a, b) => a.avgDeliveryDays - b.avgDeliveryDays);
}

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 6 — INTELIGENCIA DE NEGOCIOS (KPIs, ABC, VALORACIÓN, EXPORTACIÓN)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export interface DailyChartPoint {
  date:  string;  // 'YYYY-MM-DD'
  total: number;
}

export interface ProductABCItem {
  productId:            string;
  productName:          string;
  sku:                  string;
  category:             string;
  brand:                string;
  quantitySold:         number;
  totalRevenue:         number;
  cumulativePercentage: number;
  abcClass:             'A' | 'B' | 'C';
}

export interface LowStockItem {
  productId:                  string;
  productName:                string;
  sku:                        string;
  category:                   string;
  brand:                      string;
  stockQuantity:               number;
  minStockLevel:               number;
  shortage:                    number;
  costPriceAvg:                number;
  estimatedReplenishmentCost:  number;
  urgency:                    'CRITICAL' | 'WARNING';
}

export interface ExcelColumn {
  header:  string;
  key:     string;
  width?:  number;
  numFmt?: string;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Rellena los días sin ventas con 0 para mantener continuidad gráfica.
 * Permite que librerías como Chart.js o Recharts dibujen líneas sin huecos.
 */
function fillDailyGaps(
  rows:      Array<{ day: string; total: string }>,
  startDate: Date,
  endDate:   Date,
): DailyChartPoint[] {
  const map = new Map(rows.map(r => [r.day, parseFloat(r.total ?? '0') || 0]));
  const result: DailyChartPoint[] = [];

  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const limit  = new Date(endDate.getFullYear(),   endDate.getMonth(),   endDate.getDate());

  while (cursor <= limit) {
    const dateStr = cursor.toISOString().split('T')[0]!;
    result.push({ date: dateStr, total: parseFloat((map.get(dateStr) ?? 0).toFixed(2)) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

// ─── Dashboard Ejecutivo ──────────────────────────────────────────────────────

/**
 * KPIs para el panel ejecutivo:
 *  - Total ventas brutas, cantidad de transacciones, ticket promedio.
 *  - Producto más vendido (por unidades).
 *  - Serie diaria lista para renderizar en Chart.js / Recharts.
 */
export async function getExecutiveDashboard(startDate: Date, endDate: Date) {
  const [salesAgg, dailyRows, saleRefs] = await Promise.all([
    prisma.sale.aggregate({
      where: { status: SaleStatus.COMPLETED, createdAt: { gte: startDate, lte: endDate } },
      _sum:   { totalAmount: true },
      _count: { id: true },
    }),
    // Agrupación diaria en PostgreSQL — eficiente para rangos largos
    prisma.$queryRaw<Array<{ day: string; total: string }>>`
      SELECT
        TO_CHAR(DATE_TRUNC('day', "createdAt"), 'YYYY-MM-DD') AS day,
        CAST(SUM("totalAmount") AS NUMERIC)                   AS total
      FROM "sales"
      WHERE "status" = 'COMPLETED'
        AND "createdAt" >= ${startDate}
        AND "createdAt" <= ${endDate}
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY day ASC
    `,
    prisma.sale.findMany({
      where: { status: SaleStatus.COMPLETED, createdAt: { gte: startDate, lte: endDate } },
      select: { id: true },
    }),
  ]);

  const saleIds = saleRefs.map((s: { id: string }) => s.id);

  const topItemsRaw = saleIds.length > 0
    ? await prisma.saleItem.groupBy({
        by:      ['productId'],
        where:   { saleId: { in: saleIds } },
        _sum:    { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take:    5,
      })
    : [];

  const topIds = topItemsRaw.map((p: { productId: string }) => p.productId);
  const topDetails = topIds.length > 0
    ? await prisma.product.findMany({
        where:  { id: { in: topIds } },
        select: {
          id: true,
          nameCommercial: true,
          skuInternal: true,
          category: { select: { name: true } },
        },
      })
    : [];

  const pMap = new Map(topDetails.map(p => [p.id, p]));

  const totalSales = toFloat(salesAgg._sum.totalAmount);
  const txCount    = salesAgg._count.id;
  const avgTicket  = txCount > 0 ? totalSales / txCount : 0;
  const best       = topItemsRaw[0] ? pMap.get(topItemsRaw[0].productId) : null;

  logger.info(`[reportService] getExecutiveDashboard: ${txCount} ventas, $${totalSales.toFixed(2)}`);

  return {
    period: {
      startDate: startDate.toISOString().split('T')[0],
      endDate:   endDate.toISOString().split('T')[0],
    },
    kpis: {
      totalGrossSales:    parseFloat(totalSales.toFixed(2)),
      transactionCount:   txCount,
      averageTicket:      parseFloat(avgTicket.toFixed(2)),
      topSellingProduct:  best
        ? {
            productId:    best.id,
            name:         best.nameCommercial,
            sku:          best.skuInternal,
            category:     best.category?.name ?? 'Sin Categoría',
            quantitySold: topItemsRaw[0]._sum.quantity ?? 0,
            totalRevenue: parseFloat(toFloat(topItemsRaw[0]._sum.lineTotal).toFixed(2)),
          }
        : null,
    },
    dailySalesChart: fillDailyGaps(dailyRows, startDate, endDate),
    topProducts: topItemsRaw.map(item => {
      const p = pMap.get(item.productId);
      return {
        productId:    item.productId,
        name:         p?.nameCommercial ?? 'Producto Eliminado',
        sku:          p?.skuInternal    ?? '',
        category:     p?.category?.name ?? 'Sin Categoría',
        quantitySold: item._sum.quantity ?? 0,
        totalRevenue: parseFloat(toFloat(item._sum.lineTotal).toFixed(2)),
      };
    }),
  };
}

// ─── Valoración de Inventario ─────────────────────────────────────────────────

/**
 * Calcula en la BD:
 *   - Valor a Costo:  SUM(stockQuantity × costPriceAvg)
 *   - Valor Potencial de Venta: SUM(stockQuantity × salePriceBase)
 *   - Margen Potencial y % de margen
 * Evita traer miles de registros a Node.js.
 */
export async function getInventoryValuation() {
  const [totalsRaw, topByValueRaw] = await Promise.all([
    prisma.$queryRaw<Array<{
      cost_value:    string;
      sale_value:    string;
      total_units:   string;
      product_count: string;
    }>>`
      SELECT
        CAST(COALESCE(SUM("stockQuantity" * "costPriceAvg"),  0) AS NUMERIC) AS cost_value,
        CAST(COALESCE(SUM("stockQuantity" * "salePriceBase"), 0) AS NUMERIC) AS sale_value,
        COALESCE(SUM("stockQuantity"), 0)                                    AS total_units,
        COUNT(*)                                                             AS product_count
      FROM "products"
      WHERE "isActive" = true AND "stockQuantity" > 0
    `,
    prisma.$queryRaw<Array<{
      id:              string;
      name_commercial: string;
      sku_internal:    string;
      stock_quantity:  string;
      cost_price_avg:  string;
      sale_price_base: string;
      cost_value:      string;
      sale_value:      string;
    }>>`
      SELECT
        id,
        "nameCommercial"                                         AS name_commercial,
        "skuInternal"                                            AS sku_internal,
        "stockQuantity"                                          AS stock_quantity,
        CAST("costPriceAvg"  AS NUMERIC)                        AS cost_price_avg,
        CAST("salePriceBase" AS NUMERIC)                        AS sale_price_base,
        CAST("stockQuantity" * "costPriceAvg"  AS NUMERIC)      AS cost_value,
        CAST("stockQuantity" * "salePriceBase" AS NUMERIC)      AS sale_value
      FROM "products"
      WHERE "isActive" = true AND "stockQuantity" > 0
      ORDER BY ("stockQuantity" * "costPriceAvg") DESC
      LIMIT 10
    `,
  ]);

  const row        = totalsRaw[0] ?? { cost_value: '0', sale_value: '0', total_units: '0', product_count: '0' };
  const costValue  = parseFloat(String(row.cost_value  ?? 0)) || 0;
  const saleValue  = parseFloat(String(row.sale_value  ?? 0)) || 0;
  const margin     = saleValue - costValue;

  logger.info(`[reportService] getInventoryValuation: costo $${costValue.toFixed(2)}, venta $${saleValue.toFixed(2)}`);

  return {
    summary: {
      costValue:               parseFloat(costValue.toFixed(2)),
      potentialSaleValue:      parseFloat(saleValue.toFixed(2)),
      potentialMargin:         parseFloat(margin.toFixed(2)),
      marginPercentage:        saleValue > 0 ? parseFloat(((margin / saleValue) * 100).toFixed(2)) : 0,
      totalUnitsInStock:       parseInt(String(row.total_units   ?? 0), 10),
      activeProductsWithStock: parseInt(String(row.product_count ?? 0), 10),
    },
    topByValue: topByValueRaw.map(p => ({
      productId:     p.id,
      productName:   p.name_commercial,
      sku:           p.sku_internal,
      stockQuantity: parseInt(String(p.stock_quantity ?? 0), 10),
      costPriceAvg:  parseFloat(String(p.cost_price_avg  ?? 0)) || 0,
      salePriceBase: parseFloat(String(p.sale_price_base ?? 0)) || 0,
      costValue:     parseFloat(String(p.cost_value  ?? 0)) || 0,
      saleValue:     parseFloat(String(p.sale_value  ?? 0)) || 0,
    })),
  };
}

// ─── Análisis de Rotación ABC ─────────────────────────────────────────────────

/**
 * Curva ABC basada en la Ley de Pareto:
 *   A → Productos que acumulan el  0-80% de unidades vendidas (alta rotación).
 *   B → Siguiente 15% acumulado (80-95%) — rotación media.
 *   C → Último 5% (>95%) — baja rotación, candidatos a revisión/liquidación.
 *
 * Productos sin ventas en el período se incluyen automáticamente en Clase C.
 */
export async function getProductRotationABC(startDate: Date, endDate: Date) {
  const saleRefs = await prisma.sale.findMany({
    where:  { status: SaleStatus.COMPLETED, createdAt: { gte: startDate, lte: endDate } },
    select: { id: true },
  });

  const saleIds = saleRefs.map((s: { id: string }) => s.id);

  const [soldItemsRaw, allProducts] = await Promise.all([
    saleIds.length > 0
      ? prisma.saleItem.groupBy({
          by:      ['productId'],
          where:   { saleId: { in: saleIds } },
          _sum:    { quantity: true, lineTotal: true },
          orderBy: { _sum: { quantity: 'desc' } },
        })
      : Promise.resolve([]),
    prisma.product.findMany({
      where:  { isActive: true },
      select: {
        id: true,
        nameCommercial: true,
        skuInternal:    true,
        category: { select: { name: true } },
        brand:    { select: { name: true } },
      },
    }),
  ]);

  const soldMap = new Map(
    (soldItemsRaw as Array<{
      productId: string;
      _sum: { quantity: number | null; lineTotal: unknown };
    }>).map(item => [
      item.productId,
      { quantitySold: item._sum.quantity ?? 0, totalRevenue: toFloat(item._sum.lineTotal) },
    ]),
  );

  // Ordenar por cantidad vendida desc (productos sin ventas al final)
  const sorted = allProducts
    .map(p => {
      const s = soldMap.get(p.id);
      return {
        productId:    p.id,
        productName:  p.nameCommercial,
        sku:          p.skuInternal,
        category:     p.category?.name ?? 'Sin Categoría',
        brand:        p.brand?.name    ?? 'Sin Marca',
        quantitySold: s?.quantitySold ?? 0,
        totalRevenue: s ? parseFloat(s.totalRevenue.toFixed(2)) : 0,
      };
    })
    .sort((a, b) => b.quantitySold - a.quantitySold);

  const totalUnits = sorted.reduce((acc, p) => acc + p.quantitySold, 0);

  // Aplicar clasificación ABC acumulando porcentaje
  let cumulative = 0;
  const classified: ProductABCItem[] = sorted.map(p => {
    cumulative += p.quantitySold;
    const cumulativePercentage = totalUnits > 0
      ? parseFloat(((cumulative / totalUnits) * 100).toFixed(2))
      : 100;

    const abcClass: 'A' | 'B' | 'C' =
      cumulativePercentage <= 80  ? 'A' :
      cumulativePercentage <= 95  ? 'B' : 'C';

    return { ...p, cumulativePercentage, abcClass };
  });

  const countA = classified.filter(p => p.abcClass === 'A').length;
  const countB = classified.filter(p => p.abcClass === 'B').length;
  const countC = classified.filter(p => p.abcClass === 'C').length;

  logger.info(`[reportService] ABC: A=${countA} B=${countB} C=${countC} (${classified.length} productos)`);

  return {
    summary: {
      totalProducts:  classified.length,
      totalUnitsSold: totalUnits,
      classA: countA,
      classB: countB,
      classC: countC,
      period: {
        startDate: startDate.toISOString().split('T')[0],
        endDate:   endDate.toISOString().split('T')[0],
      },
    },
    products: classified,
  };
}

// ─── Alertas de Stock Bajo ────────────────────────────────────────────────────

/**
 * Devuelve productos donde stockQuantity ≤ minStockLevel.
 * La comparación campo-contra-campo requiere SQL raw.
 * Incluye estimación del costo de reposición para la urgencia de compra.
 */
export async function getLowStockProducts(): Promise<LowStockItem[]> {
  const rows = await prisma.$queryRaw<Array<{
    id:              string;
    name_commercial: string;
    sku_internal:    string;
    category_name:   string;
    brand_name:      string;
    stock_quantity:  string;
    min_stock_level: string;
    cost_price_avg:  string;
  }>>`
    SELECT
      p.id,
      p."nameCommercial"                          AS name_commercial,
      p."skuInternal"                             AS sku_internal,
      COALESCE(c.name, 'Sin Categoría')           AS category_name,
      COALESCE(b.name, 'Sin Marca')               AS brand_name,
      p."stockQuantity"                           AS stock_quantity,
      p."minStockLevel"                           AS min_stock_level,
      CAST(p."costPriceAvg" AS NUMERIC)           AS cost_price_avg
    FROM  "products"   p
    LEFT JOIN "categories" c ON c.id = p."categoryId"
    LEFT JOIN "brands"     b ON b.id = p."brandId"
    WHERE p."isActive" = true
      AND p."stockQuantity" <= p."minStockLevel"
    ORDER BY p."stockQuantity" ASC
  `;

  logger.info(`[reportService] getLowStockProducts: ${rows.length} alertas`);

  return rows.map((r): LowStockItem => {
    const costAvg   = parseFloat(String(r.cost_price_avg  ?? 0)) || 0;
    const stock     = parseInt(String(r.stock_quantity  ?? 0), 10);
    const minStock  = parseInt(String(r.min_stock_level ?? 0), 10);
    const shortage  = Math.max(0, minStock - stock);
    return {
      productId:                 r.id,
      productName:               r.name_commercial,
      sku:                       r.sku_internal,
      category:                  r.category_name,
      brand:                     r.brand_name,
      stockQuantity:              stock,
      minStockLevel:              minStock,
      shortage,
      costPriceAvg:               parseFloat(costAvg.toFixed(4)),
      estimatedReplenishmentCost: parseFloat((shortage * costAvg).toFixed(2)),
      urgency:                    stock === 0 ? 'CRITICAL' : 'WARNING',
    };
  });
}

// ─── Generador de Excel (ExcelJS) ─────────────────────────────────────────────

/**
 * Genera un buffer XLSX con encabezados estilizados listos para descarga HTTP.
 * Para < 10 000 filas (contexto PYME) el buffer en memoria es suficiente.
 */
export async function generateExcelBuffer(
  rows:         Record<string, unknown>[],
  columns:      ExcelColumn[],
  sheetName  = 'Reporte',
  reportTitle?: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator  = 'SIGC-Motos';
  workbook.created  = new Date();

  const sheet = workbook.addWorksheet(sheetName);
  let dataStartRow = 1;

  // Título del reporte (fila 1, fusionada)
  if (reportTitle) {
    sheet.addRow([reportTitle]);
    const titleRow  = sheet.getRow(1);
    titleRow.font   = { bold: true, size: 14, color: { argb: 'FF1F4E79' } };
    titleRow.height = 24;
    sheet.mergeCells(1, 1, 1, columns.length);
    sheet.addRow([]);   // fila vacía
    dataStartRow = 3;
  }

  // Columnas y encabezados
  sheet.columns = columns.map(col => ({
    header: col.header,
    key:    col.key,
    width:  col.width ?? 18,
  }));

  // Estilo de fila de encabezados
  const headerRow = sheet.getRow(dataStartRow);
  headerRow.font      = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  headerRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } } as ExcelJS.Fill;
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height    = 22;

  // Datos
  rows.forEach(row => sheet.addRow(row));

  // Formato numérico por columna
  columns.forEach(col => {
    if (col.numFmt) sheet.getColumn(col.key).numFmt = col.numFmt;
  });

  // Bordes finos en todas las celdas de datos
  sheet.eachRow((row, idx) => {
    if (idx < dataStartRow) return;
    row.eachCell(cell => {
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FFBFBFBF' } },
        left:   { style: 'thin', color: { argb: 'FFBFBFBF' } },
        bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
        right:  { style: 'thin', color: { argb: 'FFBFBFBF' } },
      };
    });
  });

  return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

// ─── Constructores de datos para exportación ──────────────────────────────────

export async function buildSalesExportData(
  startDate: Date,
  endDate:   Date,
): Promise<{ rows: Record<string, unknown>[]; columns: ExcelColumn[]; title: string }> {
  const sales = await prisma.sale.findMany({
    where:   { status: SaleStatus.COMPLETED, createdAt: { gte: startDate, lte: endDate } },
    select:  {
      saleNumber:    true,
      createdAt:     true,
      totalAmount:   true,
      taxAmount:     true,
      discountAmount: true,
      paymentMethod: true,
      customer:      { select: { name: true, identificationNumber: true } },
      _count:        { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const columns: ExcelColumn[] = [
    { header: '# Venta',          key: 'saleNumber',      width: 18 },
    { header: 'Fecha',            key: 'date',            width: 22 },
    { header: 'Cliente',          key: 'customerName',    width: 30 },
    { header: 'Identificación',   key: 'identification',  width: 18 },
    { header: 'Ítems',            key: 'itemCount',       width: 8  },
    { header: 'Descuento',        key: 'discount',        width: 14, numFmt: '#,##0.00' },
    { header: 'Impuesto',         key: 'tax',             width: 14, numFmt: '#,##0.00' },
    { header: 'Total',            key: 'total',           width: 16, numFmt: '#,##0.00' },
    { header: 'Método de Pago',   key: 'paymentMethod',   width: 16 },
  ];

  const rows: Record<string, unknown>[] = sales.map(s => ({
    saleNumber:     s.saleNumber,
    date:           s.createdAt.toLocaleString('es-CO'),
    customerName:   s.customer?.name            ?? 'Consumidor Final',
    identification: s.customer?.identificationNumber ?? '',
    itemCount:      s._count.items,
    discount:       parseFloat(toFloat(s.discountAmount).toFixed(2)),
    tax:            parseFloat(toFloat(s.taxAmount).toFixed(2)),
    total:          parseFloat(toFloat(s.totalAmount).toFixed(2)),
    paymentMethod:  s.paymentMethod,
  }));

  return { rows, columns, title: `Reporte de Ventas — ${startDate.toLocaleDateString('es-CO')} al ${endDate.toLocaleDateString('es-CO')}` };
}

export async function buildInventoryExportData(): Promise<{ rows: Record<string, unknown>[]; columns: ExcelColumn[]; title: string }> {
  const products = await prisma.product.findMany({
    where:   { isActive: true },
    select:  {
      skuInternal:    true,
      nameCommercial: true,
      partNumberOEM:  true,
      stockQuantity:  true,
      minStockLevel:  true,
      costPriceAvg:   true,
      salePriceBase:  true,
      taxRate:        true,
      category: { select: { name: true } },
      brand:    { select: { name: true } },
    },
    orderBy: { nameCommercial: 'asc' },
  });

  const columns: ExcelColumn[] = [
    { header: 'SKU',             key: 'sku',           width: 16 },
    { header: 'Nombre',          key: 'name',          width: 36 },
    { header: 'N° OEM',          key: 'partNumberOEM', width: 18 },
    { header: 'Categoría',       key: 'category',      width: 22 },
    { header: 'Marca',           key: 'brand',         width: 18 },
    { header: 'Stock Actual',    key: 'stock',         width: 12 },
    { header: 'Stock Mínimo',    key: 'minStock',      width: 12 },
    { header: 'Costo Promedio',  key: 'costAvg',       width: 16, numFmt: '#,##0.0000' },
    { header: 'Precio Venta',    key: 'salePrice',     width: 16, numFmt: '#,##0.00' },
    { header: 'IVA %',           key: 'taxRate',       width: 8,  numFmt: '0.00' },
    { header: 'Valor a Costo',   key: 'costValue',     width: 16, numFmt: '#,##0.00' },
    { header: 'Valor a Precio',  key: 'saleValue',     width: 16, numFmt: '#,##0.00' },
    { header: 'Estado Stock',    key: 'stockStatus',   width: 14 },
  ];

  const rows: Record<string, unknown>[] = products.map(p => {
    const costAvg   = toFloat(p.costPriceAvg);
    const salePrice = toFloat(p.salePriceBase);
    return {
      sku:          p.skuInternal,
      name:         p.nameCommercial,
      partNumberOEM: p.partNumberOEM,
      category:     p.category?.name ?? 'Sin Categoría',
      brand:        p.brand?.name    ?? 'Sin Marca',
      stock:        p.stockQuantity,
      minStock:     p.minStockLevel,
      costAvg:      parseFloat(costAvg.toFixed(4)),
      salePrice:    parseFloat(salePrice.toFixed(2)),
      taxRate:      parseFloat(toFloat(p.taxRate).toFixed(2)),
      costValue:    parseFloat((costAvg   * p.stockQuantity).toFixed(2)),
      saleValue:    parseFloat((salePrice * p.stockQuantity).toFixed(2)),
      stockStatus:  p.stockQuantity === 0 ? 'SIN STOCK' :
                    p.stockQuantity <= p.minStockLevel ? 'BAJO' : 'OK',
    };
  });

  return { rows, columns, title: `Inventario — ${new Date().toLocaleDateString('es-CO')}` };
}

export async function buildProductsRotationExportData(
  startDate: Date,
  endDate:   Date,
): Promise<{ rows: Record<string, unknown>[]; columns: ExcelColumn[]; title: string }> {
  const { products } = await getProductRotationABC(startDate, endDate);

  const columns: ExcelColumn[] = [
    { header: 'Clase ABC',         key: 'abcClass',             width: 10 },
    { header: 'SKU',               key: 'sku',                  width: 16 },
    { header: 'Nombre',            key: 'productName',          width: 36 },
    { header: 'Categoría',         key: 'category',             width: 22 },
    { header: 'Marca',             key: 'brand',                width: 18 },
    { header: 'Unidades Vendidas', key: 'quantitySold',         width: 18 },
    { header: 'Ingresos',          key: 'totalRevenue',         width: 18, numFmt: '#,##0.00' },
    { header: '% Acumulado',       key: 'cumulativePercentage', width: 14, numFmt: '0.00' },
  ];

  const rows: Record<string, unknown>[] = products.map(p => ({
    abcClass:             p.abcClass,
    sku:                  p.sku,
    productName:          p.productName,
    category:             p.category,
    brand:                p.brand,
    quantitySold:         p.quantitySold,
    totalRevenue:         p.totalRevenue,
    cumulativePercentage: p.cumulativePercentage,
  }));

  return { rows, columns, title: `Rotación ABC — ${startDate.toLocaleDateString('es-CO')} al ${endDate.toLocaleDateString('es-CO')}` };
}
