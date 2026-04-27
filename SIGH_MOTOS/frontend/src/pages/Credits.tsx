import { useState, useEffect, useCallback } from 'react'
import { CreditCard, RefreshCw, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { debtService, type Debt, type DebtStatus } from '@/services/debtService'
import { PayDebtModal } from '@/components/PayDebtModal'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, KpiCard } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { Pagination } from '@/components/ui/Pagination'
import { formatCOP, formatDateTime } from '@/utils/formatters'

const STATUS_LABELS: Record<DebtStatus, string> = {
  PENDING: 'Pendiente',
  PARTIALLY_PAID: 'Parcial',
  PAID: 'Pagado',
  OVERDUE: 'Vencido',
}

const STATUS_VARIANTS: Record<DebtStatus, 'yellow' | 'blue' | 'green' | 'red'> = {
  PENDING: 'yellow',
  PARTIALLY_PAID: 'blue',
  PAID: 'green',
  OVERDUE: 'red',
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Activos' },
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'PARTIALLY_PAID', label: 'Parciales' },
  { value: 'OVERDUE', label: 'Vencidos' },
  { value: 'PAID', label: 'Pagados' },
]

export default function Credits() {
  const [debts, setDebts] = useState<Debt[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<{ totalDebt: number; paidAmount: number; remainingBalance: number } | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  const [selectedDebt, setSelectedDebt] = useState<Debt | null>(null)
  const [payModalOpen, setPayModalOpen] = useState(false)

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const s = await debtService.getSummary()
      setSummary(s.amounts)
    } catch {
      // ignore
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  const loadDebts = useCallback(async () => {
    setLoading(true)
    try {
      const result = await debtService.listDebts({
        status: statusFilter || undefined,
        page,
        limit: 20,
      })
      setDebts(result.data)
      setTotal(result.total)
      setTotalPages(result.totalPages)
    } catch {
      toast.error('Error al cargar créditos')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, page])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  useEffect(() => {
    setPage(1)
  }, [statusFilter])

  useEffect(() => {
    loadDebts()
  }, [loadDebts])

  const openPayModal = (debt: Debt) => {
    setSelectedDebt(debt)
    setPayModalOpen(true)
  }

  const handlePaySuccess = (updatedDebt: Debt) => {
    setDebts((prev) => prev.map((d) => d.id === updatedDebt.id ? updatedDebt : d))
    loadSummary()
  }

  return (
    <div>
      <PageHeader
        title="Créditos / Fiados"
        description="Control de cuentas por cobrar a clientes"
        actions={
          <button className="btn-outline btn-sm" onClick={() => { loadDebts(); loadSummary() }}>
            <RefreshCw className="w-4 h-4" /> Actualizar
          </button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {summaryLoading ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-white rounded-xl border border-gray-200 animate-pulse" />
            ))}
          </>
        ) : summary && (
          <>
            <KpiCard
              title="Total Prestado"
              value={formatCOP(summary.totalDebt)}
              icon={<CreditCard />}
              color="blue"
            />
            <KpiCard
              title="Total Abonado"
              value={formatCOP(summary.paidAmount)}
              icon={<CheckCircle2 />}
              color="green"
            />
            <KpiCard
              title="Saldo Pendiente"
              value={formatCOP(summary.remainingBalance)}
              icon={<AlertTriangle />}
              color="orange"
            />
          </>
        )}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              statusFilter === f.value
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">
            Créditos
            <span className="ml-2 text-sm text-gray-400 font-normal">({total} registros)</span>
          </h2>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <TableSkeleton rows={6} cols={6} />
          ) : debts.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <Clock className="w-10 h-10 mx-auto mb-2 text-gray-200" />
              <p className="text-sm">No hay créditos en este filtro</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-th">Cliente</th>
                  <th className="table-th">Venta</th>
                  <th className="table-th">Fecha</th>
                  <th className="table-th">Deuda Total</th>
                  <th className="table-th">Abonado</th>
                  <th className="table-th">Saldo</th>
                  <th className="table-th">Estado</th>
                  <th className="table-th">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {debts.map((debt) => (
                  <tr key={debt.id} className="table-row">
                    <td className="table-td">
                      <p className="font-medium text-gray-900">{debt.customer.name}</p>
                      {debt.customer.phone && (
                        <p className="text-xs text-gray-400">{debt.customer.phone}</p>
                      )}
                    </td>
                    <td className="table-td text-xs font-mono text-gray-600">
                      {debt.sale.saleNumber}
                    </td>
                    <td className="table-td text-xs text-gray-500">
                      {formatDateTime(debt.createdAt)}
                      {debt.dueDate && (
                        <p className="text-orange-500 text-xs">
                          Vence: {formatDateTime(debt.dueDate)}
                        </p>
                      )}
                    </td>
                    <td className="table-td font-medium">{formatCOP(debt.totalDebt)}</td>
                    <td className="table-td text-green-700">{formatCOP(debt.paidAmount)}</td>
                    <td className="table-td font-bold text-orange-600">
                      {formatCOP(debt.remainingBalance)}
                    </td>
                    <td className="table-td">
                      <Badge variant={STATUS_VARIANTS[debt.status]}>
                        {STATUS_LABELS[debt.status]}
                      </Badge>
                    </td>
                    <td className="table-td">
                      {debt.status !== 'PAID' && (
                        <button
                          className="btn-primary btn-sm text-xs"
                          onClick={() => openPayModal(debt)}
                        >
                          Abonar
                        </button>
                      )}
                      {debt.status === 'PAID' && (
                        <span className="text-green-600 text-xs font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Saldado
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            limit={20}
            onPageChange={setPage}
          />
        )}
      </Card>

      <PayDebtModal
        debt={selectedDebt}
        open={payModalOpen}
        onClose={() => { setPayModalOpen(false); setSelectedDebt(null) }}
        onSuccess={handlePaySuccess}
      />
    </div>
  )
}
