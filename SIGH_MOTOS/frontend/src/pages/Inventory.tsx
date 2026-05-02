import { useState, useEffect, useCallback, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Edit, Trash2, SlidersHorizontal, Upload, Download, Package } from 'lucide-react'
import { toast } from 'sonner'
import { inventoryService } from '@/services/inventoryService'
import type { Product, Category } from '@/types'
import { productSchema, adjustStockSchema, type ProductInput, type AdjustStockInput } from '@/utils/validators'
import { PageHeader } from '@/components/ui/PageHeader'
import { SearchInput } from '@/components/ui/SearchInput'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/EmptyState'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Card } from '@/components/ui/Card'
import { formatCOP, formatNumber } from '@/utils/formatters'
import { exportProductsToExcel } from '@/utils/excelExport'
import { debounce } from '@/utils/helpers'

const STOCK_TYPES = [
  { value: 'ENTRY', label: 'Entrada (Compra)' },
  { value: 'EXIT', label: 'Salida (Venta)' },
  { value: 'ADJUSTMENT', label: 'Ajuste Manual' },
  { value: 'RETURN', label: 'Devolución' },
]

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [lowStockFilter, setLowStockFilter] = useState(false)

  const [productModal, setProductModal] = useState(false)
  const [stockModal, setStockModal] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const LIMIT = 25

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: { taxRate: 19, stock: 0, minStock: 5 },
  })


  const { register: regStock, handleSubmit: handleStockSubmit, reset: resetStock, formState: { errors: stockErrors } } = useForm<AdjustStockInput>({
    resolver: zodResolver(adjustStockSchema),
    defaultValues: { type: 'ENTRY' },
  })

  const load = useCallback(async (q = search, cat = categoryFilter, ls = lowStockFilter, p = page) => {
    setLoading(true)
    try {
      const res = await inventoryService.getProducts({ page: p, limit: LIMIT, search: q || undefined, categoryId: cat || undefined, lowStock: ls || undefined })
      setProducts(res.data)
      setTotal(res.total)
      setTotalPages(res.totalPages)
    } catch { /* handled */ } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const debouncedLoad = useCallback(debounce((q: string) => {
    setPage(1)
    load(q, categoryFilter, lowStockFilter, 1)
  }, 350) as (q: string) => void, [categoryFilter, lowStockFilter, load])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { inventoryService.getCategories().then(setCategories).catch(() => {}) }, [])

  const handleSearch = (v: string) => { setSearch(v); debouncedLoad(v) }

  const handleFilterChange = (cat: string, ls: boolean) => {
    setCategoryFilter(cat); setLowStockFilter(ls); setPage(1)
    load(search, cat, ls, 1)
  }

  const openCreate = () => {
    setSelectedProduct(null)
    reset({ taxRate: 19, stock: 0, minStock: 5 })
    setProductModal(true)
  }

  const openEdit = (p: Product) => {
    setSelectedProduct(p)
    reset({
      name: p.name, sku: p.sku, barcode: p.barcode, category: p.category?.name ?? '',
      brandId: p.brandId, costPrice: p.costPrice, salePrice: p.salePrice,
      taxRate: p.taxRate, stock: p.stock, minStock: p.minStock,
      binLocation: p.binLocation, description: p.description,
    })
    setProductModal(true)
  }

  const openStockAdjust = (p: Product) => {
    setSelectedProduct(p)
    resetStock({ type: 'ENTRY', quantity: undefined as unknown as number, reason: '' })
    setStockModal(true)
  }

  const onSaveProduct = async (data: ProductInput) => {
    setSaving(true)
    try {
      // Resolve free-text category name → categoryId
      const categoryName = data.category.trim()
      let categoryId: string
      const existing = categories.find(
        (c) => c.name.toLowerCase() === categoryName.toLowerCase()
      )
      if (existing) {
        categoryId = existing.id
      } else {
        const codePrefix = categoryName
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .substring(0, 6)
          .padEnd(2, 'X')
        const newCat = await inventoryService.createFullCategory({ name: categoryName, codePrefix })
        categoryId = newCat.id
        setCategories((prev) => [...prev, newCat])
      }

      const { category: _cat, ...formData } = data
      const payload = { ...formData, categoryId }

      if (selectedProduct) {
        const updated = await inventoryService.updateProduct(selectedProduct.id, payload)
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        toast.success('Producto actualizado')
      } else {
        await inventoryService.createProduct(payload)
        toast.success('Producto creado')
        load(search, categoryFilter, lowStockFilter, 1)
        setPage(1)
      }
      setProductModal(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al guardar producto'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const onAdjustStock = async (data: AdjustStockInput) => {
    if (!selectedProduct) return
    setSaving(true)
    try {
      await inventoryService.adjustStock(selectedProduct.id, data)
      toast.success('Stock actualizado correctamente')
      setStockModal(false)
      load(search, categoryFilter, lowStockFilter, page)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al ajustar stock'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!selectedProduct) return
    setDeleting(true)
    try {
      await inventoryService.deleteProduct(selectedProduct.id)
      toast.success('Producto eliminado')
      setDeleteDialog(false)
      load(search, categoryFilter, lowStockFilter, page)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al eliminar'
      toast.error(msg)
    } finally {
      setDeleting(false)
    }
  }

  const handleExport = async () => {
    if (products.length === 0) { toast.warning('No hay productos para exportar'); return }
    try {
      await exportProductsToExcel(products)
      toast.success('Excel exportado correctamente')
    } catch { toast.error('Error al exportar') }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const res = await inventoryService.importFromExcel(file)
      toast.success(`${res.imported} productos importados`)
      if (res.errors?.length) toast.warning(`${res.errors.length} registros con errores`)
      load(search, categoryFilter, lowStockFilter, 1)
    } catch { toast.error('Error al importar Excel') } finally {
      e.target.value = ''
    }
  }

  const stockBadge = (p: Product) => {
    if (p.stock <= 0) return <Badge variant="red">{p.stock}</Badge>
    if (p.stock <= (p.minStock ?? 5)) return <Badge variant="yellow">{p.stock}</Badge>
    return <Badge variant="green">{p.stock}</Badge>
  }

  return (
    <div>
      <PageHeader
        title="Inventario"
        description="Gestión de productos y stock"
        actions={
          <div className="flex gap-2">
            <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
            <button className="btn-outline btn-sm" onClick={() => importRef.current?.click()}>
              <Upload className="w-4 h-4" /> Importar
            </button>
            <button className="btn-outline btn-sm" onClick={handleExport}>
              <Download className="w-4 h-4" /> Exportar
            </button>
            <button className="btn-primary btn-sm" onClick={openCreate}>
              <Plus className="w-4 h-4" /> Agregar Producto
            </button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <SearchInput value={search} onChange={handleSearch} placeholder="Buscar por nombre o SKU..." className="w-72" />
          <select
            className="input-field w-48"
            value={categoryFilter}
            onChange={(e) => handleFilterChange(e.target.value, lowStockFilter)}
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={lowStockFilter}
              onChange={(e) => handleFilterChange(categoryFilter, e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400"
            />
            <SlidersHorizontal className="w-4 h-4" />
            Solo bajo stock
          </label>
          {(search || categoryFilter || lowStockFilter) && (
            <button className="btn-ghost btn-sm text-gray-500" onClick={() => { setSearch(''); setCategoryFilter(''); setLowStockFilter(false); load('', '', false, 1); setPage(1) }}>
              Limpiar filtros
            </button>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <TableSkeleton rows={8} cols={7} />
          ) : products.length === 0 ? (
            <EmptyState
              icon={<Package className="w-8 h-8" />}
              title="Sin productos"
              description="No se encontraron productos con los filtros aplicados."
              action={<button className="btn-primary btn-sm" onClick={openCreate}><Plus className="w-4 h-4" /> Agregar primero</button>}
            />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-th">SKU</th>
                  <th className="table-th">Nombre</th>
                  <th className="table-th">Categoría</th>
                  <th className="table-th">Precio Venta</th>
                  <th className="table-th">Costo</th>
                  <th className="table-th">Stock</th>
                  <th className="table-th">Ubicación</th>
                  <th className="table-th">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="table-row">
                    <td className="table-td font-mono text-xs text-gray-500">{p.sku || '—'}</td>
                    <td className="table-td">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                        {p.barcode && <p className="text-xs text-gray-400">{p.barcode}</p>}
                      </div>
                    </td>
                    <td className="table-td text-gray-500">{p.category?.name ?? '—'}</td>
                    <td className="table-td font-semibold text-gray-900">{formatCOP(p.salePrice)}</td>
                    <td className="table-td text-gray-500">{formatCOP(p.costPrice)}</td>
                    <td className="table-td">{stockBadge(p)}</td>
                    <td className="table-td text-gray-500 text-xs">{p.binLocation || '—'}</td>
                    <td className="table-td">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openStockAdjust(p)}
                          className="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition-colors"
                          title="Ajustar stock"
                        >
                          <SlidersHorizontal className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                          title="Editar"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setSelectedProduct(p); setDeleteDialog(true) }}
                          className="p-1.5 rounded hover:bg-red-50 text-red-500 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {!loading && products.length > 0 && (
          <Pagination page={page} totalPages={totalPages} total={total} limit={LIMIT} onPageChange={(p) => { setPage(p); load(search, categoryFilter, lowStockFilter, p) }} />
        )}
      </Card>

      {/* Product Modal */}
      <Modal
        open={productModal}
        onClose={() => setProductModal(false)}
        title={selectedProduct ? 'Editar Producto' : 'Nuevo Producto'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setProductModal(false)}>Cancelar</button>
            <button className="btn-primary" form="product-form" type="submit" disabled={saving}>
              {saving && <Spinner size="sm" />} {selectedProduct ? 'Actualizar' : 'Crear Producto'}
            </button>
          </div>
        }
      >
        <form id="product-form" onSubmit={handleSubmit(onSaveProduct)} className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Nombre del Producto *</label>
            <input className={`input-field ${errors.name ? 'input-error' : ''}`} {...register('name')} placeholder="Ej: Aceite motor 4T 20W50 1L" />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="label">SKU Interno</label>
            <input className="input-field" {...register('sku')} placeholder="Ej: ACE-4T-001" />
          </div>
          <div>
            <label className="label">Código de Barras</label>
            <input className="input-field" {...register('barcode')} placeholder="EAN-13 o UPC-A" />
          </div>
          <div>
            <label className="label">Categoría *</label>
            <input className={`input-field ${errors.category ? 'input-error' : ''}`} {...register('category')} placeholder="Ej: Aceites, Filtros, Frenos..." />
            {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category.message}</p>}
          </div>
          <div>
            <label className="label">Ubicación (Bin)</label>
            <input className="input-field" {...register('binLocation')} placeholder="Ej: A-12-3" />
          </div>
          <div>
            <label className="label">Precio Costo *</label>
            <input type="number" step="1" min="0" className={`input-field ${errors.costPrice ? 'input-error' : ''}`} {...register('costPrice', { valueAsNumber: true })} placeholder="0" />
            {errors.costPrice && <p className="text-red-500 text-xs mt-1">{errors.costPrice.message}</p>}
          </div>
          <div>
            <label className="label">Precio Venta *</label>
            <input type="number" step="1" min="0" className={`input-field ${errors.salePrice ? 'input-error' : ''}`} {...register('salePrice', { valueAsNumber: true })} placeholder="0" />
            {errors.salePrice && <p className="text-red-500 text-xs mt-1">{errors.salePrice.message}</p>}
          </div>
          <div>
            <label className="label">IVA (%)</label>
            <input type="number" step="1" min="0" max="100" className="input-field" {...register('taxRate', { valueAsNumber: true })} defaultValue={19} />
          </div>
          <div>
            <label className="label">Stock Inicial</label>
            <input type="number" step="1" min="0" className="input-field" {...register('stock', { valueAsNumber: true })} />
          </div>
          <div>
            <label className="label">Stock Mínimo</label>
            <input type="number" step="1" min="0" className="input-field" {...register('minStock', { valueAsNumber: true })} />
          </div>
          <div className="col-span-2">
            <label className="label">Descripción</label>
            <textarea className="input-field resize-none" rows={2} {...register('description')} placeholder="Descripción opcional..." />
          </div>
        </form>
      </Modal>

      {/* Stock Adjust Modal */}
      <Modal
        open={stockModal}
        onClose={() => setStockModal(false)}
        title={`Ajustar Stock — ${selectedProduct?.name ?? ''}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setStockModal(false)}>Cancelar</button>
            <button className="btn-secondary" form="stock-form" type="submit" disabled={saving}>
              {saving && <Spinner size="sm" />} Aplicar Ajuste
            </button>
          </div>
        }
      >
        <form id="stock-form" onSubmit={handleStockSubmit(onAdjustStock)} className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <span className="text-gray-500">Stock actual: </span>
            <span className="font-bold text-gray-900">{formatNumber(selectedProduct?.stock ?? 0)} unidades</span>
          </div>
          <div>
            <label className="label">Tipo de Movimiento *</label>
            <select className="input-field" {...regStock('type')}>
              {STOCK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Cantidad *</label>
            <input type="number" step="1" min="1" className={`input-field ${stockErrors.quantity ? 'input-error' : ''}`} {...regStock('quantity', { valueAsNumber: true })} placeholder="0" />
            {stockErrors.quantity && <p className="text-red-500 text-xs mt-1">{stockErrors.quantity.message}</p>}
          </div>
          <div>
            <label className="label">Motivo *</label>
            <input className={`input-field ${stockErrors.reason ? 'input-error' : ''}`} {...regStock('reason')} placeholder="Ej: Compra a proveedor XYZ" />
            {stockErrors.reason && <p className="text-red-500 text-xs mt-1">{stockErrors.reason.message}</p>}
          </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteDialog}
        title="Eliminar Producto"
        message={`¿Seguro que deseas eliminar "${selectedProduct?.name}"? Esta acción no se puede deshacer.`}
        confirmLabel="Sí, Eliminar"
        loading={deleting}
        onConfirm={onDelete}
        onCancel={() => setDeleteDialog(false)}
      />
    </div>
  )
}
