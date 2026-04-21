import { PrismaClient } from '@prisma/client';

// Tipo que abarca tanto PrismaClient directo como un cliente de transacción
type SaleQueryClient = Pick<PrismaClient, 'sale'>;

/**
 * Genera el siguiente número de venta consecutivo para el año en curso.
 *
 * Formato: VTA-{AÑO}-{CONSECUTIVO_5_DIGITOS}
 * Ejemplo: VTA-2026-00042
 *
 * Corre siempre dentro de la misma transacción que crea la venta, por lo que
 * la lectura del último número y la escritura del nuevo son atómicas.
 */
export async function generateSaleNumber(client: SaleQueryClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `VTA-${year}-`;

  // Busca la última venta del año actual ordenando por saleNumber descendente
  const last = await client.sale.findFirst({
    where: { saleNumber: { startsWith: prefix } },
    orderBy: { saleNumber: 'desc' },
    select: { saleNumber: true },
  });

  let nextSeq = 1;

  if (last) {
    // Extrae el número consecutivo del sufijo: "VTA-2026-00042" → 42
    const parts = last.saleNumber.split('-');
    const lastSeq = parseInt(parts[parts.length - 1] ?? '0', 10);
    nextSeq = isNaN(lastSeq) ? 1 : lastSeq + 1;
  }

  // Rellena con ceros a la izquierda hasta 5 dígitos
  const padded = String(nextSeq).padStart(5, '0');
  return `${prefix}${padded}`;
}
