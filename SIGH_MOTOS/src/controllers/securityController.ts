/**
 * securityController.ts — Módulo 7: Seguridad y Gobernanza
 *
 * Funcionalidades nuevas que no existen en userController:
 *   - changePassword        → cualquier usuario autenticado
 *   - reactivateUser        → ADMIN: deshacer deactivateUser
 *   - getAuditLogsPaginated → ADMIN: historial con paginación cursor-based
 *   - triggerBackup         → ADMIN: pg_dump + gzip hacia carpeta /backups
 */

import { Request, Response }   from 'express';
import { exec }                from 'child_process';
import { promisify }           from 'util';
import { promises as fs }      from 'fs';
import path                    from 'path';
import { Prisma }              from '@prisma/client';
import { ZodError, z }         from 'zod';
import * as authService        from '../services/authService';
import * as auditService       from '../services/auditService';
import { prisma }              from '../config/prisma';
import { hashPassword }        from '../utils/passwordUtils';
import {
  changePasswordSchema,
  auditLogsQuerySchema,
  registerSchema,
} from '../utils/validators';
import { logger }              from '../config/logger';

const execAsync = promisify(exec);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

const fail = (res: Response, error: string, status = 400, details?: unknown) =>
  res.status(status).json({ success: false, error, ...(details ? { details } : {}) });

function extractParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] ?? '';
  return param ?? '';
}

function handleError(res: Response, err: unknown, context: string): Response {
  logger.error(`[securityController] ${context}`, { err });

  if (err instanceof ZodError) {
    return fail(res, 'Datos de entrada inválidos', 422, err.flatten());
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return fail(res, 'Registro duplicado', 409);
    if (err.code === 'P2025') return fail(res, 'Registro no encontrado', 404);
  }
  if (err instanceof Error) return fail(res, err.message, 400);
  return fail(res, 'Error interno del servidor', 500);
}

// ─── GET /api/v1/security/users ──────────────────────────────────────────────

export async function listUsers(_req: Request, res: Response): Promise<Response> {
  try {
    const users = await authService.listUsers();
    return ok(res, users);
  } catch (err) {
    return handleError(res, err, 'listUsers');
  }
}

// ─── POST /api/v1/security/users ─────────────────────────────────────────────

export async function createUser(req: Request, res: Response): Promise<Response> {
  try {
    const ipAddress = req.ip ?? req.socket.remoteAddress;

    // Frontend sends role name, backend expects roleId — look up the role
    const { name, email, password, role } = req.body as {
      name: string; email: string; password: string; role: string;
    };

    let roleId: string = req.body.roleId;
    if (!roleId && role) {
      const roleRecord = await prisma.role.findFirst({ where: { name: role.toUpperCase() } });
      if (!roleRecord) return fail(res, `Rol '${role}' no encontrado`, 404);
      roleId = roleRecord.id;
    }

    const parsed = registerSchema.parse({ name, email, password, roleId });
    const user = await authService.createUser(parsed, req.user!.id, ipAddress);
    return ok(res, user, 201);
  } catch (err) {
    return handleError(res, err, 'createUser');
  }
}

// ─── PUT /api/v1/security/users/:id ─────────────────────────────────────────

export async function updateUser(req: Request, res: Response): Promise<Response> {
  try {
    const targetId  = extractParam(req.params['id']);
    if (!targetId) return fail(res, 'ID de usuario requerido');
    const ipAddress = req.ip ?? req.socket.remoteAddress;

    const { name, email, role, password } = req.body as {
      name?: string; email?: string; role?: string; password?: string;
    };

    const updateData: Record<string, unknown> = {};
    if (name)  updateData['name']  = name;
    if (email) updateData['email'] = email.toLowerCase().trim();

    if (role) {
      const roleRecord = await prisma.role.findFirst({ where: { name: role.toUpperCase() } });
      if (!roleRecord) return fail(res, `Rol '${role}' no encontrado`, 404);
      updateData['roleId'] = roleRecord.id;
    }

    if (password) {
      updateData['password'] = await hashPassword(password);
    }

    const user = await prisma.user.update({
      where:  { id: targetId },
      data:   updateData,
      select: {
        id: true, email: true, name: true, isActive: true, createdAt: true,
        role: { select: { id: true, name: true } },
      },
    });

    void auditService.logAction(req.user!.id, 'UPDATE_USER', 'User', targetId, {
      fields: Object.keys(updateData).filter((k) => k !== 'password'),
    }, ipAddress);

    return ok(res, user);
  } catch (err) {
    return handleError(res, err, 'updateUser');
  }
}

// ─── PATCH /api/v1/security/users/:id/status ─────────────────────────────────

