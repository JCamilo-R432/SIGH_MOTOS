import { MovementType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

interface CreateMovementInput {
  productId: string;
  type: MovementType;
  /** Siempre positivo. El tipo determina el efecto sobre el stock. */
  quantity: number;
  unitCost: number | string;
  referenceDoc?: string;
  reason?: string;
  userId?: string;
}

/**
 * Crea un registro en InventoryMovement.
 * No modifica el stock directamente — eso lo hace productService para
 * mantener la transacción atómica cuando sea necesario.
 */
export async function createMovement(data: CreateMovementInput) {
  const movement = await prisma.inventoryMovement.create({
    data: {
      productId: data.productId,
      type: data.type,
      quantity: Math.abs(data.quantity), // Siempre positivo
      unitCostAtMoment: String(data.unitCost),
      referenceDoc: data.referenceDoc,
      reason: data.reason,
      performedByUserId: data.userId,
    },
  });

  logger.info('InventoryMovement created', {
    movementId: movement.id,
    productId: data.productId,
    type: data.type,
    qty: data.quantity,
  });

  return movement;
}

/** Devuelve los últimos N movimientos de un producto, ordenados por fecha. */
export async function getMovementsByProduct(productId: string, limit = 50) {
  return prisma.inventoryMovement.findMany({
    where: { productId },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
}
