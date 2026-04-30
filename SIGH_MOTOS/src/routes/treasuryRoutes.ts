import { Router } from 'express';
import { authorize } from '../middleware/authMiddleware';
import * as treasuryController from '../controllers/treasuryController';

// authenticate aplicado en routes/index.ts antes de montar este router
const router = Router();

// ─── Turno de caja (rutas originales) ────────────────────────────────────────
router.post('/open',      authorize('finance.write'), treasuryController.openCashRegister);
router.post('/close',     authorize('finance.write'), treasuryController.closeCashRegister);
router.get('/shift',      authorize('finance.read'),  treasuryController.getActiveShift);

// ─── Aliases /cash-register/* (compatibilidad con frontend) ──────────────────
router.get('/cash-register/current',       authorize('finance.read'),  treasuryController.getActiveShift);
router.get('/cash-register',               authorize('finance.read'),  treasuryController.getCashRegisters);
router.post('/cash-register/open',         authorize('finance.write'), treasuryController.openCashRegisterAlias);
router.post('/cash-register/:id/close',    authorize('finance.write'), treasuryController.closeCashRegisterAlias);

// ─── Egresos operativos ───────────────────────────────────────────────────────
router.post('/expenses',  authorize('finance.write'), treasuryController.registerExpense);

// ─── Transacciones ────────────────────────────────────────────────────────────
router.get('/transactions', authorize('finance.read'), treasuryController.getTransactions);

// ─── Consultas y reportes ─────────────────────────────────────────────────────
router.get('/summary',      authorize('finance.read'),  treasuryController.getDailySummary);
router.get('/daily-report', authorize('finance.read'),  treasuryController.getDailyReport);
// /report requiere finance.read + users.read (permiso de admin)
router.get('/report',       authorize('finance.read', 'users.read'), treasuryController.getDailyReport);

export default router;
