/**
 * treasuryService.ts — Módulo 5: Tesorería y Control de Caja
 *
 * Gestión de flujos de efectivo por turno/usuario:
 *   - Apertura de turno con saldo inicial (por usuario, no global)
 *   - Registro de egresos operativos en la caja del turno activo
 *   - Cálculo de Saldo Teórico:
 *       SaldoTeórico = SaldoInicial + ΣVentasEfectivo − ΣEgresosEfectivo
 *   - Arqueo de caja (Cierre de turno): comparación Teórico vs Conteo Físico
 *   - Reporte diario global de todos los turnos y flujos del día
 */

import {
  CashRegisterStatus,
  PaymentMethod,
  SaleStatus,
  TransactionType,
} from '@prisma/client';
import { prisma }  from '../config/prisma';
import { logger }  from '../config/logger';

// ─── Constante configurable ───────────────────────────────────────────────────

/** Umbral a partir del cual una diferencia en el arqueo requiere revisión de Admin. */
const SIGNIFICANT_DIFF_THRESHOLD = parseFloat(
  process.env['TREASURY_DIFF_THRESHOLD'] ?? '10000',
);

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface ExpenseInput {
  amount:        number;
  description:   string;
  category:      string;
  paymentMethod: PaymentMethod;
}

export interface TheoreticalBalanceResult {
  openingBalance:      number;
  totalCashSales:      number;
  totalCashExpenses:   number;
  theoreticalBalance:  number;
}

export interface DailySummaryResult {
  cashRegister: {
    id:             string;
    openedAt:       Date;
    openingBalance: number;
    openedBy:       { id: string; name: string };
    status:         CashRegisterStatus;
  };
  sales: {
    breakdown:          Array<{ paymentMethod: PaymentMethod; total: number; count: number }>;
    totalSales:         number;
    totalCashSales:     number;
    totalCardSales:     number;
    totalTransferSales: number;
    count:              number;
  };
  expenses: {
    total:        number;
    cashExpenses: number;
    count:        number;
    items:        Array<{
      id:            string;
      amount:        number;
      description:   string;
      category:      string;
      paymentMethod: PaymentMethod;
      timestamp:     Date;
    }>;
  };
  theoreticalBalance: number;
  formula:            string;
}

