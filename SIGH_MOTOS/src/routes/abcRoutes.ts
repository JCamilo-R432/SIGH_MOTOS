import { Router } from 'express'
import { authenticate, authorize } from '../middleware/authMiddleware'
import { getAbcAnalysis, getSalesTrend, getDashboardKpis } from '../controllers/abcController'

const router = Router()

router.use(authenticate)

/**
 * GET /api/v1/reports/abc-analysis?startDate=&endDate=
 * GET /api/v1/reports/sales-trend?days=30
 * GET /api/v1/reports/kpis
 */
router.get('/abc-analysis', authorize('reports.read'), getAbcAnalysis)
router.get('/sales-trend',  authorize('reports.read'), getSalesTrend)
router.get('/kpis',         authorize('reports.read'), getDashboardKpis)

export default router
