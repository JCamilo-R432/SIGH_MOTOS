import { Request, Response, NextFunction } from 'express';

// ─── Placeholder de autenticación ───────────────────────────────────────────
// Reemplazar con JWT / sesión real cuando se implemente el módulo de Auth.

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Verifica que el request tenga un token válido y adjunta req.user. */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token de autenticación requerido' });
  }

  // TODO: validar JWT real
  // Por ahora inyecta un usuario de desarrollo si el token es "dev"
  if (process.env.NODE_ENV === 'development' && token === 'dev') {
    req.user = {
      id: 'dev-user-001',
      email: 'dev@sigcmotos.co',
      role: 'ADMIN',
      permissions: [
        'inventory.read', 'inventory.write',
        'sales.read', 'sales.write', 'sales.admin',
      ],
    };
    return next();
  }

  return res.status(401).json({ success: false, error: 'Token inválido' });
}

/**
 * Verifica que req.user tenga el permiso indicado.
 * Uso: authorize('inventory.write')
 */
export function authorize(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userPerms = req.user?.permissions ?? [];
    const hasAll = requiredPermissions.every((p) => userPerms.includes(p));

    if (!hasAll) {
      return res.status(403).json({
        success: false,
        error: `Permisos insuficientes. Requeridos: ${requiredPermissions.join(', ')}`,
      });
    }

    return next();
  };
}
