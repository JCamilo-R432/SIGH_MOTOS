import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import {
  openCashShiftSchema,
  registerExpenseSchema,
  closeCashShiftSchema,
  dailySummaryQuerySchema,
} from '../utils/validators';
import * as treasuryService from '../services/treasuryService';
import { logger } from '../config/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

const fail = (res: Response, error: string, status = 400, details?: unknown) =>
  res.status(status).json({ success: false, error, ...(details ? { details } : {}) });

function handleError(res: Response, err: unknown, context: string): Response {
  logger.error(`[treasuryController] ${context}`, { err });

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

// ─── POST /api/v1/treasury/open ───────────────────────────────────────────────

/**
 * Abre un nuevo turno de caja para el usuario logueado.
 * Body: { initialBalance: number, notes?: string }
 */
export async function openCashRegister(req: Request, res: Response): Promise<Response> {
  try {
    const data = openCashShiftSchema.parse(req.body);
    const register = await treasuryService.openCashShift(
      req.user!.id,
      parseFloat(data.initialBalance),
      data.notes,
    );
    return ok(res, register, 201);
  } catch (err) {
    return handleError(res, err, 'openCashRegister');
  }
}

// ─── POST /api/v1/treasury/expenses ──────────────────────────────────────────

/**
 * Registra un egreso operativo en el turno activo del usuario.
 * Body: { amount, description, category, paymentMethod }
 */
export async function registerExpense(req: Request, res: Response): Promise<Response> {
  try {
    const data = registerExpenseSchema.parse(req.body);
    const tx = await treasuryService.registerExpenseTransaction(req.user!.id, {
      amount:        parseFloat(data.amount),
      description:   data.description,
      category:      data.category,
      paymentMethod: data.paymentMethod,
    });
    return ok(res, tx, 201);
  } catch (err) {
    return handleError(res, err, 'registerExpense');
  }
}

// ─── GET /api/v1/treasury/summary ────────────────────────────────────────────

/**
 * Devuelve el resumen del turno activo o del día especificado.
 * Query: { date?: YYYY-MM-DD, userId?: string }
 *   - userId solo aplica si el solicitante tiene permiso users.admin.
 *   - Sin fecha, devuelve el turno OPEN del usuario.
 *   - Con fecha, busca el último turno abierto ese día.
 */
export async function getDailySummary(req: Request, res: Response): Promise<Response> {
  try {
    const query = dailySummaryQuerySchema.parse(req.query);

    // Admin puede consultar el turno de otro usuario; Seller solo el propio.
    const canViewAll = req.user!.permissions.includes('users.admin');
    const targetUserId = canViewAll && query.userId ? query.userId : req.user!.id;

    const summary = await treasuryService.getDailyShiftSummary(targetUserId, query.date);
    return ok(res, summary);
  } catch (err) {
    return handleError(res, err, 'getDailySummary');
  }
}

// ─── POST /api/v1/treasury/close ─────────────────────────────────────────────

/**
 * Realiza el arqueo y cierra el turno activo del usuario.
 * Body: { physicalCount: number, observations?: string }
 * Devuelve la diferencia (sobrante/faltante) con trazabilidad completa.
 */
export async function closeCashRegister(req: Request, res: Response): Promise<Response> {
  try {
    const data = closeCashShiftSchema.parse(req.body);
    const result = await treasuryService.closeCashShift(
      req.user!.id,
      parseFloat(data.physicalCount),
      data.observations,
    );
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'closeCashRegister');
  }
}

// ─── GET /api/v1/treasury/report ─────────────────────────────────────────────

/**
 * Genera el reporte diario global para el admin: todos los turnos del día,
 * ventas por método de pago y egresos totales.
 * Query: { date?: YYYY-MM-DD }  (default: hoy)
 */
export async function getDailyReport(req: Request, res: Response): Promise<Response> {
  try {
    const rawDate = req.query['date'];
    const date = typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : new Date().toISOString().split('T')[0]!;

    const report = await treasuryService.generateDailyReport(date);
    return ok(res, report);
  } catch (err) {
    return handleError(res, err, 'getDailyReport');
  }
}

// ─── GET /api/v1/treasury/shift ──────────────────────────────────────────────

/**
 * Devuelve el turno activo del usuario logueado (si existe).
 * Útil para el frontend en la pantalla de inicio del cajero.
 */
export async function getActiveShift(req: Request, res: Response): Promise<Response> {
  try {
    const shift = await treasuryService.getActiveShiftForUser(req.user!.id);
    return ok(res, shift);
  } catch (err) {
    return handleError(res, err, 'getActiveShift');
  }
}
