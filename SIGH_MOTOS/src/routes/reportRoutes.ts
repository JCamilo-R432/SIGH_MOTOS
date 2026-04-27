import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import * as reportController from '../controllers/reportController';

const router = Router();

// Todos los endpoints requieren autenticación + permiso reports.read
router.use(authenticate, authorize('reports.read'));

// ─── Reportes existentes ──────────────────────────────────────────────────────
router.get('/dashboard',             reportController.getDashboard);
router.get('/profitability',         reportController.getProfitability);
router.get('/inventory/aging',       reportController.getInventoryAging);
router.get('/sales/grouped',         reportController.getSalesGrouped);
router.get('/customers/top-buyers',  reportController.getTopCustomers);
router.get('/suppliers/performance', reportController.getSupplierPerformance);

// ─── Módulo 6: Inteligencia de Negocios ──────────────────────────────────────

// KPIs ejecutivos + gráfico diario (Chart.js / Recharts ready)
router.get('/dashboard/executive',   reportController.getExecutiveDashboard);

// Valoración de inventario a costo y a precio de venta
router.get('/inventory/valuation',   reportController.getInventoryValuation);

// Análisis de rotación ABC (Ley de Pareto 80/20)
router.get('/products/rotation',     reportController.getProductRotationAnalysis);

// Alertas de stock mínimo con estimación de reposición
router.get('/alerts/low-stock',      reportController.getLowStockAlerts);

// Exportación a Excel — type: sales | inventory | products
// GET /api/v1/reports/export/sales?startDate=2026-01-01&endDate=2026-01-31
router.get('/export/:type',          reportController.exportReport);

export default router;
