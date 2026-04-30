/**
 * securityRoutes.ts — Módulo 7: Seguridad y Gobernanza
 *
 * Montado en /api/v1/security (autenticación aplicada en index.ts).
 *
 * Endpoints:
 *   POST   /security/change-password         — Cualquier usuario autenticado
 *   PATCH  /security/users/:id/reactivate    — ADMIN
 *   GET    /security/audit-logs              — ADMIN (cursor-paginated)
 *   POST   /security/backup                  — ADMIN (pg_dump + gzip)
 */

import { Router }          from 'express';
import { authorize }       from '../middleware/authMiddleware';
import { requireRole }     from '../middleware/rbacMiddleware';
import * as secCtrl        from '../controllers/securityController';

// authenticate ya aplicado en routes/index.ts antes de montar este router
const router = Router();

// ─── Gestión de contraseña ────────────────────────────────────────────────────
router.post('/change-password',
  secCtrl.changePassword,
);

// ─── Gestión de usuarios CRUD ────────────────────────────────────────────────
router.get('/users',
  authorize('users.admin'),
  secCtrl.listUsers,
);

router.post('/users',
  authorize('users.admin'),
  secCtrl.createUser,
);

router.put('/users/:id',
  authorize('users.admin'),
  secCtrl.updateUser,
);

router.patch('/users/:id/status',
  authorize('users.admin'),
  secCtrl.toggleUserStatus,
);

router.patch('/users/:id/reactivate',
  authorize('users.admin'),
  secCtrl.reactivateUser,
);

// ─── Auditoría paginada ───────────────────────────────────────────────────────
router.get('/audit-logs',
  authorize('users.admin'),
  secCtrl.getAuditLogsPaginated,
);

// ─── Reset de contraseña por Admin ───────────────────────────────────────────
router.post('/users/:id/reset-password',
  authorize('users.admin'),
  secCtrl.resetUserPassword,
);

// ─── Backup de BD ─────────────────────────────────────────────────────────────
// Double-guard: requiere permiso users.admin Y rol ADMIN
router.post('/backup',
  authorize('users.admin'),
  requireRole('ADMIN'),
  secCtrl.triggerBackup,
);

export default router;
