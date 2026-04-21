import { Prisma, MovementType, SaleStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { generateSaleNumber } from '../utils/saleNumberGenerator';
import type { CreateSaleInput, ListSalesQuery, CancelSaleInput } from '../utils/validators';

// ─── Tipos internos ──────────────────────────────────────────────────────────

// Cliente de transacción interactiva de Prisma
type PrismaTx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// Error tipado para stock insuficiente — permite identificarlo en el controller
export class InsufficientStockError extends Error {
  constructor(
    public readonly productName: string,
    public readonly available: number,
    public readonly requested: number,
  ) {
    super(
      `Stock insuficiente para "${productName}". Disponible: ${available}, solicitado: ${requested}.`,
    );
    this.name = 'InsufficientStockError';
  }
}

// ─── Lógica interna de ítems ─────────────────────────────────────────────────

interface ProcessedItem {
  productId: string;
  productNameSnapshot: string;
  skuSnapshot: string;
  quantity: number;
  unitPrice: string;
  discountPerItem: string;
  lineTotal: string;
}

/**
 * Procesa cada ítem dentro de la transacción:
 *  1. Lee el producto (con lock implícito en la fila por la transacción)
 *  2. Valida que hay stock suficiente
 *  3. Descuenta el stock del producto
 *  4. Crea el movimiento de inventario tipo EXIT
 *  5. Devuelve el objeto listo para insertar en SaleItem
 */
async function processItem(
  tx: PrismaTx,
  rawItem: CreateSaleInput['items'][number],
  saleNumber: string,
  userId: string,
): Promise<{ item: ProcessedItem; lineSubtotal: number }> {
  const product = await tx.product.findUnique({
    where: { id: rawItem.productId },
    select: {
      id: true,
      nameCommercial: true,
      skuInternal: true,
      costPriceAvg: true,
      salePriceBase: true,
      stockQuantity: true,
      isActive: true,
    },
  });

  if (!product) {
    throw new Error(`Producto con id "${rawItem.productId}" no encontrado.`);
  }
  if (!product.isActive) {
    throw new Error(`El producto "${product.nameCommercial}" está desactivado y no se puede vender.`);
  }
  if (product.stockQuantity < rawItem.quantity) {
    throw new InsufficientStockError(
      product.nameCommercial,
      product.stockQuantity,
      rawItem.quantity,
    );
  }

  const unitPrice = rawItem.unitPrice ?? Number(product.salePriceBase);
  const discountPerItem = rawItem.discountPerItem;
  // lineTotal = precio × cantidad - descuento por ítem
  const lineTotal = parseFloat(
    (unitPrice * rawItem.quantity - discountPerItem).toFixed(2),
  );

  const newStock = product.stockQuantity - rawItem.quantity;

  // Descontar stock
  await tx.product.update({
    where: { id: rawItem.productId },
    data: { stockQuantity: newStock },
  });

  // Registrar movimiento EXIT en inventario (trazabilidad completa)
  await tx.inventoryMovement.create({
    data: {
      productId: rawItem.productId,
      type: MovementType.EXIT,
      quantity: rawItem.quantity,
      unitCostAtMoment: product.costPriceAvg,
      referenceDoc: saleNumber,
      reason: `SALE-${saleNumber}`,
      performedByUserId: userId,
    },
  });

  return {
    item: {
      productId: rawItem.productId,
      productNameSnapshot: product.nameCommercial,
      skuSnapshot: product.skuInternal,
      quantity: rawItem.quantity,
      unitPrice: String(unitPrice),
      discountPerItem: String(discountPerItem),
      lineTotal: String(lineTotal),
    },
    lineSubtotal: lineTotal,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICIO PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea una venta completa en una única transacción atómica.
 *
 * Si cualquier ítem no tiene stock suficiente, toda la transacción se revierte:
 * ni el stock ni los movimientos ni la venta quedan parcialmente guardados.
 */
export async function createSale(data: CreateSaleInput, userId: string) {
  logger.info('Starting sale creation transaction', {
    userId,
    itemCount: data.items.length,
    paymentMethod: data.paymentMethod,
  });

  const sale = await prisma.$transaction(async (tx) => {
    // 1. Número de venta consecutivo (dentro de la TX para evitar race conditions)
    const saleNumber = await generateSaleNumber(tx as unknown as Parameters<typeof generateSaleNumber>[0]);

    // 2. Procesar ítems: valida stock, descuenta, crea movimientos
    let subtotal = 0;
    const processedItems: ProcessedItem[] = [];

    for (const rawItem of data.items) {
      const { item, lineSubtotal } = await processItem(tx as PrismaTx, rawItem, saleNumber, userId);
      processedItems.push(item);
      subtotal += lineSubtotal;
    }

    // 3. Calcular totales financieros
    const discountAmount = data.discountAmount;
    // Base gravable = subtotal - descuento global
    const taxableBase = Math.max(0, subtotal - discountAmount);
    // IVA 19% sobre la base gravable
    const taxAmount = parseFloat((taxableBase * 0.19).toFixed(2));
    const totalAmount = parseFloat((taxableBase + taxAmount).toFixed(2));

    // 4. Crear la venta con sus ítems en una sola escritura
    const created = await (tx as PrismaTx).sale.create({
      data: {
        saleNumber,
        customerId: data.customerId ?? null,
        userId,
        subtotal: String(parseFloat(subtotal.toFixed(2))),
        discountAmount: String(discountAmount),
        taxAmount: String(taxAmount),
        totalAmount: String(totalAmount),
        paymentMethod: data.paymentMethod,
        status: SaleStatus.COMPLETED,
        notes: data.notes,
        items: { create: processedItems },
      },
      include: {
        items: true,
        customer: true,
      },
    });

    logger.info('Sale created successfully', {
      saleId: created.id,
      saleNumber: created.saleNumber,
      total: totalAmount,
    });

    return created;
  });

  return sale;
}

export async function getSaleById(id: string) {
  return prisma.sale.findFirst({
    where: { OR: [{ id }, { saleNumber: id }] },
    include: {
      customer: true,
      items: {
        include: {
          product: {
            select: {
              id: true,
              skuInternal: true,
              nameCommercial: true,
              locationBin: true,
              isActive: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Cancela una venta COMPLETED:
 *  - Cambia status a CANCELLED
 *  - Revierte el stock de cada ítem (RETURN movement)
 * Todo en una transacción atómica.
 */
export async function cancelSale(
  id: string,
  data: CancelSaleInput,
  userId: string,
) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!sale) throw new Error('Venta no encontrada.');
  if (sale.status !== SaleStatus.COMPLETED) {
    throw new Error(`No se puede cancelar una venta en estado "${sale.status}".`);
  }

  await prisma.$transaction(async (tx) => {
    // Revertir stock e inventario por cada ítem
    for (const item of sale.items) {
      const product = await (tx as PrismaTx).product.findUnique({
        where: { id: item.productId },
        select: { stockQuantity: true, costPriceAvg: true },
      });

      if (product) {
        await (tx as PrismaTx).product.update({
          where: { id: item.productId },
          data: { stockQuantity: product.stockQuantity + item.quantity },
        });

        await (tx as PrismaTx).inventoryMovement.create({
          data: {
            productId: item.productId,
            type: MovementType.RETURN,
            quantity: item.quantity,
            unitCostAtMoment: product.costPriceAvg,
            referenceDoc: sale.saleNumber,
            reason: `CANCEL-${sale.saleNumber}: ${data.reason}`,
            performedByUserId: userId,
          },
        });
      }
    }

    // Marcar la venta como cancelada
    await (tx as PrismaTx).sale.update({
      where: { id },
      data: { status: SaleStatus.CANCELLED, notes: `[CANCELADA] ${data.reason}` },
    });
  });

  logger.info('Sale cancelled', { saleId: id, saleNumber: sale.saleNumber, userId });

  return { saleNumber: sale.saleNumber, status: SaleStatus.CANCELLED };
}

export async function getSales(query: ListSalesQuery) {
  const {
    page,
    limit,
    startDate,
    endDate,
    customerId,
    status,
    paymentMethod,
    sortBy,
  } = query;

  const skip = (page - 1) * limit;
  const [sortField, sortDir] = sortBy.split(':') as [string, 'asc' | 'desc'];

  const where: Prisma.SaleWhereInput = {
    ...(customerId && { customerId }),
    ...(status && { status }),
    ...(paymentMethod && { paymentMethod }),
    ...((startDate ?? endDate) && {
      createdAt: {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate && { lte: new Date(endDate) }),
      },
    }),
  };

  const [sales, total] = await prisma.$transaction([
    prisma.sale.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortField]: sortDir },
      include: {
        customer: {
          select: { id: true, name: true, phone: true, identificationNumber: true },
        },
        items: { select: { id: true, productNameSnapshot: true, quantity: true, lineTotal: true } },
      },
    }),
    prisma.sale.count({ where }),
  ]);

  return {
    data: sales,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}
