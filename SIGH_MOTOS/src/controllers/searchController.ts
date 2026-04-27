/**
 * searchController.ts
 * Búsqueda tolerante de productos para el POS.
 * GET /api/v1/pos/products/search?query=...&limit=10
 */
import type { Request, Response } from 'express'
import { prisma } from '../config/prisma'
import { logger } from '../config/logger'

const ok  = (res: Response, data: unknown) => res.status(200).json({ success: true, data })
const fail = (res: Response, msg: string, status = 400) => res.status(status).json({ success: false, error: msg })

export async function scanProduct(req: Request, res: Response): Promise<Response> {
  try {
    const code = String(req.query.code ?? '').trim()
    if (!code) return fail(res, 'El parámetro "code" es requerido', 400)

    const product = await prisma.product.findFirst({
      where: {
        isActive: true,
        OR: [
          { skuInternal:    code },
          { barcodeExternal: code },
        ],
      },
      include: {
        category: { select: { id: true, name: true } },
        brand:    { select: { id: true, name: true } },
      },
    })

    if (!product) return fail(res, `Producto no encontrado para código: "${code}"`, 404)
    return ok(res, product)
  } catch (err) {
    logger.error('[searchController] scanProduct error', { err })
    return fail(res, 'Error al escanear producto', 500)
  }
}

export async function searchProducts(req: Request, res: Response): Promise<Response> {
  try {
    const query = String(req.query.query ?? req.query.q ?? '').trim()
    const limit = Math.min(20, Math.max(1, Number(req.query.limit ?? 10)))

    if (!query || query.length < 1) {
      return ok(res, [])
    }

    // Priority 1: exact barcode match
    const exactByBarcode = await prisma.product.findFirst({
      where: { barcodeExternal: query, isActive: true },
      include: { category: { select: { id: true, name: true } }, brand: { select: { id: true, name: true } } },
    })

    if (exactByBarcode) {
      return ok(res, [exactByBarcode])
    }

    // Priority 2: exact SKU match
    const exactBySku = await prisma.product.findFirst({
      where: { skuInternal: { equals: query, mode: 'insensitive' }, isActive: true },
      include: { category: { select: { id: true, name: true } }, brand: { select: { id: true, name: true } } },
    })

    // Priority 3: fuzzy name / SKU / partNumber contains
    const fuzzyResults = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { nameCommercial: { contains: query, mode: 'insensitive' } },
          { skuInternal:    { contains: query, mode: 'insensitive' } },
          { partNumberOEM:  { contains: query, mode: 'insensitive' } },
          { descriptionTech: { contains: query, mode: 'insensitive' } },
        ],
        ...(exactBySku ? { id: { not: exactBySku.id } } : {}),
      },
      take: exactBySku ? limit - 1 : limit,
      orderBy: { nameCommercial: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
        brand:    { select: { id: true, name: true } },
      },
    })

    const results = [
      ...(exactBySku ? [exactBySku] : []),
      ...fuzzyResults,
    ].slice(0, limit)

    logger.debug('[searchController] product search', { query, found: results.length })
    return ok(res, results)
  } catch (err) {
    logger.error('[searchController] searchProducts error', { err })
    return fail(res, 'Error al buscar productos', 500)
  }
}
