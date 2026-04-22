import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import {
  createProductSchema,
  updateProductSchema,
  adjustStockSchema,
  getProductsQuerySchema,
} from '../utils/validators';
import * as productService from '../services/productService';
import { logAction } from '../services/auditService';
import { logger } from '../config/logger';

// ─── Respuestas estandarizadas ────────────────────────────────────────────────

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

const fail = (res: Response, error: string, status = 400, details?: unknown) =>
  res.status(status).json({ success: false, error, ...(details ? { details } : {}) });

// ─── Manejo centralizado de errores ─────────────────────────────────────────

function handleError(res: Response, err: unknown, context: string) {
  logger.error(`[ProductController] ${context}`, { err });

  if (err instanceof ZodError) {
    return fail(res, 'Datos de entrada inválidos', 422, err.flatten());
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const fields = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'campo';
      return fail(res, `Ya existe un registro con ese ${fields}`, 409);
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

// ─── Controladores ───────────────────────────────────────────────────────────

export async function createProduct(req: Request, res: Response) {
  try {
    const input = createProductSchema.parse(req.body);
    const userId = req.user?.id;
    const product = await productService.createProduct(input, userId);
    // AUDIT — registra quién creó el producto y con qué datos básicos
    void logAction(userId ?? null, 'CREATE_PRODUCT', 'Product', product.id, {
      name: product.nameCommercial,
      sku:  product.skuInternal,
      cost: product.costPriceAvg,
    }, req.ip);
    return ok(res, product, 201);
  } catch (err) {
    return handleError(res, err, 'createProduct');
  }
}

export async function getProducts(req: Request, res: Response) {
  try {
    const query = getProductsQuerySchema.parse(req.query);
    const result = await productService.getProducts(query);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'getProducts');
  }
}

export async function getProductById(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const product = await productService.getProductById(id);
    if (!product) return fail(res, 'Producto no encontrado', 404);
    return ok(res, product);
  } catch (err) {
    return handleError(res, err, 'getProductById');
  }
}

export async function updateProduct(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const input = updateProductSchema.parse(req.body);
    const userId = req.user?.id;
    const product = await productService.updateProduct(id, input, userId);
    // AUDIT — especialmente importante para rastrear cambios de precio
    void logAction(userId ?? null, 'UPDATE_PRODUCT', 'Product', id, {
      changes: input,
    }, req.ip);
    return ok(res, product);
  } catch (err) {
    return handleError(res, err, 'updateProduct');
  }
}

export async function deleteProduct(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const result = await productService.deleteProduct(id);
    return ok(res, {
      message: 'Producto desactivado correctamente',
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (err) {
    return handleError(res, err, 'deleteProduct');
  }
}

export async function adjustStock(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const input = adjustStockSchema.parse(req.body);
    const userId = req.user?.id;
    const result = await productService.adjustStock(id, input, userId);
    // AUDIT — ajustes manuales de stock son de alto riesgo (posible fraude)
    void logAction(userId ?? null, 'ADJUST_STOCK', 'Product', id, {
      type:     input.type,
      quantity: input.quantity,
      reason:   input.reason,
    }, req.ip);
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'adjustStock');
  }
}

export async function getLowStockProducts(_req: Request, res: Response) {
  try {
    const products = await productService.getLowStockProducts();
    return ok(res, products);
  } catch (err) {
    return handleError(res, err, 'getLowStockProducts');
  }
}

export async function getProductMovements(req: Request, res: Response) {
  try {
    const id = extractId(req.params['id']!);
    const limitRaw = req.query['limit'];
    const limitStr = typeof limitRaw === 'string' ? limitRaw : '50';
    const limit = Math.min(parseInt(limitStr), 200);
    const movements = await productService.getMovementsByProduct(id, limit);
    return ok(res, movements);
  } catch (err) {
    return handleError(res, err, 'getProductMovements');
  }
}