export interface CloseShiftResult {
  cashRegister: {
    id:                     string;
    openedAt:               Date;
    closedAt:               Date;
    openedBy:               { id: string; name: string };
    closedBy:               { id: string; name: string };
    openingBalance:         number;
    closingBalance:         number;
    expectedClosingBalance: number;
    difference:             number;
    status:                 CashRegisterStatus;
    notes:                  string | null;
  };
  arqueo: {
    openingBalance:      number;
    totalCashSales:      number;
    totalCashExpenses:   number;
    theoreticalBalance:  number;
    physicalCount:       number;
    difference:          number;
    differenceAbs:       number;
    differenceStatus:    'CUADRADO' | 'SOBRANTE' | 'FALTANTE';
    requiresAdminReview: boolean;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(value: unknown): number {
  return parseFloat(String(value ?? 0)) || 0;
}

function buildDayRange(date: string): { gte: Date; lte: Date } {
  const d = new Date(date);
  return {
    gte: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0),
    lte: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
  };
}

function buildShiftRange(openedAt: Date, closedAt?: Date | null): { gte: Date; lte: Date } {
  return { gte: openedAt, lte: closedAt ?? new Date() };
}

// ─── Encontrar turno (helper interno) ─────────────────────────────────────────

async function findRegister(userId: string, date?: string) {
  if (date) {
    const range = buildDayRange(date);
    return prisma.cashRegister.findFirst({
      where:   { openedByUserId: userId, openedAt: range },
      include: { openedBy: { select: { id: true, name: true } } },
      orderBy: { openedAt: 'desc' },
    });
  }
  return prisma.cashRegister.findFirst({
    where:   { openedByUserId: userId, status: CashRegisterStatus.OPEN },
    include: { openedBy: { select: { id: true, name: true } } },
    orderBy: { openedAt: 'desc' },
  });
}

// ─── API pública ──────────────────────────────────────────────────────────────

/** Devuelve el turno OPEN del usuario, o null si no tiene uno activo. */
export async function getActiveShiftForUser(userId: string) {
  return prisma.cashRegister.findFirst({
    where:   { openedByUserId: userId, status: CashRegisterStatus.OPEN },
    include: { openedBy: { select: { id: true, name: true } } },
    orderBy: { openedAt: 'desc' },
  });
}

// ─── Apertura de turno ────────────────────────────────────────────────────────

/**
 * Abre un nuevo turno para el usuario. Cada usuario tiene a lo sumo un turno OPEN;
 * múltiples usuarios pueden tener turnos simultáneos sin conflicto.
 */
export async function openCashShift(
  userId:         string,
  initialBalance: number,
  notes?:         string,
) {
  const existing = await prisma.cashRegister.findFirst({
    where:  { openedByUserId: userId, status: CashRegisterStatus.OPEN },
    select: { id: true, openedAt: true },
  });

  if (existing) {
    const fecha = existing.openedAt.toLocaleDateString('es-CO');
    throw new Error(
      `Ya tienes un turno de caja abierto (ID: ${existing.id}, desde ${fecha}). ` +
      'Ciérralo antes de abrir uno nuevo.',
    );
  }

  const register = await prisma.cashRegister.create({
    data: {
      openedByUserId: userId,
      openingBalance: initialBalance.toFixed(2),
      status:         CashRegisterStatus.OPEN,
      openedAt:       new Date(),
      notes,
    },
    include: { openedBy: { select: { id: true, name: true, email: true } } },
  });

  logger.info(
    `[treasuryService] Turno abierto: ${register.id} — $${initialBalance} — usuario ${userId}`,
  );
  return register;
}

// ─── Registro de egreso operativo ─────────────────────────────────────────────

/**
 * Registra un egreso (gasto operativo) en el turno activo del usuario.
 * Si paymentMethod = CASH, reduce el saldo teórico de la caja.
 */
export async function registerExpenseTransaction(
  userId: string,
  data:   ExpenseInput,
) {
  const register = await getActiveShiftForUser(userId);

  if (!register) {
    throw new Error(
      'No tienes un turno de caja abierto. Abre un turno antes de registrar egresos.',
    );
  }

  const tx = await prisma.financialTransaction.create({
    data: {
      cashRegisterId:    register.id,
      type:              TransactionType.EXPENSE,
      amount:            data.amount.toFixed(2),
      description:       data.description.trim(),
      category:          data.category.trim(),
      paymentMethod:     data.paymentMethod,
      performedByUserId: userId,
    },
    include: { performedBy: { select: { id: true, name: true } } },
  });

  logger.info(
    `[treasuryService] Egreso $${data.amount} "${data.category}" en caja ${register.id}`,
  );
  return tx;
}

// ─── Cálculo de Saldo Teórico ─────────────────────────────────────────────────

/**
 * Fórmula:
 *   SaldoTeórico = SaldoInicial + ΣVentasEfectivo − ΣEgresosEfectivo
 *
 * Ventas: tabla `Sale` (paymentMethod=CASH, status=COMPLETED, userId, período del turno).
 * Egresos: tabla `FinancialTransaction` (type=EXPENSE, paymentMethod=CASH, esta caja).
 *
 * Acepta `cachedRegister` para evitar una consulta extra cuando el registro ya fue cargado.
 */
export async function calculateTheoreticalBalance(
  userId:          string,
  cashRegisterId:  string,
  cachedRegister?: { openingBalance: unknown; openedAt: Date; closedAt?: Date | null },
): Promise<TheoreticalBalanceResult> {
  let openedAt: Date;
  let closedAt: Date | null | undefined;
  let rawOpeningBalance: unknown;

  if (cachedRegister) {
    openedAt           = cachedRegister.openedAt;
    closedAt           = cachedRegister.closedAt;
    rawOpeningBalance  = cachedRegister.openingBalance;
  } else {
    const found = await prisma.cashRegister.findUnique({
      where:  { id: cashRegisterId },
      select: { openingBalance: true, openedAt: true, closedAt: true },
    });
    if (!found) throw new Error('Caja no encontrada');
    openedAt          = found.openedAt;
    closedAt          = found.closedAt;
    rawOpeningBalance = found.openingBalance;
  }

  const shiftRange = buildShiftRange(openedAt, closedAt);

  const [cashSalesAgg, expensesAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: {
        userId,
        paymentMethod: PaymentMethod.CASH,
        status:        SaleStatus.COMPLETED,
        createdAt:     shiftRange,
      },
      _sum: { totalAmount: true },
    }),
    prisma.financialTransaction.aggregate({
      where: {
        cashRegisterId,
        type:          TransactionType.EXPENSE,
        paymentMethod: PaymentMethod.CASH,
      },
      _sum: { amount: true },
    }),
  ]);

  const openingBalance    = toNumber(rawOpeningBalance);
  const totalCashSales    = toNumber(cashSalesAgg._sum.totalAmount);
  const totalCashExpenses = toNumber(expensesAgg._sum.amount);

  // SaldoTeórico = SaldoInicial + VentasEfectivo − EgresosEfectivo
  const theoreticalBalance = openingBalance + totalCashSales - totalCashExpenses;

  return { openingBalance, totalCashSales, totalCashExpenses, theoreticalBalance };
}

// ─── Resumen del turno ────────────────────────────────────────────────────────