export async function toggleUserStatus(req: Request, res: Response): Promise<Response> {
  try {
    const targetId = extractParam(req.params['id']);
    if (!targetId) return fail(res, 'ID de usuario requerido');

    const { isActive } = req.body as { isActive: boolean };
    if (typeof isActive !== 'boolean') return fail(res, 'isActive debe ser boolean', 422);

    const ipAddress = req.ip ?? req.socket.remoteAddress;

    const user = await prisma.user.update({
      where:  { id: targetId },
      data:   { isActive },
      select: { id: true, email: true, name: true, isActive: true },
    });

    const action = isActive ? 'REACTIVATE_USER' : 'DEACTIVATE_USER';
    void auditService.logAction(req.user!.id, action, 'User', targetId, {
      email: user.email,
    }, ipAddress);

    return ok(res, user);
  } catch (err) {
    return handleError(res, err, 'toggleUserStatus');
  }
}

// ─── POST /api/v1/security/change-password ────────────────────────────────────

/**
 * Cambia la contraseña del usuario logueado.
 * Requiere: oldPassword + newPassword (mín. 8 chars).
 */
export async function changePassword(req: Request, res: Response): Promise<Response> {
  try {
    const data = changePasswordSchema.parse(req.body);
    const ipAddress = req.ip ?? req.socket.remoteAddress;

    await authService.changePassword(
      req.user!.id,
      data.oldPassword,
      data.newPassword,
      ipAddress,
    );

    return ok(res, { message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    return handleError(res, err, 'changePassword');
  }
}

// ─── PATCH /api/v1/security/users/:id/reactivate ─────────────────────────────

/**
 * Reactiva un usuario previamente desactivado (soft-delete reverso).
 * Exclusivo de ADMIN. No se puede reactivar a sí mismo (ya está activo).
 */
export async function reactivateUser(req: Request, res: Response): Promise<Response> {
  try {
    const targetId  = extractParam(req.params['id']);
    if (!targetId) return fail(res, 'ID de usuario requerido');

    if (targetId === req.user!.id) {
      return fail(res, 'Tu cuenta ya está activa', 400);
    }

    const ipAddress = req.ip ?? req.socket.remoteAddress;
    const user = await authService.reactivateUser(targetId, req.user!.id, ipAddress);
    return ok(res, { message: 'Usuario reactivado correctamente', user });
  } catch (err) {
    return handleError(res, err, 'reactivateUser');
  }
}

// ─── GET /api/v1/security/audit-logs ─────────────────────────────────────────

/**
 * Historial de auditoría con paginación cursor-based y filtros avanzados.
 * Exclusivo de ADMIN.
 *
 * Query params:
 *   cursor     — ID del último registro visto (paginación forward-only)
 *   limit      — Máximo de registros (default 50, max 200)
 *   userId     — Filtrar por usuario
 *   entity     — Filtrar por entidad ('Sale', 'Product', 'User', etc.)
 *   action     — Filtrar por acción (búsqueda parcial insensitive)
 *   from       — Fecha inicio (ISO)
 *   to         — Fecha fin (ISO)
 */
export async function getAuditLogsPaginated(req: Request, res: Response): Promise<Response> {
  try {
    const query = auditLogsQuerySchema.parse(req.query);

    const logs = await auditService.getAuditLogsPaginated({
      cursor:   query.cursor,
      limit:    query.limit,
      userId:   query.userId,
      entity:   query.entity,
      action:   query.action,
      from:     query.from ? new Date(query.from) : undefined,
      to:       query.to   ? new Date(query.to)   : undefined,
    });

    const nextCursor = logs.length === query.limit
      ? logs[logs.length - 1]?.id
      : undefined;

    return ok(res, {
      logs,
      pagination: {
        limit:      query.limit,
        count:      logs.length,
        nextCursor: nextCursor ?? null,
        hasMore:    !!nextCursor,
      },
    });
  } catch (err) {
    return handleError(res, err, 'getAuditLogsPaginated');
  }
}

// ─── POST /api/v1/security/users/:id/reset-password ──────────────────────────

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

/**
 * Permite al ADMIN establecer una nueva contraseña para cualquier usuario.
 * No requiere la contraseña actual del usuario objetivo.
 */
export async function resetUserPassword(req: Request, res: Response): Promise<Response> {
  try {
    const targetId = extractParam(req.params['id']);
    if (!targetId) return fail(res, 'ID de usuario requerido');

    const { newPassword } = resetPasswordSchema.parse(req.body);
    const ipAddress = req.ip ?? req.socket.remoteAddress;

    const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, name: true, email: true } });
    if (!user) return fail(res, 'Usuario no encontrado', 404);

    const hashed = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: targetId }, data: { password: hashed } });

    void auditService.logAction(req.user!.id, 'RESET_PASSWORD', 'User', targetId, {
      targetUser: user.email,
      resetBy: req.user!.id,
    }, ipAddress);

    return ok(res, { message: `Contraseña de ${user.name} actualizada correctamente` });
  } catch (err) {
    return handleError(res, err, 'resetUserPassword');
  }
}

