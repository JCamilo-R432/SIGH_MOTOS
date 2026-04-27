/**
 * rbacMiddleware.ts — Middleware RBAC de grano fino (Módulo 7)
 *
 * Complementa al `authorize()` del authMiddleware con dos variantes:
 *
 *   authorize(...perms)           — AND: el usuario debe tener TODOS los permisos.
 *   requireAnyPermission(...perms)— OR:  el usuario debe tener AL MENOS UNO.
 *   requireRole(...roles)          — Verifica el roleName directamente.
 *   requireAllPermissions(...perms)— Alias semántico de authorize (AND), exportado
 *                                   aquí para mantener consistencia en este módulo.
 *
 * Todos los middlewares asumen que `authenticate` ya se ejecutó
 * y que `req.user` está disponible.
 */

import { Request, Response, NextFunction } from 'express';
import { PERMISSIONS } from '../constants/permissions';

// ─── Tipos utilitarios ────────────────────────────────────────────────────────

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS] | string;

// ─── requireAnyPermission (OR) ────────────────────────────────────────────────

/**
 * El usuario debe tener AL MENOS UNO de los permisos indicados.
 *
 * Ideal para recursos accesibles por múltiples roles distintos.
 * Ejemplo: router.get('/stock', authenticate, requireAnyPermission('inventory.read', 'sales.read'), handler)
 */
export function requireAnyPermission(...perms: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }

    const userPerms = req.user.permissions;
    const hasAny = perms.some(p => userPerms.includes(p));

    if (!hasAny) {
      return res.status(403).json({
        success: false,
        error: `Acceso denegado. Se requiere al menos uno de: ${perms.join(', ')}`,
        required: perms,
      });
    }

    return next();
  };
}

// ─── requireAllPermissions (AND) ─────────────────────────────────────────────

/**
 * El usuario debe tener TODOS los permisos indicados.
 * Alias semántico de `authorize()` exportado desde este módulo.
 */
export function requireAllPermissions(...perms: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }

    const userPerms = req.user.permissions;
    const missing = perms.filter(p => !userPerms.includes(p));

    if (missing.length > 0) {
      return res.status(403).json({
        success: false,
        error: `Permisos insuficientes. Faltan: ${missing.join(', ')}`,
        required: perms,
        missing,
      });
    }

    return next();
  };
}

// ─── requireRole ──────────────────────────────────────────────────────────────

/**
 * El usuario debe tener UNO de los roles indicados (OR sobre roleName).
 *
 * Ejemplo: router.post('/backup', authenticate, requireRole('ADMIN'), handler)
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }

    const userRole = req.user.roleName;
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: `Acceso denegado. Roles permitidos: ${roles.join(', ')}`,
        required: roles,
        current: userRole,
      });
    }

    return next();
  };
}

// ─── isAdmin (helper booleano) ────────────────────────────────────────────────

/**
 * Helper no-middleware para verificar en el interior de un handler
 * si el usuario logueado es administrador.
 */
export function isAdmin(req: Request): boolean {
  return req.user?.roleName === 'ADMIN' ||
         req.user?.permissions.includes('users.admin') === true;
}

// ─── Mapa de permisos por rol (referencia rápida) ─────────────────────────────

/**
 * Devuelve un resumen de los permisos esperados para un rol dado.
 * Útil para documentación en respuestas de error o pantallas de administración.
 */
export const ROLE_PERMISSION_MAP = {
  ADMIN:     ['all — acceso total'],
  MANAGER:   ['inventory.read', 'sales.read', 'sales.admin', 'purchases.read', 'reports.read', 'finance.read', 'finance.write'],
  SELLER:    ['inventory.read', 'sales.read', 'sales.write'],
  WAREHOUSE: ['inventory.read', 'inventory.write', 'purchases.read', 'purchases.write'],
} as const;
