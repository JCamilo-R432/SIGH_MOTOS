import { z } from 'zod';
import { MovementType } from '@prisma/client';

// ─── Helpers ────────────────────────────────────────────────────────────────

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
    message: 'Debe ser un número positivo',
  });

// ─── Producto ────────────────────────────────────────────────────────────────

export const createProductSchema = z.object({
  // SKU es opcional: si no se envía se genera automáticamente
  skuInternal: z.string().min(3).max(60).optional(),
  barcodeExternal: z.string().max(50).optional(),
  partNumberOEM: z.string().min(1).max(100),

  brandId: z.string().cuid({ message: 'brandId inválido' }),
  categoryId: z.string().cuid({ message: 'categoryId inválido' }),

  nameCommercial: z.string().min(2).max(200),
  descriptionTech: z.string().max(2000).optional(),

  // Array de strings con nombres de motos compatibles
  compatibleModels: z.array(z.string().min(1)).default([]),

  // Ubicación física en bodega — obligatoria
  locationBin: z
    .string()
    .min(1)
    .max(30)
    .regex(/^[A-Z0-9\-]+$/i, 'Formato inválido. Ej: EST-A-04'),

  imageKey: z.string().max(500).optional(),

  costPriceAvg: decimalString,
  // Si se omite, se calcula desde el margen de la categoría
  salePriceBase: decimalString.optional(),
  taxRate: decimalString.optional(),

  stockQuantity: z.number().int().min(0).default(0),
  minStockLevel: z.number().int().min(0).default(5),
  maxStockLevel: z.number().int().positive().optional(),

  isActive: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial().omit({
  skuInternal: true, // El SKU no se puede cambiar una vez asignado
});

// ─── Ajuste de stock ─────────────────────────────────────────────────────────

export const adjustStockSchema = z.object({
  // != 0; el tipo de movimiento determina si suma o resta
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

// ─── Query params para listado ───────────────────────────────────────────────

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

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type GetProductsQuery = z.infer<typeof getProductsQuerySchema>;
