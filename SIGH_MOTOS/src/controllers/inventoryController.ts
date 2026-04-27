import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import {
  createBrandSchema,
  updateBrandSchema,
  listBrandsQuerySchema,
  createCategorySchema,
  updateCategorySchema,
  listCategoriesQuerySchema,
  createProductSchema,
  updateProductSchema,
  patchStockSchema,
  getProductsQuerySchema,
} from '../utils/validators';
import * as inventoryService from '../services/inventoryService';
import { logAction } from '../services/auditService';
import { logger } from '../config/logger';

// ─── Helpers HTTP ─────────────────────────────────────────────────────────────

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

const fail = (res: Response, error: string, status = 400, details?: unknown) =>
  res.status(status).json({ success: false, error, ...(details ? { details } : {}) });

function handleError(res: Response, err: unknown, context: string) {
  logger.error(`[InventoryController] ${context}`, { err });

  if (err instanceof ZodError) {
    return fail(res, 'Datos de entrada inválidos', 422, err.flatten());
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      // Mensaje específico para conflictos de unicidad en inventario
      const fields = (err.meta?.target as string[] | undefined) ?? [];
      const isSkuOrBarcode =
        fields.some((f) => f === 'skuInternal' || f === 'barcodeExternal');
      return fail(
        res,
        isSkuOrBarcode
          ? 'El SKU o Código de Barras ya existe'
          : `Ya existe un registro con ese ${fields.join(', ')}`,
        409,
      );
    }
    if (err.code === 'P2025') {
      return fail(res, 'Registro no encontrado', 404);
    }
  }

  if (err instanceof Error) {
    return fail(res, err.message, 400);
  }

  return fail(res, 'Error interno del servidor', 500);
}

function extractId(param: string | string[]): string {
  return Array.isArray(param) ? param[0]! : param;
}

// ═══════════════════════════════════════════════════════════════════════════
// MARCAS (Brand)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/inventory/brands
 *
 * @request  { name: string, logoUrl?: string, isActive?: boolean }
 * @response { success: true, data: Brand }
 */
export async function createBrand(req: Request, res: Response) {
  try {
    const input = createBrandSchema.parse(req.body);
    const brand = await inventoryService.createBrand(input);
    void logAction(req.user?.id ?? null, 'CREATE_BRAND', 'Brand', brand.id, {
      name: brand.name,
    }, req.ip);
    return ok(res, brand, 201);
  } catch (err) {
    return handleError(res, err, 'createBrand');
  }
}

/**
 * GET /api/v1/inventory/brands
 *
 * @query  query?, isActive?, page?, limit?
 * @response { success: true, data: { data: Brand[], meta: PaginationMeta } }
 */
export async function getBrands(req: Request, res: Response) {
  try {
    const query = listBrandsQuerySchema.parse(req.query);
    const result = await inventoryService.getBrands(query);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'getBrands');
  }
}

/**
 * GET /api/v1/inventory/brands/:id
 *
 * @response { success: true, data: Brand & { _count: { products: number } } }
 */
export async function getBrandById(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const brand = await inventoryService.getBrandById(id);
    if (!brand) return fail(res, 'Marca no encontrada', 404);
    return ok(res, brand);
  } catch (err) {
    return handleError(res, err, 'getBrandById');
  }
}

/**
 * PUT /api/v1/inventory/brands/:id
 *
 * @request  Partial<CreateBrandInput>
 * @response { success: true, data: Brand }
 */
export async function updateBrand(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const input = updateBrandSchema.parse(req.body);
    const brand = await inventoryService.updateBrand(id, input);
    void logAction(req.user?.id ?? null, 'UPDATE_BRAND', 'Brand', id, { changes: input }, req.ip);
    return ok(res, brand);
  } catch (err) {
    return handleError(res, err, 'updateBrand');
  }
}

/**
 * DELETE /api/v1/inventory/brands/:id
 * Soft delete — sólo desactiva si no tiene productos activos.
 *
 * @response { success: true, data: { message: string } }
 */
