import { Request, Response } from 'express';
import * as reportService from '../services/reportService';
import { getStartOfMonth, getEndOfMonth } from '../utils/dateUtils';
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
