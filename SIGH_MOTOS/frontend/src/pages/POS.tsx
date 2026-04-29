import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, Minus, Trash2, User, Receipt, Printer, Download, X, Ticket } from 'lucide-react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { posService } from '@/services/posService'
import type { CartItem, Customer, Sale, PaymentMethod, Product } from '@/types'
import { Card } from '@/components/ui/Card'
import { SearchInput } from '@/components/ui/SearchInput'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { PageHeader } from '@/components/ui/PageHeader'
import { SmartScannerInput, type SmartScannerHandle } from '@/components/SmartScannerInput'
import { formatCOP } from '@/utils/formatters'
import { generateId } from '@/utils/helpers'
import { generateInvoicePDF } from '@/utils/pdfGenerator'

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH',     label: 'Efectivo' },
  { value: 'CARD',     label: 'Tarjeta' },
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'MIXED',    label: 'Mixto' },
  { value: 'CREDIT',   label: 'Crédito / Fiado' },
]

export default function POS() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [globalDiscount, setGlobalDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [finalizingLoading, setFinalizingLoading] = useState(false)
  const [completedSale, setCompletedSale] = useState<Sale | null>(null)
  const [receiptModal, setReceiptModal] = useState(false)
  const scannerRef = useRef<SmartScannerHandle>(null)

  useEffect(() => {
    scannerRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); scannerRef.current?.focus() }
      if (e.key === 'F2') { e.preventDefault(); if (cart.length > 0) handleFinalize() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cart]) // eslint-disable-line react-hooks/exhaustive-deps

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id)
      if (existing) {
        if (existing.quantity >= product.stock) { toast.warning('No hay más stock disponible'); return prev }
        return prev.map((i) => i.productId === product.id
          ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unitPrice * (1 - i.discount / 100) }
          : i
        )
      }
      return [...prev, {
        productId: product.id,
        product,
        quantity: 1,
        unitPrice: product.salePrice,
        discount: 0,
        subtotal: product.salePrice,
      }]
    })
  }

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) { removeFromCart(productId); return }
    setCart((prev) => prev.map((i) => {
      if (i.productId !== productId) return i
      if (qty > i.product.stock) { toast.warning('Cantidad supera el stock disponible'); return i }
      return { ...i, quantity: qty, subtotal: qty * i.unitPrice * (1 - i.discount / 100) }
    }))
  }

  const updateDiscount = (productId: string, disc: number) => {
    const d = Math.max(0, Math.min(100, disc))
    setCart((prev) => prev.map((i) => i.productId !== productId ? i : { ...i, discount: d, subtotal: i.quantity * i.unitPrice * (1 - d / 100) }))
  }

  const removeFromCart = (productId: string) => setCart((prev) => prev.filter((i) => i.productId !== productId))

  const subtotal = cart.reduce((s, i) => s + i.subtotal, 0)
  const discountAmount = (subtotal * globalDiscount) / 100
  const taxableBase = subtotal - discountAmount
  const taxTotal = cart.reduce((s, i) => s + (i.subtotal * (1 - globalDiscount / 100) * i.product.taxRate / 100), 0)
  const total = taxableBase + taxTotal

  const handleFinalize = useCallback(async () => {
    if (cart.length === 0) { toast.error('El carrito está vacío'); return }
    setFinalizingLoading(true)
    try {
      const sale = await posService.createSale({
        customerId: customer?.id,
        items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, discountPerItem: i.discount })),
        paymentMethod,
        discountAmount,
        notes: notes || undefined,
      })
      setCompletedSale(sale)
      setReceiptModal(true)
      setCart([])
      setCustomer(null)
      setNotes('')
      setGlobalDiscount(0)
      toast.success(`Venta ${sale.saleNumber} completada exitosamente`)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al procesar la venta'
      toast.error(msg)
    } finally {
      setFinalizingLoading(false)
    }
  }, [cart, customer, paymentMethod, discountAmount, notes])

  const searchCustomers = useCallback(async (q: string) => {
    if (q.length < 2) { setCustomerResults([]); return }
    try {
      const results = await posService.searchCustomers(q)
      setCustomerResults(results)
    } catch { setCustomerResults([]) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchCustomers(customerSearch), 350)
    return () => clearTimeout(t)
  }, [customerSearch, searchCustomers])

  const handlePrintPDF = () => {
    if (!completedSale?.invoiceId) { toast.warning('La factura aún no está disponible'); return }
    // Use the invoice data from the sale
    const fakeInvoice = {
      id: completedSale.invoiceId ?? '',
      invoiceNumber: completedSale.saleNumber,
      issuedAt: completedSale.createdAt,
      createdAt: completedSale.createdAt,
      customer: completedSale.customer,
      items: completedSale.items,
      subtotal: Number(completedSale.subtotal ?? 0),
      taxTotal: Number(completedSale.taxTotal ?? 0),
      total: Number(completedSale.total ?? 0),
      status: 'EMITIDA' as const,
    }
    generateInvoicePDF(fakeInvoice)
  }

  return (
    <div>
      <PageHeader title="Punto de Venta" description="F1: Buscar  ·  F2: Finalizar Venta  ·  ESC: Limpiar" />

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Left: Cart */}
        <div className="xl:col-span-3 space-y-4">
          {/* Smart Scanner */}
          <SmartScannerInput
            ref={scannerRef}
            onProductScanned={addToCart}
            disabled={finalizingLoading}
          />

          {/* Cart Items */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Carrito ({cart.length} productos)</h3>
              {cart.length > 0 && (
                <button className="text-sm text-red-500 hover:text-red-700" onClick={() => setCart([])}>
                  Vaciar carrito
                </button>
              )}
            </div>
            {cart.length === 0 ? (
              <div className="py-16 text-center text-gray-400 text-sm">
                <Receipt className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                El carrito está vacío. Escanea o busca un producto.
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {cart.map((item) => (
                  <div key={item.productId} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-gray-900 truncate">{item.product.name}</p>
                        <p className="text-xs text-gray-400">{item.product.sku}</p>
                        <p className="text-xs text-blue-700 font-medium mt-0.5">{formatCOP(item.unitPrice)} c/u</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Qty */}
                        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                          <button onClick={() => updateQty(item.productId, item.quantity - 1)} className="p-1.5 hover:bg-gray-100 text-gray-500">
                            <Minus className="w-3 h-3" />
                          </button>
                          <input
                            type="number" min="1" value={item.quantity}
                            onChange={(e) => updateQty(item.productId, Number(e.target.value))}
                            className="w-12 text-center text-sm border-0 focus:outline-none py-1"
                          />
                          <button onClick={() => updateQty(item.productId, item.quantity + 1)} className="p-1.5 hover:bg-gray-100 text-gray-500">
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        {/* Discount */}
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min="0" max="100" value={item.discount}
                            onChange={(e) => updateDiscount(item.productId, Number(e.target.value))}
                            className="w-14 text-center text-sm border border-gray-200 rounded py-1 focus:outline-none focus:border-blue-400"
                            title="Descuento %"
                            placeholder="%"
                          />
                          <span className="text-xs text-gray-400">%</span>
                        </div>
                        {/* Subtotal */}
                        <p className="font-semibold text-sm w-24 text-right">{formatCOP(item.subtotal)}</p>
                        <button onClick={() => removeFromCart(item.productId)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right: Order Summary */}
        <div className="xl:col-span-2 space-y-4">
          {/* Customer */}
          <Card className="p-4">
            <label className="label">
              <User className="inline w-4 h-4 mr-1 text-gray-400" />
              Cliente (opcional)
            </label>
            {customer ? (
              <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
                <div>
                  <p className="font-medium text-sm text-blue-900">{customer.name}</p>
                  <p className="text-xs text-blue-600">{customer.phone ?? customer.email ?? customer.documentNumber ?? ''}</p>
                </div>
                <button onClick={() => setCustomer(null)} className="text-blue-400 hover:text-blue-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <SearchInput value={customerSearch} onChange={setCustomerSearch} placeholder="Buscar cliente..." />
                {customerResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1 max-h-48 overflow-y-auto">
                    {customerResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setCustomer(c); setCustomerSearch(''); setCustomerResults([]) }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                      >
                        <p className="font-medium">{c.name}</p>
                        <p className="text-gray-400 text-xs">{c.phone ?? c.email}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Payment */}
          <Card className="p-4 space-y-4">
            <div>
              <label className="label">Método de Pago</label>
              <select className="input-field" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Descuento Global (%)</label>
              <input type="number" min="0" max="100" value={globalDiscount}
                onChange={(e) => setGlobalDiscount(Math.max(0, Math.min(100, Number(e.target.value))))}
                className="input-field"
              />
            </div>
            <div>
              <label className="label">Notas</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="input-field resize-none" placeholder="Notas opcionales..." />
            </div>
          </Card>

          {/* Totals */}
          <Card className="p-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span><span>{formatCOP(subtotal)}</span>
              </div>
              {globalDiscount > 0 && (
                <div className="flex justify-between text-orange-600">
                  <span>Descuento ({globalDiscount}%)</span><span>-{formatCOP(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600">
                <span>IVA (19%)</span><span>{formatCOP(taxTotal)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-100">
                <span>TOTAL</span><span className="text-orange-500">{formatCOP(total)}</span>
              </div>
            </div>
            <button
              onClick={handleFinalize}
              disabled={cart.length === 0 || finalizingLoading}
              className="btn-primary w-full justify-center mt-4 py-3 text-base"
            >
              {finalizingLoading ? <><Spinner size="sm" /> Procesando...</> : <><Receipt className="w-5 h-5" /> Finalizar Venta (F2)</>}
            </button>
          </Card>
        </div>
      </div>

      {/* Receipt Modal */}
      <Modal
        open={receiptModal}
        onClose={() => setReceiptModal(false)}
        title="Venta Completada"
        size="md"
        footer={
          <div className="flex gap-2 justify-end flex-wrap">
            <button className="btn-outline" onClick={() => { setReceiptModal(false); scannerRef.current?.focus() }}>
              Nueva Venta
            </button>
            {completedSale && (
              <button
                className="btn-secondary flex items-center gap-1"
                onClick={() => window.open(`/print-ticket/${completedSale.id}`, '_blank', 'width=400,height=700')}
              >
                <Ticket className="w-4 h-4" /> Ticket Térmico
              </button>
            )}
            <button className="btn-ghost" onClick={() => window.print()}>
              <Printer className="w-4 h-4" /> Imprimir
            </button>
            <button className="btn-primary" onClick={handlePrintPDF}>
              <Download className="w-4 h-4" /> Descargar PDF
            </button>
          </div>
        }
      >
        {completedSale && (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <Receipt className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{formatCOP(Number(completedSale.totalAmount ?? completedSale.total ?? 0))}</p>
              <p className="text-sm text-gray-500">Factura {completedSale.saleNumber}</p>
            </div>
            {completedSale.invoiceId && (
              <div className="flex justify-center">
                <QRCodeSVG value={`https://motos.quantacloud.com/invoices/${completedSale.invoiceId}`} size={120} />
              </div>
            )}
            <div className="text-left bg-gray-50 rounded-xl p-4 space-y-2">
              {completedSale.items.slice(0, 5).map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-600">{item.productNameSnapshot ?? item.product?.name ?? 'Producto'} × {item.quantity}</span>
                  <span className="font-medium">{formatCOP(Number(item.lineTotal ?? item.subtotal ?? 0))}</span>
                </div>
              ))}
              {completedSale.items.length > 5 && (
                <p className="text-xs text-gray-400 text-center">+{completedSale.items.length - 5} más...</p>
              )}
              <div className="border-t border-gray-200 pt-2 flex justify-between font-bold">
                <span>Total</span><span className="text-orange-500">{formatCOP(Number(completedSale.totalAmount ?? completedSale.total ?? 0))}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
