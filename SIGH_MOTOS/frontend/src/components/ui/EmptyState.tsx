import { cn } from '@/utils/helpers'

interface Props {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export const EmptyState = ({ icon, title, description, action, className }: Props) => (
  <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
    {icon && (
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4 text-gray-400">
        {icon}
      </div>
    )}
    <h3 className="text-base font-semibold text-gray-700">{title}</h3>
    {description && <p className="text-sm text-gray-500 mt-1 max-w-sm">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)
