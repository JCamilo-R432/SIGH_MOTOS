import { AccountStatus, PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import {
  createPaymentReceivedTransaction,
  createPaymentMadeTransaction,
} from './financialTransactionService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toFloat(value: unknown): number {
  return parseFloat(String(value ?? 0)) || 0;
}

function resolveAccountStatus(
  paidAmount: number,
  totalDebt: number,
  dueDate?: Date | null,
): AccountStatus {
  if (paidAmount >= totalDebt) return AccountStatus.PAID;
  if (paidAmount > 0) return AccountStatus.PARTIALLY_PAID;
  if (dueDate && dueDate < new Date()) return AccountStatus.OVERDUE;
  return AccountStatus.PENDING;
}

// ─── CUENTAS POR COBRAR (CxC) ─────────────────────────────────────────────────

export async function createReceivableFromSale(
  saleId: string,
  customerId: string,
  totalAmount: number,
  dueDate?: Date,
) {
  const existing = await prisma.accountReceivable.findUnique({ where: { saleId } });
  if (existing) return existing;

  const receivable = await prisma.accountReceivable.create({
    data: {
      saleId,
      customerId,
      totalDebt:        totalAmount.toFixed(2),
      paidAmount:       '0.00',
      remainingBalance: totalAmount.toFixed(2),
      dueDate,
      status: AccountStatus.PENDING,
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      sale:     { select: { id: true, saleNumber: true } },
    },
  });

  logger.info(`[debtService] CxC creada: ${receivable.id} — $${totalAmount} cliente ${customerId}`);
  return receivable;
}

// ─── CUENTAS POR PAGAR (CxP) ─────────────────────────────────────────────────

export async function createPayableFromPurchase(
  purchaseOrderId: string,
  supplierId: string,
  totalAmount: number,
  dueDate?: Date,
) {
  const existing = await prisma.accountPayable.findUnique({ where: { purchaseOrderId } });
  if (existing) return existing;

  const payable = await prisma.accountPayable.create({
    data: {
      purchaseOrderId,
      supplierId,
      totalDebt:        totalAmount.toFixed(2),
      paidAmount:       '0.00',
      remainingBalance: totalAmount.toFixed(2),
      dueDate,
      status: AccountStatus.PENDING,
    },
    include: {
      supplier:      { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, orderNumber: true } },
    },
  });

  logger.info(`[debtService] CxP creada: ${payable.id} — $${totalAmount} proveedor ${supplierId}`);
  return payable;
}

// ─── REGISTRAR ABONO / PAGO ───────────────────────────────────────────────────

export interface RecordPaymentInput {
  accountReceivableId?: string;
  accountPayableId?:    string;
  amount:               number;
  paymentMethod:        PaymentMethod;
  referenceDoc?:        string;
  note?:                string;
  cashRegisterId?:      string;
}

export async function recordPayment(data: RecordPaymentInput, userId: string) {
  const isReceivable = Boolean(data.accountReceivableId);
  const isPayable    = Boolean(data.accountPayableId);

  if (isReceivable === isPayable) {
    throw new Error(
      'Debe especificar exactamente uno: accountReceivableId o accountPayableId',
    );
  }
  if (data.amount <= 0) throw new Error('El monto debe ser mayor que cero');

  if (isReceivable) {
    return recordReceivablePayment(data, userId);
  } else {
    return recordPayablePayment(data, userId);
  }
}

async function recordReceivablePayment(data: RecordPaymentInput, userId: string) {
  const cxcId = data.accountReceivableId!;
  const cxc = await prisma.accountReceivable.findUnique({
    where: { id: cxcId },
    include: { sale: { select: { saleNumber: true } }, customer: { select: { name: true } } },
  });
  if (!cxc) throw new Error('Cuenta por cobrar no encontrada');
  if (cxc.status === AccountStatus.PAID) throw new Error('Esta deuda ya está saldada');

  const currentPaid   = toFloat(cxc.paidAmount);
  const totalDebt     = toFloat(cxc.totalDebt);
  const newPaid       = currentPaid + data.amount;

  if (newPaid > totalDebt + 0.01) {
    throw new Error(
      `El abono ($${data.amount}) supera la deuda restante ($${(totalDebt - currentPaid).toFixed(2)})`,
    );
  }

  const newRemaining = Math.max(0, totalDebt - newPaid);
  const newStatus    = resolveAccountStatus(newPaid, totalDebt, cxc.dueDate);

  const [paymentRecord] = await prisma.$transaction([
    prisma.paymentRecord.create({
      data: {
        accountReceivableId: cxcId,
        amount:              data.amount.toFixed(2),
        paymentMethod:       data.paymentMethod,
        referenceDoc:        data.referenceDoc,
        note:                data.note,
        performedByUserId:   userId,
      },
    }),
    prisma.accountReceivable.update({
      where: { id: cxcId },
      data: {
        paidAmount:       newPaid.toFixed(2),
        remainingBalance: newRemaining.toFixed(2),
        status:           newStatus,
      },
    }),
  ]);

  const description = `Abono CxC — ${cxc.customer.name} (Venta ${cxc.sale.saleNumber})`;
  void createPaymentReceivedTransaction(
    cxcId, data.amount, data.paymentMethod, userId, description, data.cashRegisterId,
  ).catch((err: unknown) => logger.error('[debtService] Error al crear transacción CxC', err));

  logger.info(
    `[debtService] Abono CxC ${cxcId}: $${data.amount} — saldo restante: $${newRemaining.toFixed(2)}`,
  );
  return {
    paymentRecord,
    updatedAccount: { id: cxcId, newPaid, newRemaining, newStatus },
  };
}

