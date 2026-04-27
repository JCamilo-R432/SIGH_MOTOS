import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Save, Settings as SettingsIcon, RefreshCw } from 'lucide-react'
import { configService, type BusinessConfig } from '@/services/configService'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'

type ConfigForm = Omit<BusinessConfig, 'id' | 'updatedAt'>

export default function Settings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<ConfigForm>()

  useEffect(() => {
    configService.getConfig()
      .then((cfg) => {
        reset(cfg)
        setLastSaved(cfg.updatedAt)
      })
      .catch(() => toast.error('Error al cargar la configuración'))
      .finally(() => setLoading(false))
  }, [reset])

  const onSubmit = async (data: ConfigForm) => {
    setSaving(true)
    try {
      const updated = await configService.updateConfig(data)
      reset(updated)
      setLastSaved(updated.updatedAt)
      toast.success('Configuración guardada correctamente')
    } catch {
      toast.error('Error al guardar la configuración')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Configuración del Negocio"
        description="Datos de la empresa que aparecen en tickets, facturas y reportes"
        actions={
          <button
            form="settings-form"
            type="submit"
            className="btn-primary btn-sm"
            disabled={saving || !isDirty}
          >
            {saving ? <Spinner size="sm" /> : <Save className="w-4 h-4" />}
            Guardar Cambios
          </button>
        }
      />

      <form id="settings-form" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Datos principales */}
          <Card className="p-6 space-y-4">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <SettingsIcon className="w-4 h-4 text-orange-500" />
              Información del Negocio
            </h2>

            <div>
              <label className="label">Nombre del Negocio *</label>
              <input
                className={`input-field ${errors.businessName ? 'input-error' : ''}`}
                {...register('businessName', { required: 'Requerido' })}
                placeholder="TALLER Y REPUESTOS CLAVIJOS MOTOS"
              />
              {errors.businessName && <p className="text-red-500 text-xs mt-1">{errors.businessName.message}</p>}
            </div>

            <div>
              <label className="label">NIT</label>
              <input
                className="input-field"
                {...register('nit')}
                placeholder="900.123.456-7"
              />
            </div>

            <div>
              <label className="label">Dirección</label>
              <input
                className="input-field"
                {...register('address')}
                placeholder="CRA 16 6-40 AGUACHICA CESAR"
              />
            </div>

            <div>
              <label className="label">Teléfono</label>
              <input
                className="input-field"
                {...register('phone')}
                placeholder="3117379097"
              />
            </div>

            <div>
              <label className="label">Correo Electrónico</label>
              <input
                type="email"
                className="input-field"
                {...register('email')}
                placeholder="contacto@negocio.com"
              />
            </div>
          </Card>

          {/* Configuración fiscal y ticket */}
          <Card className="p-6 space-y-4">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-orange-500" />
              Configuración Fiscal y Ticket
            </h2>

            <div>
              <label className="label">IVA por Defecto (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="50"
                className={`input-field ${errors.taxRate ? 'input-error' : ''}`}
                {...register('taxRate', {
                  valueAsNumber: true,
                  min: { value: 0, message: 'Mínimo 0%' },
                  max: { value: 50, message: 'Máximo 50%' },
                })}
              />
              {errors.taxRate && <p className="text-red-500 text-xs mt-1">{errors.taxRate.message}</p>}
              <p className="text-gray-400 text-xs mt-1">Colombia: 19% para repuestos gravados, 0% para algunos artículos de primera necesidad.</p>
            </div>

            <div>
              <label className="label">Resolución DIAN (opcional)</label>
              <input
                className="input-field"
                {...register('resolutionDian')}
                placeholder="Resolución No. 18760000001 del 2024-01-01"
              />
              <p className="text-gray-400 text-xs mt-1">Aparece en el ticket si se configura.</p>
            </div>

            <div>
              <label className="label">Mensaje del Pie del Ticket</label>
              <textarea
                rows={3}
                className="input-field resize-none"
                {...register('footer')}
                placeholder="¡Gracias por su compra! Garantía según política de fábrica."
              />
            </div>

            {lastSaved && (
              <p className="text-gray-400 text-xs">
                Última actualización: {new Date(lastSaved).toLocaleString('es-CO')}
              </p>
            )}
          </Card>

        </div>

        {/* Info sobre el logo */}
        <Card className="p-6 mt-6">
          <h2 className="font-semibold text-gray-800 mb-2">Logo del Negocio</h2>
          <p className="text-sm text-gray-500">
            El logo se gestiona directamente en el servidor. Coloca el archivo <code className="bg-gray-100 px-1 rounded">logo.png</code> en la carpeta <code className="bg-gray-100 px-1 rounded">uploads/</code> del servidor y configura el campo <strong>logoKey</strong> con el nombre del archivo.
          </p>
          <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-xs text-blue-700">
              <strong>Instrucción:</strong> Sube el logo por SCP/FTP al servidor en <code>/opt/SIGH_MOTOS/uploads/logo.png</code>, luego escribe <code>uploads/logo.png</code> en el campo logoKey y guarda.
            </p>
          </div>
          <div className="mt-3">
            <label className="label">Ruta del Logo (logoKey)</label>
            <input
              className="input-field"
              {...register('logoKey')}
              placeholder="uploads/logo.png"
            />
          </div>
        </Card>
      </form>
    </div>
  )
}
