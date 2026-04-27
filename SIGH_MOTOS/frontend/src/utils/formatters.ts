// Format currency in Colombian pesos
export const formatCOP = (amount: number): string => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

// Format number with thousand separators
export const formatNumber = (n: number): string =>
  new Intl.NumberFormat('es-CO').format(n)

// Format date as dd/mm/yyyy
export const formatDate = (dateStr: string | Date): string => {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Format datetime
export const formatDateTime = (dateStr: string | Date): string => {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Format percentage
export const formatPct = (n: number, decimals = 1): string => `${n.toFixed(decimals)}%`

// Stock badge color
export const stockColor = (stock: number, minStock = 5): string => {
  if (stock <= 0) return 'badge-red'
  if (stock <= minStock) return 'badge-yellow'
  return 'badge-green'
}

// Sale status badge
export const saleStatusBadge = (status: string): { cls: string; label: string } => {
  switch (status) {
    case 'COMPLETED': return { cls: 'badge-green', label: 'Completada' }
    case 'CANCELLED': return { cls: 'badge-red', label: 'Cancelada' }
    case 'PENDING': return { cls: 'badge-yellow', label: 'Pendiente' }
    default: return { cls: 'badge-gray', label: status }
  }
}

// Invoice status badge
export const invoiceStatusBadge = (status: string): { cls: string; label: string } => {
  switch (status) {
    case 'EMITIDA': return { cls: 'badge-blue', label: 'Emitida' }
    case 'ANULADA': return { cls: 'badge-red', label: 'Anulada' }
    case 'ENVIADA_DIAN': return { cls: 'badge-green', label: 'Enviada DIAN' }
    default: return { cls: 'badge-gray', label: status }
  }
}

// Purchase order status badge
export const poStatusBadge = (status: string): { cls: string; label: string } => {
  switch (status) {
    case 'PENDIENTE': return { cls: 'badge-yellow', label: 'Pendiente' }
    case 'RECIBIDA': return { cls: 'badge-green', label: 'Recibida' }
    case 'CANCELADA': return { cls: 'badge-red', label: 'Cancelada' }
    case 'PARCIAL': return { cls: 'badge-orange', label: 'Parcial' }
    default: return { cls: 'badge-gray', label: status }
  }
}

// ABC class badge
export const abcBadge = (cls: string): string => {
  switch (cls) {
    case 'A': return 'badge-green'
    case 'B': return 'badge-yellow'
    case 'C': return 'badge-red'
    default: return 'badge-gray'
  }
}

// Role label
export const roleLabel = (role: string): string => {
  switch (role) {
    case 'ADMIN': return 'Administrador'
    case 'SELLER': return 'Vendedor'
    case 'WAREHOUSE': return 'Almacén'
    default: return role
  }
}

// Payment method label
export const paymentMethodLabel = (method: string): string => {
  switch (method) {
    case 'EFECTIVO': return 'Efectivo'
    case 'TARJETA_CREDITO': return 'Tarjeta Crédito'
    case 'TARJETA_DEBITO': return 'Tarjeta Débito'
    case 'TRANSFERENCIA_BANCARIA': return 'Transferencia'
    case 'MIXTO': return 'Mixto'
    default: return method
  }
}
