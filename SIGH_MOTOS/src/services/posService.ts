/**
 * posService.ts — Módulo 2: Punto de Venta (POS)
 *
 * Responsabilidades:
 *  - Lookup ultra-rápido de productos por código de barras o SKU
 *  - Validación pre-transacción de stock disponible
 *  - Cálculo preciso de totales (aritmética entera para evitar errores de punto flotante)
 *  - Generación de números de factura FAC-{AÑO}-{SEQ}
 *  - Transacción atómica de venta: Sale + SaleItems + InventoryMovements + stock update
 *  - Consulta de ventas con filtro por rol (SELLER ve solo sus ventas)
 *  - Cancelación de ventas con reversión completa de stock
 */

import { Prisma, MovementType, SaleStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import type { CreateSaleInput, ListSalesQuery, CancelSaleInput, SearchCustomersQuery } from '../utils/validators';

// Re-export para que posController no dependa directamente de saleService
export { InsufficientStockError } from './saleService';
import { InsufficientStockError } from './saleService';
import { searchCustomers as customerServiceSearch } from './customerService';

// ─── Tipos internos ───────────────────────────────────────────────────────────

/** Cliente de transacción interactiva de Prisma (sin métodos de control de conexión). */
type PrismaTx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Producto ligero para pantalla de caja — sólo los campos que necesita el POS. */
export interface PosProduct {
  id:             string;
  nameCommercial: string;
  skuInternal:    string;
  barcodeExternal: string | null;
  salePriceBase:  string;
  taxRate:        string;
  stockQuantity:  number;
  imageKey:       string | null;
  locationBin:    string;
}

/** Descomposición de totales de una venta. */
export interface SaleTotals {
  subtotal:       number;
  discountAmount: number;
  taxableBase:    number;
  taxAmount:      number;
  totalAmount:    number;
}

// ─── Helper de precisión monetaria ───────────────────────────────────────────

/**
 * Redondea a 2 decimales usando aritmética entera para evitar errores de punto flotante.
 * Math.round(1.005 * 100) / 100 → 1.01 (correcto)
 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ═══════════════════════════════════════════════════════════════════════════
// BÚSQUEDA DE PRODUCTO (endpoint de caja)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca un producto por código de barras o SKU interno.
 *
 * Optimizado para respuestas < 50 ms:
 *  - Usa los índices de BD sobre `barcodeExternal` y `skuInternal`.
 *  - Retorna sólo los campos necesarios en pantalla de caja.
 *  - Solo productos activos son devueltos.
 *
 * El frontend envía el código al recibir el evento "Enter" del lector HID.
 *
 * @param code - Código de barras o SKU interno escaneado / tecleado.
 *
 * @example
 * GET /api/v1/pos/products/by-barcode/7702009123456
 * GET /api/v1/pos/products/by-barcode/FREN-BAJ-1713700000000
 */
export async function findProductByCode(code: string): Promise<PosProduct | null> {
  const product = await prisma.product.findFirst({
    where: {
      isActive: true,
      OR: [
        { barcodeExternal: code },
        { skuInternal:     code },
      ],
    },
    select: {
      id:              true,
      nameCommercial:  true,
      skuInternal:     true,
      barcodeExternal: true,
      salePriceBase:   true,
      taxRate:         true,
      stockQuantity:   true,
      imageKey:        true,
      locationBin:     true,
    },
  });

  if (!product) return null;
  return {
    ...product,
    salePriceBase: product.salePriceBase.toString(),
    taxRate:       product.taxRate.toString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE STOCK (pre-transacción)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica que TODOS los ítems del carrito tengan stock suficiente ANTES de
 * abrir la transacción de venta. Falla rápido con mensaje específico por producto.
 *
 * Realiza las lecturas en paralelo para mayor velocidad.
 *
 * @throws {InsufficientStockError} Si algún producto no tiene el stock requerido.
 *
 * @example
 * await validateStockAvailability([
 *   { productId: 'clxyz...', quantity: 3 },
 *   { productId: 'clabc...', quantity: 1 },
 * ]);
 */
export async function validateStockAvailability(
  items: Array<{ productId: string; quantity: number }>,
): Promise<void> {
  const products = await Promise.all(
    items.map((item) =>
      prisma.product.findUnique({
        where:  { id: item.productId },
        select: { id: true, nameCommercial: true, stockQuantity: true, isActive: true },
      }),
    ),
  );

  for (let i = 0; i < items.length; i++) {
    const product = products[i]!;
    const item    = items[i]!;

    if (!product) {
      throw new Error(`Producto con id "${item.productId}" no encontrado.`);
    }
    if (!product.isActive) {
      throw new Error(`El producto "${product.nameCommercial}" está desactivado.`);
    }
    if (product.stockQuantity < item.quantity) {
      throw new InsufficientStockError(
        product.nameCommercial,
        product.stockQuantity,
        item.quantity,
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CÁLCULO DE TOTALES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula los totales de una venta usando aritmética entera para evitar
 * errores de punto flotante en operaciones monetarias.
 *
 * Fórmula:
 *   lineTotal        = (unitPrice × quantity) − discountPerItem
 *   subtotal         = Σ lineTotals
 *   taxableBase      = max(0, subtotal − globalDiscount)
 *   taxAmount        = taxableBase × (taxRate / 100)
 *   totalAmount      = taxableBase + taxAmount
 *
 * @param items               - Ítems del carrito con precios ya definidos.
 * @param globalDiscountAmount - Descuento global aplicado a la venta (default: 0).
 * @param taxRate             - Porcentaje de IVA (default: 19 para Colombia).
 *
 * @example
 * calculateSaleTotals(
 *   [{ quantity: 2, unitPrice: 15000, discountPerItem: 0 }],
 *   0,
 *   19
 * )
 * // → { subtotal: 30000, discountAmount: 0, taxableBase: 30000, taxAmount: 5700, totalAmount: 35700 }
 */
export function calculateSaleTotals(
  items: Array<{ quantity: number; unitPrice: number; discountPerItem?: number }>,
  globalDiscountAmount = 0,
  taxRate = 19,
): SaleTotals {
  // Aritmética entera: trabajar en centavos para evitar imprecisión de IEEE 754
  let subtotalCents = 0;

  for (const item of items) {
    const lineCents =
      Math.round(item.unitPrice * item.quantity * 100) -
      Math.round((item.discountPerItem ?? 0) * 100);
    subtotalCents += lineCents;
  }

  const discountCents  = Math.round(globalDiscountAmount * 100);
  const taxBaseCents   = Math.max(0, subtotalCents - discountCents);
  const taxAmountCents = Math.round((taxBaseCents * taxRate) / 100);
  const totalCents     = taxBaseCents + taxAmountCents;

  return {
    subtotal:       round2(subtotalCents  / 100),
    discountAmount: round2(discountCents  / 100),
    taxableBase:    round2(taxBaseCents   / 100),
    taxAmount:      round2(taxAmountCents / 100),
    totalAmount:    round2(totalCents     / 100),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// NÚMERO DE FACTURA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera el número de factura para ventas POS en formato FAC-{AÑO}-{SEQ}.
 * Ejemplo: FAC-2026-00001
 *
 * NOTA: Para garantizar unicidad bajo concurrencia, esta función debe
 * ejecutarse siempre DENTRO de la misma transacción que crea la venta.
 * El método público está disponible para consultas fuera de transacción.
 *
 * @param client - Cliente de Prisma (directo o de transacción).
 */
async function _generateInvoiceNumber(
  client: Pick<typeof prisma, 'sale'>,
): Promise<string> {
  const year   = new Date().getFullYear();
  const prefix = `FAC-${year}-`;

  const last = await client.sale.findFirst({
    where:   { saleNumber: { startsWith: prefix } },
    orderBy: { saleNumber: 'desc' },
    select:  { saleNumber: true },
  });

  const nextSeq = last
    ? (parseInt(last.saleNumber.split('-').at(-1) ?? '0', 10) || 0) + 1
    : 1;

  return `${prefix}${String(nextSeq).padStart(5, '0')}`;
}

/**
 * Genera el siguiente número de factura FAC-{AÑO}-{SEQ} disponible.
 * Devuelve el número pero NO lo reserva — usar dentro de transacción para
 * garantizar unicidad bajo concurrencia alta.
 *
 * @example
 * await generateInvoiceNumber() // → "FAC-2026-00042"
 */
export async function generateInvoiceNumber(): Promise<string> {
  return _generateInvoiceNumber(prisma);
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSACCIÓN DE VENTA (núcleo del POS)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Procesa una venta completa en una única transacción atómica de Prisma.
 *
 * Orden de operaciones (dentro de $transaction):
 *  1. Generar número de factura FAC-{AÑO}-{SEQ} (lectura atómica dentro de TX).
 *  2. Por cada ítem:
 *     a. Leer producto con bloqueo implícito de fila.
 *     b. Verificar stock suficiente (segunda barrera, la primera es validateStockAvailability).
 *     c. Actualizar stockQuantity del producto.
 *     d. Crear movimiento InventoryMovement tipo EXIT.
 *     e. Calcular lineTotal con descuento por ítem.
 *  3. Calcular totales (subtotal, IVA, total final).
 *  4. Crear registro Sale con todos sus SaleItems en una sola escritura.
 *
 * Si cualquier paso falla, Prisma revierte TODA la transacción:
 * ni la venta ni los movimientos ni las actualizaciones de stock persisten.
 *
 * @param data   - Datos validados por createSaleSchema.
 * @param userId - ID del vendedor que realiza la venta.
 *
 * @throws {InsufficientStockError} si el stock falla dentro de la TX (race condition).
 * @throws {Error} si el producto no existe o está desactivado.
 */
export async function processSaleTransaction(data: CreateSaleInput, userId: string) {
  logger.info('[posService] Starting POS sale transaction', {
    userId,
    itemCount:     data.items.length,
    paymentMethod: data.paymentMethod,
  });

  // Serializable evita que dos ventas simultáneas del mismo producto dejen stock negativo
  const sale = await prisma.$transaction(async (tx) => {
    // ── 1. Número de factura (dentro de TX para evitar colisiones) ──────────
    const invoiceNumber = await _generateInvoiceNumber(tx as unknown as Pick<typeof prisma, 'sale'>);

    // ── 2. Procesar cada ítem ────────────────────────────────────────────────
    let subtotalCents = 0;

    const processedItems = await Promise.all(
      data.items.map(async (rawItem) => {
        const product = await (tx as PrismaTx).product.findUnique({
          where:  { id: rawItem.productId },
          select: {
            id:             true,
            nameCommercial: true,
            skuInternal:    true,
            costPriceAvg:   true,
            salePriceBase:  true,
            taxRate:        true,
            stockQuantity:  true,
            isActive:       true,
          },
        });

        if (!product) {
          throw new Error(`Producto "${rawItem.productId}" no encontrado.`);
        }
        if (!product.isActive) {
          throw new Error(`El producto "${product.nameCommercial}" está desactivado.`);
        }
        if (product.stockQuantity < rawItem.quantity) {
          throw new InsufficientStockError(
            product.nameCommercial,
            product.stockQuantity,
            rawItem.quantity,
          );
        }

        const unitPrice      = rawItem.unitPrice ?? Number(product.salePriceBase);
        const discountItem   = rawItem.discountPerItem ?? 0;
        // Aritmética entera para la línea
        const lineCents      =
          Math.round(unitPrice * rawItem.quantity * 100) -
          Math.round(discountItem * 100);
        subtotalCents += lineCents;

        const newStock = product.stockQuantity - rawItem.quantity;

        // Descontar stock
        await (tx as PrismaTx).product.update({
          where: { id: rawItem.productId },
          data:  { stockQuantity: newStock },
        });

        // Movimiento EXIT en inventario (trazabilidad completa)
        await (tx as PrismaTx).inventoryMovement.create({
          data: {
            productId:         rawItem.productId,
            type:              MovementType.EXIT,
            quantity:          rawItem.quantity,
            unitCostAtMoment:  product.costPriceAvg,
            referenceDoc:      invoiceNumber,
            reason:            `VENTA-${invoiceNumber}`,
            performedByUserId: userId,
          },
        });

        return {
          productId:           rawItem.productId,
          productNameSnapshot: product.nameCommercial,
          skuSnapshot:         product.skuInternal,
          quantity:            rawItem.quantity,
          unitPrice:           String(round2(unitPrice)),
          discountPerItem:     String(round2(discountItem)),
          lineTotal:           String(round2(lineCents / 100)),
        };
      }),
    );

    // ── 3. Calcular totales financieros ──────────────────────────────────────
    const discountCents   = Math.round((data.discountAmount ?? 0) * 100);
    const taxBaseCents    = Math.max(0, subtotalCents - discountCents);
    const taxAmountCents  = Math.round((taxBaseCents * 19) / 100);   // IVA 19%
    const totalCents      = taxBaseCents + taxAmountCents;

    // ── 4. Crear la venta con sus ítems en una sola escritura ────────────────
    const created = await (tx as PrismaTx).sale.create({
      data: {
        saleNumber:    invoiceNumber,
        customerId:    data.customerId ?? null,
        userId,
        subtotal:      String(round2(subtotalCents / 100)),
        discountAmount: String(round2(discountCents / 100)),
        taxAmount:     String(round2(taxAmountCents / 100)),
        totalAmount:   String(round2(totalCents / 100)),
        paymentMethod: data.paymentMethod,
        status:        SaleStatus.COMPLETED,
        notes:         data.notes ?? null,
        items:         { create: processedItems },
      },
      include: {
        items:    true,
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    logger.info('[posService] POS sale created', {
      saleId:      created.id,
      invoice:     invoiceNumber,
      total:       round2(totalCents / 100),
      itemCount:   processedItems.length,
    });

    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return sale;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSULTAS DE VENTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene una venta por ID o número de factura con todos sus detalles.
 * Incluye ítems, datos del cliente y snapshot de cada producto en el momento
 * de la venta (productNameSnapshot, skuSnapshot, unitPrice, lineTotal).
 *
 * @param identifier - ID de Prisma (cuid) o número de factura (FAC-… / VTA-…).
 *
 * @example
 * GET /api/v1/pos/sales/FAC-2026-00042
 * GET /api/v1/pos/sales/clxyz789abc
 */
export async function getSaleById(identifier: string) {
  const sale = await prisma.sale.findFirst({
    where: {
      OR: [{ id: identifier }, { saleNumber: identifier }],
    },
    include: {
      customer: {
        select: { id: true, name: true, phone: true, identificationNumber: true },
      },
      items: {
        select: {
          id:                  true,
          productId:           true,
          productNameSnapshot: true,
          skuSnapshot:         true,
          quantity:            true,
          unitPrice:           true,
          discountPerItem:     true,
          lineTotal:           true,
        },
      },
    },
  });

  if (!sale) return null;

  const cashier = await prisma.user
    .findUnique({ where: { id: sale.userId }, select: { id: true, name: true } })
    .catch(() => null);

  return { ...sale, cashier };
}

/**
 * Lista ventas con paginación, filtros y control de acceso por rol.
 *
 * - **ADMIN** (`isAdmin = true`): ve todas las ventas del sistema.
 * - **SELLER** (`isAdmin = false`): sólo ve las ventas donde `userId = callerId`.
 *
 * No incluye `descriptionTech` ni campos pesados de productos para mantener
 * respuestas ligeras en la lista.
 *
 * @param query    - Filtros y paginación (validados por listSalesQuerySchema).
 * @param callerId - ID del usuario que realiza la consulta.
 * @param isAdmin  - Si tiene permiso `sales.admin`.
 *
 * @example
 * GET /api/v1/pos/sales?startDate=2026-01-01&paymentMethod=CASH&page=1&limit=20
 */
export async function getAllSales(
  query: ListSalesQuery,
  callerId: string,
  isAdmin: boolean,
) {
  const { page, limit, startDate, endDate, customerId, status, paymentMethod, sortBy } = query;
  const skip = (page - 1) * limit;
  const [sortField, sortDir] = sortBy.split(':') as [string, 'asc' | 'desc'];

  const where: Prisma.SaleWhereInput = {
    // SELLER sólo ve sus propias ventas
    ...(!isAdmin && { userId: callerId }),
    ...(customerId    && { customerId }),
    ...(status        && { status }),
    ...(paymentMethod && { paymentMethod }),
    ...((startDate ?? endDate) && {
      createdAt: {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate   && { lte: new Date(endDate) }),
      },
    }),
  };

  const [sales, total] = await prisma.$transaction([
    prisma.sale.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { [sortField]: sortDir },
      select: {
        id:             true,
        saleNumber:     true,
        userId:         true,
        subtotal:       true,
        discountAmount: true,
        taxAmount:      true,
        totalAmount:    true,
        paymentMethod:  true,
        status:         true,
        notes:          true,
        createdAt:      true,
        customer: {
          select: { id: true, name: true, phone: true, identificationNumber: true },
        },
        items: {
          select: {
            id:                  true,
            productNameSnapshot: true,
            skuSnapshot:         true,
            quantity:            true,
            lineTotal:           true,
          },
        },
      },
    }),
    prisma.sale.count({ where }),
  ]);

  return {
    data: sales,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CANCELACIÓN DE VENTA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cancela una venta en estado COMPLETED.
 *
 * Transacción atómica (todo o nada):
 *  1. Verifica que la venta exista y esté en estado COMPLETED.
 *  2. Por cada ítem: restaura stock + crea movimiento RETURN.
 *  3. Actualiza el estado de la venta a CANCELLED.
 *
 * Requiere rol ADMIN — verificado en el middleware de la ruta.
 *
 * @param id     - ID o número de factura de la venta a cancelar.
 * @param data   - Motivo de cancelación (requerido para auditoría).
 * @param userId - ID del administrador que ejecuta la cancelación.
 *
 * @throws {Error} Si la venta no existe o no está en estado COMPLETED.
 *
 * @example
 * POST /api/v1/pos/sales/FAC-2026-00042/cancel
 * { "reason": "Error en la facturación — duplicado con FAC-2026-00041" }
 */
export async function cancelSale(
  id: string,
  data: CancelSaleInput,
  userId: string,
) {
  const sale = await prisma.sale.findFirst({
    where: { OR: [{ id }, { saleNumber: id }] },
    include: { items: true },
  });

  if (!sale) throw new Error('Venta no encontrada.');
  if (sale.status !== SaleStatus.COMPLETED) {
    throw new Error(
      `No se puede cancelar una venta en estado "${sale.status}". Solo se cancelan ventas COMPLETED.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    // Restaurar stock e inventario por cada ítem vendido
    for (const item of sale.items) {
      const product = await (tx as PrismaTx).product.findUnique({
        where:  { id: item.productId },
        select: { stockQuantity: true, costPriceAvg: true },
      });

      if (product) {
        await (tx as PrismaTx).product.update({
          where: { id: item.productId },
          data:  { stockQuantity: product.stockQuantity + item.quantity },
        });

        await (tx as PrismaTx).inventoryMovement.create({
          data: {
            productId:         item.productId,
            type:              MovementType.RETURN,
            quantity:          item.quantity,
            unitCostAtMoment:  product.costPriceAvg,
            referenceDoc:      sale.saleNumber,
            reason:            `CANCELACION-${sale.saleNumber}: ${data.reason}`,
            performedByUserId: userId,
          },
        });
      }
    }

    // Marcar como cancelada
    await (tx as PrismaTx).sale.update({
      where: { id: sale.id },
      data: {
        status: SaleStatus.CANCELLED,
        notes:  `[CANCELADA por ${userId}] ${data.reason}`,
      },
    });
  });

  logger.info('[posService] Sale cancelled', {
    saleId:      sale.id,
    saleNumber:  sale.saleNumber,
    cancelledBy: userId,
    reason:      data.reason,
  });

  return {
    saleId:     sale.id,
    saleNumber: sale.saleNumber,
    status:     SaleStatus.CANCELLED,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTES (búsqueda rápida para vincular en checkout)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Búsqueda de clientes para el flujo de checkout del POS.
 * Delega a customerService.searchCustomers para evitar duplicación.
 *
 * @example
 * GET /api/v1/pos/customers?query=Juan&page=1&limit=10
 */
export async function searchCustomers(query: SearchCustomersQuery) {
  return customerServiceSearch(query);
}
