import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/helpers'

interface Props {
  page: number
  totalPages: number
  total: number
  limit: number
  onPageChange: (p: number) => void
}

export const Pagination = ({ page, totalPages, total, limit, onPageChange }: Props) => {
  const start = (page - 1) * limit + 1
  const end = Math.min(page * limit, total)

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
      <p className="text-sm text-gray-500">
        Mostrando <span className="font-medium">{start}</span>–<span className="font-medium">{end}</span> de{' '}
        <span className="font-medium">{total}</span> registros
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors')}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          let p = i + 1
          if (totalPages > 5) {
            if (page > 3) p = page - 2 + i
            if (page > totalPages - 2) p = totalPages - 4 + i
          }
          return (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={cn(
                'w-8 h-8 rounded text-sm font-medium transition-colors',
                p === page ? 'bg-blue-900 text-white' : 'hover:bg-gray-100 text-gray-600'
              )}
            >
              {p}
            </button>
          )
        })}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
