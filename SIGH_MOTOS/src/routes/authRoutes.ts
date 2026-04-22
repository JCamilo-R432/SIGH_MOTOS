import { Router } from 'express';
import { login } from '../controllers/userController';

const router = Router();

// POST /api/v1/auth/login — Pública (no requiere authenticate)
router.post('/login', login);

export default router;
