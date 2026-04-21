import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import {
  createSupplierHandler,
  listSuppliersHandler,
  getSupplierByIdHandler,
  updateSupplierHandler,
} from '../controllers/purchaseController';

const router = Router();

const canRead  = [authenticate, authorize('purchases.read')];
const canWrite = [authenticate, authorize('purchases.write')];

router.post('/',     ...canWrite, createSupplierHandler);
router.get('/',      ...canRead,  listSuppliersHandler);
router.get('/:id',   ...canRead,  getSupplierByIdHandler);
router.put('/:id',   ...canWrite, updateSupplierHandler);

export default router;
