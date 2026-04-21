import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import {
  createCustomerHandler,
  searchCustomersHandler,
  getCustomerByIdHandler,
} from '../controllers/saleController';

const router = Router();

const canRead  = [authenticate, authorize('sales.read')];
const canWrite = [authenticate, authorize('sales.write')];

router.post('/',    ...canWrite, createCustomerHandler);
router.get('/',     ...canRead,  searchCustomersHandler);
router.get('/:id',  ...canRead,  getCustomerByIdHandler);

export default router;
