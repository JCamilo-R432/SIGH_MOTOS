import { PaymentMethod, TransactionType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { getCurrentOpenRegister } from './cashRegisterService';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CreateTransactionInput {
  type:          TransactionType;
  amount:        number;
  description:   string;
  category:      string;
  paymentMethod: PaymentMethod;
  referenceType?: string;
  referenceId?:   string;
}

// ─── Crear transacción manual ─────────────────────────────────────────────────

export async function createTransaction(
  data: CreateTransactionInput,
  userId: string,
  cashRegisterId?: string,
) {
  const registerId = cashRegisterId ?? (await getCurrentOpenRegister())?.id;

  if (!registerId) {
    throw new Error('No hay caja abierta. Abre una caja antes de registrar movimientos.');
  }

  if (data.amount <= 0) {
    throw new Error('El monto debe ser mayor que cero');
  }

  const tx = await prisma.financialTransaction.create({
    data: {
      cashRegisterId:   registerId,
      type:             data.type,
      amount:           data.amount.toFixed(2),
      description:      data.description,
      category:         data.category,
      paymentMethod:    data.paymentMethod,
      referenceType:    data.referenceType,
      referenceId:      data.referenceId,
      performedByUserId: userId,
    },
    include: { performedBy: { select: { id: true, name: true } } },
  });

  logger.info(
    `[financialTransactionService] ${data.type} $${data.amount} en caja ${registerId}`,
  );
  return tx;
}

// ─── Crear ingreso automático desde venta ─────────────────────────────────────

export async function createIncomeFromSale(
  saleId: string,
  amount: number,
  paymentMethod: PaymentMethod,
  userId: string,
) {
  const openRegister = await getCurrentOpenRegister();

  if (!openRegister) {
    logger.warn(
      `[financialTransactionService] Venta ${saleId} registrada sin caja abierta — income no registrado`,
    );
    return null;
  }

  return createTransaction(
    {
      type:          TransactionType.INCOME,
      amount,
      description:   `Venta ${saleId}`,
      category:      'Venta',
      paymentMethod,
      referenceType: 'SALE',
      referenceId:   saleId,
    },
    userId,
    openRegister.id,
  );
}

// ─── Crear pago recibido (abono CxC) desde debtService ───────────────────────

export async function createPaymentReceivedTransaction(
  receivableId: string,
  amount: number,
  paymentMethod: PaymentMethod,
  userId: string,
  description: string,
  cashRegisterId?: string,
) {
  const registerId = cashRegisterId ?? (await getCurrentOpenRegister())?.id;

  if (!registerId) {
    logger.warn(
      `[financialTransactionService] Abono CxC ${receivableId} sin caja abierta — no registrado en caja`,
    );
    return null;
  }

  return createTransaction(
    {
      type:          TransactionType.PAYMENT_RECEIVED,
      amount,
      description,
      category:      'Cobro Cartera',
      paymentMethod,
      referenceType: 'ACCOUNT_RECEIVABLE',
      referenceId:   receivableId,
    },
    userId,
    registerId,
  );
}

// ─── Crear pago realizado (pago CxP) desde debtService ───────────────────────

export async function createPaymentMadeTransaction(
  payableId: string,
  amount: number,
  paymentMethod: PaymentMethod,
  userId: string,
  description: string,
  cashRegisterId?: string,
) {
  const registerId = cashRegisterId ?? (await getCurrentOpenRegister())?.id;

  if (!registerId) {
    logger.warn(
      `[financialTransactionService] Pago CxP ${payableId} sin caja abierta — no registrado en caja`,
    );
    return null;
  }

  return createTransaction(
    {
      type:          TransactionType.PAYMENT_MADE,
      amount,
      description,
      category:      'Pago Proveedor',
      paymentMethod,
      referenceType: 'ACCOUNT_PAYABLE',
      referenceId:   payableId,
    },
    userId,
    registerId,
  );
}

// ─── Listar transacciones de una caja ─────────────────────────────────────────

export async function listTransactions(cashRegisterId: string) {
  return prisma.financialTransaction.findMany({
    where: { cashRegisterId },
    orderBy: { timestamp: 'desc' },
    include: { performedBy: { select: { id: true, name: true } } },
  });
}
