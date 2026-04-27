import { Router } from 'express'
import { authenticate, authorize } from '../middleware/authMiddleware'
import {
  listDebts,
  getDebtById,
  registerPayment,
  getDebtsSummary,
} from '../controllers/debtController'

const router = Router()

// All treasury routes require authentication
router.use(authenticate)

/**
 * GET  /api/v1/treasury/debts/summary  → resumen de cuentas por cobrar
 * GET  /api/v1/treasury/debts          → lista de deudas (filtros: status, customerId)
 * GET  /api/v1/treasury/debts/:id      → detalle de una deuda
 * PATCH /api/v1/treasury/debts/:id/pay → registrar abono
 */
router.get('/summary',      authorize('finance.read'),  getDebtsSummary)
router.get('/',             authorize('finance.read'),  listDebts)
router.get('/:id',          authorize('finance.read'),  getDebtById)
router.patch('/:id/pay',    authorize('finance.write'), registerPayment)

export default router
