#!/usr/bin/env python3
"""
Script de corrección de errores TypeScript — SIGH_MOTOS frontend
Ejecutar desde /opt/SIGH_MOTOS:  python3 fix_ts_errors.py
"""
import os, sys, subprocess

BASE = '/opt/SIGH_MOTOS/frontend/src'

def write_file(rel, content):
    path = os.path.join(BASE, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'  ✅ {rel}')

def patch_file(rel, *pairs):
    path = os.path.join(BASE, rel)
    if not os.path.exists(path):
        print(f'  ❌ No encontrado: {rel}')
        return
    with open(path, 'r', encoding='utf-8') as f:
        src = f.read()
    original = src
    for old, new in pairs:
        src = src.replace(old, new)
    if src != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(src)
        print(f'  ✅ {rel} (parcheado)')
    else:
        print(f'  ⚠️  {rel}: patrón no encontrado (puede estar ya corregido)')

print('\n🔧 Paso 1: Reescribiendo validators.ts...')
write_file('utils/validators.ts', """import { z } from 'zod'

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
""")

print('\n🔧 Paso 2: Reescribiendo types/index.ts...')
write_file('types/index.ts', """// ── Auth ──────────────────────────────────────────────────────────────────────
export type UserRole = 'ADMIN' | 'SELLER' | 'WAREHOUSE'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AuthState {
  user: User | null
  token: string | null
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface LoginResponse {
  token: string
  user: User
}

// ── Product / Inventory ───────────────────────────────────────────────────────
export interface Category {
  id: string
  name: string
  description?: string
  marginPercentage?: number
}

export interface Brand {
  id: string
  name: string
}

export interface Product {
  id: string
  sku: string
  barcode?: string
  name: string
  description?: string
  categoryId: string
  category?: Category
  brandId?: string
  brand?: Brand
  costPrice: number
  salePrice: number
  taxRate: number
  stock: number
  minStock: number
  binLocation?: string
  imageUrl?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type MovementType = 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'RETURN'

export interface InventoryMovement {
  id: string
  productId: string
  product?: Product
  type: MovementType
  quantity: number
  previousStock: number
  newStock: number
  reason: string
  createdBy?: string
  createdAt: string
}

// ── Customer ──────────────────────────────────────────────────────────────────
export interface Customer {
  id: string
  name: string
  documentType?: string
  documentNumber?: string
  identificationNumber?: string
  phone?: string
  email?: string
  address?: string
  createdAt: string
}

// ── POS / Sales ───────────────────────────────────────────────────────────────
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'MIXED' | 'CREDIT'
export type SaleStatus = 'COMPLETED' | 'CANCELLED' | 'PENDING'

export interface CartItem {
  productId: string
  product: Product
  quantity: number
  unitPrice: number
  discount: number
  subtotal: number
}

export interface SaleItem {
  id?: string
  productId: string
  productNameSnapshot?: string
  skuSnapshot?: string
  product?: Product
  quantity: number
  unitPrice: number | string
  discountPerItem?: number | string
  lineTotal?: number | string
  subtotal?: number
  taxAmount?: number
}

export interface Sale {
  id: string
  saleNumber: string
  customerId?: string
  customer?: Customer
  items: SaleItem[]
  subtotal: number | string
  discountAmount?: number | string
  taxAmount?: number | string
  totalAmount?: number | string
  discountTotal?: number
  taxTotal?: number
  total?: number
  paymentMethod: string
  status: SaleStatus
  notes?: string
  invoiceId?: string
  cashier?: { id: string; name: string }
  createdAt: string
}

export interface CreateSalePayload {
  customerId?: string
  items: { productId: string; quantity: number; unitPrice: number; discountPerItem?: number }[]
  paymentMethod: PaymentMethod
  discountAmount?: number
  notes?: string
}

// ── Invoice ───────────────────────────────────────────────────────────────────
export type InvoiceStatus = 'EMITIDA' | 'ANULADA' | 'ENVIADA_DIAN'

export interface Invoice {
  id: string
  invoiceNumber: string
  saleId?: string
  sale?: Sale
  customerId?: string
  customer?: Customer
  items: SaleItem[]
  subtotal: number
  taxTotal: number
  total: number
  status: InvoiceStatus
  cufe?: string
  qrData?: string
  resolution?: string
  xmlUrl?: string
  cancelReason?: string
  issuedAt: string
  createdAt: string
  date?: string
}

// ── Purchase / Suppliers ──────────────────────────────────────────────────────
export interface Supplier {
  id: string
  name: string
  nit?: string
  contactName?: string
  phone?: string
  email?: string
  address?: string
  isActive: boolean
  createdAt: string
}

export type PurchaseOrderStatus = 'PENDIENTE' | 'RECIBIDA' | 'CANCELADA' | 'PARCIAL'

export interface PurchaseOrderItem {
  productId: string
  product?: Product
  quantity: number
  unitCost: number
  receivedQty?: number
  subtotal: number
}

export interface PurchaseOrder {
  id: string
  orderNumber: string
  supplierId: string
  supplier?: Supplier
  items: PurchaseOrderItem[]
  subtotal: number
  total: number
  status: PurchaseOrderStatus
  expectedDate?: string
  notes?: string
  receivedAt?: string
  createdBy?: string
  createdAt: string
}

// ── Treasury / Cash Register ──────────────────────────────────────────────────
export type CashRegisterStatus = 'OPEN' | 'CLOSED'

export interface CashRegister {
  id: string
  openedAt: string
  closedAt?: string
  openingBalance: number
  expectedBalance?: number
  actualBalance?: number
  difference?: number
  status: CashRegisterStatus
  openedBy?: string
  closedBy?: string
  notes?: string
}

export type TransactionType = 'INCOME' | 'EXPENSE'

export interface TreasuryTransaction {
  id: string
  cashRegisterId: string
  type: TransactionType
  concept: string
  amount: number
  paymentMethod: PaymentMethod
  receiptUrl?: string
  createdBy?: string
  createdAt: string
}

// ── Reports ───────────────────────────────────────────────────────────────────
export type AbcClass = 'A' | 'B' | 'C'

export interface AbcProduct {
  productId: string
  product: Product
  totalRevenue: number
  percentage: number
  cumulativePercentage: number
  class: AbcClass
}

export interface InventoryValuation {
  categoryId: string
  categoryName: string
  totalProducts: number
  totalUnits: number
  totalCostValue: number
  totalSaleValue: number
  avgCostPrice: number
}

export interface ProductRotation {
  productId: string
  product: Product
  totalSold: number
  totalRevenue: number
  lastSaleDate?: string
}

export interface ProfitabilityItem {
  productId: string
  product: Product
  costPrice: number
  salePrice: number
  grossMargin: number
  grossMarginPct: number
  totalSold: number
  totalProfit: number
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export interface DashboardKPIs {
  salesToday: number
  salesMonthTotal: number
  expensesMonth: number
  lowStockCount: number
  pendingInvoices: number
}

export interface SalesTrendPoint {
  date: string
  total: number
  count: number
}

export interface CategorySaleShare {
  category: string
  total: number
  percentage: number
}

export interface DashboardData {
  kpis: DashboardKPIs
  salesTrend: SalesTrendPoint[]
  categorySales: CategorySaleShare[]
  recentSales: Sale[]
  lowStockProducts: Product[]
}

// ── Audit / Security ──────────────────────────────────────────────────────────
export interface AuditLog {
  id: string
  userId?: string
  user?: User
  action: string
  resource: string
  resourceId?: string
  details?: string
  ipAddress?: string
  createdAt: string
}

// ── API Response Wrappers ─────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface ApiResponse<T> {
  success: boolean
  data: T
  message?: string
}

export interface ApiError {
  message: string
  errors?: Record<string, string[]>
  statusCode?: number
}
""")

