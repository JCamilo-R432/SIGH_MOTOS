import { AlertTriangle } from 'lucide-react'
import { Spinner } from './Spinner'

interface Props {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'info'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmDialog = ({
  open,
  title = '¿Confirmar acción?',
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  loading,
  onConfirm,
  onCancel,
}: Props) => {
  if (!open) return null

  const btnCls = variant === 'danger'
    ? 'btn-destructive'
    : variant === 'warning'
    ? 'bg-yellow-500 hover:bg-yellow-600 text-white btn'
    : 'btn-secondary'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-sm p-6 animate-slide-in">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 mt-6 justify-end">
          <button className="btn-outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button className={btnCls} onClick={onConfirm} disabled={loading}>
            {loading && <Spinner size="sm" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
