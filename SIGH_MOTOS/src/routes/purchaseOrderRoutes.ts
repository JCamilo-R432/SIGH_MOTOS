import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import {
  createPurchaseOrderHandler,
  receivePurchaseOrderHandler,
  cancelPurchaseOrderHandler,
  getPurchaseOrderByIdHandler,
  listPurchaseOrdersHandler,
} from '../controllers/purchaseController';

const router = Router();

const canRead  = [authenticate, authorize('purchases.read')];
const canWrite = [authenticate, authorize('purchases.write')];

// Aliases /orders/* deben ir ANTES de /:id para que Express no las interprete como IDs
router.post('/orders',               ...canWrite, createPurchaseOrderHandler);
router.get('/orders',                ...canRead,  listPurchaseOrdersHandler);
router.get('/orders/:id',            ...canRead,  getPurchaseOrderByIdHandler);
router.post('/orders/:id/receive',   ...canWrite, receivePurchaseOrderHandler);
router.put('/orders/:id/receive',    ...canWrite, receivePurchaseOrderHandler);
router.post('/orders/:id/cancel',    ...canWrite, cancelPurchaseOrderHandler);

// Rutas base (sin prefijo /orders)
router.post('/',               ...canWrite, createPurchaseOrderHandler);
router.get('/',                ...canRead,  listPurchaseOrdersHandler);
router.get('/:id',             ...canRead,  getPurchaseOrderByIdHandler);
router.post('/:id/receive',    ...canWrite, receivePurchaseOrderHandler);
router.post('/:id/cancel',     ...canWrite, cancelPurchaseOrderHandler);

export default router;
