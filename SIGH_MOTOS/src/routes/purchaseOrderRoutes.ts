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

router.post('/',               ...canWrite, createPurchaseOrderHandler);
router.get('/',                ...canRead,  listPurchaseOrdersHandler);
router.get('/:id',             ...canRead,  getPurchaseOrderByIdHandler);
router.post('/:id/receive',    ...canWrite, receivePurchaseOrderHandler);
router.post('/:id/cancel',     ...canWrite, cancelPurchaseOrderHandler);

export default router;
