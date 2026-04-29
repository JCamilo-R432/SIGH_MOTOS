import { Router }           from 'express';
import { Request, Response } from 'express';
import { ZodError }          from 'zod';
import { loginSchema }       from '../utils/validators';
import { login, getOwnProfile } from '../controllers/userController';
import { authenticate }      from '../middleware/authMiddleware';

const router = Router();

// POST /api/v1/auth/login — Pública
router.post('/login', async (req: Request, res: Response) => {
  let parsed: { email: string; password: string };
  try {
    // loginSchema aplica .toLowerCase().trim() al email — usar el resultado, no req.body
    parsed = loginSchema.parse(req.body);
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
  // Reemplazar req.body con los valores transformados por Zod
  req.body = parsed;
  return login(req, res);
});

// GET /api/v1/auth/me — Requiere token JWT válido
router.get('/me', authenticate, getOwnProfile);

export default router;
