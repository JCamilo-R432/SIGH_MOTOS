import { cn } from '@/utils/helpers'

interface Props {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}

export const PageHeader = ({ title, description, actions, className }: Props) => (
  <div className={cn('flex items-start justify-between gap-4 mb-6', className)}>
    <div>
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
  </div>
)
