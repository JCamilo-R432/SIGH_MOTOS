import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import * as reportController from '../controllers/reportController';

const router = Router();

// Todos los endpoints de reportes requieren autenticación + permiso reports.read
router.use(authenticate, authorize('reports.read'));

router.get('/dashboard',            reportController.getDashboard);
router.get('/profitability',        reportController.getProfitability);
router.get('/inventory/aging',      reportController.getInventoryAging);
router.get('/sales/grouped',        reportController.getSalesGrouped);
router.get('/customers/top-buyers', reportController.getTopCustomers);
router.get('/suppliers/performance',reportController.getSupplierPerformance);

export default router;
