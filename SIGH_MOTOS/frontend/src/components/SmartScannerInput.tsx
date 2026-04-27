import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Barcode, CheckCircle, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { posService } from '@/services/posService'
import { SearchSuggestionsDropdown } from '@/components/SearchSuggestionsDropdown'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'
import { formatCOP } from '@/utils/formatters'
import { beepSound } from '@/utils/helpers'
import type { Product } from '@/types'

export interface SmartScannerHandle {
  focus: () => void
}

interface Props {
  onProductScanned: (product: Product) => void
  disabled?: boolean
}

export const SmartScannerInput = forwardRef<SmartScannerHandle, Props>(
  function SmartScannerInput({ onProductScanned, disabled }, ref) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [value, setValue] = useState('')
    const [scanning, setScanning] = useState(false)
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [lastScanned, setLastScanned] = useState<Product | null>(null)

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }))

    const refocus = () => setTimeout(() => inputRef.current?.focus(), 50)

    const addProduct = (product: Product) => {
      if (product.stock <= 0) {
        toast.error(`Sin stock: "${product.name}"`)
        return
      }
      beepSound()
      setLastScanned(product)
      toast.success(`Agregado: ${product.name}`)
      onProductScanned(product)
      setValue('')
      setShowSuggestions(false)
      refocus()
    }

    const handleScan = async () => {
      const code = value.trim()
      if (!code) return
      setShowSuggestions(false)
      setScanning(true)
      try {
        const product = await posService.scanProduct(code)
        if (!product) {
          toast.error(`Código no encontrado: "${code}"`)
          refocus()
          return
        }
        addProduct(product)
      } catch {
        toast.error('Error al escanear producto')
        refocus()
      } finally {
        setScanning(false)
      }
    }

    return (
      <Card className="p-4 space-y-3">
        <label className="label">Código de barras / Nombre de producto</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setShowSuggestions(e.target.value.length >= 2)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleScan() }
                if (e.key === 'Escape') { setValue(''); setShowSuggestions(false) }
              }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              onFocus={() => value.length >= 2 && setShowSuggestions(true)}
              placeholder="Escanear código o escribir nombre..."
              className="input-field pl-9"
              autoComplete="off"
              disabled={disabled || scanning}
            />
            <SearchSuggestionsDropdown
              query={value}
              visible={showSuggestions}
              onSelect={addProduct}
            />
          </div>
          <button
            className="btn-secondary"
            onClick={handleScan}
            disabled={disabled || scanning || !value.trim()}
          >
            {scanning ? <Spinner size="sm" /> : <Plus className="w-4 h-4" />}
            Agregar
          </button>
        </div>

        {lastScanned && (
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm animate-fade-in">
            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-green-900 truncate">{lastScanned.name}</p>
              <p className="text-xs text-green-600">{lastScanned.sku} · Stock: {lastScanned.stock}</p>
            </div>
            <p className="font-semibold text-green-700 flex-shrink-0">{formatCOP(lastScanned.salePrice)}</p>
          </div>
        )}
      </Card>
    )
  }
)