export async function deleteBrand(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    await inventoryService.deleteBrand(id);
    void logAction(req.user?.id ?? null, 'DELETE_BRAND', 'Brand', id, {}, req.ip);
    return ok(res, { message: 'Marca desactivada correctamente' });
  } catch (err) {
    return handleError(res, err, 'deleteBrand');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORÍAS (Category)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/inventory/categories
 *
 * @request  { name, codePrefix, marginPercentage?, slug?, isActive? }
 * @response { success: true, data: Category }
 */
export async function createCategory(req: Request, res: Response) {
  try {
    const input = createCategorySchema.parse(req.body);
    const category = await inventoryService.createCategory(input);
    void logAction(req.user?.id ?? null, 'CREATE_CATEGORY', 'Category', category.id, {
      name: category.name,
      slug: category.slug,
    }, req.ip);
    return ok(res, category, 201);
  } catch (err) {
    return handleError(res, err, 'createCategory');
  }
}

/**
 * GET /api/v1/inventory/categories
 *
 * @query  query?, isActive?, page?, limit?
 * @response { success: true, data: { data: Category[], meta: PaginationMeta } }
 */
export async function getCategories(req: Request, res: Response) {
  try {
    const query = listCategoriesQuerySchema.parse(req.query);
    const result = await inventoryService.getCategories(query);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'getCategories');
  }
}

/**
 * GET /api/v1/inventory/categories/:id
 * Acepta ID o slug como parámetro.
 *
 * @response { success: true, data: Category & { _count: { products: number } } }
 */
export async function getCategoryById(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const category = await inventoryService.getCategoryById(id);
    if (!category) return fail(res, 'Categoría no encontrada', 404);
    return ok(res, category);
  } catch (err) {
    return handleError(res, err, 'getCategoryById');
  }
}

/**
 * PUT /api/v1/inventory/categories/:id
 *
 * @request  Partial<CreateCategoryInput>
 * @response { success: true, data: Category }
 */
export async function updateCategory(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const input = updateCategorySchema.parse(req.body);
    const category = await inventoryService.updateCategory(id, input);
    void logAction(req.user?.id ?? null, 'UPDATE_CATEGORY', 'Category', id, {
      changes: input,
    }, req.ip);
    return ok(res, category);
  } catch (err) {
    return handleError(res, err, 'updateCategory');
  }
}

/**
 * DELETE /api/v1/inventory/categories/:id
 * Soft delete — sólo desactiva si no tiene productos activos.
 *
 * @response { success: true, data: { message: string } }
 */
export async function deleteCategory(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    await inventoryService.deleteCategory(id);
    void logAction(req.user?.id ?? null, 'DELETE_CATEGORY', 'Category', id, {}, req.ip);
    return ok(res, { message: 'Categoría desactivada correctamente' });
  } catch (err) {
    return handleError(res, err, 'deleteCategory');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTOS (Product)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/inventory/products
 *
 * @request  {
 *   partNumberOEM, brandId, categoryId, nameCommercial,
 *   locationBin, costPriceAvg, stockQuantity?,
 *   skuInternal?, barcodeExternal?, descriptionTech?,
 *   compatibleModels?, salePriceBase?, taxRate?,
 *   minStockLevel?, maxStockLevel?, imageKey?
 * }
 * @response { success: true, data: Product & { brand, category } }
 */
export async function createProduct(req: Request, res: Response) {
  try {
    const input = createProductSchema.parse(req.body);
    const userId = req.user?.id;
    const product = await inventoryService.createProduct(input, userId);
    void logAction(userId ?? null, 'CREATE_PRODUCT', 'Product', product.id, {
      sku:  product.skuInternal,
      name: product.nameCommercial,
      cost: product.costPriceAvg,
    }, req.ip);
    return ok(res, product, 201);
  } catch (err) {
    return handleError(res, err, 'createProduct');
  }
}

/**
 * GET /api/v1/inventory/products
 *
 * @query  search?, brandId?, categoryId?, isActive?,
 *         sortBy? (ej: "nameCommercial:asc"), page?, limit?
 *
 * La búsqueda (`search`) cubre: nameCommercial, skuInternal, barcodeExternal,
 * partNumberOEM y compatibleModels (JSON array de modelos compatibles).
 * Los campos pesados (descriptionTech, compatibleModels) se omiten en la lista
 * para optimizar el tamaño de la respuesta; están disponibles en GET /:id.
 *
 * @response { success: true, data: { data: Product[], meta: PaginationMeta } }
 */
export async function getAllProducts(req: Request, res: Response) {
  try {
    const query = getProductsQuerySchema.parse(req.query);
    const result = await inventoryService.getAllProducts(query);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'getAllProducts');
  }
}

