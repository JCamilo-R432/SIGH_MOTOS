// ── Auth ──────────────────────────────────────────────────────────────────────
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
