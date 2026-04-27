import { Search, X } from 'lucide-react'
import { cn } from '@/utils/helpers'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
  onEnter?: () => void
}

export const SearchInput = ({ value, onChange, placeholder = 'Buscar...', className, autoFocus, onEnter }: Props) => (
  <div className={cn('relative', className)}>
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter() }}
      className="input-field pl-9 pr-8"
    />
    {value && (
      <button
        onClick={() => onChange('')}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
      >
        <X className="w-3.5 h-3.5 text-gray-400" />
      </button>
    )}
  </div>
)
