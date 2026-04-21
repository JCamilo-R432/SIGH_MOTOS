import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import {
  createSaleHandler,
  getSaleByIdHandler,
  cancelSaleHandler,
  listSalesHandler,
} from '../controllers/saleController';

const router = Router();

const canRead  = [authenticate, authorize('sales.read')];
const canWrite = [authenticate, authorize('sales.write')];

router.post('/',              ...canWrite, createSaleHandler);
router.get('/',               ...canRead,  listSalesHandler);
router.get('/:id',            ...canRead,  getSaleByIdHandler);
router.post('/:id/cancel',    ...canWrite, cancelSaleHandler);

export default router;
