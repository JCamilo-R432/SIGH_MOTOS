import { cn } from '@/utils/helpers'

interface Props {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = { sm: 'w-4 h-4 border-2', md: 'w-6 h-6 border-2', lg: 'w-8 h-8 border-[3px]' }

export const Spinner = ({ size = 'md', className }: Props) => (
  <div
    className={cn(
      'rounded-full border-gray-200 border-t-orange-500 animate-spin',
      sizes[size],
      className
    )}
  />
)
