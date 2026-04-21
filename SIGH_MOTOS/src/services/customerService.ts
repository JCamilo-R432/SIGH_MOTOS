import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import type { CreateCustomerInput, UpdateCustomerInput, SearchCustomersQuery } from '../utils/validators';

/**
 * Crea un cliente nuevo o actualiza uno existente si ya coincide por
 * identificationNumber o phone. Devuelve siempre el cliente resultante.
 */
export async function createOrUpdateCustomer(data: CreateCustomerInput) {
  // Intentar encontrar cliente existente por identificación o teléfono
  const existing = await prisma.customer.findFirst({
    where: {
      OR: [
        ...(data.identificationNumber
          ? [{ identificationNumber: data.identificationNumber }]
          : []),
        ...(data.phone ? [{ phone: data.phone }] : []),
      ],
    },
  });

  if (existing) {
    logger.info('Updating existing customer', { customerId: existing.id });
    return prisma.customer.update({
      where: { id: existing.id },
      data: {
        name: data.name,
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.identificationNumber !== undefined && {
          identificationNumber: data.identificationNumber,
        }),
        ...(data.address !== undefined && { address: data.address }),
      },
    });
  }

  logger.info('Creating new customer', { name: data.name });
  return prisma.customer.create({ data });
}

export async function getCustomerById(id: string) {
  return prisma.customer.findUnique({
    where: { id },
    include: {
      // Últimas 10 ventas del cliente para resumen rápido en POS
      sales: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          saleNumber: true,
          totalAmount: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });
}

export async function searchCustomers(query: SearchCustomersQuery) {
  const { page, limit, query: search } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.CustomerWhereInput = {
    isActive: true,
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { identificationNumber: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [customers, total] = await prisma.$transaction([
    prisma.customer.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        identificationNumber: true,
        address: true,
        createdAt: true,
      },
    }),
    prisma.customer.count({ where }),
  ]);

  return {
    data: customers,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function updateCustomer(id: string, data: UpdateCustomerInput) {
  return prisma.customer.update({ where: { id }, data });
}
