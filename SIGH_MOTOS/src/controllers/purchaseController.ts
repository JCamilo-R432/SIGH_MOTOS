import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import {
  createSupplierSchema,
  updateSupplierSchema,
  listSuppliersQuerySchema,
  createPurchaseOrderSchema,
  receivePurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
  cancelPurchaseOrderSchema,
  registerEntrySchema,
  listEntriesQuerySchema,
} from '../utils/validators';
import {
  createSupplier,
  getSuppliers,
  getSupplierById,
  updateSupplier,
} from '../services/supplierService';
import {
  createPurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  getPurchaseOrderById,
  getPurchaseOrders,
  OverreceiptError,
} from '../services/purchaseOrderService';
import {
  processEntryTransaction,
  getAllEntries,
  getEntryById,
} from '../services/purchaseService';
import { createPayableFromPurchase } from '../services/debtService';
import { logAction } from '../services/auditService';
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
  logger.error(`[PurchaseController] ${context}`, { err });

  if (err instanceof ZodError) {
    return fail(res, 'Datos de entrada inválidos', 422, err.flatten());
  }

  // Exceso de recepción sobre lo ordenado
  if (err instanceof OverreceiptError) {
    return fail(res, err.message, 400, {
      type: 'OVERRECEIPT',
      product: err.productName,
      pending: err.pending,
      attempted: err.attempted,
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
// PROVEEDORES
// ═══════════════════════════════════════════════════════════════════════════

export async function createSupplierHandler(req: Request, res: Response) {
  try {
    const input = createSupplierSchema.parse(req.body);
    const supplier = await createSupplier(input);
    return ok(res, supplier, 201);
  } catch (err) {
    return handleError(res, err, 'createSupplier');
  }
}

export async function listSuppliersHandler(req: Request, res: Response) {
  try {
    const query = listSuppliersQuerySchema.parse(req.query);
    const result = await getSuppliers(query);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'listSuppliers');
  }
}

export async function getSupplierByIdHandler(req: Request, res: Response) {
  try {
    const id = extractParam(req.params['id']);
    const supplier = await getSupplierById(id);
    if (!supplier) return fail(res, 'Proveedor no encontrado', 404);
    return ok(res, supplier);
  } catch (err) {
    return handleError(res, err, 'getSupplierById');
  }
}

export async function updateSupplierHandler(req: Request, res: Response) {
  try {
    const id = extractParam(req.params['id']);
    const input = updateSupplierSchema.parse(req.body);
    const supplier = await updateSupplier(id, input);
    return ok(res, supplier);
  } catch (err) {
    return handleError(res, err, 'updateSupplier');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ÓRDENES DE COMPRA
// ═══════════════════════════════════════════════════════════════════════════

export async function createPurchaseOrderHandler(req: Request, res: Response) {
  try {
    const input = createPurchaseOrderSchema.parse(req.body);
    const userId = req.user?.id ?? 'unknown';
    const po = await createPurchaseOrder(input, userId);
    // TODO AUDIT: import { logAction } from '../services/auditService'
    // void logAction(userId, 'CREATE_PURCHASE_ORDER', 'PurchaseOrder', po.id, {
    //   supplierId:  po.supplierId,
    //   total:       po.totalAmount,
    //   itemsCount:  po.items.length,
    // }, req.ip);
    return ok(res, po, 201);
  } catch (err) {
    return handleError(res, err, 'createPurchaseOrder');
  }
}

export async function receivePurchaseOrderHandler(req: Request, res: Response) {
  try {
    const id = extractParam(req.params['id']);
    const input = receivePurchaseOrderSchema.parse(req.body);
    const userId = req.user?.id ?? 'unknown';
    const po = await receivePurchaseOrder(id, input, userId);

    // Si se envía isCredit=true en el body, crea CxP automáticamente
    const body = req.body as Record<string, unknown>;
    if (body['isCredit'] === true && po.status !== 'CANCELLED') {
      const dueDate = typeof body['dueDate'] === 'string' ? new Date(body['dueDate']) : undefined;
      void createPayableFromPurchase(
        po.id, po.supplierId, parseFloat(String(po.totalAmount)), dueDate,
      ).catch((err: unknown) => logger.error('[purchaseController] Error al crear CxP', err));
    }

    return ok(res, po);
  } catch (err) {
    return handleError(res, err, 'receivePurchaseOrder');
  }
}

export async function cancelPurchaseOrderHandler(req: Request, res: Response) {
  try {
    const id = extractParam(req.params['id']);
    const input = cancelPurchaseOrderSchema.parse(req.body);
    const userId = req.user?.id ?? 'unknown';
    const po = await cancelPurchaseOrder(id, input, userId);
    return ok(res, po);
  } catch (err) {
    return handleError(res, err, 'cancelPurchaseOrder');
  }
}

export async function getPurchaseOrderByIdHandler(req: Request, res: Response) {
  try {
    const id = extractParam(req.params['id']);
    const po = await getPurchaseOrderById(id);
    if (!po) return fail(res, 'Orden de compra no encontrada', 404);
    return ok(res, po);
  } catch (err) {
    return handleError(res, err, 'getPurchaseOrderById');
  }
}

export async function listPurchaseOrdersHandler(req: Request, res: Response) {
  try {
    const query = listPurchaseOrdersQuerySchema.parse(req.query);
    const result = await getPurchaseOrders(query);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'listPurchaseOrders');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 4 — ENTRADAS DE MERCANCÍA (Recepción Física)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/purchases/entries
 *
 * Registra una entrada de mercancía al almacén.
 *
 * Flujo de negocio:
 *  1. Valida el body con Zod (items + quantity/unitCost > 0).
 *  2. Pre-resuelve cada ítem: busca productos existentes o valida campos
 *     para crear uno nuevo "al vuelo" (nameCommercial + brandId + categoryId).
 *  3. Transacción atómica:
 *     - Genera número ENT-{AÑO}-{NNNNN}.
 *     - Crea productos nuevos si aplica (stock 0 inicial).
 *     - Actualiza `stockQuantity` y recalcula `costPriceAvg` (WAC) por producto.
 *     - Crea un `InventoryMovement` tipo ENTRY por cada ítem.
 *  4. Retorna el resumen con número de entrada, totales y detalle por ítem.
 *
 * @request { items: EntryItem[], notes?: string }
 * @response 201 con EntryResult completo.
 * @response 409 si un SKU generado para producto nuevo ya existe (P2002).
 */
export async function registerEntryHandler(req: Request, res: Response) {
  try {
    const input  = registerEntrySchema.parse(req.body);
    const userId = req.user?.id ?? 'unknown';

    const result = await processEntryTransaction(input, userId);

    void logAction(userId, 'PURCHASE_ENTRY_REGISTERED', 'InventoryMovement', result.entryNumber, {
      entryNumber:    result.entryNumber,
      itemsProcessed: result.itemsProcessed,
      totalValue:     result.totalValue,
      newProducts:    result.items.filter((i) => i.wasCreated).length,
    }, req.ip);

    return ok(res, result, 201);
  } catch (err) {
    return handleError(res, err, 'registerEntry');
  }
}

/**
 * GET /api/v1/purchases/entries
 *
 * Lista el historial de entradas de mercancía con paginación y filtros por fecha.
 * Muestra datos agregados: Número de Documento, Fecha, Total Ítems, Valor Total.
 *
 * @query page?, limit?, startDate?, endDate?
 *
 * @example
 * GET /api/v1/purchases/entries?startDate=2026-01-01T00:00:00Z&limit=20
 */
export async function getAllEntriesHandler(req: Request, res: Response) {
  try {
    const query  = listEntriesQuerySchema.parse(req.query);
    const result = await getAllEntries(query);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'getAllEntries');
  }
}

/**
 * GET /api/v1/purchases/entries/:id
 *
 * Obtiene los detalles completos de una entrada específica.
 * El parámetro `:id` es el número de documento (ENT-2026-00001).
 *
 * Retorna: lista de productos recibidos con costos unitarios, cantidades,
 * valores por línea, y totales de la entrada.
 *
 * @param req.params.id - Número de entrada (ENT-{AÑO}-{NNNNN}).
 *
 * @example
 * GET /api/v1/purchases/entries/ENT-2026-00001
 */
export async function getEntryByIdHandler(req: Request, res: Response) {
  try {
    const entryNumber = extractParam(req.params['id']);
    const entry       = await getEntryById(entryNumber);

    if (!entry) {
      return fail(res, `Entrada "${entryNumber}" no encontrada`, 404);
    }

    return ok(res, entry);
  } catch (err) {
    return handleError(res, err, 'getEntryById');
  }
}
