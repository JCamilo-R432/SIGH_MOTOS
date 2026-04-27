import { z } from 'zod';
import { MovementType, PaymentMethod, SaleStatus, PurchaseOrderStatus } from '@prisma/client';

// ─── Helpers ────────────────────────────────────────────────────────────────

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
    message: 'Debe ser un número positivo',
  });

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 1 — INVENTARIO: MARCAS
// ═══════════════════════════════════════════════════════════════════════════

export const createBrandSchema = z.object({
  name: z.string().min(2).max(100),
  logoUrl: z.string().url({ message: 'URL de logo inválida' }).optional(),
  isActive: z.boolean().default(true),
});

export const updateBrandSchema = createBrandSchema.partial();

export const listBrandsQuerySchema = z.object({
  query: z.string().optional(),
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 1 — INVENTARIO: CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════════════

export const createCategorySchema = z.object({
  name: z.string().min(2).max(100),
  /**
   * slug: si no se envía, el servicio lo genera automáticamente desde el nombre.
   * Formato: sólo minúsculas, números y guiones (ej: "frenos-traseros").
   */
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug: sólo minúsculas, números y guiones')
    .optional(),
  /** Prefijo de 2-6 caracteres alfanuméricos usado para generar SKUs (ej: "FREN"). */
  codePrefix: z
    .string()
    .min(2)
    .max(6)
    .regex(/^[A-Z0-9]+$/i, 'Prefijo: sólo letras y números')
    .transform((v) => v.toUpperCase()),
  marginPercentage: z.number().min(0).max(99.99).default(30),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = createCategorySchema.partial();

export const listCategoriesQuerySchema = z.object({
  query: z.string().optional(),
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 1 — INVENTARIO: PRODUCTOS
// ═══════════════════════════════════════════════════════════════════════════

export const createProductSchema = z.object({
  /**
   * SKU interno único: 3-20 caracteres alfanuméricos + guiones, sin espacios.
   * Si no se envía, el servicio lo genera automáticamente.
   */
  skuInternal: z
    .string()
    .min(3, 'SKU mínimo 3 caracteres')
    .max(20, 'SKU máximo 20 caracteres')
    .regex(/^[A-Z0-9-]+$/i, 'SKU: solo letras, números y guiones (sin espacios)')
    .optional(),

  barcodeExternal: z.string().max(50).optional(),
  partNumberOEM:   z.string().min(1).max(100),

  brandId:    z.string().cuid({ message: 'brandId inválido' }),
  categoryId: z.string().cuid({ message: 'categoryId inválido' }),

  nameCommercial:  z.string().min(2, 'Nombre mínimo 2 caracteres').max(200),
  descriptionTech: z.string().max(2000).optional(),

  /** Array de modelos de moto compatibles. Ej: ["GN 125", "Boxer CT"] */
  compatibleModels: z.array(z.string().min(1)).default([]),

  /** Ubicación física en bodega. Ej: "Estante A-04". Default: "SIN-UBICACION". */
  locationBin: z.string().min(1).max(50).default('SIN-UBICACION'),

  imageKey: z.string().max(500).optional(),

  /** Costo promedio ponderado unitario — debe ser mayor a 0. */
  costPriceAvg:  z.number().positive('El costo debe ser mayor a 0'),
  /** Precio de venta base sin impuesto. Si no se envía, se calcula con el margen de la categoría. */
  salePriceBase: z.number().positive('El precio de venta debe ser mayor a 0').optional(),
  /** Porcentaje de IVA aplicable. Default: 19. */
  taxRate: z.number().min(0).max(100).default(19),

  /** Cantidad inicial en stock (genera movimiento ENTRY si > 0). */
  stockQuantity: z.number().int().min(0, 'El stock no puede ser negativo').default(0),
  /** Nivel mínimo para alertas de reabastecimiento. Default: 5. */
  minStockLevel: z.number().int().min(0).default(5),
  maxStockLevel: z.number().int().positive().optional(),

  isActive: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial().omit({
  skuInternal: true,
});

/**
 * Schema original — conservado para compatibilidad con productController (Módulos 2-6).
 * Requiere indicar el `type` de movimiento explícitamente.
 */
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

/**
 * Schema para PATCH /api/v1/inventory/products/:id/stock
 * El `type` de movimiento se infiere automáticamente del signo de `quantity`:
 *   - quantity > 0 → ADJUSTMENT_POS
 *   - quantity < 0 → ADJUSTMENT_NEG
 * Opcionalmente se puede enviar `unitCost` para recalcular el Costo Promedio Ponderado.
 */
export const patchStockSchema = z.object({
  /** Cantidad a ajustar. Positivo = entrada, negativo = salida. */
  quantity: z
    .number()
    .int()
    .refine((v) => v !== 0, { message: 'La cantidad no puede ser 0' }),
  /** Motivo del ajuste (conteo físico, corrección de error, etc.) */
  reason:       z.string().min(3, 'Motivo mínimo 3 caracteres').max(500),
  referenceDoc: z.string().max(100).optional(),
  /**
   * Costo unitario de las unidades que ingresan (solo para quantity > 0).
   * Si se envía, se recalcula el Costo Promedio Ponderado (WAC).
   * Si se omite en una entrada, el sistema usa el costo promedio actual.
   */
  unitCost: z.number().positive('El costo unitario debe ser mayor a 0').optional(),
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

/**
 * Valida el código enviado por el lector de barras (HID Keyboard Emulation).
 * El frontend envía este valor al endpoint GET /pos/products/by-barcode/:code
 * al detectar el caracter "Enter" (Enter/Return) en el input de escaneo.
 */
export const barcodeSchema = z.object({
  code: z.string().min(1, 'El código de barras no puede estar vacío').max(100),
});

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

const saleItemSchema = z.object({
  productId: z.string().min(1, 'productId requerido'),
  quantity: z.number().int().positive('La cantidad debe ser mayor a 0'),
  unitPrice: z.number().positive().optional(),
  discountPerItem: z.number().min(0).default(0),
});

export const createSaleSchema = z.object({
  customerId: z.string().optional(),
  paymentMethod: z.enum(
    Object.values(PaymentMethod) as [PaymentMethod, ...PaymentMethod[]],
    { error: `Método de pago inválido. Valores: ${Object.values(PaymentMethod).join(', ')}` },
  ),
  discountAmount: z.number().min(0).default(0),
  notes: z.string().max(1000).optional(),
  items: z.array(saleItemSchema).min(1, 'La venta debe tener al menos un ítem'),
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

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 3 — COMPRAS Y PROVEEDORES
// ═══════════════════════════════════════════════════════════════════════════

export const createSupplierSchema = z.object({
  name: z.string().min(2).max(200),
  nit: z.string().max(20).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  address: z.string().max(300).optional(),
  contactPerson: z.string().max(150).optional(),
  paymentTerms: z.string().max(100).optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const listSuppliersQuerySchema = z.object({
  query: z.string().optional(),
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const purchaseOrderItemSchema = z.object({
  productId: z.string().min(1, 'productId requerido'),
  quantityOrdered: z.number().int().positive('La cantidad debe ser mayor a 0'),
  // Costo acordado con el proveedor; puede ser 0 si aún no está definido
  unitCost: z.number().min(0, 'El costo no puede ser negativo'),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().min(1, 'supplierId requerido'),
  expectedDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
  items: z
    .array(purchaseOrderItemSchema)
    .min(1, 'La orden debe tener al menos un ítem'),
});

// Recepción parcial o total — cada ítem indica cuánto llegó ahora
const receiveItemSchema = z.object({
  purchaseOrderItemId: z.string().min(1, 'purchaseOrderItemId requerido'),
  quantityReceived: z
    .number()
    .int()
    .positive('La cantidad recibida debe ser mayor a 0'),
});

export const receivePurchaseOrderSchema = z.object({
  items: z
    .array(receiveItemSchema)
    .min(1, 'Debe recibir al menos un ítem'),
});

export const listPurchaseOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  supplierId: z.string().optional(),
  status: z
    .enum(Object.values(PurchaseOrderStatus) as [PurchaseOrderStatus, ...PurchaseOrderStatus[]])
    .optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  sortBy: z
    .string()
    .regex(/^\w+:(asc|desc)$/, 'Formato: campo:asc|desc')
    .optional()
    .default('createdAt:desc'),
});

export const cancelPurchaseOrderSchema = z.object({
  reason: z.string().min(3).max(500).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 4 — ENTRADAS DE MERCANCÍA (Recepción Física)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ítem de una entrada de mercancía.
 *
 * Identificación del producto (se usa el primero que se encuentre):
 *   - productId       → búsqueda directa por ID; debe existir.
 *   - skuInternal     → búsqueda por SKU; si no existe se puede crear.
 *   - barcodeExternal → búsqueda por código de barras; si no existe se puede crear.
 *
 * Creación de producto nuevo (si ningún identificador encuentra el producto):
 *   - nameCommercial + brandId + categoryId son obligatorios.
 *   - partNumberOEM es opcional (por defecto se usa nameCommercial).
 *
 * Restricción: al menos uno de los identificadores O los campos de creación.
 */
export const entryItemSchema = z.object({
  // Identificadores del producto existente
  productId:       z.string().min(1).optional(),
  skuInternal:     z.string().min(3).max(20).optional(),
  barcodeExternal: z.string().max(50).optional(),

  // Campos para creación de producto nuevo (requeridos si el producto no existe)
  nameCommercial: z.string().min(2).max(200).optional(),
  brandId:        z.string().min(1).optional(),
  categoryId:     z.string().min(1).optional(),
  partNumberOEM:  z.string().min(1).max(100).optional(),

  // Datos de la entrada (siempre requeridos)
  quantity: z.number().int().positive('La cantidad debe ser mayor a 0'),
  unitCost: z.number().positive('El costo unitario debe ser mayor a 0'),
  notes:    z.string().max(500).optional(),
}).refine(
  (d) => !!(d.productId || d.skuInternal || d.barcodeExternal || (d.nameCommercial && d.brandId && d.categoryId)),
  {
    message:
      'Proporcionar productId, skuInternal o barcodeExternal para un producto existente; ' +
      'o bien nameCommercial + brandId + categoryId para crear uno nuevo.',
  },
);

export const registerEntrySchema = z.object({
  items: z.array(entryItemSchema).min(1, 'La entrada debe incluir al menos un ítem'),
  notes: z.string().max(1000).optional(),
});

export const listEntriesQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
  startDate: z.string().datetime().optional(),
  endDate:   z.string().datetime().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 7 — SEGURIDAD Y GOBERNANZA DE ACCESO
// ═══════════════════════════════════════════════════════════════════════════

/** Login: email válido + contraseña mínimo 8 caracteres */
export const loginSchema = z.object({
  email:    z.string().email({ message: 'Email con formato inválido' }).toLowerCase().trim(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

/** Registro / creación de usuario (solo ADMIN) */
export const registerSchema = z.object({
  name:     z.string().min(2, 'Nombre mínimo 2 caracteres').max(150),
  email:    z.string().email({ message: 'Email con formato inválido' }).toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Debe incluir al menos una mayúscula')
    .regex(/[0-9]/, 'Debe incluir al menos un número'),
  roleId:   z.string().min(1, 'roleId requerido'),
});

/** Cambio de contraseña: verificar actual + nueva con requisitos */
export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'La contraseña actual es requerida'),
  newPassword: z
    .string()
    .min(8, 'La nueva contraseña debe tener al menos 8 caracteres')
    .regex(/[A-Z]/, 'Debe incluir al menos una mayúscula')
    .regex(/[0-9]/, 'Debe incluir al menos un número'),
}).refine(
  data => data.oldPassword !== data.newPassword,
  { message: 'La nueva contraseña debe ser diferente a la actual', path: ['newPassword'] },
);

/** Parámetros de consulta para el historial de auditoría paginado */
export const auditLogsQuerySchema = z.object({
  cursor:  z.string().optional(),
  limit:   z.coerce.number().int().min(1).max(200).default(50),
  userId:  z.string().optional(),
  entity:  z.string().optional(),
  action:  z.string().optional(),
  from:    z.string().optional(),
  to:      z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 6 — INTELIGENCIA DE NEGOCIOS (REPORTES)
// ═══════════════════════════════════════════════════════════════════════════

/** Rango de fechas opcional para filtros de reportes (ISO strings, default mes actual). */
export const dateRangeQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate:   z.string().optional(),
});

/** Tipos válidos de exportación a Excel. */
export const exportTypeSchema = z.enum(['sales', 'inventory', 'products'], {
  error: 'Tipo de exportación inválido. Valores: sales, inventory, products',
});

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 5 — TESORERÍA Y CONTROL DE CAJA
// ═══════════════════════════════════════════════════════════════════════════

/** Apertura de turno: saldo inicial >= 0 */
export const openCashShiftSchema = z.object({
  initialBalance: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0,
      { message: 'initialBalance debe ser un número mayor o igual a cero' },
    ),
  notes: z.string().max(500).optional(),
});

/** Registro de egreso operativo */
export const registerExpenseSchema = z.object({
  amount: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      { message: 'amount debe ser mayor a cero' },
    ),
  description:   z.string().min(3, 'Descripción mínimo 3 caracteres').max(500),
  category:      z.string().min(2, 'Categoría requerida').max(100),
  paymentMethod: z.enum(
    Object.values(PaymentMethod) as [PaymentMethod, ...PaymentMethod[]],
    { error: `paymentMethod inválido. Valores: ${Object.values(PaymentMethod).join(', ')}` },
  ),
});

/** Cierre de turno: conteo físico >= 0 */
export const closeCashShiftSchema = z.object({
  physicalCount: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0,
      { message: 'physicalCount debe ser un número mayor o igual a cero' },
    ),
  observations: z.string().max(1000).optional(),
});

/** Parámetros de consulta para el resumen de turno */
export const dailySummaryQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe estar en formato YYYY-MM-DD')
    .optional(),
  userId: z.string().min(1).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 3 — FACTURACIÓN Y DOCUMENTACIÓN COMERCIAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuración de empresa usada en el encabezado de todas las facturas.
 * Se persiste en src/config/companyConfig.json (no en BD).
 * El schema es parcial: sólo se deben enviar los campos a modificar.
 */
export const companyConfigSchema = z.object({
  name:    z.string().min(2).max(200).optional(),
  nit:     z.string().min(5).max(30).optional(),
  address: z.string().min(5).max(300).optional(),
  phone:   z.string().min(5).max(30).optional(),
  email:   z.string().email({ message: 'Email inválido' }).optional().or(z.literal('')),
  footer:  z.string().max(500).optional(),
});

// ─── Tipos exportados ────────────────────────────────────────────────────────

export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
export type ListBrandsQuery = z.infer<typeof listBrandsQuerySchema>;

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

export type CreateProductInput  = z.infer<typeof createProductSchema>;
export type UpdateProductInput  = z.infer<typeof updateProductSchema>;
export type AdjustStockInput    = z.infer<typeof adjustStockSchema>;
export type PatchStockInput     = z.infer<typeof patchStockSchema>;
export type GetProductsQuery    = z.infer<typeof getProductsQuerySchema>;

export type BarcodeInput       = z.infer<typeof barcodeSchema>;
export type CreateCustomerInput  = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput  = z.infer<typeof updateCustomerSchema>;
export type SearchCustomersQuery = z.infer<typeof searchCustomersQuerySchema>;
export type CreateSaleInput    = z.infer<typeof createSaleSchema>;
export type ListSalesQuery     = z.infer<typeof listSalesQuerySchema>;
export type CancelSaleInput    = z.infer<typeof cancelSaleSchema>;

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;
export type CancelPurchaseOrderInput = z.infer<typeof cancelPurchaseOrderSchema>;

export type EntryItemInput      = z.infer<typeof entryItemSchema>;
export type RegisterEntryInput  = z.infer<typeof registerEntrySchema>;
export type ListEntriesQuery    = z.infer<typeof listEntriesQuerySchema>;

export type CompanyConfigInput = z.infer<typeof companyConfigSchema>;

export type LoginInput            = z.infer<typeof loginSchema>;
export type RegisterInput         = z.infer<typeof registerSchema>;
export type ChangePasswordInput   = z.infer<typeof changePasswordSchema>;
export type AuditLogsQuery        = z.infer<typeof auditLogsQuerySchema>;

export type DateRangeQuery        = z.infer<typeof dateRangeQuerySchema>;
export type ExportType            = z.infer<typeof exportTypeSchema>;

export type OpenCashShiftInput    = z.infer<typeof openCashShiftSchema>;
export type RegisterExpenseInput  = z.infer<typeof registerExpenseSchema>;
export type CloseCashShiftInput   = z.infer<typeof closeCashShiftSchema>;
export type DailySummaryQuery     = z.infer<typeof dailySummaryQuerySchema>;
