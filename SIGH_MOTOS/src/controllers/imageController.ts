import type { Request, Response } from 'express'
import path from 'path'
import { prisma } from '../config/prisma'
import { logger } from '../config/logger'
import { uploadProductImage } from '../middleware/uploadMiddleware'

const ok  = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data })
const fail = (res: Response, msg: string, status = 400) => res.status(status).json({ success: false, error: msg })

/**
 * POST /api/v1/inventory/products/:id/image
 * Sube imagen del producto y actualiza imageKey.
 */
export function handleProductImageUpload(req: Request, res: Response): void {
  uploadProductImage(req, res, async (err) => {
    try {
      if (err) {
        logger.warn('[imageController] Upload error', { err: err.message })
        fail(res, err.message)
        return
      }

      if (!req.file) {
        fail(res, 'No se recibió ningún archivo. Envía el campo "image" como multipart.')
        return
      }

      const id = String(req.params['id'])
      const product = await prisma.product.findUnique({ where: { id } })
      if (!product) {
        fail(res, 'Producto no encontrado.', 404)
        return
      }

      // Store relative URL path (served as static by Express)
      const imageKey = `/uploads/products/${req.file.filename}`

      const updated = await prisma.product.update({
        where: { id },
        data: { imageKey },
        select: { id: true, nameCommercial: true, imageKey: true },
      })

      logger.info('[imageController] Product image updated', { productId: id, imageKey })
      ok(res, { imageUrl: updated.imageKey, product: updated })
    } catch (e) {
      logger.error('[imageController] Unexpected error', { err: e })
      fail(res, 'Error al procesar la imagen.', 500)
    }
  })
}
