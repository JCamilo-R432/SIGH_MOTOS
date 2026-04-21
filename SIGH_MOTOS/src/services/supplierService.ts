import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import type {
  CreateSupplierInput,
  UpdateSupplierInput,
  ListSuppliersQuery,
} from '../utils/validators';

export async function createSupplier(data: CreateSupplierInput) {
  logger.info('Creating supplier', { name: data.name, nit: data.nit });
  return prisma.supplier.create({ data });
}

export async function getSuppliers(query: ListSuppliersQuery) {
  const { page, limit, query: search, isActive } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.SupplierWhereInput = {
    ...(isActive !== undefined && { isActive }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { nit: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [suppliers, total] = await prisma.$transaction([
    prisma.supplier.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
    }),
    prisma.supplier.count({ where }),
  ]);

  return {
    data: suppliers,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getSupplierById(id: string) {
  return prisma.supplier.findUnique({
    where: { id },
    include: {
      // Últimas 15 órdenes del proveedor para historial rápido
      purchaseOrders: {
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          expectedDate: true,
          receivedDate: true,
          createdAt: true,
        },
      },
    },
  });
}

export async function updateSupplier(id: string, data: UpdateSupplierInput) {
  return prisma.supplier.update({ where: { id }, data });
}
