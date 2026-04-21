import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import * as ctrl from '../controllers/productController';

const router = Router();

const canRead = [authenticate, authorize('inventory.read')];
const canWrite = [authenticate, authorize('inventory.read', 'inventory.write')];

// ─── Colección ───────────────────────────────────────────────────────────────
router.post('/', ...canWrite, ctrl.createProduct);
router.get('/', ...canRead, ctrl.getProducts);
router.get('/low-stock', ...canRead, ctrl.getLowStockProducts);

// ─── Recurso individual ──────────────────────────────────────────────────────
router.get('/:id', ...canRead, ctrl.getProductById);
router.put('/:id', ...canWrite, ctrl.updateProduct);
router.delete('/:id', ...canWrite, ctrl.deleteProduct);

// ─── Sub-recursos ────────────────────────────────────────────────────────────
router.post('/:id/adjust-stock', ...canWrite, ctrl.adjustStock);
router.get('/:id/movements', ...canRead, ctrl.getProductMovements);

export default router;
