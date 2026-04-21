import { z } from 'zod';
import { MovementType, PaymentMethod, SaleStatus } from '@prisma/client';

// ─── Helpers ────────────────────────────────────────────────────────────────

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
    message: 'Debe ser un número positivo',
  });

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 1 — INVENTARIO
// ═══════════════════════════════════════════════════════════════════════════

export const createProductSchema = z.object({
  skuInternal: z.string().min(3).max(60).optional(),
  barcodeExternal: z.string().max(50).optional(),
  partNumberOEM: z.string().min(1).max(100),

  brandId: z.string().cuid({ message: 'brandId inválido' }),
  categoryId: z.string().cuid({ message: 'categoryId inválido' }),

  nameCommercial: z.string().min(2).max(200),
  descriptionTech: z.string().max(2000).optional(),

  compatibleModels: z.array(z.string().min(1)).default([]),

  locationBin: z
    .string()
    .min(1)
    .max(30)
    .regex(/^[A-Z0-9\-]+$/i, 'Formato inválido. Ej: EST-A-04'),

  imageKey: z.string().max(500).optional(),

  costPriceAvg: decimalString,
  salePriceBase: decimalString.optional(),
  taxRate: decimalString.optional(),

  stockQuantity: z.number().int().min(0).default(0),
  minStockLevel: z.number().int().min(0).default(5),
  maxStockLevel: z.number().int().positive().optional(),

  isActive: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial().omit({
  skuInternal: true,
});

export const adjustStockSchema = z.object({
  quantity: z
    .number()
    .int()
    .refine((v) => v !== 0, { message: 'La cantidad no puede ser 0' }),

  type: z.enum(
    Object.values(MovementType) as [MovementType, ...MovementType[]],
    { error: `Tipo inválido. Valores: ${Object.values(MovementType).join(', ')}` },
  ),

  reason: z.string().min(3).max(500),
  referenceDoc: z.string().max(100).optional(),
});

export const getProductsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  brandId: z.string().optional(),
  categoryId: z.string().optional(),
  minStock: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  sortBy: z
    .string()
    .regex(/^\w+:(asc|desc)$/, 'Formato: campo:asc|desc')
    .optional()
    .default('createdAt:desc'),
});

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 2 — VENTAS / POS
// ═══════════════════════════════════════════════════════════════════════════

export const createCustomerSchema = z.object({
  name: z.string().min(2).max(200),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  identificationNumber: z.string().max(30).optional(),
  address: z.string().max(300).optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const searchCustomersQuerySchema = z.object({
  query: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Ítem individual dentro de una venta
const saleItemSchema = z.object({
  productId: z.string().min(1, 'productId requerido'),
  quantity: z.number().int().positive('La cantidad debe ser mayor a 0'),
  // Si se omite, se usa salePriceBase del producto en BD
  unitPrice: z.number().positive().optional(),
  // Descuento en pesos por ítem (no porcentaje)
  discountPerItem: z.number().min(0).default(0),
});

export const createSaleSchema = z.object({
  // Si viene null/undefined → venta a Cliente Genérico
  customerId: z.string().optional(),

  paymentMethod: z.enum(
    Object.values(PaymentMethod) as [PaymentMethod, ...PaymentMethod[]],
    { error: `Método de pago inválido. Valores: ${Object.values(PaymentMethod).join(', ')}` },
  ),

  // Descuento global en pesos aplicado sobre el subtotal
  discountAmount: z.number().min(0).default(0),

  notes: z.string().max(1000).optional(),

  items: z
    .array(saleItemSchema)
    .min(1, 'La venta debe tener al menos un ítem'),
});

export const listSalesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  customerId: z.string().optional(),
  status: z
    .enum(Object.values(SaleStatus) as [SaleStatus, ...SaleStatus[]])
    .optional(),
  paymentMethod: z
    .enum(Object.values(PaymentMethod) as [PaymentMethod, ...PaymentMethod[]])
    .optional(),
  sortBy: z
    .string()
    .regex(/^\w+:(asc|desc)$/, 'Formato: campo:asc|desc')
    .optional()
    .default('createdAt:desc'),
});

export const cancelSaleSchema = z.object({
  reason: z.string().min(5).max(500),
});

// ─── Tipos exportados ────────────────────────────────────────────────────────

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type GetProductsQuery = z.infer<typeof getProductsQuerySchema>;

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type SearchCustomersQuery = z.infer<typeof searchCustomersQuerySchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
export type CancelSaleInput = z.infer<typeof cancelSaleSchema>;
