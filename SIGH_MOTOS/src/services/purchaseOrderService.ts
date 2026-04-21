import { Prisma, MovementType, PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { generatePurchaseOrderNumber } from '../utils/purchaseOrderNumberGenerator';
import type {
  CreatePurchaseOrderInput,
  ReceivePurchaseOrderInput,
  ListPurchaseOrdersQuery,
  CancelPurchaseOrderInput,
} from '../utils/validators';

// ─── Tipo cliente de transacción ─────────────────────────────────────────────

type PrismaTx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ─── Error tipado para exceso de recepción ───────────────────────────────────

export class OverreceiptError extends Error {
  constructor(
    public readonly productName: string,
    public readonly pending: number,
    public readonly attempted: number,
  ) {
    super(
      `No se puede recibir ${attempted} unidades de "${productName}". ` +
      `Solo quedan ${pending} unidades pendientes de recepción.`,
    );
    this.name = 'OverreceiptError';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CREAR ORDEN DE COMPRA
// ═══════════════════════════════════════════════════════════════════════════

export async function createPurchaseOrder(
  data: CreatePurchaseOrderInput,
  userId: string,
) {
  logger.info('Creating purchase order', {
    supplierId: data.supplierId,
    itemCount: data.items.length,
  });

  return prisma.$transaction(async (tx) => {
    const orderNumber = await generatePurchaseOrderNumber(
      tx as unknown as Parameters<typeof generatePurchaseOrderNumber>[0],
    );

    // Obtener snapshots y calcular totales
    let subtotal = 0;
    const processedItems: {
      productId: string;
      productNameSnapshot: string;
      skuSnapshot: string;
      quantityOrdered: number;
      quantityReceived: number;
      unitCost: string;
      lineTotal: string;
    }[] = [];

    for (const item of data.items) {
      const product = await (tx as PrismaTx).product.findUniqueOrThrow({
        where: { id: item.productId },
        select: { nameCommercial: true, skuInternal: true, isActive: true },
      });

      if (!product.isActive) {
        throw new Error(`El producto "${product.nameCommercial}" está desactivado.`);
      }

      const lineTotal = parseFloat((item.unitCost * item.quantityOrdered).toFixed(2));
      subtotal += lineTotal;

      processedItems.push({
        productId: item.productId,
        productNameSnapshot: product.nameCommercial,
        skuSnapshot: product.skuInternal,
        quantityOrdered: item.quantityOrdered,
        quantityReceived: 0,
        unitCost: String(item.unitCost),
        lineTotal: String(lineTotal),
      });
    }

    const taxAmount = parseFloat((subtotal * 0.19).toFixed(2));
    const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));

    const po = await (tx as PrismaTx).purchaseOrder.create({
      data: {
        orderNumber,
        supplierId: data.supplierId,
        userId,
        status: PurchaseOrderStatus.PENDING,
        subtotal: String(parseFloat(subtotal.toFixed(2))),
        taxAmount: String(taxAmount),
        totalAmount: String(totalAmount),
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        notes: data.notes,
        items: { create: processedItems },
      },
      include: {
        items: true,
        supplier: { select: { id: true, name: true, nit: true, phone: true } },
      },
    });

    logger.info('Purchase order created', {
      orderId: po.id,
      orderNumber: po.orderNumber,
      total: totalAmount,
    });

    return po;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// RECEPCIÓN PARCIAL O TOTAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Recibe mercancía contra una OC existente.
 *
 * Por cada ítem recibido, de forma atómica:
 *   1. Valida que la cantidad no exceda lo pendiente
 *   2. Actualiza quantityReceived en PurchaseOrderItem
 *   3. Recalcula el costo promedio ponderado del producto
 *   4. Actualiza stockQuantity del producto
 *   5. Crea movimiento ENTRY en InventoryMovement
 *
 * Al final recalcula el estado de la OC (PARTIALLY_RECEIVED → RECEIVED).
 */
export async function receivePurchaseOrder(
  purchaseOrderId: string,
  receiveData: ReceivePurchaseOrderInput,
  userId: string,
) {
  logger.info('Starting purchase order reception', {
    purchaseOrderId,
    itemsToReceive: receiveData.items.length,
  });

  return prisma.$transaction(async (tx) => {
    // 1. Obtener OC con sus ítems actuales
    const po = await (tx as PrismaTx).purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { items: true },
    });

    if (!po) throw new Error('Orden de compra no encontrada.');
    if (po.status === PurchaseOrderStatus.CANCELLED) {
      throw new Error('No se puede recibir mercancía de una OC cancelada.');
    }
    if (po.status === PurchaseOrderStatus.RECEIVED) {
      throw new Error('Esta OC ya fue completamente recibida.');
    }

    // 2. Procesar cada ítem de la recepción
    for (const incoming of receiveData.items) {
      const poItem = po.items.find((i) => i.id === incoming.purchaseOrderItemId);

      if (!poItem) {
        throw new Error(
          `El ítem "${incoming.purchaseOrderItemId}" no pertenece a esta OC.`,
        );
      }

      const pendingQty = poItem.quantityOrdered - poItem.quantityReceived;

      if (incoming.quantityReceived > pendingQty) {
        throw new OverreceiptError(
          poItem.productNameSnapshot,
          pendingQty,
          incoming.quantityReceived,
        );
      }

      // 2a. Actualizar cantidad recibida acumulada en el ítem
      await (tx as PrismaTx).purchaseOrderItem.update({
        where: { id: incoming.purchaseOrderItemId },
        data: {
          quantityReceived: poItem.quantityReceived + incoming.quantityReceived,
        },
      });

      // 2b. Leer estado actual del producto para el cálculo de costo
      const product = await (tx as PrismaTx).product.findUniqueOrThrow({
        where: { id: poItem.productId },
        select: { stockQuantity: true, costPriceAvg: true },
      });

      const currentStock = product.stockQuantity;
      const currentCostAvg = Number(product.costPriceAvg);
      const purchaseUnitCost = Number(poItem.unitCost);
      const receivedQty = incoming.quantityReceived;

      /**
       * Fórmula de costo promedio ponderado (CPP):
       *   nuevoCPP = (stockActual × costoActual + cantidadRecibida × costoCompra)
       *              ────────────────────────────────────────────────────────────
       *                         (stockActual + cantidadRecibida)
       *
       * Cuando el stock es 0 (primer ingreso), el CPP es directamente el costo
       * de la compra para evitar división por cero.
       */
      const newCostAvg =
        currentStock + receivedQty === 0
          ? purchaseUnitCost
          : (currentStock * currentCostAvg + receivedQty * purchaseUnitCost) /
            (currentStock + receivedQty);

      // 2c. Actualizar stock y costo promedio del producto
      await (tx as PrismaTx).product.update({
        where: { id: poItem.productId },
        data: {
          stockQuantity: currentStock + receivedQty,
          // 4 decimales para preservar precisión en el promedio ponderado
          costPriceAvg: String(parseFloat(newCostAvg.toFixed(4))),
        },
      });

      // 2d. Crear movimiento ENTRY para trazabilidad completa
      await (tx as PrismaTx).inventoryMovement.create({
        data: {
          productId: poItem.productId,
          type: MovementType.ENTRY,
          quantity: receivedQty,
          unitCostAtMoment: String(purchaseUnitCost),
          referenceDoc: po.orderNumber,
          reason: `PURCHASE-OC-${po.orderNumber}`,
          performedByUserId: userId,
        },
      });

      logger.info('Item received', {
        orderNumber: po.orderNumber,
        productId: poItem.productId,
        receivedQty,
        newStock: currentStock + receivedQty,
        newCostAvg: parseFloat(newCostAvg.toFixed(4)),
      });
    }

    // 3. Leer los ítems con cantidades actualizadas para determinar nuevo estado
    const updatedItems = await (tx as PrismaTx).purchaseOrderItem.findMany({
      where: { purchaseOrderId },
    });

    const allReceived = updatedItems.every(
      (i) => i.quantityReceived >= i.quantityOrdered,
    );
    const anyReceived = updatedItems.some((i) => i.quantityReceived > 0);

    const newStatus: PurchaseOrderStatus = allReceived
      ? PurchaseOrderStatus.RECEIVED
      : anyReceived
        ? PurchaseOrderStatus.PARTIALLY_RECEIVED
        : PurchaseOrderStatus.PENDING;

    // 4. Actualizar estado de la OC (y fecha de recepción si es completa)
    const updatedPO = await (tx as PrismaTx).purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: {
        status: newStatus,
        ...(newStatus === PurchaseOrderStatus.RECEIVED && {
          receivedDate: new Date(),
        }),
      },
      include: {
        supplier: { select: { id: true, name: true, nit: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                nameCommercial: true,
                skuInternal: true,
                stockQuantity: true,
                costPriceAvg: true,
              },
            },
          },
        },
      },
    });

    logger.info('Purchase order reception complete', {
      orderNumber: po.orderNumber,
      newStatus,
    });

    return updatedPO;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CANCELAR ORDEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Solo se puede cancelar una OC en estado PENDING.
 * Si ya tiene recepciones (PARTIALLY_RECEIVED), hay que hacer ajustes
 * de inventario manuales — este endpoint no los revierte automáticamente.
 */
export async function cancelPurchaseOrder(
  id: string,
  data: CancelPurchaseOrderInput,
  userId: string,
) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { status: true, orderNumber: true },
  });

  if (!po) throw new Error('Orden de compra no encontrada.');

  if (po.status !== PurchaseOrderStatus.PENDING) {
    throw new Error(
      `Solo se pueden cancelar OCs en estado PENDING. Estado actual: ${po.status}.`,
    );
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: PurchaseOrderStatus.CANCELLED,
      ...(data.reason && { notes: `[CANCELADA por ${userId}] ${data.reason}` }),
    },
  });

  logger.info('Purchase order cancelled', {
    orderId: id,
    orderNumber: po.orderNumber,
    userId,
  });

  return updated;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSULTAS
// ═══════════════════════════════════════════════════════════════════════════

export async function getPurchaseOrderById(id: string) {
  return prisma.purchaseOrder.findFirst({
    where: { OR: [{ id }, { orderNumber: id }] },
    include: {
      supplier: true,
      items: {
        include: {
          product: {
            select: {
              id: true,
              skuInternal: true,
              nameCommercial: true,
              locationBin: true,
              stockQuantity: true,
              costPriceAvg: true,
              isActive: true,
            },
          },
        },
      },
    },
  });
}

export async function getPurchaseOrders(query: ListPurchaseOrdersQuery) {
  const { page, limit, supplierId, status, startDate, endDate, sortBy } = query;
  const skip = (page - 1) * limit;
  const [sortField, sortDir] = sortBy.split(':') as [string, 'asc' | 'desc'];

  const where: Prisma.PurchaseOrderWhereInput = {
    ...(supplierId && { supplierId }),
    ...(status && { status }),
    ...((startDate ?? endDate) && {
      createdAt: {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate && { lte: new Date(endDate) }),
      },
    }),
  };

  const [orders, total] = await prisma.$transaction([
    prisma.purchaseOrder.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortField]: sortDir },
      include: {
        supplier: { select: { id: true, name: true, nit: true } },
        items: {
          select: {
            id: true,
            productNameSnapshot: true,
            quantityOrdered: true,
            quantityReceived: true,
            unitCost: true,
            lineTotal: true,
          },
        },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return {
    data: orders,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}
