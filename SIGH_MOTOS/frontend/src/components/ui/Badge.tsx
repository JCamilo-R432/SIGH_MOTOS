import { cn } from '@/utils/helpers'

type Variant = 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'orange' | 'purple'

interface Props {
  variant?: Variant
  children: React.ReactNode
  className?: string
}

const variantMap: Record<Variant, string> = {
  green:  'bg-green-100  text-green-800',
  red:    'bg-red-100    text-red-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  blue:   'bg-blue-100   text-blue-800',
  gray:   'bg-gray-100   text-gray-700',
  orange: 'bg-orange-100 text-orange-800',
  purple: 'bg-purple-100 text-purple-800',
}

export const Badge = ({ variant = 'gray', children, className }: Props) => (
  <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', variantMap[variant], className)}>
    {children}
  </span>
)
