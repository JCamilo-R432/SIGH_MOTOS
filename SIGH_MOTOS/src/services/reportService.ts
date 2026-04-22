import { SaleStatus, PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
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

// ─── Dashboard Ejecutivo ──────────────────────────────────────────────────────

export async function getDashboardStats(startDate?: Date, endDate?: Date) {
  const now = new Date();
  const todayStart = getStartOfDay(now);
  const todayEnd = getEndOfDay(now);
  const monthStart = getStartOfMonth(now);
  const monthEnd = getEndOfMonth(now);
  const rangeStart = startDate ?? monthStart;
  const rangeEnd = endDate ?? monthEnd;

  const [salesTodayAgg, salesMonthAgg, lowStockRows, pendingOrdersCount, completedSaleRefs, recentSales] =
    await Promise.all([
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
      // Field-comparison (stockQuantity <= minStockLevel) requires raw SQL
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM "Product"
        WHERE "isActive" = true AND "stockQuantity" <= "minStockLevel"
      `,
      prisma.purchaseOrder.count({
        where: {
          status: { in: [PurchaseOrderStatus.PENDING, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        },
      }),
      prisma.sale.findMany({
        where: { status: SaleStatus.COMPLETED, createdAt: { gte: rangeStart, lte: rangeEnd } },
        select: { id: true },
      }),
      prisma.sale.findMany({
        where: { status: SaleStatus.COMPLETED },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          saleNumber: true,
          totalAmount: true,
          paymentMethod: true,
          createdAt: true,
          customer: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);

  const saleIdList = completedSaleRefs.map((s: { id: string }) => s.id);

  const topProductsRaw = saleIdList.length
    ? await prisma.saleItem.groupBy({
        by: ['productId'],
        where: { saleId: { in: saleIdList } },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      })
    : [];

  const productIds = topProductsRaw.map(
    (p: { productId: string }) => p.productId,
  );

  const productDetails =
    productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, nameCommercial: true, skuInternal: true },
        })
      : [];

  const productMap = new Map(
    productDetails.map((p: { id: string; nameCommercial: string; skuInternal: string }) => [p.id, p]),
  );

  const topSellingProducts = topProductsRaw.map(
    (item: { productId: string; _sum: { quantity: number | null; lineTotal: unknown } }) => ({
      productId: item.productId,
      productName: productMap.get(item.productId)?.nameCommercial ?? 'Producto Eliminado',
      sku: productMap.get(item.productId)?.skuInternal ?? '',
      quantitySold: item._sum.quantity ?? 0,
      totalRevenue: toFloat(item._sum.lineTotal),
    }),
  );

  logger.info('[reportService] getDashboardStats ejecutado');

  return {
    today: {
      totalSales: toFloat(salesTodayAgg._sum.totalAmount),
      transactionCount: salesTodayAgg._count.id,
    },
    currentMonth: {
      totalSales: toFloat(salesMonthAgg._sum.totalAmount),
      transactionCount: salesMonthAgg._count.id,
    },
    inventory: {
      lowStockCount: Number(lowStockRows[0]?.count ?? BigInt(0)),
    },
    purchases: { pendingOrdersCount },
    topSellingProducts,
    recentSales: recentSales.map((s) => ({
      id: s.id,
      saleNumber: s.saleNumber,
      totalAmount: toFloat(s.totalAmount),
      paymentMethod: s.paymentMethod,
      itemCount: s._count.items,
      customerName: s.customer?.name ?? 'Consumidor Final',
      date: s.createdAt,
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