/**
 * Resumen completo del turno activo o del día indicado.
 * El `userId` ya viene resuelto desde el controlador
 * (admin puede pasar el userId de otro cajero, seller siempre el suyo).
 */
export async function getDailyShiftSummary(
  userId: string,
  date?:  string,
): Promise<DailySummaryResult> {
  const register = await findRegister(userId, date);

  if (!register) {
    throw new Error('No se encontró turno de caja para los filtros indicados.');
  }

  const shiftRange = buildShiftRange(register.openedAt, register.closedAt);

  const [salesByMethod, expenseTxs, balanceData] = await Promise.all([
    prisma.sale.groupBy({
      by:    ['paymentMethod'],
      where: { userId, status: SaleStatus.COMPLETED, createdAt: shiftRange },
      _sum:  { totalAmount: true },
      _count: { id: true },
    }),
    prisma.financialTransaction.findMany({
      where:   { cashRegisterId: register.id, type: TransactionType.EXPENSE },
      select:  {
        id: true, amount: true, description: true,
        category: true, paymentMethod: true, timestamp: true,
      },
      orderBy: { timestamp: 'desc' },
    }),
    calculateTheoreticalBalance(userId, register.id, register),
  ]);

  const { openingBalance, totalCashSales, totalCashExpenses, theoreticalBalance } = balanceData;

  const totalSales         = salesByMethod.reduce((a, s) => a + toNumber(s._sum.totalAmount), 0);
  const totalCardSales     = toNumber(salesByMethod.find(s => s.paymentMethod === PaymentMethod.CARD)?._sum.totalAmount);
  const totalTransferSales = toNumber(salesByMethod.find(s => s.paymentMethod === PaymentMethod.TRANSFER)?._sum.totalAmount);
  const totalExpenses      = expenseTxs.reduce((a, e) => a + toNumber(e.amount), 0);
  const cashExpenses       = expenseTxs
    .filter(e => e.paymentMethod === PaymentMethod.CASH)
    .reduce((a, e) => a + toNumber(e.amount), 0);

  return {
    cashRegister: {
      id:             register.id,
      openedAt:       register.openedAt,
      openingBalance: parseFloat(openingBalance.toFixed(2)),
      openedBy:       register.openedBy,
      status:         register.status,
    },
    sales: {
      breakdown: salesByMethod.map(s => ({
        paymentMethod: s.paymentMethod,
        total:         parseFloat(toNumber(s._sum.totalAmount).toFixed(2)),
        count:         s._count.id,
      })),
      totalSales:         parseFloat(totalSales.toFixed(2)),
      totalCashSales:     parseFloat(totalCashSales.toFixed(2)),
      totalCardSales:     parseFloat(totalCardSales.toFixed(2)),
      totalTransferSales: parseFloat(totalTransferSales.toFixed(2)),
      count:              salesByMethod.reduce((a, s) => a + s._count.id, 0),
    },
    expenses: {
      total:        parseFloat(totalExpenses.toFixed(2)),
      cashExpenses: parseFloat(cashExpenses.toFixed(2)),
      count:        expenseTxs.length,
      items:        expenseTxs.map(e => ({
        ...e,
        amount: parseFloat(toNumber(e.amount).toFixed(2)),
      })),
    },
    theoreticalBalance: parseFloat(theoreticalBalance.toFixed(2)),
    formula: (
      `$${openingBalance.toFixed(2)} (apertura) ` +
      `+ $${totalCashSales.toFixed(2)} (ventas efectivo) ` +
      `- $${totalCashExpenses.toFixed(2)} (egresos efectivo) ` +
      `= $${theoreticalBalance.toFixed(2)}`
    ),
  };
}

// ─── Cierre de turno (Arqueo de Caja) ────────────────────────────────────────

/**
 * Realiza el arqueo y cierra el turno activo del usuario.
 *
 * Estado de la diferencia:
 *   CUADRADO → |diff| < $0.01
 *   SOBRANTE → physicalCount > theoreticalBalance
 *   FALTANTE → physicalCount < theoreticalBalance
 *
 * `requiresAdminReview` se activa cuando la diferencia supera TREASURY_DIFF_THRESHOLD.
 */
