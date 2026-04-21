import { PrismaClient } from '@prisma/client';

/**
 * Genera un SKU único en formato: {CATEGORY_PREFIX}-{BRAND_ABBR}-{TIMESTAMP_MS}
 *
 * Ejemplo: FREN-BAJ-1713700000000
 *
 * El timestamp de 13 dígitos garantiza baja colisión. Si aun así colisiona
 * (race condition bajo alta carga), reintenta hasta MAX_RETRIES veces
 * añadiendo un sufijo aleatorio de 3 dígitos.
 */
export async function generateSKU(
  brandId: string,
  categoryId: string,
  prismaClient: PrismaClient,
): Promise<string> {
  const MAX_RETRIES = 5;

  const [brand, category] = await Promise.all([
    prismaClient.brand.findUniqueOrThrow({ where: { id: brandId }, select: { name: true } }),
    prismaClient.category.findUniqueOrThrow({ where: { id: categoryId }, select: { codePrefix: true } }),
  ]);

  // Toma las 3 primeras letras del nombre de la marca, en mayúsculas
  const brandAbbr = brand.name
    .replace(/[^a-zA-Z]/g, '')
    .substring(0, 3)
    .toUpperCase()
    .padEnd(3, 'X');

  const prefix = category.codePrefix.toUpperCase();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const timestamp = Date.now();
    const suffix = attempt > 0 ? `-${Math.floor(Math.random() * 900 + 100)}` : '';
    const sku = `${prefix}-${brandAbbr}-${timestamp}${suffix}`;

    const existing = await prismaClient.product.findUnique({
      where: { skuInternal: sku },
      select: { id: true },
    });

    if (!existing) return sku;
  }

  // Fallback con UUID parcial si todos los intentos colisionan
  const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase();
  return `${prefix}-${brandAbbr}-${uuid}`;
}
