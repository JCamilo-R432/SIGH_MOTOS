import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Plus, Edit, Trash2, Tag, Layers } from 'lucide-react'
import { inventoryService, type Brand } from '@/services/inventoryService'
import type { Category } from '@/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

type ActiveTab = 'brands' | 'categories'

interface BrandForm { name: string; logoUrl?: string }
interface CategoryForm { name: string; codePrefix: string; marginPercentage?: number }

export default function Classifications() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('brands')

  // ── Brands state ────────────────────────────────────────────────────────
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandsLoading, setBrandsLoading] = useState(true)
  const [brandModal, setBrandModal] = useState(false)
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null)
  const [brandSaving, setBrandSaving] = useState(false)
  const [confirmDeleteBrand, setConfirmDeleteBrand] = useState<Brand | null>(null)

  // ── Categories state ────────────────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([])
  const [catsLoading, setCatsLoading] = useState(true)
  const [catModal, setCatModal] = useState(false)
  const [selectedCat, setSelectedCat] = useState<Category | null>(null)
  const [catSaving, setCatSaving] = useState(false)
  const [confirmDeleteCat, setConfirmDeleteCat] = useState<Category | null>(null)

  // ── Forms ───────────────────────────────────────────────────────────────
  const brandForm = useForm<BrandForm>()
  const catForm   = useForm<CategoryForm>({ defaultValues: { marginPercentage: 30 } })

  // ── Loaders ─────────────────────────────────────────────────────────────
  const loadBrands = useCallback(async () => {
    setBrandsLoading(true)
    try { setBrands(await inventoryService.getBrands()) }
    catch { toast.error('Error al cargar marcas') }
    finally { setBrandsLoading(false) }
  }, [])

  const loadCategories = useCallback(async () => {
    setCatsLoading(true)
    try { setCategories(await inventoryService.getAllCategories()) }
    catch { toast.error('Error al cargar categorías') }
    finally { setCatsLoading(false) }
  }, [])

  useEffect(() => { loadBrands(); loadCategories() }, [loadBrands, loadCategories])

  // ── Brand handlers ───────────────────────────────────────────────────────
  const openBrandCreate = () => {
    setSelectedBrand(null)
    brandForm.reset({ name: '', logoUrl: '' })
    setBrandModal(true)
  }
  const openBrandEdit = (b: Brand) => {
    setSelectedBrand(b)
    brandForm.reset({ name: b.name, logoUrl: b.logoUrl ?? '' })
    setBrandModal(true)
  }
  const onSaveBrand = async (data: BrandForm) => {
    setBrandSaving(true)
    try {
      const payload = { name: data.name, ...(data.logoUrl ? { logoUrl: data.logoUrl } : {}) }
      if (selectedBrand) {
        await inventoryService.updateBrand(selectedBrand.id, payload)
        toast.success('Marca actualizada')
      } else {
        await inventoryService.createBrand(payload)
        toast.success('Marca creada')
      }
      setBrandModal(false)
      loadBrands()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al guardar la marca'
      toast.error(msg)
    } finally { setBrandSaving(false) }
  }
  const deleteBrand = async (b: Brand) => {
    try {
      await inventoryService.deleteBrand(b.id)
      toast.success('Marca desactivada')
      loadBrands()
    } catch { toast.error('No se puede eliminar: la marca tiene productos activos') }
    finally { setConfirmDeleteBrand(null) }
  }

  // ── Category handlers ────────────────────────────────────────────────────
  const openCatCreate = () => {
    setSelectedCat(null)
    catForm.reset({ name: '', codePrefix: '', marginPercentage: 30 })
    setCatModal(true)
  }
  const openCatEdit = (c: Category) => {
    setSelectedCat(c)
    catForm.reset({
      name: c.name,
      codePrefix: (c as Category & { codePrefix?: string }).codePrefix ?? '',
      marginPercentage: Number((c as Category & { marginPercentage?: number }).marginPercentage ?? 30),
    })
    setCatModal(true)
  }
  const onSaveCat = async (data: CategoryForm) => {
    setCatSaving(true)
    try {
      if (selectedCat) {
        await inventoryService.updateCategory(selectedCat.id, data)
        toast.success('Categoría actualizada')
      } else {
        await inventoryService.createFullCategory(data)
        toast.success('Categoría creada')
      }
      setCatModal(false)
      loadCategories()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al guardar la categoría'
      toast.error(msg)
    } finally { setCatSaving(false) }
  }
  const deleteCategory = async (c: Category) => {
    try {
      await inventoryService.deleteCategory(c.id)
      toast.success('Categoría desactivada')
      loadCategories()
    } catch { toast.error('No se puede eliminar: la categoría tiene productos activos') }
    finally { setConfirmDeleteCat(null) }
  }

  return (
    <div>
      <PageHeader
        title="Marcas y Categorías"
        description="Gestión de las clasificaciones del inventario"
        actions={
          activeTab === 'brands'
            ? <button className="btn-primary btn-sm" onClick={openBrandCreate}><Plus className="w-4 h-4" /> Nueva Marca</button>
            : <button className="btn-primary btn-sm" onClick={openCatCreate}><Plus className="w-4 h-4" /> Nueva Categoría</button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        <button onClick={() => setActiveTab('brands')} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'brands' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Tag className="w-4 h-4" /> Marcas
        </button>
        <button onClick={() => setActiveTab('categories')} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'categories' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Layers className="w-4 h-4" /> Categorías
        </button>
      </div>

      {/* Brands Tab */}
      {activeTab === 'brands' && (
        <Card className="overflow-hidden">
          {brandsLoading ? (
            <div className="flex justify-center p-8"><Spinner /></div>
          ) : brands.length === 0 ? (
            <EmptyState icon={<Tag className="w-8 h-8" />} title="Sin marcas" action={<button className="btn-primary btn-sm" onClick={openBrandCreate}><Plus className="w-4 h-4" /> Crear primera marca</button>} />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-th">Nombre</th>
                  <th className="table-th">Estado</th>
                  <th className="table-th">Logo URL</th>
                  <th className="table-th">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.id} className="table-row">
                    <td className="table-td font-medium">{b.name}</td>
                    <td className="table-td"><Badge variant={b.isActive ? 'green' : 'red'}>{b.isActive ? 'Activa' : 'Inactiva'}</Badge></td>
                    <td className="table-td text-gray-400 text-xs truncate max-w-xs">{b.logoUrl ?? '—'}</td>
                    <td className="table-td">
                      <div className="flex gap-1">
                        <button onClick={() => openBrandEdit(b)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Editar"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => setConfirmDeleteBrand(b)} className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Desactivar"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <Card className="overflow-hidden">
          {catsLoading ? (
            <div className="flex justify-center p-8"><Spinner /></div>
          ) : categories.length === 0 ? (
            <EmptyState icon={<Layers className="w-8 h-8" />} title="Sin categorías" action={<button className="btn-primary btn-sm" onClick={openCatCreate}><Plus className="w-4 h-4" /> Crear primera categoría</button>} />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-th">Nombre</th>
                  <th className="table-th">Prefijo SKU</th>
                  <th className="table-th">Margen %</th>
                  <th className="table-th">Estado</th>
                  <th className="table-th">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id} className="table-row">
                    <td className="table-td font-medium">{c.name}</td>
                    <td className="table-td"><span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{(c as Category & { codePrefix?: string }).codePrefix ?? '—'}</span></td>
                    <td className="table-td text-gray-500">{(c as Category & { marginPercentage?: number }).marginPercentage ?? '—'}%</td>
                    <td className="table-td"><Badge variant={(c as Category & { isActive?: boolean }).isActive !== false ? 'green' : 'red'}>{(c as Category & { isActive?: boolean }).isActive !== false ? 'Activa' : 'Inactiva'}</Badge></td>
                    <td className="table-td">
                      <div className="flex gap-1">
                        <button onClick={() => openCatEdit(c)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Editar"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => setConfirmDeleteCat(c)} className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Desactivar"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* Brand Modal */}
      <Modal
        open={brandModal}
        onClose={() => setBrandModal(false)}
        title={selectedBrand ? 'Editar Marca' : 'Nueva Marca'}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setBrandModal(false)}>Cancelar</button>
            <button className="btn-secondary" form="brand-form" type="submit" disabled={brandSaving}>
              {brandSaving && <Spinner size="sm" />} {selectedBrand ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        }
      >
        <form id="brand-form" onSubmit={brandForm.handleSubmit(onSaveBrand)} className="space-y-4">
          <div>
            <label className="label">Nombre de la Marca *</label>
            <input className={`input-field ${brandForm.formState.errors.name ? 'input-error' : ''}`} {...brandForm.register('name', { required: 'Requerido', minLength: { value: 2, message: 'Mínimo 2 caracteres' } })} placeholder="Honda, Yamaha, AKT..." />
            {brandForm.formState.errors.name && <p className="text-red-500 text-xs mt-1">{brandForm.formState.errors.name.message}</p>}
          </div>
          <div>
            <label className="label">URL del Logo (opcional)</label>
            <input className="input-field" {...brandForm.register('logoUrl')} placeholder="https://..." />
          </div>
        </form>
      </Modal>

      {/* Category Modal */}
      <Modal
        open={catModal}
        onClose={() => setCatModal(false)}
        title={selectedCat ? 'Editar Categoría' : 'Nueva Categoría'}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setCatModal(false)}>Cancelar</button>
            <button className="btn-secondary" form="cat-form" type="submit" disabled={catSaving}>
              {catSaving && <Spinner size="sm" />} {selectedCat ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        }
      >
        <form id="cat-form" onSubmit={catForm.handleSubmit(onSaveCat)} className="space-y-4">
          <div>
            <label className="label">Nombre de la Categoría *</label>
            <input className={`input-field ${catForm.formState.errors.name ? 'input-error' : ''}`} {...catForm.register('name', { required: 'Requerido', minLength: { value: 2, message: 'Mínimo 2 caracteres' } })} placeholder="Frenos, Motor, Eléctrico..." />
            {catForm.formState.errors.name && <p className="text-red-500 text-xs mt-1">{catForm.formState.errors.name.message}</p>}
          </div>
          <div>
            <label className="label">Prefijo de SKU *</label>
            <input className={`input-field uppercase ${catForm.formState.errors.codePrefix ? 'input-error' : ''}`} {...catForm.register('codePrefix', { required: 'Requerido', minLength: { value: 2, message: 'Mínimo 2 caracteres' }, maxLength: { value: 6, message: 'Máximo 6 caracteres' } })} placeholder="FREN, MOT, ELEC..." style={{ textTransform: 'uppercase' }} />
            {catForm.formState.errors.codePrefix && <p className="text-red-500 text-xs mt-1">{catForm.formState.errors.codePrefix.message}</p>}
            <p className="text-gray-400 text-xs mt-1">Se usa para generar SKUs automáticos. Ej: "FREN" → FREN-HON-001</p>
          </div>
          <div>
            <label className="label">Margen de Ganancia por Defecto (%)</label>
            <input type="number" step="0.01" min="0" max="99" className="input-field" {...catForm.register('marginPercentage', { valueAsNumber: true })} />
          </div>
        </form>
      </Modal>

      {/* Confirm Delete Brand */}
      <ConfirmDialog
        open={!!confirmDeleteBrand}
        title="Desactivar Marca"
        message={`¿Desactivar la marca "${confirmDeleteBrand?.name}"? Solo se desactiva si no tiene productos activos.`}
        confirmLabel="Desactivar"
        variant="danger"
        onConfirm={() => confirmDeleteBrand && deleteBrand(confirmDeleteBrand)}
        onCancel={() => setConfirmDeleteBrand(null)}
      />

      {/* Confirm Delete Category */}
      <ConfirmDialog
        open={!!confirmDeleteCat}
        title="Desactivar Categoría"
        message={`¿Desactivar la categoría "${confirmDeleteCat?.name}"? Solo se desactiva si no tiene productos activos.`}
        confirmLabel="Desactivar"
        variant="danger"
        onConfirm={() => confirmDeleteCat && deleteCategory(confirmDeleteCat)}
        onCancel={() => setConfirmDeleteCat(null)}
      />
    </div>
  )
}
