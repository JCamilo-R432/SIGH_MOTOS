import { Prisma, MovementType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { generateSKU } from '../utils/skuGenerator';
import { createMovement, getMovementsByProduct } from './inventoryMovementService';
import type {
  CreateProductInput,
  UpdateProductInput,
  AdjustStockInput,
  GetProductsQuery,
} from '../utils/validators';

// ─── Helpers internos ────────────────────────────────────────────────────────

/**
 * Calcula el precio de venta base usando el costo promedio y el margen
 * de la categoría.
 * salePriceBase = costPrice / (1 - margin%)
 * Esto garantiza que el margen sea sobre el precio de venta, no sobre el costo.
 */
async function calcSalePrice(categoryId: string, costPrice: number): Promise<number> {
  const category = await prisma.category.findUniqueOrThrow({
    where: { id: categoryId },
    select: { marginPercentage: true },
  });

  const margin = Number(category.marginPercentage) / 100;
  if (margin >= 1) return costPrice * 2; // Margen imposible, doble costo como fallback
  return parseFloat((costPrice / (1 - margin)).toFixed(2));
}

/** Determina el estado del stock para alertas de reposición. */
function resolveStockStatus(
  stock: number,
  min: number,
  max?: number | null,
): 'LOW' | 'OK' | 'OVERSTOCK' {
  if (stock <= min) return 'LOW';
  if (max && stock > max) return 'OVERSTOCK';
  return 'OK';
}

// ─── Servicio principal ──────────────────────────────────────────────────────

export async function createProduct(data: CreateProductInput, userId?: string) {
  // 1. Generar SKU automático si no se proporcionó
  const skuInternal =
    data.skuInternal ?? (await generateSKU(data.brandId, data.categoryId, prisma));

  // 2. Calcular precio de venta si no fue enviado
  const costPrice = parseFloat(String(data.costPriceAvg));
  const salePriceBase =
    data.salePriceBase !== undefined
      ? parseFloat(String(data.salePriceBase))
      : await calcSalePrice(data.categoryId, costPrice);

  const taxRate = data.taxRate !== undefined ? parseFloat(String(data.taxRate)) : 19;

  logger.info('Creating product', { sku: skuInternal, brandId: data.brandId });

  // 3. Crear producto y movimiento inicial en una transacción
  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        skuInternal,
        barcodeExternal: data.barcodeExternal,
        partNumberOEM: data.partNumberOEM,
        brandId: data.brandId,
        categoryId: data.categoryId,
        nameCommercial: data.nameCommercial,
        descriptionTech: data.descriptionTech,
        compatibleModels: data.compatibleModels as Prisma.InputJsonValue,
        locationBin: data.locationBin,
        imageKey: data.imageKey,
        costPriceAvg: String(costPrice),
        salePriceBase: String(salePriceBase),
        taxRate: String(taxRate),
        stockQuantity: data.stockQuantity,
        minStockLevel: data.minStockLevel,
        maxStockLevel: data.maxStockLevel,
        isActive: data.isActive,
      },
      include: { brand: true, category: true },
    });

    // 4. Si se ingresó stock inicial, registrar el movimiento de entrada
    if (data.stockQuantity > 0) {
      await tx.inventoryMovement.create({
        data: {
          productId: created.id,
          type: MovementType.ENTRY,
          quantity: data.stockQuantity,
          unitCostAtMoment: String(costPrice),
          reason: 'Stock Inicial',
          performedByUserId: userId,
        },
      });
    }

    return created;
  });

  return product;
}