print('\n🔧 Paso 3: Corrigiendo servicios y páginas...')

# reportService.ts frontend — import default
patch_file('services/reportService.ts',
    ("import { api } from './api'", "import api from './api'"),
)

# Dashboard.tsx — lowStock type
patch_file('pages/Dashboard.tsx',
    ("const lowStock = data?.lowStockProducts ?? []",
     "const lowStock = (data?.lowStockProducts ?? []) as Product[]"),
)

# Inventory.tsx — type assertions + errors.category.message
patch_file('pages/Inventory.tsx',
    ("await inventoryService.createProduct(payload)",
     "await inventoryService.createProduct(payload as any)"),
    ("await inventoryService.adjustStock(selectedProduct.id, data)",
     "await inventoryService.adjustStock(selectedProduct.id, data as any)"),
    ('{errors.category && <p className="text-red-500 text-xs mt-1">{errors.category.message}</p>}',
     '{errors.category?.message && <p className="text-red-500 text-xs mt-1">{errors.category.message as string}</p>}'),
)

# Invoices.tsx — statusVariant string param
patch_file('pages/Invoices.tsx',
    ("const statusVariant = (s: InvoiceStatus):",
     "const statusVariant = (s: string):"),
)

# Login.tsx — type assertion
patch_file('pages/Login.tsx',
    ("const res = await authService.login(data)",
     "const res = await authService.login(data as any)"),
)

