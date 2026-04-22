import { Router } from 'express';
import { authorize } from '../middleware/authMiddleware';
import * as financeController from '../controllers/financeController';

// Nota: authenticate aplicado en routes/index.ts
const router = Router();

// ─── Caja ─────────────────────────────────────────────────────────────────────
router.post('/cash/open',         authorize('finance.write'), financeController.openRegister);
router.post('/cash/close',        authorize('finance.write'), financeController.closeRegister);
router.get('/cash/current',       authorize('finance.read'),  financeController.getCurrentRegister);
router.get('/cash',               authorize('finance.read'),  financeController.listRegisters);
router.get('/cash/:id/summary',   authorize('finance.read'),  financeController.getRegisterSummary);

// ─── Transacciones manuales ───────────────────────────────────────────────────
router.post('/transactions',      authorize('finance.write'), financeController.addTransaction);

// ─── Cuentas por cobrar ───────────────────────────────────────────────────────
router.get('/debts/receivables',  authorize('finance.read'),  financeController.getReceivables);
router.post('/receivables',       authorize('finance.write'), financeController.createReceivable);

// ─── Cuentas por pagar ────────────────────────────────────────────────────────
router.get('/debts/payables',     authorize('finance.read'),  financeController.getPayables);
router.post('/payables',          authorize('finance.write'), financeController.createPayable);

// ─── Pagos y abonos ───────────────────────────────────────────────────────────
router.post('/payments',          authorize('finance.write'), financeController.makePayment);

// ─── Mantenimiento ────────────────────────────────────────────────────────────
router.post('/debts/update-overdue', authorize('finance.write'), financeController.updateOverdue);

export default router;