export async function closeCashShift(
  userId:        string,
  physicalCount: number,
  observations?: string,
): Promise<CloseShiftResult> {
  const register = await prisma.cashRegister.findFirst({
    where:   { openedByUserId: userId, status: CashRegisterStatus.OPEN },
    include: { openedBy: { select: { id: true, name: true } } },
    orderBy: { openedAt: 'desc' },
  });

  if (!register) {
    throw new Error('No tienes un turno de caja abierto para cerrar.');
  }

  const { openingBalance, totalCashSales, totalCashExpenses, theoreticalBalance } =
    await calculateTheoreticalBalance(userId, register.id, register);

  const difference = physicalCount - theoreticalBalance;

  const differenceStatus: 'CUADRADO' | 'SOBRANTE' | 'FALTANTE' =
    Math.abs(difference) < 0.01 ? 'CUADRADO'
      : difference > 0 ? 'SOBRANTE'
        : 'FALTANTE';

  const requiresAdminReview = Math.abs(difference) > SIGNIFICANT_DIFF_THRESHOLD;

  const mergedNotes = observations
    ? `${register.notes ? register.notes + ' | ' : ''}Cierre: ${observations}`
    : register.notes ?? undefined;

  const closed = await prisma.cashRegister.update({
    where: { id: register.id },
    data: {
      closedByUserId:         userId,
      closingBalance:         physicalCount.toFixed(2),
      expectedClosingBalance: theoreticalBalance.toFixed(2),
      difference:             difference.toFixed(2),
      status:                 CashRegisterStatus.CLOSED,
      closedAt:               new Date(),
      notes:                  mergedNotes,
    },
    include: {
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
    },
  });

  logger.info(
    `[treasuryService] Turno cerrado: ${register.id} — ` +
    `${differenceStatus} — diferencia: $${difference.toFixed(2)}` +
    (requiresAdminReview ? ' ⚠ REQUIERE REVISIÓN ADMIN' : ''),
  );

  return {
    cashRegister: {
      id:                     closed.id,
      openedAt:               closed.openedAt,
      closedAt:               closed.closedAt!,
      openedBy:               closed.openedBy,
      closedBy:               closed.closedBy!,
      openingBalance:         parseFloat(toNumber(closed.openingBalance).toFixed(2)),
      closingBalance:         parseFloat(toNumber(closed.closingBalance).toFixed(2)),
      expectedClosingBalance: parseFloat(toNumber(closed.expectedClosingBalance).toFixed(2)),
      difference:             parseFloat(toNumber(closed.difference).toFixed(2)),
      status:                 closed.status,
      notes:                  closed.notes,
    },
    arqueo: {
      openingBalance:      parseFloat(openingBalance.toFixed(2)),
      totalCashSales:      parseFloat(totalCashSales.toFixed(2)),
      totalCashExpenses:   parseFloat(totalCashExpenses.toFixed(2)),
      theoreticalBalance:  parseFloat(theoreticalBalance.toFixed(2)),
      physicalCount:       parseFloat(physicalCount.toFixed(2)),
      difference:          parseFloat(difference.toFixed(2)),
      differenceAbs:       parseFloat(Math.abs(difference).toFixed(2)),
      differenceStatus,
      requiresAdminReview,
    },
  };
}

// ─── Reporte diario global (Admin) ────────────────────────────────────────────

/**
 * Resumen del día para todos los turnos: cajas abiertas/cerradas, ventas globales y egresos.
 * Diseñado para la vista de reportes del administrador.
 */
export async function generateDailyReport(date: string) {
  const range = buildDayRange(date);

  const [registers, salesByMethod, expensesAgg] = await Promise.all([
    prisma.cashRegister.findMany({
      where:   { openedAt: range },
      include: {
        openedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
        _count:   { select: { transactions: true } },
      },
      orderBy: { openedAt: 'asc' },
    }),
    prisma.sale.groupBy({
      by:    ['paymentMethod'],
      where: { status: SaleStatus.COMPLETED, createdAt: range },
      _sum:  { totalAmount: true },
      _count: { id: true },
    }),
    prisma.financialTransaction.aggregate({
      where: { type: TransactionType.EXPENSE, timestamp: range },
      _sum:  { amount: true },
    }),
  ]);

  const totalSales    = salesByMethod.reduce((a, s) => a + toNumber(s._sum.totalAmount), 0);
  const totalExpenses = toNumber(expensesAgg._sum.amount);

  return {
    date,
    registers: registers.map(r => ({
      id:               r.id,
      openedBy:         r.openedBy,
      closedBy:         r.closedBy,
      status:           r.status,
      openedAt:         r.openedAt,
      closedAt:         r.closedAt,
      openingBalance:   parseFloat(toNumber(r.openingBalance).toFixed(2)),
      closingBalance:   r.closingBalance ? parseFloat(toNumber(r.closingBalance).toFixed(2)) : null,
      difference:       r.difference     ? parseFloat(toNumber(r.difference).toFixed(2))     : null,
      transactionCount: r._count.transactions,
    })),
    salesSummary: {
      breakdown: salesByMethod.map(s => ({
        paymentMethod: s.paymentMethod,
        total:         parseFloat(toNumber(s._sum.totalAmount).toFixed(2)),
        count:         s._count.id,
      })),
      totalSales: parseFloat(totalSales.toFixed(2)),
    },
    expensesSummary: {
      totalExpenses: parseFloat(totalExpenses.toFixed(2)),
    },
    netCashFlow: parseFloat((totalSales - totalExpenses).toFixed(2)),
  };
}
