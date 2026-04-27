import { Router } from 'express';
import { authorize } from '../middleware/authMiddleware';
import * as treasuryController from '../controllers/treasuryController';

// authenticate aplicado en routes/index.ts antes de montar este router
const router = Router();

// ─── Turno de caja ────────────────────────────────────────────────────────────
router.post('/open',      authorize('finance.write'), treasuryController.openCashRegister);
router.post('/close',     authorize('finance.write'), treasuryController.closeCashRegister);
router.get('/shift',      authorize('finance.read'),  treasuryController.getActiveShift);

// ─── Egresos operativos ───────────────────────────────────────────────────────
router.post('/expenses',  authorize('finance.write'), treasuryController.registerExpense);

// ─── Consultas y reportes ─────────────────────────────────────────────────────
router.get('/summary',    authorize('finance.read'),  treasuryController.getDailySummary);
// /report requiere finance.read + users.read (permiso de admin)
router.get('/report',     authorize('finance.read', 'users.read'), treasuryController.getDailyReport);

export default router;
