import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import * as ctrl from '../controllers/configController';

const router = Router();

// GET  /api/v1/config  — cualquier usuario autenticado puede leer la config
router.get('/', authenticate, ctrl.getConfig);

// PUT  /api/v1/config  — solo ADMIN puede modificar
router.put('/', authenticate, authorize('users.admin'), ctrl.updateConfig);

export default router;
