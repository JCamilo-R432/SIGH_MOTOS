import { CashRegisterStatus, TransactionType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toFloat(value: unknown): number {
  return parseFloat(String(value ?? 0)) || 0;
}

// ─── Abrir caja ───────────────────────────────────────────────────────────────

export async function openCashRegister(
  userId: string,
  openingBalance: number,
  notes?: string,
) {
  const existing = await prisma.cashRegister.findFirst({
    where: { status: CashRegisterStatus.OPEN },
    select: { id: true, openedAt: true, openedBy: { select: { name: true } } },
  });

  if (existing) {
    throw new Error(
      `Ya hay una caja abierta (ID: ${existing.id}, abierta por ${existing.openedBy.name}). Ciérrala antes de abrir una nueva.`,
    );
  }

  const register = await prisma.cashRegister.create({
    data: {
      openedByUserId: userId,
      openingBalance: openingBalance.toFixed(2),
      status: CashRegisterStatus.OPEN,
      openedAt: new Date(),
      notes,
    },
    include: { openedBy: { select: { id: true, name: true, email: true } } },
  });

  logger.info(`[cashRegisterService] Caja abierta: ${register.id} — $${openingBalance}`);
  return register;
}

// ─── Cerrar caja ──────────────────────────────────────────────────────────────

export async function closeCashRegister(
  cashRegisterId: string,
  closingBalance: number,
  userId: string,
  notes?: string,
) {
  const register = await prisma.cashRegister.findUnique({
    where: { id: cashRegisterId },
    select: { id: true, status: true, openingBalance: true, notes: true },
  });

  if (!register) throw new Error('Caja no encontrada');
  if (register.status === CashRegisterStatus.CLOSED) {
    throw new Error('Esta caja ya fue cerrada');
  }

  // Calcular entradas y salidas mediante agregaciones (eficiente, sin cargar todos los registros)
  const [incomeAgg, expenseAgg] = await Promise.all([
    prisma.financialTransaction.aggregate({
      where: {
        cashRegisterId,
        type: { in: [TransactionType.INCOME, TransactionType.PAYMENT_RECEIVED] },
      },
      _sum: { amount: true },
    }),
    prisma.financialTransaction.aggregate({
      where: {
        cashRegisterId,
        type: {
          in: [
            TransactionType.EXPENSE,
            TransactionType.WITHDRAWAL,
            TransactionType.DEPOSIT,
            TransactionType.PAYMENT_MADE,
          ],
        },
      },
      _sum: { amount: true },
    }),
  ]);

  const totalIncome  = toFloat(incomeAgg._sum.amount);
  const totalExpense = toFloat(expenseAgg._sum.amount);
  const expectedBalance =
    toFloat(register.openingBalance) + totalIncome - totalExpense;
  const difference = closingBalance - expectedBalance;

  const closed = await prisma.cashRegister.update({
    where: { id: cashRegisterId },
    data: {
      closedByUserId:         userId,
      closingBalance:         closingBalance.toFixed(2),
      expectedClosingBalance: expectedBalance.toFixed(2),
      difference:             difference.toFixed(2),
      status:                 CashRegisterStatus.CLOSED,
      closedAt:               new Date(),
      notes:                  notes ?? register.notes,
    },
    include: {
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      _count:   { select: { transactions: true } },
    },
  });

  logger.info(
    `[cashRegisterService] Caja cerrada: ${cashRegisterId} — diferencia: $${difference.toFixed(2)}`,
  );

  return {
    ...closed,
    summary: {
      openingBalance:         toFloat(register.openingBalance),
      totalIncome:            parseFloat(totalIncome.toFixed(2)),
      totalExpense:           parseFloat(totalExpense.toFixed(2)),
      expectedClosingBalance: parseFloat(expectedBalance.toFixed(2)),
      closingBalance:         closingBalance,
      difference:             parseFloat(difference.toFixed(2)),
      differenceStatus:
        difference === 0
          ? ('EXACT' as const)
          : difference > 0
            ? ('SURPLUS' as const)
            : ('SHORTAGE' as const),
    },
  };
}

// ─── Obtener caja abierta ─────────────────────────────────────────────────────

export async function getCurrentOpenRegister() {
  return prisma.cashRegister.findFirst({
    where: { status: CashRegisterStatus.OPEN },
    include: {
      openedBy: { select: { id: true, name: true } },
      _count: { select: { transactions: true } },
    },
  });
}

// ─── Resumen de caja ──────────────────────────────────────────────────────────

export async function getCashRegisterSummary(cashRegisterId: string) {
  const register = await prisma.cashRegister.findUnique({
    where: { id: cashRegisterId },
    include: {
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
    },
  });
  if (!register) throw new Error('Caja no encontrada');

  const byType = await prisma.financialTransaction.groupBy({
    by: ['type'],
    where: { cashRegisterId },
    _sum: { amount: true },
    _count: { id: true },
  });

  const transactions = await prisma.financialTransaction.findMany({
    where: { cashRegisterId },
    orderBy: { timestamp: 'desc' },
    take: 20,
    include: { performedBy: { select: { id: true, name: true } } },
  });

  return {
    register,
    breakdown: byType.map((r) => ({
      type: r.type,
      total: toFloat(r._sum.amount),
      count: r._count.id,
    })),
    recentTransactions: transactions,
  };
}

// ─── Historial de cajas ───────────────────────────────────────────────────────

export async function listCashRegisters(limit = 20) {
  return prisma.cashRegister.findMany({
    orderBy: { openedAt: 'desc' },
    take: limit,
    include: {
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      _count: { select: { transactions: true } },
    },
  });
}