async function recordPayablePayment(data: RecordPaymentInput, userId: string) {
  const cxpId = data.accountPayableId!;
  const cxp = await prisma.accountPayable.findUnique({
    where: { id: cxpId },
    include: {
      purchaseOrder: { select: { orderNumber: true } },
      supplier:      { select: { name: true } },
    },
  });
  if (!cxp) throw new Error('Cuenta por pagar no encontrada');
  if (cxp.status === AccountStatus.PAID) throw new Error('Esta deuda ya está saldada');

  const currentPaid = toFloat(cxp.paidAmount);
  const totalDebt   = toFloat(cxp.totalDebt);
  const newPaid     = currentPaid + data.amount;

  if (newPaid > totalDebt + 0.01) {
    throw new Error(
      `El pago ($${data.amount}) supera la deuda restante ($${(totalDebt - currentPaid).toFixed(2)})`,
    );
  }

  const newRemaining = Math.max(0, totalDebt - newPaid);
  const newStatus    = resolveAccountStatus(newPaid, totalDebt, cxp.dueDate);

  const [paymentRecord] = await prisma.$transaction([
    prisma.paymentRecord.create({
      data: {
        accountPayableId:  cxpId,
        amount:            data.amount.toFixed(2),
        paymentMethod:     data.paymentMethod,
        referenceDoc:      data.referenceDoc,
        note:              data.note,
        performedByUserId: userId,
      },
    }),
    prisma.accountPayable.update({
      where: { id: cxpId },
      data: {
        paidAmount:       newPaid.toFixed(2),
        remainingBalance: newRemaining.toFixed(2),
        status:           newStatus,
      },
    }),
  ]);

  const description = `Pago CxP — ${cxp.supplier.name} (OC ${cxp.purchaseOrder.orderNumber})`;
  void createPaymentMadeTransaction(
    cxpId, data.amount, data.paymentMethod, userId, description, data.cashRegisterId,
  ).catch((err: unknown) => logger.error('[debtService] Error al crear transacción CxP', err));

  logger.info(
    `[debtService] Pago CxP ${cxpId}: $${data.amount} — saldo restante: $${newRemaining.toFixed(2)}`,
  );
  return {
    paymentRecord,
    updatedAccount: { id: cxpId, newPaid, newRemaining, newStatus },
  };
}

// ─── CONSULTAS ────────────────────────────────────────────────────────────────

export interface DebtFilters {
  status?:     AccountStatus;
  customerId?: string;
  supplierId?: string;
  overdueOnly?: boolean;
  limit?:      number;
}

export async function getReceivables(filters: DebtFilters = {}) {
  const where: Prisma.AccountReceivableWhereInput = {};
  if (filters.status)      where.status = filters.status;
  if (filters.customerId)  where.customerId = filters.customerId;
  if (filters.overdueOnly) where.dueDate = { lt: new Date() };

  const items = await prisma.accountReceivable.findMany({
    where,
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    take: filters.limit ?? 100,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      sale:     { select: { id: true, saleNumber: true, createdAt: true } },
      _count:   { select: { payments: true } },
    },
  });

  const totals = await prisma.accountReceivable.aggregate({
    where,
    _sum: { totalDebt: true, paidAmount: true, remainingBalance: true },
    _count: { id: true },
  });

  return {
    items,
    summary: {
      count:           totals._count.id,
      totalDebt:       toFloat(totals._sum.totalDebt),
      totalPaid:       toFloat(totals._sum.paidAmount),
      totalRemaining:  toFloat(totals._sum.remainingBalance),
    },
  };
}

export async function getPayables(filters: DebtFilters = {}) {
  const where: Prisma.AccountPayableWhereInput = {};
  if (filters.status)      where.status = filters.status;
  if (filters.supplierId)  where.supplierId = filters.supplierId;
  if (filters.overdueOnly) where.dueDate = { lt: new Date() };

  const items = await prisma.accountPayable.findMany({
    where,
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    take: filters.limit ?? 100,
    include: {
      supplier:      { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, orderNumber: true, createdAt: true } },
      _count:        { select: { payments: true } },
    },
  });

  const totals = await prisma.accountPayable.aggregate({
    where,
    _sum: { totalDebt: true, paidAmount: true, remainingBalance: true },
    _count: { id: true },
  });

  return {
    items,
    summary: {
      count:          totals._count.id,
      totalDebt:      toFloat(totals._sum.totalDebt),
      totalPaid:      toFloat(totals._sum.paidAmount),
      totalRemaining: toFloat(totals._sum.remainingBalance),
    },
  };
}

/** Marca como OVERDUE las deudas cuya fecha de vencimiento ya pasó. */
export async function updateOverdueStatuses() {
  const now = new Date();

  const [updatedCxC, updatedCxP] = await Promise.all([
    prisma.accountReceivable.updateMany({
      where: {
        status:  { in: [AccountStatus.PENDING, AccountStatus.PARTIALLY_PAID] },
        dueDate: { lt: now },
      },
      data: { status: AccountStatus.OVERDUE },
    }),
    prisma.accountPayable.updateMany({
      where: {
        status:  { in: [AccountStatus.PENDING, AccountStatus.PARTIALLY_PAID] },
        dueDate: { lt: now },
      },
      data: { status: AccountStatus.OVERDUE },
    }),
  ]);

  logger.info(
    `[debtService] Vencidas actualizadas — CxC: ${updatedCxC.count}, CxP: ${updatedCxP.count}`,
  );
  return { updatedReceivables: updatedCxC.count, updatedPayables: updatedCxP.count };
}
