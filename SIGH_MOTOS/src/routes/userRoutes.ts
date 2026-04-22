import { Router } from 'express';
import { authorize } from '../middleware/authMiddleware';
import {
  getOwnProfile,
  createUser,
  listUsers,
  updateUserRole,
  deactivateUser,
  listRoles,
  getAuditLogs,
} from '../controllers/userController';

// Nota: authenticate se aplica en routes/index.ts al montar este router.
const router = Router();

// Perfil propio — cualquier usuario autenticado
router.get('/me',    getOwnProfile);

// Gestión de roles disponibles — users.read
router.get('/roles', authorize('users.read'), listRoles);

// CRUD de usuarios
router.get('/',    authorize('users.read'),  listUsers);
router.post('/',   authorize('users.write'), createUser);
router.put('/:id/role',   authorize('users.admin'), updateUserRole);
router.delete('/:id',     authorize('users.admin'), deactivateUser);

// Log de auditoría — solo ADMIN
router.get('/audit-logs', authorize('users.admin'), getAuditLogs);

export default router;
