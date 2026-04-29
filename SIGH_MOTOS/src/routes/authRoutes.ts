import { Router }           from 'express';
import { Request, Response } from 'express';
import { ZodError }          from 'zod';
import { loginSchema }       from '../utils/validators';
import { login, getOwnProfile } from '../controllers/userController';
import { authenticate }      from '../middleware/authMiddleware';

const router = Router();

// POST /api/v1/auth/login — Pública
router.post('/login', async (req: Request, res: Response) => {
  try {
    loginSchema.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(422).json({
        success: false,
        error:   'Datos de entrada inválidos',
        details: err.flatten(),
      });
    }
    return res.status(400).json({ success: false, error: 'Solicitud malformada' });
  }
  return login(req, res);
});

// GET /api/v1/auth/me — Requiere token JWT válido
router.get('/me', authenticate, getOwnProfile);

export default router;
