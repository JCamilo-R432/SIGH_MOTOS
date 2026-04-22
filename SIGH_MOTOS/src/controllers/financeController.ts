import { Request, Response } from 'express';
import { AccountStatus, PaymentMethod, TransactionType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import * as cashRegisterService         from '../services/cashRegisterService';
import * as financialTransactionService from '../services/financialTransactionService';
import * as debtService                 from '../services/debtService';
import { logger } from '../config/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

const fail = (res: Response, error: string, status = 400) =>
  res.status(status).json({ success: false, error });

function extractParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] ?? '';
  return param ?? '';
}

function handleError(res: Response, err: unknown, context: string): Response {
  logger.error(`[financeController] ${context}`, { err });

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return fail(res, 'Registro duplicado', 409);
    if (err.code === 'P2025') return fail(res, 'Registro no encontrado', 404);
  }
  if (err instanceof Error) return fail(res, err.message, 400);
  return fail(res, 'Error interno del servidor', 500);
}

// ─── CAJA ─────────────────────────────────────────────────────────────────────

/** POST /api/v1/finance/cash/open */
export async function openRegister(req: Request, res: Response): Promise<Response> {
  try {
    const { openingBalance, notes } = req.body as Record<string, unknown>;
    const balance = typeof openingBalance === 'number' ? openingBalance
      : parseFloat(String(openingBalance ?? 0));

    if (isNaN(balance) || balance < 0) {
      return fail(res, 'openingBalance debe ser un número mayor o igual a cero');
    }

    const register = await cashRegisterService.openCashRegister(
      req.user!.id, balance, typeof notes === 'string' ? notes : undefined,
    );
    return ok(res, register, 201);
  } catch (err) {
    return handleError(res, err, 'openRegister');
  }
}

/** POST /api/v1/finance/cash/close */
export async function closeRegister(req: Request, res: Response): Promise<Response> {
  try {
    const { cashRegisterId, closingBalance, notes } = req.body as Record<string, unknown>;

    if (typeof cashRegisterId !== 'string' || !cashRegisterId) {
      return fail(res, 'cashRegisterId requerido');
    }
    const balance = typeof closingBalance === 'number' ? closingBalance
      : parseFloat(String(closingBalance ?? 0));

    if (isNaN(balance) || balance < 0) {
      return fail(res, 'closingBalance debe ser un número mayor o igual a cero');
    }

    const result = await cashRegisterService.closeCashRegister(
      cashRegisterId, balance, req.user!.id,
      typeof notes === 'string' ? notes : undefined,
    );
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'closeRegister');
  }
}

/** GET /api/v1/finance/cash/current */
export async function getCurrentRegister(_req: Request, res: Response): Promise<Response> {
  try {
    const register = await cashRegisterService.getCurrentOpenRegister();
    if (!register) return ok(res, null);
    return ok(res, register);
  } catch (err) {
    return handleError(res, err, 'getCurrentRegister');
  }
}

/** GET /api/v1/finance/cash/:id/summary */
export async function getRegisterSummary(req: Request, res: Response): Promise<Response> {
  try {
    const id = extractParam(req.params['id']);
    const summary = await cashRegisterService.getCashRegisterSummary(id);
    return ok(res, summary);
  } catch (err) {
    return handleError(res, err, 'getRegisterSummary');
  }
}

/** GET /api/v1/finance/cash */
export async function listRegisters(req: Request, res: Response): Promise<Response> {
  try {
    const limit = parseInt(String(req.query['limit'] ?? '20'), 10);
    const registers = await cashRegisterService.listCashRegisters(Math.min(limit, 100));
    return ok(res, registers);
  } catch (err) {
    return handleError(res, err, 'listRegisters');
  }
}

// ─── TRANSACCIONES ────────────────────────────────────────────────────────────

/** POST /api/v1/finance/transactions */
export async function addTransaction(req: Request, res: Response): Promise<Response> {
  try {
    const body = req.body as Record<string, unknown>;
    const {
      type, amount, description, category, paymentMethod,
      referenceType, referenceId, cashRegisterId,
    } = body;

    if (!Object.values(TransactionType).includes(type as TransactionType)) {
      return fail(res, `type inválido. Valores: ${Object.values(TransactionType).join(', ')}`);
    }
    if (!Object.values(PaymentMethod).includes(paymentMethod as PaymentMethod)) {
      return fail(res, `paymentMethod inválido`);
    }

    const amountNum = parseFloat(String(amount ?? 0));
    if (isNaN(amountNum) || amountNum <= 0) return fail(res, 'amount debe ser mayor que cero');
    if (typeof description !== 'string' || !description.trim()) return fail(res, 'description requerida');
    if (typeof category !== 'string' || !category.trim()) return fail(res, 'category requerida');

    const tx = await financialTransactionService.createTransaction(
      {
        type:          type as TransactionType,
        amount:        amountNum,
        description:   description.trim(),
        category:      category.trim(),
        paymentMethod: paymentMethod as PaymentMethod,
        referenceType: typeof referenceType === 'string' ? referenceType : undefined,
        referenceId:   typeof referenceId   === 'string' ? referenceId   : undefined,
      },
      req.user!.id,
      typeof cashRegisterId === 'string' ? cashRegisterId : undefined,
    );
    return ok(res, tx, 201);
  } catch (err) {
    return handleError(res, err, 'addTransaction');
  }
}

