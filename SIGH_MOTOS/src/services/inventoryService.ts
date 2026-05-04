import { Prisma, MovementType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { generateSKU } from '../utils/skuGenerator';
import type {
  CreateBrandInput,
  UpdateBrandInput,
  ListBrandsQuery,
  CreateCategoryInput,
  UpdateCategoryInput,
  ListCategoriesQuery,
  CreateProductInput,
  UpdateProductInput,
  PatchStockInput,
  GetProductsQuery,
} from '../utils/validators';

// ─── Helpers privados ─────────────────────────────────────────────────────────

/** "Frenos Traseros" → "frenos-traseros" */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Calcula el precio de venta base usando el costo promedio y el margen
 * de la categoría (margen sobre precio de venta, no sobre costo).
 * salePriceBase = costPrice / (1 - margin%)
 */
function calcSalePrice(marginPercentage: number, costPrice: number): number {
  const margin = marginPercentage / 100;
  if (margin >= 1) return parseFloat((costPrice * 2).toFixed(2));
  return parseFloat((costPrice / (1 - margin)).toFixed(2));
}

/** 'LOW' | 'OK' | 'OVERSTOCK' para el dashboard de stock. */
function resolveStockStatus(
  stock: number,
  min: number,
  max?: number | null,
): 'LOW' | 'OK' | 'OVERSTOCK' {
  if (stock <= min) return 'LOW';
  if (max != null && stock > max) return 'OVERSTOCK';
  return 'OK';
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES PÚBLICAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula el Costo Promedio Ponderado (WAC) al ingresar nuevas unidades.
 *
 * Fórmula:
 *   NuevoCosto = ((currentStock * currentCost) + (newQuantity * newCost))
 *                / (currentStock + newQuantity)
 *
 * @param currentStock   - Unidades existentes antes de la entrada
 * @param currentCost    - Costo promedio actual por unidad
 * @param newQuantity    - Cantidad de unidades que ingresan
 * @param newCost        - Costo unitario de las nuevas unidades
 * @returns Nuevo costo promedio ponderado (4 decimales de precisión)
 *
 * @example
 * // 10 unidades a $5.00 + 5 nuevas unidades a $8.00
 * calculateWeightedAverageCost(10, 5.00, 5, 8.00)
 * // → 6.0000
 *
 * @remarks
 * Esta función es reutilizada por el Módulo 3 (Compras) en la recepción
 * de órdenes de compra.
 */
export function calculateWeightedAverageCost(
  currentStock: number,
  currentCost: number,
  newQuantity: number,
  newCost: number,
): number {
  const totalStock = currentStock + newQuantity;
  if (totalStock <= 0) return parseFloat(currentCost.toFixed(4));
  const wac =
    (currentStock * currentCost + newQuantity * newCost) / totalStock;
  return parseFloat(wac.toFixed(4));
}

// ═══════════════════════════════════════════════════════════════════════════
// MARCAS (Brand)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea una nueva marca.
 *
 * @example
 * POST /api/v1/inventory/brands
 * { "name": "Bajaj", "logoUrl": "https://cdn.example.com/bajaj.png" }
 */
export async function createBrand(data: CreateBrandInput) {
  logger.info('[inventoryService] createBrand', { name: data.name });
  return prisma.brand.create({
    data: { name: data.name, logoUrl: data.logoUrl, isActive: data.isActive },
  });
}

/** Devuelve el ID de la marca "Genérico", creándola si no existe. */
export async function getOrCreateGenericBrand(): Promise<string> {
  const existing = await prisma.brand.findFirst({
    where: { name: 'Genérico' },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.brand.create({
    data: { name: 'Genérico', isActive: true },
  });
  return created.id;
}

/**
 * Lista marcas con paginación y búsqueda por nombre.
 *
 * @example
 * GET /api/v1/inventory/brands?query=baj&isActive=true&page=1&limit=20
 */
export async function getBrands(query: ListBrandsQuery) {
  const { query: search, isActive, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.BrandWhereInput = {
    ...(isActive !== undefined && { isActive }),
    ...(search && { name: { contains: search, mode: 'insensitive' } }),
  };

  const [brands, total] = await prisma.$transaction([
    prisma.brand.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        isActive: true,
        createdAt: true,
        _count: { select: { products: true } },
      },
    }),
    prisma.brand.count({ where }),
  ]);

  return {
    data: brands,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

/** Obtiene una marca por ID con conteo de productos activos. */
export async function getBrandById(id: string) {
  return prisma.brand.findUnique({
    where: { id },
    include: {
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });
}

/** Actualiza campos editables de una marca. */
export async function updateBrand(id: string, data: UpdateBrandInput) {
  return prisma.brand.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });
}

/**
 * Desactiva una marca (soft delete).
 * @throws Error si la marca tiene productos activos.
 */
export async function deleteBrand(id: string) {
  const brand = await prisma.brand.findUniqueOrThrow({
    where: { id },
    include: {
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });

  if (brand._count.products > 0) {
    throw new Error(
      `No se puede desactivar: la marca "${brand.name}" tiene ${brand._count.products} producto(s) activo(s).`,
    );
  }

  return prisma.brand.update({ where: { id }, data: { isActive: false } });
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORÍAS (Category)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea una nueva categoría.
 * Genera `slug` automáticamente desde el nombre si no se envía.
 *
 * @example
 * POST /api/v1/inventory/categories
 * { "name": "Frenos Traseros", "codePrefix": "FREN", "marginPercentage": 35 }
 */
export async function createCategory(data: CreateCategoryInput) {
  const slug = data.slug ?? slugify(data.name);

  // Validación case-insensitive: no permitir nombres duplicados entre categorías activas
  const nameConflict = await prisma.category.findFirst({
    where: { name: { equals: data.name, mode: 'insensitive' }, isActive: true },
    select: { id: true },
  });
  if (nameConflict) {
    throw new Error(`Ya existe una categoría activa con el nombre "${data.name}".`);
  }

  // Si el slug existe en una categoría inactiva, reactivarla en lugar de crear una nueva
  const inactiveMatch = await prisma.category.findFirst({
    where: { slug, isActive: false },
    select: { id: true },
  });
  if (inactiveMatch) {
    logger.info('[inventoryService] createCategory: reactivating inactive category', { name: data.name, slug });
    return prisma.category.update({
      where: { id: inactiveMatch.id },
      data: {
        name: data.name,
        codePrefix: data.codePrefix,
        marginPercentage: String(data.marginPercentage),
        isActive: true,
      },
    });
  }

  // Verificar conflicto de slug en categorías activas
  const slugConflict = await prisma.category.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (slugConflict) {
    throw new Error(`Ya existe una categoría con el slug "${slug}". Envía un slug personalizado.`);
  }

  logger.info('[inventoryService] createCategory', { name: data.name, slug });

  return prisma.category.create({
    data: {
      name: data.name,
      slug,
      codePrefix: data.codePrefix,
      marginPercentage: String(data.marginPercentage),
      isActive: data.isActive,
    },
  });
}

/**
 * Lista categorías con paginación y búsqueda por nombre, slug o prefijo.
 *
 * @example
 * GET /api/v1/inventory/categories?query=frenos&isActive=true
 */
export async function getCategories(query: ListCategoriesQuery) {
  const { query: search, isActive, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.CategoryWhereInput = {
    isActive: isActive !== undefined ? isActive : true, // por defecto solo activas
    ...(search && {
      OR: [
        { name:        { contains: search, mode: 'insensitive' } },
        { slug:        { contains: search, mode: 'insensitive' } },
        { codePrefix:  { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [categories, total] = await prisma.$transaction([
    prisma.category.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        codePrefix: true,
        marginPercentage: true,
        isActive: true,
        createdAt: true,
        _count: { select: { products: true } },
      },
    }),
    prisma.category.count({ where }),
  ]);

  return {
    data: categories,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Obtiene una categoría por ID o slug con conteo de productos activos.
 *
 * @example
 * GET /api/v1/inventory/categories/frenos-traseros
 * GET /api/v1/inventory/categories/clxyz456
 */
export async function getCategoryById(idOrSlug: string) {
  return prisma.category.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: {
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });
}

/** Actualiza campos editables de una categoría. */
export async function updateCategory(id: string, data: UpdateCategoryInput) {
  // Validación case-insensitive: no permitir nombre duplicado en otra categoría activa
  if (data.name !== undefined) {
    const conflict = await prisma.category.findFirst({
      where: {
        name: { equals: data.name, mode: 'insensitive' },
        isActive: true,
        id: { not: id },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new Error(`Ya existe una categoría activa con el nombre "${data.name}".`);
    }
  }

  return prisma.category.update({
    where: { id },
    data: {
      ...(data.name             !== undefined && { name: data.name }),
      ...(data.slug             !== undefined && { slug: data.slug }),
      ...(data.codePrefix       !== undefined && { codePrefix: data.codePrefix }),
      ...(data.marginPercentage !== undefined && {
        marginPercentage: String(data.marginPercentage),
      }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });
}

/**
 * Desactiva una categoría (soft delete).
 * @throws Error si la categoría tiene productos activos.
 */
export async function deleteCategory(id: string) {
  const category = await prisma.category.findUniqueOrThrow({
    where: { id },
    include: {
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });

  if (category._count.products > 0) {
    throw new Error(
      `No se puede desactivar: la categoría "${category.name}" tiene ${category._count.products} producto(s) activo(s).`,
    );
  }

  return prisma.category.update({ where: { id }, data: { isActive: false } });
}

/**
 * Desactiva (soft delete) todas las categorías activas que no tengan productos activos.
 * Se llama automáticamente al eliminar un producto.
 * @returns Número de categorías desactivadas.
 */
export async function cleanupOrphanCategories(): Promise<number> {
  const result = await prisma.category.updateMany({
    where: {
      isActive: true,
      products: { none: { isActive: true } },
    },
    data: { isActive: false },
  });
  if (result.count > 0) {
    logger.info('[inventoryService] cleanupOrphanCategories', { deactivated: result.count });
  }
  return result.count;
}

/**
 * Estadísticas de categorías activas con conteo de productos activos por categoría.
 * Útil para el dashboard de inventario.
 */
export async function getCategoriesStats() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: { products: { where: { isActive: true } } },
      },
    },
  });

  return categories.map((c) => ({
    id:               c.id,
    name:             c.name,
    slug:             c.slug,
    codePrefix:       c.codePrefix,
    marginPercentage: Number(c.marginPercentage),
    activeProducts:   c._count.products,
  }));
}

/**
 * Resumen global del inventario: totales, valor, stock bajo y sin stock.
 * Usa raw SQL para la comparación columna-a-columna (stockQuantity <= minStockLevel).
 */
export async function getInventoryStats() {
  const [
    totalProducts,
    totalCategories,
    outOfStockCount,
    lowStockResult,
    valueResult,
  ] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    prisma.category.count({ where: { isActive: true } }),
    prisma.product.count({ where: { isActive: true, stockQuantity: 0 } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM products
      WHERE "isActive" = true AND "stockQuantity" <= "minStockLevel"
    `,
    prisma.$queryRaw<Array<{ total_value: string; total_stock: bigint }>>`
      SELECT
        COALESCE(SUM("costPriceAvg"::numeric * "stockQuantity"), 0)::text AS total_value,
        COALESCE(SUM("stockQuantity"), 0)::bigint                          AS total_stock
      FROM products
      WHERE "isActive" = true
    `,
  ]);

  return {
    totalProducts,
    totalCategories,
    totalValue:      Number(valueResult[0]?.total_value  ?? 0),
    totalStock:      Number(valueResult[0]?.total_stock  ?? 0),
    lowStockCount:   Number(lowStockResult[0]?.count     ?? 0),
    outOfStockCount,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTOS (Product)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un nuevo producto con validaciones completas.
 *
 * Flujo:
 * 1. Verifica existencia de Brand y Category.
 * 2. Genera SKU automático si no se envía.
 * 3. Calcula precio de venta con margen de categoría (si no se envía).
 * 4. En $transaction: crea el producto + registra movimiento ENTRY (si stockQuantity > 0).
 *
 * @example
 * POST /api/v1/inventory/products
 * {
 *   "nameCommercial": "Pastilla de Freno GN 125",
 *   "brandId": "clx...",
 *   "categoryId": "clx...",
 *   "partNumberOEM": "BRK-GN125-R",
 *   "costPriceAvg": 8500,
 *   "stockQuantity": 20,
 *   "compatibleModels": ["GN 125", "Boxer CT"],
 *   "locationBin": "Estante A-04"
 * }
 */
export async function createProduct(data: CreateProductInput, userId?: string) {
  // 1. Verificar existencia de Marca y Categoría
  const [brand, category] = await Promise.all([
    prisma.brand.findUnique({
      where: { id: data.brandId },
      select: { id: true, name: true },
    }),
    prisma.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true, codePrefix: true, marginPercentage: true },
    }),
  ]);

  if (!brand)    throw new Error(`La marca con ID "${data.brandId}" no existe.`);
  if (!category) throw new Error(`La categoría con ID "${data.categoryId}" no existe.`);

  // 2. Generar SKU si no se proporcionó
  const skuInternal =
    data.skuInternal ?? (await generateSKU(data.brandId, data.categoryId, prisma));

  // 3. Calcular precio de venta con el margen de la categoría
  const costPrice = data.costPriceAvg;
  const salePriceBase =
    data.salePriceBase ??
    calcSalePrice(Number(category.marginPercentage), costPrice);
  const taxRate = data.taxRate;

  logger.info('[inventoryService] createProduct', {
    sku: skuInternal,
    name: data.nameCommercial,
    cost: costPrice,
    stock: data.stockQuantity,
  });

  // 4. Transacción: producto + movimiento inicial
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        skuInternal,
        barcodeExternal:  data.barcodeExternal,
        partNumberOEM:    data.partNumberOEM,
        brandId:          data.brandId,
        categoryId:       data.categoryId,
        nameCommercial:   data.nameCommercial,
        descriptionTech:  data.descriptionTech,
        compatibleModels: data.compatibleModels as Prisma.InputJsonValue,
        locationBin:      data.locationBin,
        imageKey:         data.imageKey,
        costPriceAvg:     String(costPrice),
        salePriceBase:    String(salePriceBase),
        taxRate:          String(taxRate),
        stockQuantity:    data.stockQuantity,
        minStockLevel:    data.minStockLevel,
        maxStockLevel:    data.maxStockLevel,
        isActive:         data.isActive,
      },
      include: { brand: true, category: true },
    });

    if (data.stockQuantity > 0) {
      await tx.inventoryMovement.create({
        data: {
          productId:        product.id,
          type:             MovementType.ENTRY,
          quantity:         data.stockQuantity,
          unitCostAtMoment: String(costPrice),
          reason:           'Stock inicial',
          performedByUserId: userId,
        },
      });
    }

    return product;
  });
}

/**
 * Lista productos con paginación, filtros y búsqueda textual.
 *
 * La búsqueda (`search`) actúa sobre:
 *   - nameCommercial, skuInternal, barcodeExternal, partNumberOEM (texto)
 *   - compatibleModels (JSON array — búsqueda de subcadena en representación textual)
 *
 * Usa `.select()` para no traer `descriptionTech` ni `compatibleModels` en la lista
 * (campos pesados disponibles en `getProductById`).
 *
 * @example
 * GET /api/v1/inventory/products?search=GN+125&brandId=clx...&isActive=true&page=1&limit=20&sortBy=nameCommercial:asc
 */
export async function getAllProducts(query: GetProductsQuery) {
  const { page, limit, search, brandId, categoryId, isActive, sortBy } = query;
  const skip = (page - 1) * limit;
  const [sortField, sortDir] = sortBy.split(':') as [string, 'asc' | 'desc'];

  const where: Prisma.ProductWhereInput = {
    ...(isActive  !== undefined && { isActive }),
    ...(brandId    && { brandId }),
    ...(categoryId && { categoryId }),
    ...(search && {
      OR: [
        { nameCommercial:   { contains: search, mode: 'insensitive' } },
        { skuInternal:      { contains: search, mode: 'insensitive' } },
        { barcodeExternal:  { contains: search, mode: 'insensitive' } },
        { partNumberOEM:    { contains: search, mode: 'insensitive' } },
        // Búsqueda en JSON: string_contains busca la subcadena en la representación
        // textual del array. Ej: ["GN 125", "Boxer CT"] contiene "GN 125".
        { compatibleModels: { string_contains: search } },
      ],
    }),
  };

  const [products, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortField]: sortDir },
      // Omite descriptionTech y compatibleModels para respuestas de lista más ligeras
      select: {
        id:              true,
        skuInternal:     true,
        barcodeExternal: true,
        partNumberOEM:   true,
        nameCommercial:  true,
        locationBin:     true,
        costPriceAvg:    true,
        salePriceBase:   true,
        taxRate:         true,
        stockQuantity:   true,
        minStockLevel:   true,
        maxStockLevel:   true,
        isActive:        true,
        createdAt:       true,
        updatedAt:       true,
        brand:    { select: { id: true, name: true, logoUrl: true } },
        category: { select: { id: true, name: true, marginPercentage: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    data: products,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Obtiene un producto por ID, SKU interno o código de barras.
 * Incluye marca, categoría, últimos 10 movimientos y métricas calculadas.
 *
 * @example
 * GET /api/v1/inventory/products/clxyz789
 * GET /api/v1/inventory/products/FREN-BAJ-1713700000000
 */
export async function getProductById(identifier: string) {
  const product = await prisma.product.findFirst({
    where: {
      OR: [
        { id:               identifier },
        { skuInternal:      identifier },
        { barcodeExternal:  identifier },
      ],
    },
    include: {
      brand:    true,
      category: true,
      movements: {
        orderBy: { timestamp: 'desc' },
        take: 10,
      },
    },
  });

  if (!product) return null;

  const cost     = Number(product.costPriceAvg);
  const saleBase = Number(product.salePriceBase);
  const tax      = Number(product.taxRate);

  return {
    ...product,
    salePriceWithTax: parseFloat((saleBase * (1 + tax / 100)).toFixed(2)),
    marginAmount:     parseFloat((saleBase - cost).toFixed(2)),
    marginPercent:
      saleBase > 0
        ? parseFloat((((saleBase - cost) / saleBase) * 100).toFixed(2))
        : 0,
    stockStatus: resolveStockStatus(
      product.stockQuantity,
      product.minStockLevel,
      product.maxStockLevel,
    ),
  };
}

/**
 * Actualiza los campos editables de un producto.
 *
 * - No permite cambiar `skuInternal` ni `id`.
 * - Si se envía `stockQuantity` diferente al actual, genera un movimiento
 *   ADJUSTMENT_POS o ADJUSTMENT_NEG en la misma transacción.
 * - Si cambia `costPriceAvg` sin enviar `salePriceBase`, recalcula el precio
 *   de venta con el margen de la categoría.
 *
 * @example
 * PUT /api/v1/inventory/products/clxyz789
 * { "salePriceBase": 25000, "locationBin": "Estante B-02" }
 */
export async function updateProduct(
  id: string,
  data: UpdateProductInput,
  userId?: string,
) {
  const current = await prisma.product.findUniqueOrThrow({
    where: { id },
    select: {
      stockQuantity: true,
      costPriceAvg:  true,
      categoryId:    true,
    },
  });

  const newCost =
    data.costPriceAvg !== undefined ? data.costPriceAvg : null;

  // Recalcular precio de venta si cambia el costo y no se envía nuevo precio
  let newSalePrice: number | undefined;
  if (newCost !== null && data.salePriceBase === undefined) {
    const catId = data.categoryId ?? current.categoryId;
    const cat   = await prisma.category.findUnique({
      where:  { id: catId },
      select: { marginPercentage: true },
    });
    if (cat) {
      newSalePrice = calcSalePrice(Number(cat.marginPercentage), newCost);
    }
  } else if (data.salePriceBase !== undefined) {
    newSalePrice = data.salePriceBase;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id },
      data: {
        ...(data.barcodeExternal  !== undefined && { barcodeExternal: data.barcodeExternal }),
        ...(data.partNumberOEM    !== undefined && { partNumberOEM:   data.partNumberOEM }),
        ...(data.brandId          !== undefined && { brandId:         data.brandId }),
        ...(data.categoryId       !== undefined && { categoryId:      data.categoryId }),
        ...(data.nameCommercial   !== undefined && { nameCommercial:  data.nameCommercial }),
        ...(data.descriptionTech  !== undefined && { descriptionTech: data.descriptionTech }),
        ...(data.compatibleModels !== undefined && {
          compatibleModels: data.compatibleModels as Prisma.InputJsonValue,
        }),
        ...(data.locationBin !== undefined && { locationBin: data.locationBin }),
        ...(data.imageKey    !== undefined && { imageKey:    data.imageKey }),
        ...(newCost !== null              && { costPriceAvg:  String(newCost) }),
        ...(newSalePrice !== undefined    && { salePriceBase: String(newSalePrice) }),
        ...(data.taxRate     !== undefined && { taxRate:       String(data.taxRate) }),
        ...(data.minStockLevel !== undefined && { minStockLevel: data.minStockLevel }),
        ...(data.maxStockLevel !== undefined && { maxStockLevel: data.maxStockLevel }),
        ...(data.isActive    !== undefined && { isActive:    data.isActive }),
        // stockQuantity se gestiona por separado para garantizar trazabilidad
      },
    });

    // Movimiento de ajuste si stockQuantity cambió manualmente
    if (
      data.stockQuantity !== undefined &&
      data.stockQuantity !== current.stockQuantity
    ) {
      const diff    = data.stockQuantity - current.stockQuantity;
      const movType = diff > 0 ? MovementType.ADJUSTMENT_POS : MovementType.ADJUSTMENT_NEG;

      await tx.inventoryMovement.create({
        data: {
          productId:         id,
          type:              movType,
          quantity:          Math.abs(diff),
          unitCostAtMoment:  String(newCost ?? current.costPriceAvg),
          reason:            'Ajuste por actualización de producto',
          performedByUserId: userId,
        },
      });

      await tx.product.update({
        where: { id },
        data:  { stockQuantity: data.stockQuantity },
      });
    }

    return updated;
  });
}

/**
 * Desactiva un producto (soft delete — isActive = false).
 * Preserva histórico de movimientos para trazabilidad contable.
 * Devuelve advertencia si el producto aún tiene stock.
 *
 * @example
 * DELETE /api/v1/inventory/products/clxyz789
 */
export async function deleteProduct(id: string) {
  const product = await prisma.product.findUniqueOrThrow({
    where:  { id },
    select: { stockQuantity: true, nameCommercial: true },
  });

  const warning =
    product.stockQuantity > 0
      ? `Producto desactivado con ${product.stockQuantity} unidades en stock. Revisa el inventario físico.`
      : null;

  await prisma.product.update({ where: { id }, data: { isActive: false } });

  // Limpieza automática: desactivar categorías que quedaron sin productos activos
  await cleanupOrphanCategories();

  return { warning };
}

/**
 * Ajuste rápido de stock (conteo físico, corrección de error, merma).
 *
 * El tipo de movimiento se infiere del signo de `quantity`:
 *   - quantity > 0 → ADJUSTMENT_POS (entrada / corrección positiva)
 *   - quantity < 0 → ADJUSTMENT_NEG (salida / merma / corrección negativa)
 *
 * Si se envía `unitCost` en un ajuste positivo, recalcula el Costo Promedio
 * Ponderado (WAC) usando `calculateWeightedAverageCost`.
 *
 * @throws Error si el resultado sería stock negativo.
 *
 * @example
 * PATCH /api/v1/inventory/products/clxyz789/stock
 * { "quantity": -3, "reason": "Unidades dañadas en bodega" }
 *
 * @example Con recálculo de WAC:
 * PATCH /api/v1/inventory/products/clxyz789/stock
 * { "quantity": 10, "reason": "Conteo físico", "unitCost": 9200 }
 */
export async function adjustStock(
  productId: string,
  data: PatchStockInput,
  userId?: string,
) {
  const product = await prisma.product.findUniqueOrThrow({
    where:  { id: productId },
    select: { stockQuantity: true, costPriceAvg: true, nameCommercial: true },
  });

  const isPositive = data.quantity > 0;
  const absQty     = Math.abs(data.quantity);
  const movType    = isPositive ? MovementType.ADJUSTMENT_POS : MovementType.ADJUSTMENT_NEG;
  const newStock   = product.stockQuantity + data.quantity;

  if (newStock < 0) {
    throw new Error(
      `Stock insuficiente. Stock actual: ${product.stockQuantity}, ajuste solicitado: ${data.quantity}.`,
    );
  }

  // Recalcular WAC si es entrada con costo unitario especificado
  const currentCost = Number(product.costPriceAvg);
  let   newCostAvg  = currentCost;

  if (isPositive && data.unitCost !== undefined) {
    newCostAvg = calculateWeightedAverageCost(
      product.stockQuantity,
      currentCost,
      absQty,
      data.unitCost,
    );
  }

  // Transacción atómica: movimiento + actualización de stock (y costo si aplica)
  const [movement] = await prisma.$transaction([
    prisma.inventoryMovement.create({
      data: {
        productId,
        type:             movType,
        quantity:         absQty,
        unitCostAtMoment: String(data.unitCost ?? currentCost),
        referenceDoc:     data.referenceDoc,
        reason:           data.reason,
        performedByUserId: userId,
      },
    }),
    prisma.product.update({
      where: { id: productId },
      data: {
        stockQuantity: newStock,
        ...(isPositive && newCostAvg !== currentCost && {
          costPriceAvg: String(newCostAvg),
        }),
      },
    }),
  ]);

  logger.info('[inventoryService] adjustStock', {
    productId,
    movType,
    quantity: data.quantity,
    previousStock: product.stockQuantity,
    newStock,
    newCostAvg,
  });

  return {
    movement,
    previousStock: product.stockQuantity,
    newStock,
    costPriceAvg: newCostAvg,
  };
}

/**
 * Lista productos donde `stockQuantity <= minStockLevel` y `isActive = true`.
 * Ordenados por urgencia descendente (mayor déficit primero).
 * Ideal para dashboard de reabastecimiento.
 *
 * @example
 * GET /api/v1/inventory/alerts/low-stock
 * → [{ id, skuInternal, nameCommercial, stockQuantity, minStockLevel, locationBin, deficit }]
 */
export async function getLowStockProducts() {
  return prisma.$queryRaw<
    Array<{
      id:              string;
      skuInternal:     string;
      nameCommercial:  string;
      stockQuantity:   number;
      minStockLevel:   number;
      locationBin:     string;
      deficit:         number;
    }>
  >`
    SELECT
      id,
      "skuInternal",
      "nameCommercial",
      "stockQuantity",
      "minStockLevel",
      "locationBin",
      ("minStockLevel" - "stockQuantity") AS deficit
    FROM products
    WHERE "stockQuantity" <= "minStockLevel"
      AND "isActive" = true
    ORDER BY ("minStockLevel" - "stockQuantity") DESC,
             "nameCommercial" ASC
  `;
}

/**
 * Devuelve el historial de movimientos de un producto ordenado por fecha.
 *
 * @param limit - Máximo de registros a devolver (default: 50, max recomendado: 200)
 */
export async function getMovementsByProduct(productId: string, limit = 50) {
  return prisma.inventoryMovement.findMany({
    where:   { productId },
    orderBy: { timestamp: 'desc' },
    take:    limit,
  });
}
