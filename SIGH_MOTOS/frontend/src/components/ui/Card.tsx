import { cn } from '@/utils/helpers'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export const Card = ({ children, className, ...props }: CardProps) => (
  <div className={cn('bg-white rounded-xl border border-gray-200 shadow-card', className)} {...props}>
    {children}
  </div>
)

export const CardHeader = ({ children, className, ...props }: CardProps) => (
  <div className={cn('px-6 py-4 border-b border-gray-100', className)} {...props}>
    {children}
  </div>
)

export const CardBody = ({ children, className, ...props }: CardProps) => (
  <div className={cn('px-6 py-4', className)} {...props}>
    {children}
  </div>
)

export const CardFooter = ({ children, className, ...props }: CardProps) => (
  <div className={cn('px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl', className)} {...props}>
    {children}
  </div>
)

interface KpiCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: React.ReactNode
  trend?: { value: number; label: string }
  color?: 'blue' | 'orange' | 'green' | 'red'
}

const kpiColors = {
  blue:   { bg: 'bg-blue-50',   icon: 'text-blue-600',   text: 'text-blue-900' },
  orange: { bg: 'bg-orange-50', icon: 'text-orange-600', text: 'text-orange-900' },
  green:  { bg: 'bg-green-50',  icon: 'text-green-600',  text: 'text-green-900' },
  red:    { bg: 'bg-red-50',    icon: 'text-red-600',    text: 'text-red-900' },
}

export const KpiCard = ({ title, value, subtitle, icon, trend, color = 'blue' }: KpiCardProps) => {
  const c = kpiColors[color]
  return (
    <Card className="hover:shadow-card-hover transition-shadow duration-200">
      <CardBody className="flex items-start gap-4 py-5">
        {icon && (
          <div className={cn('p-3 rounded-lg flex-shrink-0', c.bg)}>
            <span className={cn('block w-6 h-6', c.icon)}>{icon}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-500 font-medium truncate">{title}</p>
          <p className={cn('text-2xl font-bold mt-0.5', c.text)}>{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          {trend && (
            <p className={cn('text-xs font-medium mt-1', trend.value >= 0 ? 'text-green-600' : 'text-red-500')}>
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
