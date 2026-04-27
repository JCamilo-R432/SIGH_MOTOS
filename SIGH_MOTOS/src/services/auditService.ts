import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

/**
 * Registra una acción crítica en el log de auditoría.
 *
 * Se puede llamar con `void logAction(...)` para no bloquear la respuesta HTTP,
 * o con `await logAction(...)` cuando la trazabilidad sea imprescindible (ej: login).
 */
export async function logAction(
  userId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  details: Record<string, unknown> = {},
  ipAddress?: string | null,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId:    userId ?? undefined,
        action,
        entity,
        entityId:  entityId ?? undefined,
        details:   details as Prisma.InputJsonValue,
        ipAddress: ipAddress ?? undefined,
      },
    });
  } catch (error) {
    // El fallo de auditoría nunca debe interrumpir la operación principal.
    logger.error('[auditService] Error al registrar log de auditoría', { action, entity, error });
  }
}

/** Consulta el historial de auditoría con filtros opcionales (sin paginación). */
export async function getAuditLogs(filters: {
  userId?: string;
  entity?: string;
  action?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}) {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.userId) where.userId = filters.userId;
  if (filters.entity) where.entity = filters.entity;
  if (filters.action) where.action = { contains: filters.action, mode: 'insensitive' };
  if (filters.from || filters.to) {
    where.timestamp = {};
    if (filters.from) where.timestamp.gte = filters.from;
    if (filters.to)   where.timestamp.lte = filters.to;
  }

  return prisma.auditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: filters.limit ?? 100,
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });
}

/**
 * Historial de auditoría con paginación cursor-based.
 * Más eficiente que paginación offset para tablas de alto volumen.
 * El cursor apunta al ID del último registro entregado en la página anterior.
 */
export async function getAuditLogsPaginated(filters: {
  cursor?:  string;
  limit?:   number;
  userId?:  string;
  entity?:  string;
  action?:  string;
  from?:    Date;
  to?:      Date;
}) {
  const take  = Math.min(filters.limit ?? 50, 200);
  const where: Prisma.AuditLogWhereInput = {};

  if (filters.userId) where.userId = filters.userId;
  if (filters.entity) where.entity = { contains: filters.entity, mode: 'insensitive' };
  if (filters.action) where.action = { contains: filters.action, mode: 'insensitive' };
  if (filters.from || filters.to) {
    where.timestamp = {};
    if (filters.from) where.timestamp.gte = filters.from;
    if (filters.to)   where.timestamp.lte = filters.to;
  }

  return prisma.auditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });
}
