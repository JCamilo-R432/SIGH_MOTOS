/**
 * purchaseService.ts — Módulo 4: Recepción Física de Mercancía (Entradas)
 *
 * Responsabilidades:
 *  - Registrar entradas de mercancía al almacén (sin órdenes de compra)
 *  - Actualizar stock y Costo Promedio Ponderado (WAC) de forma atómica
 *  - Crear productos "al vuelo" si no existen en el maestro
 *  - Generar números de documento ENT-{AÑO}-{NNNNN} consecutivos
 *  - Listar y consultar el historial de entradas
 *
 * NOTA: Las "entradas" no tienen un modelo propio en el esquema.
 * Se almacenan como grupos de InventoryMovement tipo ENTRY con el mismo
 * `referenceDoc` (ENT-2026-00001). Las consultas de historial usan
 * $queryRaw para calcular agregados (totalValue = SUM(qty * unitCostAtMoment)).
 *
 * Este módulo NO gestiona proveedores ni órdenes de compra.
 */

import { Prisma, MovementType } from '@prisma/client';
import { prisma }  from '../config/prisma';
import { logger }  from '../config/logger';
import { generateSKU } from '../utils/skuGenerator';
import type { RegisterEntryInput, ListEntriesQuery } from '../utils/validators';

// Re-export WAC util so consumers import from a single module
export { calculateWeightedAverageCost } from './inventoryService';
import { calculateWeightedAverageCost } from './inventoryService';

// ─── Tipos internos ───────────────────────────────────────────────────────────

/** Transaction client (sin métodos de control de conexión). */
type EntryTx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Campos mínimos del producto necesarios en la entrada. */
interface MinProduct {
  id:             string;
  nameCommercial: string;
  skuInternal:    string;
  costPriceAvg:   string | object;   // Prisma Decimal → string | Decimal
  stockQuantity:  number;
}

/** Ítem preprocesado: producto ya resuelto (id) o listo para crear. */
interface ResolvedItem {
  // Datos originales del ítem de entrada
  quantity:        number;
  unitCost:        number;
  notes:           string | undefined;
  nameCommercial:  string | undefined;
  brandId:         string | undefined;
  categoryId:      string | undefined;
  partNumberOEM:   string | undefined;
  barcodeExternal: string | undefined;
  skuInternal:     string | undefined;
  // Resultado de la resolución previa (fuera de TX)
  existingProductId: string | null;   // null → hay que crear el producto
  generatedSku:      string | null;   // SKU pre-generado para producto nuevo
}

// ─── Tipos de respuesta públicos ─────────────────────────────────────────────

export interface EntryResultItem {
  productId:     string;
  skuInternal:   string;
  nameCommercial: string;
  quantity:      number;
  unitCost:      number;
  previousCost:  number;
  newWac:        number;
  previousStock: number;
  newStock:      number;
  lineValue:     number;
  wasCreated:    boolean;
}

export interface EntryResult {
  entryNumber:    string;
  date:           string;           // ISO-8601
  itemsProcessed: number;
  totalValue:     number;
  notes:          string | null;
  items:          EntryResultItem[];
}

export interface EntryListRow {
  entryNumber:      string;
  date:             Date;
  itemCount:        number;
  totalQty:         number;
  totalValue:       number;
  performedByUserId: string | null;
}

