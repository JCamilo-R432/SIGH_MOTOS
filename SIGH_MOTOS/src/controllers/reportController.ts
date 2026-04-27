import { Request, Response } from 'express';
import { ZodError } from 'zod';
import * as reportService from '../services/reportService';
import { getStartOfMonth, getEndOfMonth } from '../utils/dateUtils';
import { dateRangeQuerySchema, exportTypeSchema } from '../utils/validators';
import { logger } from '../config/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseOptionalDate(value: unknown): Date | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

function parseDateOrDefault(value: unknown, fallback: Date): Date {
  const d = parseOptionalDate(value);
  return d ?? fallback;
}

// ─── Controllers ──────────────────────────────────────────────────────────────

export async function getDashboard(req: Request, res: Response): Promise<Response> {
  try {
    const startDate = parseOptionalDate(req.query.startDate);
    const endDate   = parseOptionalDate(req.query.endDate);
    const data = await reportService.getDashboardStats(startDate, endDate);
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('[reportController] getDashboard', error);
    return res.status(500).json({ success: false, error: 'Error al obtener el dashboard' });
  }
}

export async function getProfitability(req: Request, res: Response): Promise<Response> {
  try {
    const now = new Date();
    const startDate = parseDateOrDefault(req.query.startDate, getStartOfMonth(now));
    const endDate   = parseDateOrDefault(req.query.endDate, getEndOfMonth(now));

    if (startDate > endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate no puede ser posterior a endDate',
      });
    }

    const data = await reportService.getProfitabilityReport(startDate, endDate);
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('[reportController] getProfitability', error);
    return res.status(500).json({ success: false, error: 'Error al generar reporte de rentabilidad' });
  }
}

export async function getInventoryAging(req: Request, res: Response): Promise<Response> {
  try {
    const data = await reportService.getInventoryAgingReport();
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('[reportController] getInventoryAging', error);
    return res.status(500).json({ success: false, error: 'Error al generar reporte de envejecimiento' });
  }
}

export async function getSalesGrouped(req: Request, res: Response): Promise<Response> {
  try {
    const groupByParam = req.query.groupBy;
    if (groupByParam !== 'category' && groupByParam !== 'brand') {
      return res.status(400).json({
        success: false,
        error: 'El parámetro groupBy debe ser "category" o "brand"',
      });
    }

    const now = new Date();
    const startDate = parseDateOrDefault(req.query.startDate, getStartOfMonth(now));
    const endDate   = parseDateOrDefault(req.query.endDate, getEndOfMonth(now));

    const groupBy = groupByParam === 'category' ? 'CATEGORY' : 'BRAND';
    const data = await reportService.getSalesByCategoryOrBrand(groupBy, startDate, endDate);
    return res.json({ success: true, groupBy, period: { startDate, endDate }, data });
  } catch (error) {
    logger.error('[reportController] getSalesGrouped', error);
    return res.status(500).json({ success: false, error: 'Error al agrupar ventas' });
  }
}

export async function getTopCustomers(req: Request, res: Response): Promise<Response> {
  try {
    const limitParam = req.query.limit;
    const limit = limitParam ? parseInt(String(limitParam), 10) : 10;

    if (isNaN(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: 'El parámetro limit debe ser un número entre 1 y 100',
      });
    }

    const data = await reportService.getCustomerTopBuyers(limit);
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('[reportController] getTopCustomers', error);
    return res.status(500).json({ success: false, error: 'Error al obtener top clientes' });
  }
}