// ─── CUENTAS POR COBRAR / PAGAR ───────────────────────────────────────────────

/** POST /api/v1/finance/receivables — Crear CxC manual desde venta a crédito */
export async function createReceivable(req: Request, res: Response): Promise<Response> {
  try {
    const { saleId, customerId, totalAmount, dueDate } = req.body as Record<string, unknown>;

    if (typeof saleId !== 'string')     return fail(res, 'saleId requerido');
    if (typeof customerId !== 'string') return fail(res, 'customerId requerido');
    const amount = parseFloat(String(totalAmount ?? 0));
    if (isNaN(amount) || amount <= 0) return fail(res, 'totalAmount debe ser mayor que cero');

    const receivable = await debtService.createReceivableFromSale(
      saleId, customerId, amount,
      typeof dueDate === 'string' ? new Date(dueDate) : undefined,
    );
    return ok(res, receivable, 201);
  } catch (err) {
    return handleError(res, err, 'createReceivable');
  }
}

/** POST /api/v1/finance/payables — Crear CxP manual desde compra a crédito */
export async function createPayable(req: Request, res: Response): Promise<Response> {
  try {
    const { purchaseOrderId, supplierId, totalAmount, dueDate } = req.body as Record<string, unknown>;

    if (typeof purchaseOrderId !== 'string') return fail(res, 'purchaseOrderId requerido');
    if (typeof supplierId !== 'string')      return fail(res, 'supplierId requerido');
    const amount = parseFloat(String(totalAmount ?? 0));
    if (isNaN(amount) || amount <= 0) return fail(res, 'totalAmount debe ser mayor que cero');

    const payable = await debtService.createPayableFromPurchase(
      purchaseOrderId, supplierId, amount,
      typeof dueDate === 'string' ? new Date(dueDate) : undefined,
    );
    return ok(res, payable, 201);
  } catch (err) {
    return handleError(res, err, 'createPayable');
  }
}

/** GET /api/v1/finance/debts/receivables */
export async function getReceivables(req: Request, res: Response): Promise<Response> {
  try {
    const { status, customerId, overdueOnly, limit } = req.query;

    const result = await debtService.getReceivables({
      status:      status ? (status as AccountStatus) : undefined,
      customerId:  typeof customerId === 'string' ? customerId : undefined,
      overdueOnly: overdueOnly === 'true',
      limit:       limit ? parseInt(String(limit), 10) : 100,
    });
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'getReceivables');
  }
}

/** GET /api/v1/finance/debts/payables */
export async function getPayables(req: Request, res: Response): Promise<Response> {
  try {
    const { status, supplierId, overdueOnly, limit } = req.query;

    const result = await debtService.getPayables({
      status:      status ? (status as AccountStatus) : undefined,
      supplierId:  typeof supplierId === 'string' ? supplierId : undefined,
      overdueOnly: overdueOnly === 'true',
      limit:       limit ? parseInt(String(limit), 10) : 100,
    });
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'getPayables');
  }
}

/** POST /api/v1/finance/payments */
export async function makePayment(req: Request, res: Response): Promise<Response> {
  try {
    const body = req.body as Record<string, unknown>;
    const {
      accountReceivableId, accountPayableId, amount,
      paymentMethod, referenceDoc, note, cashRegisterId,
    } = body;

    const amountNum = parseFloat(String(amount ?? 0));
    if (isNaN(amountNum) || amountNum <= 0) return fail(res, 'amount debe ser mayor que cero');

    if (!Object.values(PaymentMethod).includes(paymentMethod as PaymentMethod)) {
      return fail(res, `paymentMethod inválido`);
    }

    const result = await debtService.recordPayment(
      {
        accountReceivableId: typeof accountReceivableId === 'string' ? accountReceivableId : undefined,
        accountPayableId:    typeof accountPayableId    === 'string' ? accountPayableId    : undefined,
        amount:              amountNum,
        paymentMethod:       paymentMethod as PaymentMethod,
        referenceDoc:        typeof referenceDoc    === 'string' ? referenceDoc    : undefined,
        note:                typeof note            === 'string' ? note            : undefined,
        cashRegisterId:      typeof cashRegisterId  === 'string' ? cashRegisterId  : undefined,
      },
      req.user!.id,
    );
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'makePayment');
  }
}

/** POST /api/v1/finance/debts/update-overdue */
export async function updateOverdue(_req: Request, res: Response): Promise<Response> {
  try {
    const result = await debtService.updateOverdueStatuses();
    return ok(res, result);
  } catch (err) {
    return handleError(res, err, 'updateOverdue');
  }
}
