import { useState, useEffect, useCallback } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2, ShoppingBag, CheckCircle, XCircle, Eye, Download } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseService } from '@/services/purchaseService'
import { inventoryService } from '@/services/inventoryService'
import type { PurchaseOrder, Supplier, Product } from '@/types'
import { purchaseOrderSchema, supplierSchema, type PurchaseOrderInput, type SupplierInput } from '@/utils/validators'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Pagination } from '@/components/ui/Pagination'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { formatCOP, formatDate, poStatusBadge } from '@/utils/formatters'
import { exportPurchaseOrdersToExcel } from '@/utils/excelExport'

const statusOptions = [
  { value: '', label: 'Todos los estados' },
  { value: 'PENDIENTE', label: 'Pendiente' },
  { value: 'RECIBIDA', label: 'Recibida' },
  { value: 'CANCELADA', label: 'Cancelada' },
]

export default function Purchases() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')

  const [orderModal, setOrderModal] = useState(false)
  const [detailModal, setDetailModal] = useState(false)
  const [supplierModal, setSupplierModal] = useState(false)
  const [receiveDialog, setReceiveDialog] = useState(false)
  const [cancelDialog, setCancelDialog] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null)
  const [saving, setSaving] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])

  const LIMIT = 20

  const { register, handleSubmit, reset, control, watch, formState: { errors } } = useForm<PurchaseOrderInput>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: { supplierId: '', items: [] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  const { register: regSup, handleSubmit: handleSupSubmit, reset: resetSup, formState: { errors: supErrors } } = useForm<SupplierInput>({
    resolver: zodResolver(supplierSchema),
  })

  const watchItems = watch('items')
  const orderTotal = (watchItems ?? []).reduce((s, i) => s + (Number(i.quantity) * Number(i.unitCost) || 0), 0)

  const load = useCallback(async (p = page, status = statusFilter, sup = supplierFilter) => {
    setLoading(true)
    try {
      const res = await purchaseService.getOrders({ page: p, limit: LIMIT, status: status || undefined, supplierId: sup || undefined })
      setOrders(res.data)
      setTotal(res.total)
      setTotalPages(res.totalPages)
    } catch { /* handled */ } finally { setLoading(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { purchaseService.getSuppliers().then(setSuppliers).catch(() => {}) }, [])
  useEffect(() => { inventoryService.getProducts({ limit: 500 }).then((r) => setProducts(r.data)).catch(() => {}) }, [])

  const handleProductSearch = async (q: string) => {
    setProductSearch(q)
    if (q.length < 2) { setProductResults([]); return }
    const results = products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.sku?.toLowerCase().includes(q.toLowerCase()))
    setProductResults(results.slice(0, 8))
  }

  const addProductToOrder = (product: Product) => {
    const exists = fields.find((f) => f.productId === product.id)
    if (exists) { toast.warning('Este producto ya está en la orden'); return }
    append({ productId: product.id, quantity: 1, unitCost: product.costPrice })
    setProductSearch('')
    setProductResults([])
  }

  const onSaveOrder = async (data: PurchaseOrderInput) => {
    setSaving(true)
    try {
      await purchaseService.createOrder(data)
      toast.success('Orden de compra creada')
      setOrderModal(false)
      reset()
      load(1, statusFilter, supplierFilter)
      setPage(1)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al crear orden'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  const onSaveSupplier = async (data: SupplierInput) => {
    setSaving(true)
    try {
      const s = await purchaseService.createSupplier(data)
      setSuppliers((prev) => [...prev, s])
      toast.success('Proveedor creado')
      setSupplierModal(false)
      resetSup()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al crear proveedor'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  const handleReceive = async () => {
    if (!selectedOrder) return
    setSaving(true)
    try {
      await purchaseService.receiveOrder(selectedOrder.id)
      toast.success('Orden recibida y stock actualizado')
      setReceiveDialog(false)
      load(page, statusFilter, supplierFilter)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al recibir orden'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  const handleCancel = async () => {
    if (!selectedOrder) return
    setSaving(true)
    try {
      await purchaseService.cancelOrder(selectedOrder.id)
      toast.success('Orden cancelada')
      setCancelDialog(false)
      load(page, statusFilter, supplierFilter)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al cancelar'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  const poBadgeVariant = (s: string): 'yellow' | 'green' | 'red' | 'orange' | 'gray' => {
    if (s === 'PENDIENTE') return 'yellow'
    if (s === 'RECIBIDA') return 'green'
    if (s === 'CANCELADA') return 'red'
    return 'gray'
  }

  const getProductName = (id: string) => products.find((p) => p.id === id)?.name ?? id

  return (
    <div>
      <PageHeader
        title="Compras"
        description="Órdenes de compra y proveedores"
        actions={
          <div className="flex gap-2">
            <button className="btn-outline btn-sm" onClick={() => { resetSup(); setSupplierModal(true) }}>
              <Plus className="w-4 h-4" /> Nuevo Proveedor
            </button>
            <button className="btn-outline btn-sm" onClick={async () => { await exportPurchaseOrdersToExcel(orders); toast.success('Excel exportado') }}>
              <Download className="w-4 h-4" /> Exportar
            </button>
            <button className="btn-primary btn-sm" onClick={() => { reset({ supplierId: '', items: [] }); setOrderModal(true) }}>
              <Plus className="w-4 h-4" /> Nueva Orden
            </button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Estado</label>
            <select className="input-field w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {statusOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Proveedor</label>
            <select className="input-field w-52" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
              <option value="">Todos los proveedores</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button className="btn-secondary btn-sm" onClick={() => { setPage(1); load(1, statusFilter, supplierFilter) }}>Filtrar</button>
          <button className="btn-ghost btn-sm text-gray-500" onClick={() => { setStatusFilter(''); setSupplierFilter(''); setPage(1); load(1, '', '') }}>Limpiar</button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? <TableSkeleton rows={8} cols={6} /> : orders.length === 0 ? (
            <EmptyState icon={<ShoppingBag className="w-8 h-8" />} title="Sin órdenes de compra" action={<button className="btn-primary btn-sm" onClick={() => { reset({ supplierId: '', items: [] }); setOrderModal(true) }}><Plus className="w-4 h-4" /> Crear primera orden</button>} />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-th">Número</th>
                  <th className="table-th">Proveedor</th>
                  <th className="table-th">Total</th>
                  <th className="table-th">Estado</th>
                  <th className="table-th">Fecha Esperada</th>
                  <th className="table-th">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const st = poStatusBadge(o.status)
                  return (
                    <tr key={o.id} className="table-row">
                      <td className="table-td font-mono text-xs font-semibold text-blue-900">{o.orderNumber}</td>
                      <td className="table-td">{o.supplier?.name ?? '—'}</td>
                      <td className="table-td font-semibold">{formatCOP(o.total)}</td>
                      <td className="table-td"><Badge variant={poBadgeVariant(o.status)}>{st.label}</Badge></td>
                      <td className="table-td text-gray-500 text-xs">{o.expectedDate ? formatDate(o.expectedDate) : '—'}</td>
                      <td className="table-td">
                        <div className="flex items-center gap-1">
                          <button onClick={() => { setSelectedOrder(o); setDetailModal(true) }} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Ver detalle"><Eye className="w-4 h-4" /></button>
                          {o.status === 'PENDIENTE' && (
                            <>
                              <button onClick={() => { setSelectedOrder(o); setReceiveDialog(true) }} className="p-1.5 rounded hover:bg-green-50 text-green-600" title="Marcar como recibida"><CheckCircle className="w-4 h-4" /></button>
                              <button onClick={() => { setSelectedOrder(o); setCancelDialog(true) }} className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Cancelar"><XCircle className="w-4 h-4" /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        {!loading && orders.length > 0 && (
          <Pagination page={page} totalPages={totalPages} total={total} limit={LIMIT} onPageChange={(p) => { setPage(p); load(p) }} />
        )}
      </Card>

      {/* New Order Modal */}
      <Modal open={orderModal} onClose={() => setOrderModal(false)} title="Nueva Orden de Compra" size="xl"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setOrderModal(false)}>Cancelar</button>
            <button className="btn-primary" form="order-form" type="submit" disabled={saving || fields.length === 0}>
              {saving && <Spinner size="sm" />} Crear Orden ({formatCOP(orderTotal)})
            </button>
          </div>
        }
      >
        <form id="order-form" onSubmit={handleSubmit(onSaveOrder)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Proveedor *</label>
              <select className={`input-field ${errors.supplierId ? 'input-error' : ''}`} {...register('supplierId')}>
                <option value="">Seleccionar proveedor</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {errors.supplierId && <p className="text-red-500 text-xs mt-1">{errors.supplierId.message}</p>}
            </div>
            <div>
              <label className="label">Fecha Esperada</label>
              <input type="date" className="input-field" {...register('expectedDate')} />
            </div>
          </div>

          {/* Product search */}
          <div>
            <label className="label">Agregar Productos</label>
            <div className="relative">
              <SearchInput value={productSearch} onChange={handleProductSearch} placeholder="Buscar producto por nombre o SKU..." />
              {productResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-52 overflow-y-auto mt-1">
                  {productResults.map((p) => (
                    <button key={p.id} type="button" onClick={() => addProductToOrder(p)} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-50 last:border-0">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-gray-400 ml-2 text-xs">{p.sku}</span>
                      <span className="text-orange-500 ml-2 text-xs font-medium">{formatCOP(p.costPrice)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Items */}
          {fields.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-th">Producto</th>
                    <th className="table-th w-24">Cantidad</th>
                    <th className="table-th w-32">Costo Unit.</th>
                    <th className="table-th w-28">Subtotal</th>
                    <th className="table-th w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, idx) => {
                    const qty = Number(watchItems?.[idx]?.quantity) || 0
                    const cost = Number(watchItems?.[idx]?.unitCost) || 0
                    return (
                      <tr key={field.id} className="table-row">
                        <td className="table-td">{getProductName(field.productId)}</td>
                        <td className="table-td">
                          <input type="number" min="1" className="input-field text-center py-1 px-2" {...register(`items.${idx}.quantity`, { valueAsNumber: true })} />
                        </td>
                        <td className="table-td">
                          <input type="number" min="0" step="1" className="input-field py-1 px-2" {...register(`items.${idx}.unitCost`, { valueAsNumber: true })} />
                        </td>
                        <td className="table-td font-semibold">{formatCOP(qty * cost)}</td>
                        <td className="table-td">
                          <button type="button" onClick={() => remove(idx)} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {fields.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
              Busca y agrega productos a la orden
            </div>
          )}

          <div>
            <label className="label">Notas</label>
            <textarea className="input-field resize-none" rows={2} {...register('notes')} placeholder="Observaciones opcionales..." />
          </div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal open={detailModal} onClose={() => setDetailModal(false)} title={`Orden ${selectedOrder?.orderNumber ?? ''}`} size="lg"
        footer={<div className="flex justify-end"><button className="btn-outline" onClick={() => setDetailModal(false)}>Cerrar</button></div>}
      >
        {selectedOrder && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-gray-500">Proveedor:</span> <span className="font-medium">{selectedOrder.supplier?.name}</span></div>
              <div><span className="text-gray-500">Estado:</span> <Badge variant={poBadgeVariant(selectedOrder.status)}>{poStatusBadge(selectedOrder.status).label}</Badge></div>
              <div><span className="text-gray-500">Total:</span> <span className="font-bold text-orange-500">{formatCOP(selectedOrder.total)}</span></div>
              {selectedOrder.expectedDate && <div><span className="text-gray-500">Fecha esperada:</span> {formatDate(selectedOrder.expectedDate)}</div>}
            </div>
            <table className="w-full">
              <thead className="bg-gray-50"><tr><th className="table-th">Producto</th><th className="table-th">Cant.</th><th className="table-th">Costo</th><th className="table-th">Subtotal</th></tr></thead>
              <tbody>
                {(selectedOrder.items ?? []).map((item, i) => (
                  <tr key={i} className="table-row">
                    <td className="table-td">{item.product?.name ?? getProductName(item.productId)}</td>
                    <td className="table-td">{item.quantity}</td>
                    <td className="table-td">{formatCOP(item.unitCost)}</td>
                    <td className="table-td font-semibold">{formatCOP(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* New Supplier Modal */}
      <Modal open={supplierModal} onClose={() => { setSupplierModal(false); resetSup() }} title="Nuevo Proveedor" size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => { setSupplierModal(false); resetSup() }}>Cancelar</button>
            <button className="btn-primary" form="sup-form" type="submit" disabled={saving}>
              {saving && <Spinner size="sm" />} Crear
            </button>
          </div>
        }
      >
        <form id="sup-form" onSubmit={handleSupSubmit(onSaveSupplier)} className="space-y-3">
          <div><label className="label">Nombre *</label><input className={`input-field ${supErrors.name ? 'input-error' : ''}`} {...regSup('name')} />{supErrors.name && <p className="text-red-500 text-xs mt-1">{supErrors.name.message}</p>}</div>
          <div><label className="label">NIT</label><input className="input-field" {...regSup('nit')} /></div>
          <div><label className="label">Contacto</label><input className="input-field" {...regSup('contactName')} /></div>
          <div><label className="label">Teléfono</label><input className="input-field" {...regSup('phone')} /></div>
          <div><label className="label">Email</label><input type="email" className="input-field" {...regSup('email')} /></div>
          <div><label className="label">Dirección</label><input className="input-field" {...regSup('address')} /></div>
        </form>
      </Modal>

      <ConfirmDialog open={receiveDialog} title="Recibir Orden" message={`¿Confirmar recepción de la orden ${selectedOrder?.orderNumber}? El stock se actualizará automáticamente.`} confirmLabel="Sí, Recibir" variant="info" loading={saving} onConfirm={handleReceive} onCancel={() => setReceiveDialog(false)} />
      <ConfirmDialog open={cancelDialog} title="Cancelar Orden" message={`¿Cancelar la orden ${selectedOrder?.orderNumber}?`} confirmLabel="Sí, Cancelar" loading={saving} onConfirm={handleCancel} onCancel={() => setCancelDialog(false)} />
    </div>
  )
}
