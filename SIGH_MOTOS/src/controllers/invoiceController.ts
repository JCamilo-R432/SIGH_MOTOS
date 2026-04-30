/**
 * invoiceController.ts — Módulo 3: Facturación y Documentación Comercial
 *
 * Endpoints HTTP:
 *  GET  /api/v1/invoices/config      — Leer configuración de empresa
 *  PUT  /api/v1/invoices/config      — Actualizar configuración de empresa (ADMIN)
 *  GET  /api/v1/invoices/:id         — Obtener documento de factura para imprimir
 *  POST /api/v1/invoices/:id/cancel  — Cancelar factura (ADMIN)
 */

import { Request, Response } from 'express';
import { Prisma }            from '@prisma/client';
import { ZodError }          from 'zod';
import { companyConfigSchema, cancelSaleSchema } from '../utils/validators';
import {
  getCompanyConfig,
  updateCompanyConfig,
  generateInvoiceDocument,
  cancelInvoice,
} from '../services/invoiceService';
import { prisma }    from '../config/prisma';
import { logAction } from '../services/auditService';
import { logger }   from '../config/logger';

// ─── Helpers HTTP ─────────────────────────────────────────────────────────────

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

const fail = (res: Response, error: string, status = 400, details?: unknown) =>
  res.status(status).json({ success: false, error, ...(details ? { details } : {}) });

function extractParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] ?? '';
  return param ?? '';
}

function handleError(res: Response, err: unknown, context: string) {
  logger.error(`[InvoiceController] ${context}`, { err });

  if (err instanceof ZodError) {
    return fail(res, 'Datos de entrada inválidos', 422, err.flatten());
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
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
// LISTADO DE FACTURAS
// ═══════════════════════════════════════════════════════════════════════════

export async function listInvoicesHandler(req: Request, res: Response) {
  try {
    const page       = Math.max(1, parseInt(String(req.query['page'] ?? '1')));
    const limit      = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '20'))));
    const startDate  = req.query['startDate'] as string | undefined;
    const endDate    = req.query['endDate']   as string | undefined;
    const customerId = req.query['customerId'] as string | undefined;
    const status     = req.query['status']    as string | undefined;

    const where: Prisma.SaleWhereInput = {
      ...(customerId ? { customerId } : {}),
      ...(status     ? { status: status as Prisma.EnumSaleStatusFilter } : {}),
      ...(startDate || endDate ? {
        createdAt: {
          ...(startDate ? { gte: new Date(startDate) } : {}),
          ...(endDate   ? { lte: new Date(endDate)   } : {}),
        },
      } : {}),
    };

    const [invoices, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        skip:    (page - 1) * limit,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          items:    { select: { id: true, quantity: true, unitPrice: true, productId: true } },
        },
      }),
      prisma.sale.count({ where }),
    ]);

    return ok(res, {
      invoices,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    return handleError(res, err, 'listInvoices');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE EMPRESA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/invoices/config
 *
 * Retorna la configuración de empresa usada en el encabezado de todas las facturas.
 * Incluye: razón social, NIT, dirección, teléfono, email, pie de página.
 *
 * @response { name, nit, address, phone, email?, footer? }
 */
export function getCompanyConfigHandler(_req: Request, res: Response) {
  try {
    const config = getCompanyConfig();
    return ok(res, config);
  } catch (err) {
    return handleError(res, err, 'getCompanyConfig');
  }
}

/**
 * PUT /api/v1/invoices/config
 *
 * Actualiza la configuración de empresa (merge parcial sobre la configuración actual).
 * No es necesario enviar todos los campos — sólo los que se desean modificar.
 * Requiere permiso `sales.admin` (ADMIN).
 *
 * @request { name?, nit?, address?, phone?, email?, footer? }
 * @response Configuración resultante después del merge.
 *
 * @example
 * PUT /api/v1/invoices/config
 * { "phone": "3001234567", "email": "ventas@clavijosmotos.com" }
 */
export function updateCompanyConfigHandler(req: Request, res: Response) {
  try {
    const input  = companyConfigSchema.parse(req.body);
    const result = updateCompanyConfig(input);

    const userId = req.user?.id ?? 'unknown';
    void logAction(userId, 'INVOICE_CONFIG_UPDATED', 'SystemConfig', 'company', {
      fields: Object.keys(input),
    }, req.ip);

    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'updateCompanyConfig');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTOS DE FACTURA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/invoices/:id
 *
 * Genera y retorna el documento de factura estructurado para impresión térmica.
 *
 * Acepta tanto el ID de la venta (cuid) como el número de factura (FAC-… / VTA-…).
 * El documento incluye: encabezado de empresa, datos de la factura, datos del cliente,
 * líneas de productos y totales desglosados (subtotal, IVA, total).
 *
 * El campo `printedAt` es el momento en que se genera el documento, no la venta.
 *
 * @param req.params.id - ID (cuid) o número de factura (FAC-… / VTA-…).
 *
 * @example
 * GET /api/v1/invoices/FAC-2026-00042
 * GET /api/v1/invoices/clxyz789abc
 *
 * @response InvoiceDocument completo con header, invoice, customer, items, totals, footer.
 * @response 404 si no existe ninguna venta con ese identificador.
 */
export async function getInvoiceHandler(req: Request, res: Response) {
  try {
    const id  = extractParam(req.params['id']);
    const doc = await generateInvoiceDocument(id);

    if (!doc) return fail(res, `Factura no encontrada para el identificador "${id}"`, 404);

    return ok(res, doc);
  } catch (err) {
    return handleError(res, err, 'getInvoice');
  }
}

/**
 * POST /api/v1/invoices/:id/cancel
 *
 * Cancela una factura (= venta) en estado COMPLETED.
 *
 * Transacción atómica:
 *  1. Verifica que la venta exista y esté COMPLETED.
 *  2. Restaura el stock de cada ítem (movimientos RETURN).
 *  3. Marca la venta como CANCELLED con el motivo en el campo `notes`.
 *
 * Exclusivo para rol ADMIN (verificado en middleware de la ruta).
 *
 * @param req.params.id - ID (cuid) o número de factura.
 * @request { reason: string } — motivo obligatorio para trazabilidad.
 *
 * @example
 * POST /api/v1/invoices/FAC-2026-00042/cancel
 * { "reason": "Duplicado con FAC-2026-00041, error de doble cobro" }
 */
export async function cancelInvoiceHandler(req: Request, res: Response) {
  try {
    const id     = extractParam(req.params['id']);
    const input  = cancelSaleSchema.parse(req.body);
    const userId = req.user?.id ?? 'unknown';

    const result = await cancelInvoice(id, input, userId);

    void logAction(userId, 'INVOICE_CANCELLED', 'Sale', id, {
      reason:      input.reason,
      invoiceNumber: result.saleNumber,
    }, req.ip);

    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'cancelInvoice');
  }
}
