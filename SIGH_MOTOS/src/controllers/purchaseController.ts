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
import { createPayableFromPurchase } from '../services/debtService';
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
