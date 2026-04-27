import { Router } from 'express'
import { authenticate } from '../middleware/authMiddleware'
import { searchProducts, scanProduct } from '../controllers/searchController'

const router = Router()

/**
 * GET /api/v1/pos/products/search?query=&limit=10
 * Búsqueda tolerante de productos para el POS.
 */
router.get('/products/search', authenticate, searchProducts)

/**
 * GET /api/v1/pos/products/scan?code=
 * Coincidencia exacta por skuInternal o barcodeExternal — optimizado para lectores láser.
 */
router.get('/products/scan', authenticate, scanProduct)

export default router