export async function getSupplierPerformance(req: Request, res: Response): Promise<Response> {
  try {
    const data = await reportService.getSupplierPerformanceReport();
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('[reportController] getSupplierPerformance', error);
    return res.status(500).json({ success: false, error: 'Error al generar reporte de proveedores' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 6 — INTELIGENCIA DE NEGOCIOS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Helper común ─────────────────────────────────────────────────────────────

function resolveDateRange(query: Record<string, unknown>): { startDate: Date; endDate: Date } {
  const now = new Date();
  const start = query['startDate'] ? new Date(String(query['startDate'])) : getStartOfMonth(now);
  const end   = query['endDate']   ? new Date(String(query['endDate']))   : getEndOfMonth(now);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Fechas inválidas. Use formato ISO (ej: 2026-01-01)');
  }
  if (start > end) throw new Error('startDate no puede ser posterior a endDate');
  return { startDate: start, endDate: end };
}

// ─── GET /api/v1/reports/dashboard/executive ─────────────────────────────────

/**
 * KPIs ejecutivos: ventas brutas, ticket promedio, top producto,
 * y serie diaria lista para Chart.js / Recharts.
 * Query: startDate?, endDate?  (default: mes actual)
 */
export async function getExecutiveDashboard(req: Request, res: Response): Promise<Response> {
  try {
    const { startDate, endDate } = resolveDateRange(req.query as Record<string, unknown>);
    const data = await reportService.getExecutiveDashboard(startDate, endDate);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('[reportController] getExecutiveDashboard', err);
    if (err instanceof Error) return res.status(400).json({ success: false, error: err.message });
    return res.status(500).json({ success: false, error: 'Error al generar dashboard ejecutivo' });
  }
}

// ─── GET /api/v1/reports/inventory/valuation ─────────────────────────────────

/** Valoración actual del inventario a costo y a precio de venta. */
export async function getInventoryValuation(_req: Request, res: Response): Promise<Response> {
  try {
    const data = await reportService.getInventoryValuation();
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('[reportController] getInventoryValuation', err);
    return res.status(500).json({ success: false, error: 'Error al valorar inventario' });
  }
}

// ─── GET /api/v1/reports/products/rotation ───────────────────────────────────

/**
 * Análisis ABC de rotación de productos en el período.
 * Query: startDate?, endDate?  (default: mes actual)
 */
export async function getProductRotationAnalysis(req: Request, res: Response): Promise<Response> {
  try {
    const { startDate, endDate } = resolveDateRange(req.query as Record<string, unknown>);
    const data = await reportService.getProductRotationABC(startDate, endDate);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('[reportController] getProductRotationAnalysis', err);
    if (err instanceof Error) return res.status(400).json({ success: false, error: err.message });
    return res.status(500).json({ success: false, error: 'Error al analizar rotación ABC' });
  }
}

// ─── GET /api/v1/reports/alerts/low-stock ────────────────────────────────────

/** Lista productos con stock ≤ minStockLevel, ordenados por urgencia. */
export async function getLowStockAlerts(_req: Request, res: Response): Promise<Response> {
  try {
    const data = await reportService.getLowStockProducts();
    return res.json({ success: true, count: data.length, data });
  } catch (err) {
    logger.error('[reportController] getLowStockAlerts', err);
    return res.status(500).json({ success: false, error: 'Error al obtener alertas de stock' });
  }
}

// ─── GET /api/v1/reports/export/:type ────────────────────────────────────────

/**
 * Exportación a Excel (.xlsx).
 * Param:  type = 'sales' | 'inventory' | 'products'
 * Query:  startDate?, endDate?  (requerido para sales y products)
 *
 * Instalar dependencia: npm install exceljs
 */
export async function exportReport(req: Request, res: Response): Promise<Response | void> {
  try {
    const typeParsed = exportTypeSchema.safeParse(req.params['type']);
    if (!typeParsed.success) {
      return res.status(400).json({
        success: false,
        error: `Tipo de exportación inválido. Valores: sales, inventory, products`,
      });
    }

    const exportType = typeParsed.data;
    const { startDate, endDate } = resolveDateRange(req.query as Record<string, unknown>);

    let exportData: {
      rows:    Record<string, unknown>[];
      columns: reportService.ExcelColumn[];
      title:   string;
    };

    switch (exportType) {
      case 'sales':
        exportData = await reportService.buildSalesExportData(startDate, endDate);
        break;
      case 'inventory':
        exportData = await reportService.buildInventoryExportData();
        break;
      case 'products':
        exportData = await reportService.buildProductsRotationExportData(startDate, endDate);
        break;
    }

    const buffer = await reportService.generateExcelBuffer(
      exportData.rows,
      exportData.columns,
      exportType === 'sales' ? 'Ventas' : exportType === 'inventory' ? 'Inventario' : 'Rotación ABC',
      exportData.title,
    );

    const filename = `sigc-motos-${exportType}-${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length',      buffer.length);

    res.end(buffer, 'binary');
  } catch (err) {
    logger.error('[reportController] exportReport', err);
    if (err instanceof ZodError) {
      return res.status(422).json({ success: false, error: 'Parámetros inválidos', details: err.flatten() });
    }
    if (err instanceof Error) return res.status(400).json({ success: false, error: err.message });
    return res.status(500).json({ success: false, error: 'Error al generar exportación' });
  }
}
