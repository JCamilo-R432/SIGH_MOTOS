import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import {
  createSaleSchema,
  cancelSaleSchema,
  listSalesQuerySchema,
  createCustomerSchema,
  searchCustomersQuerySchema,
} from '../utils/validators';
import {
  createSale,
  getSaleById,
  cancelSale,
  getSales,
  InsufficientStockError,
} from '../services/saleService';
import {
  createOrUpdateCustomer,
  getCustomerById,
  searchCustomers,
} from '../services/customerService';
import { logger } from '../config/logger';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

const fail = (res: Response, error: string, status = 400, details?: unknown) =>
  res.status(status).json({ success: false, error, ...(details ? { details } : {}) });

function extractParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] ?? '';
  return param ?? '';
}

function handleError(res: Response, err: unknown, context: string) {
  logger.error(`[SaleController] ${context}`, { err });

  if (err instanceof ZodError) {
    return fail(res, 'Datos de entrada inválidos', 422, err.flatten());
  }

  // Stock insuficiente — error de negocio claro para el POS
  if (err instanceof InsufficientStockError) {
    return fail(res, err.message, 400, {
      type: 'INSUFFICIENT_STOCK',
      product: err.productName,
      available: err.available,
      requested: err.requested,
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const fields = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'campo';
      return fail(res, `Ya existe un registro con ese ${fields}`, 409);
    }
    if (err.code === 'P2025') {
      return fail(res, 'Registro no encontrado', 404);
    }
  }

  if (err instanceof Error) {
    return fail(res, err.message, 400);
  }

  return fail(res, 'Error interno del servidor', 500);
}

// ═══════════════════════════════════════════════════════════════════════════
// VENTAS
// ═══════════════════════════════════════════════════════════════════════════

export async function createSaleHandler(req: Request, res: Response) {
  try {
    const input = createSaleSchema.parse(req.body);
    const userId = req.user?.id ?? 'unknown';
    const sale = await createSale(input, userId);
    // TODO AUDIT: import { logAction } from '../services/auditService'
    // void logAction(userId, 'SALE_COMPLETED', 'Sale', sale.id, {
    //   total:      sale.totalAmount,
    //   itemsCount: sale.items.length,
    //   customerId: sale.customerId,
    // }, req.ip);
    return ok(res, sale, 201);
  } catch (err) {
    return handleError(res, err, 'createSale');
  }
}

export async function getSaleByIdHandler(req: Request, res: Response) {
  try {
    const id = extractParam(req.params['id']);
    const sale = await getSaleById(id);
    if (!sale) return fail(res, 'Venta no encontrada', 404);
    return ok(res, sale);
  } catch (err) {
    return handleError(res, err, 'getSaleById');
  }
}

export async function cancelSaleHandler(req: Request, res: Response) {
  try {
    const id = extractParam(req.params['id']);
    const input = cancelSaleSchema.parse(req.body);
    const userId = req.user?.id ?? 'unknown';
    const result = await cancelSale(id, input, userId);
    // TODO AUDIT: void logAction(userId, 'SALE_CANCELLED', 'Sale', id, { reason: input.reason }, req.ip);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'cancelSale');
  }
}

export async function listSalesHandler(req: Request, res: Response) {
  try {
    const query = listSalesQuerySchema.parse(req.query);
    const result = await getSales(query);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'listSales');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTES
// ═══════════════════════════════════════════════════════════════════════════

export async function createCustomerHandler(req: Request, res: Response) {
  try {
    const input = createCustomerSchema.parse(req.body);
    const customer = await createOrUpdateCustomer(input);
    return ok(res, customer, 201);
  } catch (err) {
    return handleError(res, err, 'createCustomer');
  }
}

export async function searchCustomersHandler(req: Request, res: Response) {
  try {
    const query = searchCustomersQuerySchema.parse(req.query);
    const result = await searchCustomers(query);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'searchCustomers');
  }
}

export async function getCustomerByIdHandler(req: Request, res: Response) {
  try {
    const id = extractParam(req.params['id']);
    const customer = await getCustomerById(id);
    if (!customer) return fail(res, 'Cliente no encontrado', 404);
    return ok(res, customer);
  } catch (err) {
    return handleError(res, err, 'getCustomerById');
  }
}
