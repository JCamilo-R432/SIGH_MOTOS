/**
 * posController.ts — Módulo 2: Punto de Venta (POS)
 *
 * Endpoints HTTP para operaciones de caja:
 *  - Lookup instantáneo de productos por código de barras / SKU
 *  - Procesamiento de ventas (con integración financiera fire-and-forget)
 *  - Consulta y cancelación de ventas
 *  - Búsqueda de clientes para vincular en checkout
 */

import { Request, Response } from 'express';
import { Prisma, PaymentMethod } from '@prisma/client';
import { ZodError }              from 'zod';
import {
  createSaleSchema,
  cancelSaleSchema,
  listSalesQuerySchema,
  searchCustomersQuerySchema,
} from '../utils/validators';
import {
  findProductByCode,
  validateStockAvailability,
  calculateSaleTotals,
  processSaleTransaction,
  getSaleById,
  getAllSales,
  cancelSale,
  searchCustomers,
  InsufficientStockError,
} from '../services/posService';
import { createIncomeFromSale }      from '../services/financialTransactionService';
import { createReceivableFromSale }  from '../services/debtService';
import { logAction }                 from '../services/auditService';
import { logger }                    from '../config/logger';

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
  logger.error(`[PosController] ${context}`, { err });

  if (err instanceof ZodError) {
    return fail(res, 'Datos de entrada inválidos', 422, err.flatten());
  }

  // Stock insuficiente — error de negocio con payload estructurado para el POS
  if (err instanceof InsufficientStockError) {
    return fail(res, err.message, 409, {
      type:      'INSUFFICIENT_STOCK',
      product:   err.productName,
      available: err.available,
      requested: err.requested,
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return fail(res, 'Ya existe un registro con esos datos', 409);
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
// PRODUCTOS — LOOKUP POR CÓDIGO DE BARRAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/pos/products/by-barcode/:code
 *
 * Busca un producto activo por `barcodeExternal` o `skuInternal`.
 * Endpoint crítico para el flujo de escaneo en caja — optimizado para < 50 ms.
 *
 * ─── Integración con hardware ──────────────────────────────────────────────
 * Los lectores de barras en modo HID Keyboard Emulation envían el código
 * como secuencia de teclas seguida de un Enter. El frontend debe capturar
 * el evento keydown/keyup de "Enter" en el input de escaneo y hacer GET a
 * este endpoint con el valor del input limpiado de espacios.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * @param req.params.code - Código de barras o SKU escaneado.
 *
 * @example
 * GET /api/v1/pos/products/by-barcode/7702009123456
 * → { success: true, data: { id, nameCommercial, salePriceBase, stockQuantity, ... } }
 *
 * @response 404 si el producto no existe o está desactivado.
 */
export async function getProductByBarcode(req: Request, res: Response) {
  try {
    const code    = extractParam(req.params['code']).trim();
    const product = await findProductByCode(code);

    if (!product) {
      return fail(res, `Producto no encontrado para el código "${code}"`, 404);
    }

    // Calcular precio con IVA incluido para mostrarlo en pantalla de caja
    const base = Number(product.salePriceBase);
    const tax  = Number(product.taxRate);

    return ok(res, {
      ...product,
      salePriceWithTax: Math.round((base * (1 + tax / 100)) * 100) / 100,
    });
  } catch (err) {
    return handleError(res, err, 'getProductByBarcode');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VENTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/pos/sales
 *
 * Procesa una venta desde el POS. Flujo:
 *  1. Valida el body con Zod.
 *  2. Pre-valida stock de TODOS los ítems (falla rápido antes de abrir TX).
 *  3. Ejecuta la transacción atómica: Sale + SaleItems + EXIT movements + stock update.
 *  4. Fire-and-forget: integración financiera (registro en caja o CxC si es CREDIT).
 *  5. Fire-and-forget: log de auditoría.
 *
 * @request {
 *   items:         Array<{ productId, quantity, discountPerItem?, unitPrice? }>,
 *   paymentMethod: "CASH" | "CARD" | "TRANSFER" | "MIXED" | "CREDIT",
 *   customerId?:   string  (cuid del cliente — puede omitirse en ventas anónimas),
 *   discountAmount?: number (descuento global sobre la venta),
 *   notes?:        string
 * }
 *
 * @response 201 con objeto completo de la venta (para imprimir ticket).
 * @response 409 si algún producto no tiene stock suficiente.
 */
export async function createSale(req: Request, res: Response) {
  try {
    const input  = createSaleSchema.parse(req.body);
    const userId = req.user?.id ?? 'unknown';

    // Pre-validación de stock (fuera de TX para mensajes de error más claros)
    await validateStockAvailability(
      input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    );

    // Transacción principal: FAC number + Sale + Items + Movements + Stock
    const sale  = await processSaleTransaction(input, userId);
    const total = Number(sale.totalAmount);

    // ── Integración financiera (fire-and-forget, no bloquea respuesta) ──────
    if (input.paymentMethod === PaymentMethod.CREDIT) {
      if (sale.customerId) {
        void createReceivableFromSale(sale.id, sale.customerId, total)
          .catch((e: unknown) =>
            logger.error('[posController] Error al crear CxC', { err: e, saleId: sale.id }),
          );
      }
    } else {
      void createIncomeFromSale(sale.id, total, input.paymentMethod, userId)
        .catch((e: unknown) =>
          logger.error('[posController] Error al registrar ingreso en caja', { err: e, saleId: sale.id }),
        );
    }

    // ── Auditoría ────────────────────────────────────────────────────────────
    void logAction(userId, 'POS_SALE_COMPLETED', 'Sale', sale.id, {
      invoice:       sale.saleNumber,
      total,
      paymentMethod: input.paymentMethod,
      itemsCount:    sale.items.length,
      customerId:    sale.customerId,
    }, req.ip);

    return ok(res, sale, 201);
  } catch (err) {
    return handleError(res, err, 'createSale');
  }
}

/**
 * GET /api/v1/pos/sales/:id
 *
 * Obtiene una venta por ID o número de factura con todos sus detalles.
 * Útil para reimpresión de tickets y resolución de disputas.
 *
 * @param req.params.id - ID (cuid) o número de factura (FAC-… / VTA-…).
 *
 * @example
 * GET /api/v1/pos/sales/FAC-2026-00042
 */
export async function getSaleByIdHandler(req: Request, res: Response) {
  try {
    const id   = extractParam(req.params['id']);
    const sale = await getSaleById(id);
    if (!sale) return fail(res, 'Venta no encontrada', 404);
    return ok(res, sale);
  } catch (err) {
    return handleError(res, err, 'getSaleById');
  }
}

/**
 * GET /api/v1/pos/sales
 *
 * Lista ventas con filtros y paginación.
 *
 * ─── Control de acceso por rol ────────────────────────────────────────────
 * - ADMIN (permiso `sales.admin`): ve todas las ventas del sistema.
 * - SELLER: sólo ve sus propias ventas (filtrado por userId en BD).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * @query startDate?, endDate?, customerId?, status?, paymentMethod?, sortBy?, page?, limit?
 */
export async function getAllSalesHandler(req: Request, res: Response) {
  try {
    const query    = listSalesQuerySchema.parse(req.query);
    const callerId = req.user?.id ?? 'unknown';
    const isAdmin  = req.user?.permissions.includes('sales.admin') ?? false;

    const result = await getAllSales(query, callerId, isAdmin);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'getAllSales');
  }
}

/**
 * POST /api/v1/pos/sales/:id/cancel
 *
 * Cancela una venta en estado COMPLETED.
 * Restaura el stock de todos los ítems y registra movimientos RETURN.
 * Exclusivo para rol ADMIN (verificado en el middleware de la ruta).
 *
 * @request { reason: string } — motivo obligatorio para auditoría.
 *
 * @example
 * POST /api/v1/pos/sales/FAC-2026-00042/cancel
 * { "reason": "Error en la facturación, duplicado con FAC-2026-00041" }
 */
export async function cancelSaleHandler(req: Request, res: Response) {
  try {
    const id     = extractParam(req.params['id']);
    const input  = cancelSaleSchema.parse(req.body);
    const userId = req.user?.id ?? 'unknown';

    const result = await cancelSale(id, input, userId);

    void logAction(userId, 'POS_SALE_CANCELLED', 'Sale', id, {
      reason:     input.reason,
      saleNumber: result.saleNumber,
    }, req.ip);

    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'cancelSale');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTES — búsqueda rápida para el checkout
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/pos/customers
 *
 * Busca clientes por nombre, teléfono o número de identificación.
 * Útil para vincular clientes a ventas durante el checkout sin salir del POS.
 *
 * @query query? (texto libre), page?, limit?
 *
 * @example
 * GET /api/v1/pos/customers?query=3157890123&limit=5
 */
export async function searchCustomersHandler(req: Request, res: Response) {
  try {
    const query  = searchCustomersQuerySchema.parse(req.query);
    const result = await searchCustomers(query);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'searchCustomers');
  }
}

/**
 * GET /api/v1/pos/sales/totals/preview
 *
 * Calcula los totales de un carrito SIN procesar la venta.
 * Útil para mostrar el desglose en pantalla antes de confirmar.
 *
 * @request {
 *   items: Array<{ quantity, unitPrice, discountPerItem? }>,
 *   discountAmount?: number,
 *   taxRate?: number
 * }
 *
 * @response { subtotal, discountAmount, taxableBase, taxAmount, totalAmount }
 */
export async function previewTotals(req: Request, res: Response) {
  try {
    const { items, discountAmount, taxRate } = req.body as {
      items: Array<{ quantity: number; unitPrice: number; discountPerItem?: number }>;
      discountAmount?: number;
      taxRate?: number;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return fail(res, 'Se requiere al menos un ítem para calcular totales', 400);
    }

    const totals = calculateSaleTotals(items, discountAmount, taxRate);
    return ok(res, totals);
  } catch (err) {
    return handleError(res, err, 'previewTotals');
  }
}
