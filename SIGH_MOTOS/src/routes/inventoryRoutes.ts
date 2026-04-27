import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import * as ctrl from '../controllers/inventoryController';

const router = Router();

// Todas las rutas requieren autenticación JWT.
// Lectura:   inventory.read                      → todos los roles autenticados
// Escritura: inventory.read + inventory.write    → solo ADMIN y WAREHOUSE
const canRead  = [authenticate, authorize('inventory.read')];
const canWrite = [authenticate, authorize('inventory.read', 'inventory.write')];

// ═══════════════════════════════════════════════════════════════════════════
// MARCAS  →  /api/v1/inventory/brands
// ═══════════════════════════════════════════════════════════════════════════

router.post(  '/brands',     ...canWrite, ctrl.createBrand);
router.get(   '/brands',     ...canRead,  ctrl.getBrands);
router.get(   '/brands/:id', ...canRead,  ctrl.getBrandById);
router.put(   '/brands/:id', ...canWrite, ctrl.updateBrand);
router.delete('/brands/:id', ...canWrite, ctrl.deleteBrand);

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORÍAS  →  /api/v1/inventory/categories
// ═══════════════════════════════════════════════════════════════════════════

router.post(  '/categories',     ...canWrite, ctrl.createCategory);
router.get(   '/categories',     ...canRead,  ctrl.getCategories);
router.get(   '/categories/:id', ...canRead,  ctrl.getCategoryById);
router.put(   '/categories/:id', ...canWrite, ctrl.updateCategory);
router.delete('/categories/:id', ...canWrite, ctrl.deleteCategory);

// ═══════════════════════════════════════════════════════════════════════════
// ALERTAS  →  /api/v1/inventory/alerts
// ─── Declaradas ANTES de /products para evitar ambigüedad de rutas.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/inventory/alerts/low-stock
 * Lista productos con stockQuantity <= minStockLevel y isActive = true.
 * Ordenados por déficit descendente (mayor urgencia primero).
 * Diseñado para el dashboard de reabastecimiento.
 */
router.get('/alerts/low-stock', ...canRead, ctrl.getLowStockProducts);

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTOS  →  /api/v1/inventory/products
// ═══════════════════════════════════════════════════════════════════════════

router.post(  '/products',     ...canWrite, ctrl.createProduct);
router.get(   '/products',     ...canRead,  ctrl.getAllProducts);
router.get(   '/products/:id', ...canRead,  ctrl.getProductById);
router.put(   '/products/:id', ...canWrite, ctrl.updateProduct);
router.delete('/products/:id', ...canWrite, ctrl.deleteProduct);

// ─── Sub-recursos de producto ───────────────────────────────────────────────

/**
 * PATCH /api/v1/inventory/products/:id/stock
 * Ajuste rápido de stock. quantity positivo = entrada, negativo = salida.
 * Infiere tipo de movimiento del signo. Recalcula WAC si se envía unitCost.
 */
router.patch('/products/:id/stock',     ...canWrite, ctrl.adjustStock);

/**
 * GET /api/v1/inventory/products/:id/movements
 * Historial de movimientos del producto. Query param: limit (max 200).
 */
router.get(  '/products/:id/movements', ...canRead,  ctrl.getProductMovements);

export default router;
