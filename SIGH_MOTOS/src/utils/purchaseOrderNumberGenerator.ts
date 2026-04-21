import { PrismaClient } from '@prisma/client';

type PurchaseOrderQueryClient = Pick<PrismaClient, 'purchaseOrder'>;

/**
 * Genera el siguiente número de OC consecutivo para el año en curso.
 *
 * Formato: OC-{AÑO}-{CONSECUTIVO_5_DIGITOS}
 * Ejemplo: OC-2026-00042
 *
 * Debe ejecutarse dentro de la misma transacción que crea la OC para
 * garantizar atomicidad y evitar números duplicados bajo carga concurrente.
 */
export async function generatePurchaseOrderNumber(
  client: PurchaseOrderQueryClient,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `OC-${year}-`;

  const last = await client.purchaseOrder.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });

  let nextSeq = 1;

  if (last) {
    const parts = last.orderNumber.split('-');
    const lastSeq = parseInt(parts[parts.length - 1] ?? '0', 10);
    nextSeq = isNaN(lastSeq) ? 1 : lastSeq + 1;
  }

  return `${prefix}${String(nextSeq).padStart(5, '0')}`;
}