export interface EntryDetail {
  entryNumber:      string;
  date:             Date;
  performedByUserId: string | null;
  itemCount:        number;
  totalQty:         number;
  totalValue:       number;
  items: Array<{
    movementId:   string;
    productId:    string;
    product:      {
      id:             string;
      nameCommercial: string;
      skuInternal:    string;
      barcodeExternal: string | null;
      costPriceAvg:   string | object;
      stockQuantity:  number;
    } | null;
    quantity:     number;
    unitCost:     number;
    lineValue:    number;
    reason:       string | null;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// NÚMERO DE ENTRADA ENT-{AÑO}-{NNNNN}
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera el siguiente número de entrada dentro de una transacción.
 * Funciona igual que _generateInvoiceNumber en posService:
 * busca el último referenceDoc que empiece con `ENT-{year}-` en ENTRY movements,
 * y retorna el siguiente con padding de 5 dígitos.
 *
 * DEBE ejecutarse dentro de un $transaction para garantizar unicidad.
 */
async function _generateEntryNumber(
  client: Pick<EntryTx, 'inventoryMovement'>,
): Promise<string> {
  const year   = new Date().getFullYear();
  const prefix = `ENT-${year}-`;

  const last = await client.inventoryMovement.findFirst({
    where: {
      referenceDoc: { startsWith: prefix },
      type: MovementType.ENTRY,
    },
    orderBy: { referenceDoc: 'desc' },
    select: { referenceDoc: true },
  });

  const lastSeq = last?.referenceDoc
    ? parseInt(last.referenceDoc.split('-').at(-1) ?? '0', 10) || 0
    : 0;

  return `${prefix}${String(lastSeq + 1).padStart(5, '0')}`;
}

/**
 * Genera el siguiente número de documento de entrada ENT-{AÑO}-{NNNNN}.
 * Usa el cliente principal — no garantiza unicidad bajo alta concurrencia.
 * Para uso en transacciones, usar `_generateEntryNumber(tx)` directamente.
 *
 * @example
 * await generateEntryNumber() // → "ENT-2026-00001"
 */
export async function generateEntryNumber(): Promise<string> {
  return _generateEntryNumber(prisma);
}

// ═══════════════════════════════════════════════════════════════════════════
// PRECIO DE VENTA BASE (helper privado, espejo de inventoryService)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula el precio de venta base usando margen sobre precio de venta.
 * salePriceBase = costPrice / (1 - margin%)
 */
function _calcSalePrice(marginPercentage: number, costPrice: number): number {
  const margin = marginPercentage / 100;
  if (margin >= 1) return parseFloat((costPrice * 2).toFixed(2));
  return parseFloat((costPrice / (1 - margin)).toFixed(2));
}

// ═══════════════════════════════════════════════════════════════════════════
// PRE-RESOLUCIÓN DE ÍTEMS (fuera de TX)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca el producto para cada ítem ANTES de abrir la transacción.
 * Si el producto no existe, pre-genera el SKU para el nuevo producto
 * (fuera de TX para usar la función generateSKU con reintentos).
 *
 * Si `productId` está definido y el producto no se encuentra → error inmediato.
 * Si `skuInternal` o `barcodeExternal` no se encuentran pero se proporcionan
 * campos de creación → el producto se creará dentro de la TX.
 *
 * @throws {Error} Si productId no corresponde a un producto existente.
 * @throws {Error} Si el producto no se puede identificar ni crear.
 */
async function _preResolveItems(
  items: RegisterEntryInput['items'],
): Promise<ResolvedItem[]> {
  return Promise.all(
    items.map(async (item) => {
      let existingProductId: string | null = null;

      if (item.productId) {
        const p = await prisma.product.findUnique({
          where:  { id: item.productId },
          select: { id: true },
        });
        if (!p) {
          throw new Error(`Producto con id "${item.productId}" no encontrado.`);
        }
        existingProductId = p.id;

      } else if (item.skuInternal) {
        const p = await prisma.product.findUnique({
          where:  { skuInternal: item.skuInternal },
          select: { id: true },
        });
        if (p) existingProductId = p.id;

      } else if (item.barcodeExternal) {
        const p = await prisma.product.findFirst({
          where:  { barcodeExternal: item.barcodeExternal },
          select: { id: true },
        });
        if (p) existingProductId = p.id;
      }

      // Producto no encontrado → validar que se puede crear
      let generatedSku: string | null = null;
      if (!existingProductId) {
        if (!item.nameCommercial || !item.brandId || !item.categoryId) {
          const usedIds = [item.productId, item.skuInternal, item.barcodeExternal]
            .filter(Boolean)
            .join(', ') || 'ninguno';
          throw new Error(
            `Producto no encontrado (identificadores: ${usedIds}). ` +
            `Para crear uno nuevo proporcionar nameCommercial, brandId y categoryId.`,
          );
        }

        // Pre-generar SKU para el nuevo producto (fuera de TX, con reintentos de colisión)
        if (!item.skuInternal) {
          generatedSku = await generateSKU(item.brandId, item.categoryId, prisma);
        }
      }

      return {
        quantity:        item.quantity,
        unitCost:        item.unitCost,
        notes:           item.notes,
        nameCommercial:  item.nameCommercial,
        brandId:         item.brandId,
        categoryId:      item.categoryId,
        partNumberOEM:   item.partNumberOEM,
        barcodeExternal: item.barcodeExternal,
        skuInternal:     item.skuInternal,
        existingProductId,
        generatedSku,
      };
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CREACIÓN DE PRODUCTO EN TRANSACCIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un producto nuevo dentro de una transacción activa.
 * No crea movimiento de inventario inicial (stockQuantity = 0):
 * el movimiento ENTRY se crea inmediatamente después por la entrada.
 *
 * @throws {Prisma.PrismaClientKnownRequestError} P2002 si el SKU ya existe.
 */
async function _createProductInTx(
  tx:   EntryTx,
  item: ResolvedItem,
): Promise<MinProduct> {
  const skuToUse = item.skuInternal ?? item.generatedSku!;

  // Leer margen de la categoría para calcular precio de venta
  const category = await tx.category.findUnique({
    where:  { id: item.categoryId! },
    select: { marginPercentage: true },
  });
  if (!category) {
    throw new Error(`Categoría con id "${item.categoryId}" no existe.`);
  }
  const margin       = Number(category.marginPercentage);
  const salePriceBase = _calcSalePrice(margin, item.unitCost);

  const product = await tx.product.create({
    data: {
      skuInternal:     skuToUse,
      barcodeExternal: item.barcodeExternal ?? null,
      partNumberOEM:   item.partNumberOEM ?? item.nameCommercial!,
      brandId:         item.brandId!,
      categoryId:      item.categoryId!,
      nameCommercial:  item.nameCommercial!,
      costPriceAvg:    item.unitCost.toFixed(4),
      salePriceBase:   salePriceBase.toFixed(2),
      taxRate:         '19',
      stockQuantity:   0,              // El ENTRY movement lo actualiza acto seguido
      minStockLevel:   5,
      locationBin:     'SIN-UBICACION',
      isActive:        true,
    },
    select: {
      id:             true,
      nameCommercial: true,
      skuInternal:    true,
      costPriceAvg:   true,
      stockQuantity:  true,
    },
  });

  logger.info('[purchaseService] New product created on-the-fly during entry', {
    productId:      product.id,
    skuInternal:    product.skuInternal,
    nameCommercial: product.nameCommercial,
  });

  return product;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSACCIÓN PRINCIPAL DE ENTRADA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registra una entrada de mercancía al almacén.
 *
 * Flujo completo:
 *  Fase 1 (fuera de TX):
 *    - Busca cada producto por productId / skuInternal / barcodeExternal.
 *    - Si no existe, pre-genera SKU para creación posterior.
 *    - Valida que ítems sin producto tengan los campos mínimos de creación.
 *
 *  Fase 2 ($transaction atómica):
 *    - Genera número ENT-{AÑO}-{NNNNN} dentro de la TX (unicidad garantizada).
 *    - Por cada ítem:
 *        a. Crea el producto si fue marcado para creación (stockQuantity = 0 inicial).
 *        b. Calcula el nuevo WAC:
 *           `NuevoCosto = ((StockActual × CostoActual) + (Cantidad × CostoUnitario))
 *                          / (StockActual + Cantidad)`
 *        c. Actualiza `stockQuantity` y `costPriceAvg` en Product.
 *        d. Crea InventoryMovement tipo ENTRY con referenceDoc = entryNumber.
 *
 * @param data   - Datos validados por registerEntrySchema.
 * @param userId - ID del usuario que realiza el registro.
 *
 * @throws {Error} Si un productId no existe.
 * @throws {Error} Si un producto no identificado no tiene campos de creación.
 * @throws {Prisma.PrismaClientKnownRequestError} P2002 si el SKU ya existe en BD.
 */
export async function processEntryTransaction(
  data:   RegisterEntryInput,
  userId: string,
): Promise<EntryResult> {
  logger.info('[purchaseService] Starting entry transaction', {
    userId,
    itemCount: data.items.length,
  });

  // ── Fase 1: Pre-resolución fuera de TX ────────────────────────────────────
  const resolved = await _preResolveItems(data.items);

  // ── Fase 2: Transacción atómica ───────────────────────────────────────────
  const result = await prisma.$transaction(async (rawTx) => {
    const tx = rawTx as unknown as EntryTx;

    // Número de entrada generado dentro de TX para unicidad bajo concurrencia
    const entryNumber = await _generateEntryNumber(tx);

    const items:      EntryResultItem[] = [];
    let totalValueCents = 0;

    for (const item of resolved) {
      // ── a. Encontrar o crear producto ──────────────────────────────────────
      let product: MinProduct;
      let wasCreated = false;

      if (item.existingProductId) {
        product = await tx.product.findUniqueOrThrow({
          where:  { id: item.existingProductId },
          select: {
            id:             true,
            nameCommercial: true,
            skuInternal:    true,
            costPriceAvg:   true,
            stockQuantity:  true,
          },
        });
      } else {
        product    = await _createProductInTx(tx, item);
        wasCreated = true;
      }

      // ── b. Calcular nuevo WAC ──────────────────────────────────────────────
      const prevStock = product.stockQuantity;
      const prevCost  = Number(product.costPriceAvg);
      const newWac    = calculateWeightedAverageCost(prevStock, prevCost, item.quantity, item.unitCost);
      const newStock  = prevStock + item.quantity;

      // ── c. Actualizar Product (stock + costPriceAvg) ───────────────────────
      await tx.product.update({
        where: { id: product.id },
        data:  {
          stockQuantity: newStock,
          costPriceAvg:  newWac.toFixed(4),
        },
      });

      // ── d. Crear movimiento ENTRY con trazabilidad completa ─────────────────
      await tx.inventoryMovement.create({
        data: {
          productId:         product.id,
          type:              MovementType.ENTRY,
          quantity:          item.quantity,
          unitCostAtMoment:  item.unitCost.toFixed(4),
          referenceDoc:      entryNumber,
          reason:            item.notes ?? `ENTRADA-${entryNumber}`,
          performedByUserId: userId,
        },
      });

      // Aritmética entera para evitar imprecisión de punto flotante
      const lineCents     = Math.round(item.quantity * item.unitCost * 100);
      totalValueCents    += lineCents;

      items.push({
        productId:      product.id,
        skuInternal:    product.skuInternal,
        nameCommercial: product.nameCommercial,
        quantity:       item.quantity,
        unitCost:       item.unitCost,
        previousCost:   prevCost,
        newWac,
        previousStock:  prevStock,
        newStock,
        lineValue:      Math.round(lineCents) / 100,
        wasCreated,
      });
    }

    const totalValue = Math.round(totalValueCents) / 100;

    logger.info('[purchaseService] Entry transaction completed', {
      entryNumber,
      userId,
      itemCount:   items.length,
      totalValue,
      newProducts: items.filter((i) => i.wasCreated).length,
    });

    return {
      entryNumber,
      date:           new Date().toISOString(),
      itemsProcessed: items.length,
      totalValue,
      notes:          data.notes ?? null,
      items,
    };
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSULTAS DE HISTORIAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lista el historial de entradas con paginación y filtros por fecha.
 *
 * Usa $queryRaw porque necesita agregados no disponibles en prisma.groupBy:
 *   totalValue = SUM(quantity × unitCostAtMoment)
 *
 * @query page, limit, startDate?, endDate?
 */
export async function getAllEntries(query: ListEntriesQuery): Promise<{
  data: EntryListRow[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}> {
  const { page, limit, startDate, endDate } = query;
  const skip  = (page - 1) * limit;

  // Usar rangos de fecha por defecto para evitar condiciones SQL opcionales
  const start = startDate ? new Date(startDate) : new Date('2000-01-01T00:00:00Z');
  const end   = endDate   ? new Date(endDate)   : new Date('2100-12-31T23:59:59Z');

  const [rows, countRows] = await prisma.$transaction([
    prisma.$queryRaw<EntryListRow[]>`
      SELECT
        im."referenceDoc"                                       AS "entryNumber",
        MIN(im."timestamp")                                     AS "date",
        COUNT(DISTINCT im."productId")::int                     AS "itemCount",
        SUM(im."quantity")::int                                 AS "totalQty",
        ROUND(SUM(im."quantity" * im."unitCostAtMoment"), 2)    AS "totalValue",
        MAX(im."performedByUserId")                             AS "performedByUserId"
      FROM inventory_movements im
      WHERE im."referenceDoc" LIKE ${'ENT-%'}
        AND im."type"::text = 'ENTRY'
        AND im."timestamp" >= ${start}
        AND im."timestamp" <= ${end}
      GROUP BY im."referenceDoc"
      ORDER BY MIN(im."timestamp") DESC
      LIMIT ${limit} OFFSET ${skip}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT im."referenceDoc") AS count
      FROM inventory_movements im
      WHERE im."referenceDoc" LIKE ${'ENT-%'}
        AND im."type"::text = 'ENTRY'
        AND im."timestamp" >= ${start}
        AND im."timestamp" <= ${end}
    `,
  ]);

  const total = Number(countRows[0]?.count ?? 0);

  return {
    data: rows.map((r) => ({
      entryNumber:       r.entryNumber,
      date:              r.date,
      itemCount:         Number(r.itemCount),
      totalQty:          Number(r.totalQty),
      totalValue:        Number(r.totalValue),
      performedByUserId: r.performedByUserId,
    })),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Obtiene los detalles completos de una entrada por su número de documento.
 *
 * @param entryNumber - Número de entrada (ENT-2026-00001).
 * @returns Detalle con lista de productos, costos y totales, o null si no existe.
 *
 * @example
 * GET /api/v1/purchases/entries/ENT-2026-00001
 */
export async function getEntryById(entryNumber: string): Promise<EntryDetail | null> {
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      referenceDoc: entryNumber,
      type:         MovementType.ENTRY,
    },
    include: {
      product: {
        select: {
          id:              true,
          nameCommercial:  true,
          skuInternal:     true,
          barcodeExternal: true,
          costPriceAvg:    true,
          stockQuantity:   true,
        },
      },
    },
    orderBy: { timestamp: 'asc' },
  });

  if (!movements.length) return null;

  const totalQty   = movements.reduce((s, m) => s + m.quantity, 0);
  const totalValue = Math.round(
    movements.reduce((s, m) => s + m.quantity * Number(m.unitCostAtMoment), 0) * 100,
  ) / 100;

  return {
    entryNumber,
    date:             movements[0]!.timestamp,
    performedByUserId: movements[0]!.performedByUserId,
    itemCount:        movements.length,
    totalQty,
    totalValue,
    items: movements.map((m) => ({
      movementId: m.id,
      productId:  m.productId,
      product:    m.product,
      quantity:   m.quantity,
      unitCost:   Number(m.unitCostAtMoment),
      lineValue:  Math.round(m.quantity * Number(m.unitCostAtMoment) * 100) / 100,
      reason:     m.reason ?? null,
    })),
  };
}
