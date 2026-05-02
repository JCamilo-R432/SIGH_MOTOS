import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
})

export const productSchema = z.object({
  name: z.string().min(2, 'Nombre requerido'),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  category: z.string().min(1, 'Categoría requerida'),
  brandId: z.string().optional(),
  costPrice: z.number({ invalid_type_error: 'Precio de costo requerido' }).min(0),
  salePrice: z.number({ invalid_type_error: 'Precio de venta requerido' }).min(0),
  taxRate: z.number().min(0).max(100).default(19),
  stock: z.number().min(0).default(0),
  minStock: z.number().min(0).default(5),
  binLocation: z.string().optional(),
  description: z.string().optional(),
})

export const adjustStockSchema = z.object({
  quantity: z.number({ invalid_type_error: 'Cantidad requerida' }).int().positive('Debe ser mayor a 0'),
  type: z.enum(['ENTRY', 'EXIT', 'ADJUSTMENT', 'RETURN']),
  reason: z.string().min(3, 'Motivo requerido'),
})

export const purchaseOrderSchema = z.object({
  supplierId: z.string().min(1, 'Proveedor requerido'),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().positive(),
    unitCost: z.number().min(0),
  })).min(1, 'Agregar al menos un producto'),
  expectedDate: z.string().optional(),
  notes: z.string().optional(),
})

export const userSchema = z.object({
  name: z.string().min(2, 'Nombre requerido'),
  email: z.string().email('Email inválido'),
  role: z.enum(['ADMIN', 'SELLER', 'WAREHOUSE']),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
})

export const userUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: z.enum(['ADMIN', 'SELLER', 'WAREHOUSE']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional().or(z.literal('')),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Contraseña actual requerida'),
  newPassword: z.string().min(8, 'Mínimo 8 caracteres'),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Las contraseñas no coinciden',
  path: ['confirmPassword'],
})

export const expenseSchema = z.object({
  concept: z.string().min(3, 'Concepto requerido'),
  amount: z.number({ invalid_type_error: 'Monto requerido' }).positive('Debe ser mayor a 0'),
  paymentMethod: z.string().min(1, 'Método de pago requerido'),
})

export const openCashRegisterSchema = z.object({
  openingBalance: z.number({ invalid_type_error: 'Monto requerido' }).min(0),
  notes: z.string().optional(),
})

export const closeCashRegisterSchema = z.object({
  actualBalance: z.number({ invalid_type_error: 'Monto requerido' }).min(0),
  notes: z.string().optional(),
})

export const supplierSchema = z.object({
  name: z.string().min(2, 'Nombre requerido'),
  nit: z.string().optional(),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  address: z.string().optional(),
})

export type LoginInput = z.infer<typeof loginSchema>
export type ProductInput = z.infer<typeof productSchema>
export type AdjustStockInput = z.infer<typeof adjustStockSchema>
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>
export type UserInput = z.infer<typeof userSchema>
export type UserUpdateInput = z.infer<typeof userUpdateSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type ExpenseInput = z.infer<typeof expenseSchema>
export type OpenCashRegisterInput = z.infer<typeof openCashRegisterSchema>
export type CloseCashRegisterInput = z.infer<typeof closeCashRegisterSchema>
export type SupplierInput = z.infer<typeof supplierSchema>
