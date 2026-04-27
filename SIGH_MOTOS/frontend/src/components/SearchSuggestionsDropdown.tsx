import { useEffect, useRef, useState } from 'react'
import { Search, Package } from 'lucide-react'
import api from '@/services/api'
import type { Product } from '@/types'
import { formatCOP } from '@/utils/formatters'

interface Props {
  query: string
  onSelect: (product: Product) => void
  visible: boolean
}

export function SearchSuggestionsDropdown({ query, onSelect, visible }: Props) {
  const [results, setResults] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!visible || query.length < 2) {
      setResults([])
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const { data } = await api.get('/pos/products/search', { params: { query, limit: 10 } })
        const rawList: Record<string, unknown>[] = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []
        // Normalize field names from backend (nameCommercial → name, stockQuantity → stock, etc.)
        const normalized = rawList.map((p) => ({
          id: p.id as string,
          sku: (p.skuInternal ?? p.sku) as string,
          barcode: (p.barcodeExternal ?? p.barcode) as string | undefined,
          name: (p.nameCommercial ?? p.name) as string,
          description: p.descriptionTech as string | undefined,
          categoryId: (p.categoryId ?? '') as string,
          category: p.category as Product['category'],
          brandId: p.brandId as string | undefined,
          brand: p.brand as Product['brand'],
          costPrice: Number(p.costPriceAvg ?? p.costPrice ?? 0),
          salePrice: Number(p.salePriceBase ?? p.salePrice ?? 0),
          taxRate: Number(p.taxRate ?? 19),
          stock: Number(p.stockQuantity ?? p.stock ?? 0),
          minStock: Number(p.minStockLevel ?? p.minStock ?? 5),
          binLocation: (p.locationBin ?? p.binLocation) as string | undefined,
          imageUrl: p.imageKey as string | undefined,
          isActive: Boolean(p.isActive ?? true),
          createdAt: p.createdAt as string,
          updatedAt: p.updatedAt as string,
        })) as Product[]
        setResults(normalized as Product[])
        setActiveIndex(-1)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, visible])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!visible || results.length === 0) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, -1)) }
      if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault()
        onSelect(results[activeIndex]!)
        setResults([])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible, results, activeIndex, onSelect])

  if (!visible || query.length < 2) return null
  if (!loading && results.length === 0) return null

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden max-h-72 overflow-y-auto">
      {loading ? (
        <div className="px-4 py-3 text-sm text-gray-400 flex items-center gap-2">
          <Search className="w-4 h-4 animate-pulse" />
          Buscando...
        </div>
      ) : (
        results.map((product, i) => (
          <button
            key={product.id}
            className={`w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0 ${activeIndex === i ? 'bg-blue-50' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); onSelect(product); setResults([]) }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Package className="w-4 h-4 text-gray-300 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                  <p className="text-xs text-gray-400">{product.sku}{product.barcode ? ` · ${product.barcode}` : ''}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold text-blue-700">{formatCOP(product.salePrice)}</p>
                <p className={`text-xs ${product.stock <= 0 ? 'text-red-500' : 'text-gray-400'}`}>
                  Stock: {product.stock}
                </p>
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  )
}
