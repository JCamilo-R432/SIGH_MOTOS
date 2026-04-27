import { Router }         from 'express';
import { Request, Response } from 'express';
import { ZodError }        from 'zod';
import { loginSchema }     from '../utils/validators';
import { login }           from '../controllers/userController';

const router = Router();

/**
 * POST /api/v1/auth/login — Pública (no requiere authenticate)
 * Valida con loginSchema antes de delegar al controlador.
 */
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

export default router;
