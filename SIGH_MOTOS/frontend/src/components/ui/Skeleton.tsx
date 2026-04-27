import { cn } from '@/utils/helpers'

interface Props {
  className?: string
}

export const Skeleton = ({ className }: Props) => (
  <div className={cn('animate-pulse bg-gray-200 rounded', className)} />
)

export const TableSkeleton = ({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) => (
  <div className="w-full">
    {/* Header */}
    <div className="flex gap-4 px-4 py-3 border-b border-gray-100">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
    {/* Rows */}
    {Array.from({ length: rows }).map((_, ri) => (
      <div key={ri} className="flex gap-4 px-4 py-3 border-b border-gray-100">
        {Array.from({ length: cols }).map((_, ci) => (
          <Skeleton key={ci} className={cn('h-4 flex-1', ci === 0 ? 'max-w-[100px]' : '')} />
        ))}
      </div>
    ))}
  </div>
)

export const CardSkeleton = () => (
  <div className="bg-white rounded-xl border border-gray-200 p-6">
    <div className="flex items-center gap-3 mb-4">
      <Skeleton className="w-10 h-10 rounded-lg" />
      <Skeleton className="h-4 w-32" />
    </div>
    <Skeleton className="h-8 w-24 mb-2" />
    <Skeleton className="h-3 w-20" />
  </div>
)