/**
 * GET /api/v1/inventory/products/low-stock
 * Retorna productos donde stockQuantity <= minStockLevel.
 *
 * @response { success: true, data: Array<{ id, skuInternal, nameCommercial, stockQuantity, minStockLevel, locationBin }> }
 */
export async function getLowStockProducts(_req: Request, res: Response) {
  try {
    const products = await inventoryService.getLowStockProducts();
    return ok(res, products);
  } catch (err) {
    return handleError(res, err, 'getLowStockProducts');
  }
}

/**
 * GET /api/v1/inventory/products/:id
 * Acepta ID, SKU interno o código de barras como parámetro.
 *
 * @response { success: true, data: Product & { brand, category, movements, salePriceWithTax, marginAmount, stockStatus } }
 */
export async function getProductById(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const product = await inventoryService.getProductById(id);
    if (!product) return fail(res, 'Producto no encontrado', 404);
    return ok(res, product);
  } catch (err) {
    return handleError(res, err, 'getProductById');
  }
}

/**
 * PUT /api/v1/inventory/products/:id
 * No permite cambiar skuInternal. El stock se gestiona vía adjust-stock.
 *
 * @request  Partial<CreateProductInput> (sin skuInternal)
 * @response { success: true, data: Product }
 */
export async function updateProduct(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const input = updateProductSchema.parse(req.body);
    const userId = req.user?.id;
    const product = await inventoryService.updateProduct(id, input, userId);
    void logAction(userId ?? null, 'UPDATE_PRODUCT', 'Product', id, {
      changes: input,
    }, req.ip);
    return ok(res, product);
  } catch (err) {
    return handleError(res, err, 'updateProduct');
  }
}

/**
 * DELETE /api/v1/inventory/products/:id
 * Soft delete — desactiva el producto (isActive = false).
 * Devuelve advertencia si aún tiene stock.
 *
 * @response { success: true, data: { message: string, warning?: string } }
 */
export async function deleteProduct(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const result = await inventoryService.deleteProduct(id);
    void logAction(req.user?.id ?? null, 'DELETE_PRODUCT', 'Product', id, {}, req.ip);
    return ok(res, {
      message: 'Producto desactivado correctamente',
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (err) {
    return handleError(res, err, 'deleteProduct');
  }
}

/**
 * PATCH /api/v1/inventory/products/:id/stock
 *
 * Ajuste rápido de inventario (conteo físico, corrección de error, merma).
 * El tipo de movimiento se infiere automáticamente del signo de `quantity`:
 *   - quantity > 0 → ADJUSTMENT_POS
 *   - quantity < 0 → ADJUSTMENT_NEG
 *
 * @request  {
 *   quantity: number  (no cero; negativo = salida/merma),
 *   reason: string    (mínimo 3 caracteres),
 *   referenceDoc?: string,
 *   unitCost?: number (solo para entradas — recalcula el Costo Promedio Ponderado)
 * }
 * @response { success: true, data: { movement, previousStock, newStock, costPriceAvg } }
 */
export async function adjustStock(req: Request, res: Response) {
  try {
    const id    = extractId(req.params['id']!);
    const input = patchStockSchema.parse(req.body);
    const userId = req.user?.id;
    const result = await inventoryService.adjustStock(id, input, userId);
    // Ajuste manual de stock: registro de auditoría de alta prioridad
    void logAction(userId ?? null, 'ADJUST_STOCK', 'Product', id, {
      quantity:      input.quantity,
      reason:        input.reason,
      unitCost:      input.unitCost,
      previousStock: result.previousStock,
      newStock:      result.newStock,
      costPriceAvg:  result.costPriceAvg,
    }, req.ip);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'adjustStock');
  }
}

/**
 * GET /api/v1/inventory/products/:id/movements
 *
 * @query  limit? (default: 50, max: 200)
 * @response { success: true, data: InventoryMovement[] }
 */
export async function getProductMovements(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const limitRaw = req.query['limit'];
    const limit = Math.min(parseInt(typeof limitRaw === 'string' ? limitRaw : '50', 10) || 50, 200);
    const movements = await inventoryService.getMovementsByProduct(id, limit);
    return ok(res, movements);
  } catch (err) {
    return handleError(res, err, 'getProductMovements');
  }
}
