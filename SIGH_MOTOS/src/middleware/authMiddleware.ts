import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';

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

/**
 * Verifica el JWT y adjunta req.user con permisos FRESCOS desde la BD.
 *
 * Los permisos se leen de la BD en cada petición (no del payload del JWT).
 * Esto garantiza que cambios en la tabla role_permissions sean efectivos
 * de forma inmediata sin necesidad de que el usuario cierre sesión.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (!token) {
    res.status(401).json({ success: false, error: 'Token de autenticación requerido' });
    return;
  }

  // Bypass para desarrollo local
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
        'finance.read',    'finance.write',
      ],
    };
    next();
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ success: false, error: 'Configuración de seguridad incompleta' });
    return;
  }

  let decoded: TokenPayload;
  try {
    decoded = jwt.verify(token, secret) as TokenPayload;
  } catch {
    res.status(401).json({ success: false, error: 'Token inválido o expirado' });
    return;
  }

  // Consultar permisos FRESCOS desde BD usando el roleId del token.
  // Esto corrige el problema de JWTs emitidos antes de que se hiciera el seed
  // de permisos, donde permissions: [] causaba 403 en todos los endpoints.
  prisma.rolePermission.findMany({
    where:   { roleId: decoded.roleId },
    include: { permission: { select: { name: true } } },
  })
    .then((rolePerms) => {
      req.user = {
        id:          decoded.userId,
        userId:      decoded.userId,
        email:       decoded.email,
        roleId:      decoded.roleId,
        roleName:    decoded.roleName,
        permissions: rolePerms.map((rp) => rp.permission.name),
      };
      next();
    })
    .catch(() => {
      res.status(500).json({ success: false, error: 'Error al verificar permisos' });
    });
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
