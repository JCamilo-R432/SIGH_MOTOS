import { Router } from 'express'
import { authenticate, authorize } from '../middleware/authMiddleware'
import { handleProductImageUpload } from '../controllers/imageController'

const router = Router()

/**
 * POST /api/v1/inventory/products/:id/image
 * Sube imagen de producto.
 */
router.post(
  '/products/:id/image',
  authenticate,
  authorize('inventory.write'),
  handleProductImageUpload,
)

export default router
