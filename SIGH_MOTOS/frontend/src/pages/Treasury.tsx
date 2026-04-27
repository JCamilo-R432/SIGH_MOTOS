import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Landmark, Plus, Lock, Unlock, Download, TrendingUp, TrendingDown } from 'lucide-react'
import { toast } from 'sonner'
import { treasuryService } from '@/services/treasuryService'
import type { CashRegister, TreasuryTransaction } from '@/types'
import {
  openCashRegisterSchema, closeCashRegisterSchema, expenseSchema,
  type OpenCashRegisterInput, type CloseCashRegisterInput, type ExpenseInput,
} from '@/utils/validators'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardHeader, CardBody, KpiCard } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { formatCOP, formatDateTime } from '@/utils/formatters'
import { generateCashReportPDF } from '@/utils/pdfGenerator'
import { DollarSign } from 'lucide-react'

const PAYMENT_METHODS = [
  { value: 'CASH',     label: 'Efectivo' },
  { value: 'CARD',     label: 'Tarjeta' },
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'MIXED',    label: 'Mixto' },
]

export default function Treasury() {
  const [currentRegister, setCurrentRegister] = useState<CashRegister | null>(null)
  const [transactions, setTransactions] = useState<TreasuryTransaction[]>([])
  const [dailyReport, setDailyReport] = useState<{ openingBalance: number; totalSales: number; totalExpenses: number; closingBalance: number } | null>(null)
  const [loading, setLoading] = useState(true)

  const [openModal, setOpenModal] = useState(false)
  const [closeModal, setCloseModal] = useState(false)
  const [expenseModal, setExpenseModal] = useState(false)
  const [saving, setSaving] = useState(false)

  const { register: regOpen, handleSubmit: handleOpenSubmit, reset: resetOpen, formState: { errors: openErrors } } = useForm<OpenCashRegisterInput>({
    resolver: zodResolver(openCashRegisterSchema),
    defaultValues: { openingBalance: 0 },
  })

  const { register: regClose, handleSubmit: handleCloseSubmit, reset: resetClose, formState: { errors: closeErrors } } = useForm<CloseCashRegisterInput>({
    resolver: zodResolver(closeCashRegisterSchema),
  })

  const { register: regExp, handleSubmit: handleExpSubmit, reset: resetExp, formState: { errors: expErrors } } = useForm<ExpenseInput>({
    resolver: zodResolver(expenseSchema),
    defaultValues: { paymentMethod: 'CASH' },
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reg, txns] = await Promise.all([
        treasuryService.getCurrentRegister(),
        treasuryService.getTransactions(),
      ])
      setCurrentRegister(reg)
      setTransactions(txns)

      if (reg) {
        try {
          const report = await treasuryService.getDailyReport()
          setDailyReport(report)
        } catch { /* no report yet */ }
      }
    } catch { /* handled */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const onOpenRegister = async (data: OpenCashRegisterInput) => {
    setSaving(true)
    try {
      const reg = await treasuryService.openRegister(data)
      setCurrentRegister(reg)
      toast.success('Caja abierta correctamente')
      setOpenModal(false)
      resetOpen()
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al abrir caja'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  const onCloseRegister = async (data: CloseCashRegisterInput) => {
    if (!currentRegister) return
    setSaving(true)
    try {
      const reg = await treasuryService.closeRegister(currentRegister.id, data)
      setCurrentRegister(reg)
      toast.success('Caja cerrada correctamente')
      setCloseModal(false)
      resetClose()
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al cerrar caja'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  const onCreateExpense = async (data: ExpenseInput) => {
    setSaving(true)
    try {
      await treasuryService.createExpense({ ...data, cashRegisterId: currentRegister?.id })
      toast.success('Gasto registrado correctamente')
      setExpenseModal(false)
      resetExp()
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al registrar gasto'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  const handleDownloadReport = () => {
    if (!currentRegister) { toast.warning('No hay caja activa'); return }
    generateCashReportPDF(currentRegister, transactions, dailyReport?.totalSales ?? 0)
  }

  const isOpen = currentRegister?.status === 'OPEN'
  const difference = (currentRegister?.difference ?? 0)

  return (
    <div>
      <PageHeader
        title="Tesorería"
        description="Control de caja, gastos y arqueo"
        actions={
          <div className="flex gap-2">
            {isOpen && (
              <>
                <button className="btn-outline btn-sm" onClick={handleDownloadReport}>
                  <Download className="w-4 h-4" /> Reporte PDF
                </button>
                <button className="btn-outline btn-sm" onClick={() => { resetExp(); setExpenseModal(true) }}>
                  <TrendingDown className="w-4 h-4" /> Registrar Gasto
                </button>
                <button className="btn-destructive btn-sm" onClick={() => { resetClose(); setCloseModal(true) }}>
                  <Lock className="w-4 h-4" /> Cerrar Caja
                </button>
              </>
            )}
            {!isOpen && (
              <button className="btn-primary btn-sm" onClick={() => { resetOpen(); setOpenModal(true) }}>
                <Unlock className="w-4 h-4" /> Abrir Caja
              </button>
            )}
          </div>
        }
      />

      {/* Status Banner */}
      {loading ? (
        <div className="h-24 bg-white rounded-xl border border-gray-200 animate-pulse mb-6" />
      ) : currentRegister ? (
        <Card className="mb-6 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isOpen ? 'bg-green-100' : 'bg-gray-100'}`}>
                {isOpen ? <Unlock className="w-6 h-6 text-green-600" /> : <Lock className="w-6 h-6 text-gray-500" />}
              </div>
              <div>
                <p className="font-semibold text-gray-900">Caja {isOpen ? 'Abierta' : 'Cerrada'}</p>
                <p className="text-sm text-gray-500">Abierta: {formatDateTime(currentRegister.openedAt)}</p>
                {currentRegister.closedAt && <p className="text-sm text-gray-500">Cerrada: {formatDateTime(currentRegister.closedAt)}</p>}
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Saldo inicial</p>
              <p className="text-xl font-bold text-gray-900">{formatCOP(currentRegister.openingBalance)}</p>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="mb-6 p-8 text-center">
          <Landmark className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No hay caja activa</p>
          <p className="text-sm text-gray-400 mt-1">Abre la caja para comenzar a registrar movimientos</p>
          <button className="btn-primary btn-sm mt-4" onClick={() => { resetOpen(); setOpenModal(true) }}>
            <Unlock className="w-4 h-4" /> Abrir Caja Ahora
          </button>
        </Card>
      )}

      {/* KPIs */}
      {isOpen && dailyReport && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <KpiCard title="Saldo Inicial" value={formatCOP(dailyReport.openingBalance)} icon={<DollarSign />} color="blue" />
          <KpiCard title="Ventas del Día" value={formatCOP(dailyReport.totalSales)} icon={<TrendingUp />} color="green" />
          <KpiCard title="Gastos del Día" value={formatCOP(dailyReport.totalExpenses)} icon={<TrendingDown />} color="red" />
          <KpiCard title="Saldo Esperado" value={formatCOP(dailyReport.closingBalance)} icon={<Landmark />} color="orange" />
        </div>
      )}

      {/* Arqueo de Caja */}
      {currentRegister?.status === 'CLOSED' && (
        <Card className="mb-6 p-5">
          <h3 className="font-semibold text-gray-800 mb-3">Arqueo de Caja</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-gray-500">Saldo Esperado</p><p className="font-bold text-lg">{formatCOP(currentRegister.expectedBalance ?? 0)}</p></div>
            <div><p className="text-gray-500">Saldo Real</p><p className="font-bold text-lg">{formatCOP(currentRegister.actualBalance ?? 0)}</p></div>
            <div>
              <p className="text-gray-500">Diferencia</p>
              <p className={`font-bold text-lg ${difference > 0 ? 'text-green-600' : difference < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {difference >= 0 ? '+' : ''}{formatCOP(difference)}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Transactions */}
      <Card className="overflow-hidden">
        <CardHeader className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Movimientos de Caja</h2>
          <Badge variant={isOpen ? 'green' : 'gray'}>{transactions.length} movimientos</Badge>
        </CardHeader>
        <div className="overflow-x-auto">
          {loading ? <TableSkeleton rows={6} cols={5} /> : transactions.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">Sin movimientos registrados</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-th">Fecha</th>
                  <th className="table-th">Tipo</th>
                  <th className="table-th">Concepto</th>
                  <th className="table-th">Método</th>
                  <th className="table-th">Monto</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="table-row">
                    <td className="table-td text-xs text-gray-500">{formatDateTime(t.createdAt)}</td>
                    <td className="table-td">
                      {t.type === 'INCOME'
                        ? <span className="badge-green flex items-center gap-1 w-fit"><TrendingUp className="w-3 h-3" /> Ingreso</span>
                        : <span className="badge-red flex items-center gap-1 w-fit"><TrendingDown className="w-3 h-3" /> Egreso</span>
                      }
                    </td>
                    <td className="table-td font-medium">{t.concept}</td>
                    <td className="table-td text-gray-500 text-xs">{t.paymentMethod}</td>
                    <td className={`table-td font-semibold ${t.type === 'INCOME' ? 'text-green-700' : 'text-red-600'}`}>
                      {t.type === 'INCOME' ? '+' : '-'}{formatCOP(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Open Register Modal */}
      <Modal open={openModal} onClose={() => setOpenModal(false)} title="Abrir Caja" size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setOpenModal(false)}>Cancelar</button>
            <button className="btn-primary" form="open-form" type="submit" disabled={saving}>
              {saving && <Spinner size="sm" />} Abrir Caja
            </button>
          </div>
        }
      >
        <form id="open-form" onSubmit={handleOpenSubmit(onOpenRegister)} className="space-y-4">
          <div>
            <label className="label">Monto de Apertura (COP) *</label>
            <input type="number" min="0" step="1000" className={`input-field ${openErrors.openingBalance ? 'input-error' : ''}`} {...regOpen('openingBalance', { valueAsNumber: true })} placeholder="0" />
            {openErrors.openingBalance && <p className="text-red-500 text-xs mt-1">{openErrors.openingBalance.message}</p>}
          </div>
          <div>
            <label className="label">Notas</label>
            <textarea className="input-field resize-none" rows={2} {...regOpen('notes')} placeholder="Observaciones..." />
          </div>
        </form>
      </Modal>

      {/* Close Register Modal */}
      <Modal open={closeModal} onClose={() => setCloseModal(false)} title="Cerrar Caja" size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setCloseModal(false)}>Cancelar</button>
            <button className="btn-destructive" form="close-form" type="submit" disabled={saving}>
              {saving && <Spinner size="sm" />} Cerrar Caja
            </button>
          </div>
        }
      >
        <form id="close-form" onSubmit={handleCloseSubmit(onCloseRegister)} className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-sm">
            <p className="text-blue-700 font-medium">Saldo esperado en caja:</p>
            <p className="text-2xl font-bold text-blue-900 mt-1">{formatCOP(dailyReport?.closingBalance ?? 0)}</p>
          </div>
          <div>
            <label className="label">Saldo Real en Caja (COP) *</label>
            <input type="number" min="0" step="1000" className={`input-field ${closeErrors.actualBalance ? 'input-error' : ''}`} {...regClose('actualBalance', { valueAsNumber: true })} placeholder="0" />
            {closeErrors.actualBalance && <p className="text-red-500 text-xs mt-1">{closeErrors.actualBalance.message}</p>}
          </div>
          <div>
            <label className="label">Notas del Cierre</label>
            <textarea className="input-field resize-none" rows={2} {...regClose('notes')} placeholder="Justificación de diferencias, etc." />
          </div>
        </form>
      </Modal>

      {/* Expense Modal */}
      <Modal open={expenseModal} onClose={() => setExpenseModal(false)} title="Registrar Gasto" size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setExpenseModal(false)}>Cancelar</button>
            <button className="btn-primary" form="exp-form" type="submit" disabled={saving}>
              {saving && <Spinner size="sm" />} Registrar
            </button>
          </div>
        }
      >
        <form id="exp-form" onSubmit={handleExpSubmit(onCreateExpense)} className="space-y-4">
          <div>
            <label className="label">Concepto *</label>
            <input className={`input-field ${expErrors.concept ? 'input-error' : ''}`} {...regExp('concept')} placeholder="Ej: Pago de servicios" />
            {expErrors.concept && <p className="text-red-500 text-xs mt-1">{expErrors.concept.message}</p>}
          </div>
          <div>
            <label className="label">Monto (COP) *</label>
            <input type="number" min="0" step="1000" className={`input-field ${expErrors.amount ? 'input-error' : ''}`} {...regExp('amount', { valueAsNumber: true })} placeholder="0" />
            {expErrors.amount && <p className="text-red-500 text-xs mt-1">{expErrors.amount.message}</p>}
          </div>
          <div>
            <label className="label">Método de Pago *</label>
            <select className="input-field" {...regExp('paymentMethod')}>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </form>
      </Modal>
    </div>
  )
}