// ─── POST /api/v1/security/backup ────────────────────────────────────────────

/**
 * Ejecuta pg_dump y guarda el archivo comprimido (.sql.gz) en el directorio
 * configurado por la variable de entorno BACKUP_DIR (default: ./backups).
 *
 * Prerrequisito en el servidor: pg_dump disponible en el PATH.
 * Variables necesarias: DATABASE_URL (postgresql://user:pass@host:port/dbname)
 */
export async function triggerBackup(req: Request, res: Response): Promise<Response> {
  try {
    const result = await createDatabaseBackup(
      req.user!.id,
      req.ip ?? req.socket.remoteAddress,
    );
    return ok(res, result, 201);
  } catch (err) {
    return handleError(res, err, 'triggerBackup');
  }
}

// ─── Lógica de backup (interna) ───────────────────────────────────────────────

/** Valida que un string sea seguro para usar como argumento de shell (sin meta-caracteres). */
function sanitizeShellArg(value: string, fieldName: string): string {
  if (!value || typeof value !== 'string') {
    throw new Error(`${fieldName} es requerido para el backup`);
  }
  // Permite: letras, números, puntos, guiones, guiones bajos.
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`${fieldName} contiene caracteres no permitidos en el contexto de backup`);
  }
  return value;
}

async function createDatabaseBackup(userId: string, ipAddress?: string) {
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    throw new Error('DATABASE_URL no está configurada — imposible ejecutar el backup');
  }

  // Parsear la URL de conexión de forma segura
  let host: string, port: string, dbName: string, pgUser: string, pgPassword: string;
  try {
    const url    = new URL(dbUrl);
    host         = sanitizeShellArg(url.hostname,             'host');
    port         = sanitizeShellArg(url.port || '5432',       'port');
    dbName       = sanitizeShellArg(url.pathname.slice(1),    'database');
    pgUser       = sanitizeShellArg(decodeURIComponent(url.username), 'user');
    pgPassword   = decodeURIComponent(url.password);
  } catch (e) {
    if (e instanceof Error && e.message.includes('no permitidos')) throw e;
    throw new Error('DATABASE_URL tiene un formato inválido');
  }

  // Directorio de backups — crear si no existe
  const backupDir = path.resolve(process.env['BACKUP_DIR'] ?? './backups');
  await fs.mkdir(backupDir, { recursive: true });

  // Nombre de archivo determinista y sin caracteres especiales
  const timestamp = new Date()
    .toISOString()
    .replace(/[:T]/g, '-')
    .replace(/\..+$/, '');                    // "2026-04-24-10-30-00"
  const filename  = `sigcmotos-${timestamp}.sql.gz`;
  const filepath  = path.join(backupDir, filename);

  // pg_dump → gzip -9  (contraseña via PGPASSWORD, nunca en el comando)
  const cmd = [
    'pg_dump',
    `-h ${host}`,
    `-p ${port}`,
    `-U ${pgUser}`,
    `-d ${dbName}`,
    `| gzip -9 > "${filepath}"`,
  ].join(' ');

  logger.info(`[securityController] Iniciando backup → ${filename}`);

  try {
    await execAsync(cmd, {
      env:     { ...process.env, PGPASSWORD: pgPassword },
      timeout: 120_000,   // 2 min máximo
      shell:   process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    });
  } catch (execErr) {
    // Limpiar archivo parcial
    await fs.rm(filepath, { force: true });
    throw new Error(
      `pg_dump falló: ${execErr instanceof Error ? execErr.message : String(execErr)}`,
    );
  }

  const stats = await fs.stat(filepath);

  // Registrar en auditoría (fire-and-forget, no bloquea la respuesta)
  void auditService.logAction(userId, 'BACKUP_CREATED', 'System', null, {
    filename,
    filepath,
    sizeBytes: stats.size,
  }, ipAddress);

  logger.info(`[securityController] Backup completado: ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);

  return {
    filename,
    sizeBytes:  stats.size,
    sizeKB:     parseFloat((stats.size / 1024).toFixed(1)),
    filepath:   filepath.replace(/\\/g, '/'),
    createdAt:  new Date().toISOString(),
  };
}
