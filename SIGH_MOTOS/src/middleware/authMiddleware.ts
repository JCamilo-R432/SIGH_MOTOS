import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;          // Alias de userId — backward-compat con controladores existentes
  userId: string;      // User.id de la base de datos
  email: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ─── JWT payload interno ──────────────────────────────────────────────────────

interface TokenPayload {
  userId: string;
  email: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  iat?: number;
  exp?: number;
}

// ─── authenticate ─────────────────────────────────────────────────────────────

/** Verifica el JWT del header Authorization y adjunta req.user. */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token de autenticación requerido' });
  }

  // Bypass para desarrollo local — reemplazar con JWT real en producción
  if (process.env.NODE_ENV === 'development' && token === 'dev') {
    req.user = {
      id:          'dev-user-001',
      userId:      'dev-user-001',
      email:       'dev@sigcmotos.co',
      roleId:      'role-admin',
      roleName:    'ADMIN',
      permissions: [
        'inventory.read',  'inventory.write',
        'sales.read',      'sales.write',      'sales.admin',
        'purchases.read',  'purchases.write',
        'reports.read',
        'users.read',      'users.write',      'users.admin',
      ],
    };
    return next();
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ success: false, error: 'Configuración de seguridad incompleta' });
  }

  try {
    const decoded = jwt.verify(token, secret) as TokenPayload;
    req.user = {
      id:          decoded.userId,
      userId:      decoded.userId,
      email:       decoded.email,
      roleId:      decoded.roleId,
      roleName:    decoded.roleName,
      permissions: decoded.permissions,
    };
    return next();
  } catch {
    return res.status(401).json({ success: false, error: 'Token inválido o expirado' });
  }
}

// ─── authorize ───────────────────────────────────────────────────────────────

/**
 * Verifica que req.user tenga TODOS los permisos requeridos.
 *
 * Uso: router.post('/products', authenticate, authorize('inventory.write'), handler)
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
