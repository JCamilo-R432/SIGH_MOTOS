import { useState } from 'react'
import { toast } from 'sonner'
import { DollarSign } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { debtService, type Debt } from '@/services/debtService'
import { formatCOP } from '@/utils/formatters'

interface Props {
  debt: Debt | null
  open: boolean
  onClose: () => void
  onSuccess: (updatedDebt: Debt) => void
}

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'CARD', label: 'Tarjeta' },
  { value: 'TRANSFER', label: 'Transferencia' },
]

export function PayDebtModal({ debt, open, onClose, onSuccess }: Props) {
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const remaining = debt ? Number(debt.remainingBalance) : 0

  const handleClose = () => {
    setAmount('')
    setNotes('')
    setPaymentMethod('CASH')
    onClose()
  }

  const handleConfirm = async () => {
    if (!debt) return
    const num = parseFloat(amount)
    if (isNaN(num) || num <= 0) { toast.error('Ingresa un monto válido mayor a 0'); return }
    if (num > remaining + 0.01) { toast.error(`El monto supera el saldo restante ${formatCOP(remaining)}`); return }

    setSaving(true)
    try {
      const result = await debtService.registerPayment(debt.id, {
        amount: num,
        paymentMethod,
        notes: notes || undefined,
      })
      toast.success(result.message ?? 'Abono registrado correctamente')
      onSuccess(result.debt)
      handleClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al registrar el abono'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  if (!debt) return null

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Registrar Abono"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={handleClose} disabled={saving}>Cancelar</button>
          <button className="btn-primary" onClick={handleConfirm} disabled={saving || !amount}>
            {saving && <Spinner size="sm" />}
            Confirmar Abono
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Debt info */}
        <div className="bg-blue-50 rounded-lg p-3 text-sm space-y-1">
          <p className="font-semibold text-blue-900">{debt.customer.name}</p>
          <p className="text-blue-600">Venta: {debt.sale.saleNumber}</p>
          <div className="flex justify-between text-blue-700 font-medium mt-2">
            <span>Deuda total:</span><span>{formatCOP(debt.totalDebt)}</span>
          </div>
          <div className="flex justify-between text-blue-700">
            <span>Abonado:</span><span>{formatCOP(debt.paidAmount)}</span>
          </div>
          <div className="flex justify-between text-orange-700 font-bold border-t border-blue-200 pt-1">
            <span>Saldo restante:</span><span>{formatCOP(remaining)}</span>
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="label">Monto del Abono (COP) *</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="number"
              min="1"
              step="1000"
              max={remaining}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-field pl-9"
              placeholder="0"
              autoFocus
            />
          </div>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              className="text-xs btn-outline py-1 px-2"
              onClick={() => setAmount(String(remaining))}
            >
              Pago total ({formatCOP(remaining)})
            </button>
            <button
              type="button"
              className="text-xs btn-outline py-1 px-2"
              onClick={() => setAmount(String(Math.round(remaining / 2)))}
            >
              50%
            </button>
          </div>
        </div>

        {/* Payment method */}
        <div>
          <label className="label">Método de Pago</label>
          <select className="input-field" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="label">Observaciones</label>
          <input
            type="text"
            className="input-field"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Referencia de transferencia, etc."
          />
        </div>
      </div>
    </Modal>
  )
}