export async function getProducts(query: GetProductsQuery) {
  const { page, limit, search, brandId, categoryId, minStock, isActive, sortBy } = query;
  const skip = (page - 1) * limit;

  // Parsear ordenamiento: "createdAt:desc" → { createdAt: 'desc' }
  const [sortField, sortDir] = sortBy.split(':') as [string, 'asc' | 'desc'];

  const where: Prisma.ProductWhereInput = {
    ...(isActive !== undefined && { isActive }),
    ...(brandId && { brandId }),
    ...(categoryId && { categoryId }),
    // Busca stock bajo: stockQuantity <= minStockLevel (usa columna dinámica)
    ...(minStock && {
      stockQuantity: { lte: prisma.product.fields.minStockLevel as any },
    }),
    ...(search && {
      OR: [
        { skuInternal: { contains: search, mode: 'insensitive' } },
        { barcodeExternal: { contains: search, mode: 'insensitive' } },
        { partNumberOEM: { contains: search, mode: 'insensitive' } },
        { nameCommercial: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  // Para el filtro minStock usamos una raw query alternativa
  const [products, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortField]: sortDir },
      include: { brand: true, category: true },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    data: products,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getProductById(identifier: string) {
  // Busca por ID, SKU interno o Barcode
  const product = await prisma.product.findFirst({
    where: {
      OR: [
        { id: identifier },
        { skuInternal: identifier },
        { barcodeExternal: identifier },
      ],
    },
    include: {
      brand: true,
      category: true,
      // Últimos 5 movimientos para vista rápida
      movements: {
        orderBy: { timestamp: 'desc' },
        take: 5,
      },
    },
  });

  if (!product) return null;

  const cost = Number(product.costPriceAvg);
  const saleBase = Number(product.salePriceBase);
  const tax = Number(product.taxRate);

  return {
    ...product,
    // Precio con impuesto incluido calculado al vuelo
    salePriceWithTax: parseFloat((saleBase * (1 + tax / 100)).toFixed(2)),
    marginAmount: parseFloat((saleBase - cost).toFixed(2)),
    stockStatus: resolveStockStatus(
      product.stockQuantity,
      product.minStockLevel,
      product.maxStockLevel,
    ),
  };
}

export async function updateProduct(
  id: string,
  data: UpdateProductInput,
  userId?: string,
) {
  const current = await prisma.product.findUniqueOrThrow({ where: { id } });

  const newCost =
    data.costPriceAvg !== undefined ? parseFloat(String(data.costPriceAvg)) : null;

  // Si cambia el costo y NO se envía nuevo precio, recalcular precio de venta
  let newSalePrice: number | undefined;
  if (newCost !== null && data.salePriceBase === undefined) {
    newSalePrice = await calcSalePrice(
      data.categoryId ?? current.categoryId,
      newCost,
    );
  } else if (data.salePriceBase !== undefined) {
    newSalePrice = parseFloat(String(data.salePriceBase));
  }

  const updatedProduct = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id },
      data: {
        ...(data.barcodeExternal !== undefined && { barcodeExternal: data.barcodeExternal }),
        ...(data.partNumberOEM !== undefined && { partNumberOEM: data.partNumberOEM }),
        ...(data.brandId !== undefined && { brandId: data.brandId }),
        ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
        ...(data.nameCommercial !== undefined && { nameCommercial: data.nameCommercial }),
        ...(data.descriptionTech !== undefined && { descriptionTech: data.descriptionTech }),
        ...(data.compatibleModels !== undefined && {
          compatibleModels: data.compatibleModels as Prisma.InputJsonValue,
        }),
        ...(data.locationBin !== undefined && { locationBin: data.locationBin }),
        ...(data.imageKey !== undefined && { imageKey: data.imageKey }),
        ...(newCost !== null && { costPriceAvg: String(newCost) }),
        ...(newSalePrice !== undefined && { salePriceBase: String(newSalePrice) }),
        ...(data.taxRate !== undefined && { taxRate: String(data.taxRate) }),
        ...(data.minStockLevel !== undefined && { minStockLevel: data.minStockLevel }),
        ...(data.maxStockLevel !== undefined && { maxStockLevel: data.maxStockLevel }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        // stockQuantity se gestiona solo por adjustStock para mantener trazabilidad
      },
    });

    // Si se envió stockQuantity diferente al actual, crear movimiento de ajuste
    if (
      data.stockQuantity !== undefined &&
      data.stockQuantity !== current.stockQuantity
    ) {
      const diff = data.stockQuantity - current.stockQuantity;
      const movType = diff > 0 ? MovementType.ADJUSTMENT_POS : MovementType.ADJUSTMENT_NEG;

      await tx.inventoryMovement.create({
        data: {
          productId: id,
          type: movType,
          quantity: Math.abs(diff),
          unitCostAtMoment: String(newCost ?? current.costPriceAvg),
          reason: 'Ajuste por actualización de producto',
          performedByUserId: userId,
        },
      });

      await tx.product.update({
        where: { id },
        data: { stockQuantity: data.stockQuantity },
      });
    }

    return updated;
  });

  return updatedProduct;
}

export async function deleteProduct(id: string) {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id },
    select: { stockQuantity: true, nameCommercial: true },
  });

  // Advertencia si aún tiene stock (soft-delete de todas formas)
  const warning =
    product.stockQuantity > 0
      ? `Producto desactivado con ${product.stockQuantity} unidades en stock. Revisa el inventario físico.`
      : null;

  await prisma.product.update({ where: { id }, data: { isActive: false } });

  return { warning };
}

export async function adjustStock(
  productId: string,
  data: AdjustStockInput,
  userId?: string,
) {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stockQuantity: true, costPriceAvg: true },
  });

  // Tipos que restan stock
  const subtractTypes: MovementType[] = [
    MovementType.EXIT,
    MovementType.ADJUSTMENT_NEG,
    MovementType.MERMA,
  ];

  const isSubtraction = subtractTypes.includes(data.type);
  const absQty = Math.abs(data.quantity);
  const stockDelta = isSubtraction ? -absQty : absQty;
  const newStock = product.stockQuantity + stockDelta;

  if (newStock < 0) {
    throw new Error(
      `Stock insuficiente. Stock actual: ${product.stockQuantity}, ajuste solicitado: -${absQty}`,
    );
  }

  const [movement] = await prisma.$transaction([
    prisma.inventoryMovement.create({
      data: {
        productId,
        type: data.type,
        quantity: absQty,
        unitCostAtMoment: product.costPriceAvg,
        referenceDoc: data.referenceDoc,
        reason: data.reason,
        performedByUserId: userId,
      },
    }),
    prisma.product.update({
      where: { id: productId },
      data: { stockQuantity: newStock },
    }),
  ]);

  logger.info('Stock adjusted', { productId, type: data.type, absQty, newStock });

  return {
    movement,
    previousStock: product.stockQuantity,
    newStock,
  };
}

export async function getLowStockProducts() {
  // Raw query para comparar dos columnas de la misma tabla
  return prisma.$queryRaw<
    Array<{ id: string; skuInternal: string; nameCommercial: string; stockQuantity: number; minStockLevel: number; locationBin: string }>
  >`
    SELECT id, "skuInternal", "nameCommercial", "stockQuantity", "minStockLevel", "locationBin"
    FROM products
    WHERE "stockQuantity" <= "minStockLevel"
      AND "isActive" = true
    ORDER BY ("minStockLevel" - "stockQuantity") DESC
  `;
}

export { getMovementsByProduct };