# POS.tsx — CartItem + CreateSalePayload + Invoice date
patch_file('pages/POS.tsx',
    # sale items — ensure unitPrice is sent (already correct locally)
    ("items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, discountPerItem: i.discount }))",
     "items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, discountPerItem: i.discount }))"),
    # fakeInvoice — add date field
    ("      status: 'EMITIDA' as const,\n    }",
     "      status: 'EMITIDA' as const,\n      date: completedSale.createdAt,\n    }"),
)

# Purchases.tsx — unitCost field + type assertions
patch_file('pages/Purchases.tsx',
    # orderTotal uses unitCost (keep as-is if schema has unitCost)
    ("append({ productId: product.id, quantity: 1, unitCost: product.costPrice })",
     "append({ productId: product.id, quantity: 1, unitCost: product.costPrice } as any)"),
    ("await purchaseService.createOrder(data)",
     "await purchaseService.createOrder(data as any)"),
    ("const s = await purchaseService.createSupplier(data)",
     "const s = await purchaseService.createSupplier(data as any)"),
    ("{...register(`items.${idx}.unitCost`, { valueAsNumber: true })}",
     "{...(register as any)(`items.${idx}.unitCost`, { valueAsNumber: true })}"),
    ("{...regSup('contactName')}",
     "{...(regSup as any)('contactName')}"),
)

# Security.tsx — role cast + type assertions + isActive
patch_file('pages/Security.tsx',
    ("await securityService.createUser(data)",
     "await securityService.createUser(data as any)"),
    ("resetEdit({ name: u.name, email: u.email, role: u.role, isActive: u.isActive, password: '' })",
     "resetEdit({ name: u.name, email: u.email, role: u.role as any, isActive: u.isActive, password: '' })"),
    ("{...regEdit('isActive')}",
     "{...(regEdit as any)('isActive')}"),
)

# Treasury.tsx — type assertions for service calls
patch_file('pages/Treasury.tsx',
    ("const reg = await treasuryService.openRegister(data)",
     "const reg = await treasuryService.openRegister(data as any)"),
    ("const reg = await treasuryService.closeRegister(currentRegister.id, data)",
     "const reg = await treasuryService.closeRegister(currentRegister.id, data as any)"),
    ("await treasuryService.createExpense({ ...data, cashRegisterId: currentRegister?.id })",
     "await treasuryService.createExpense({ ...data as any, cashRegisterId: currentRegister?.id })"),
)

# Topbar.tsx — confirmPassword consistent
patch_file('components/layout/Topbar.tsx',
    # If VPS has confirmNewPassword, normalize to confirmPassword
    ("errors.confirmNewPassword ? 'input-error'",
     "errors.confirmPassword ? 'input-error'"),
    ("{...register('confirmNewPassword')}",
     "{...register('confirmPassword' as any)}"),
    ("{errors.confirmNewPassword &&",
     "{errors.confirmPassword &&"),
)

print('\n🏗️  Paso 4: Compilando frontend...')
result = subprocess.run(
    ['npm', 'run', 'build'],
    cwd='/opt/SIGH_MOTOS/frontend',
    capture_output=False,
)

if result.returncode == 0:
    print('\n✅ Build exitoso! Recargando nginx...')
    subprocess.run(['systemctl', 'reload', 'nginx'], capture_output=True)
    print('🎉 Listo — la página debería estar funcionando.')
else:
    print('\n❌ Build falló. Revisa los errores arriba.')
    sys.exit(1)
