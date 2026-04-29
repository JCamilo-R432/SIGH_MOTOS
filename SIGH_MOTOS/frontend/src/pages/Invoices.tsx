import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { FileText, Download, Send, XCircle, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { invoiceService } from '@/services/invoiceService'
import type { Invoice, InvoiceStatus } from '@/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Pagination } from '@/components/ui/Pagination'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCOP, formatDateTime, invoiceStatusBadge } from '@/utils/formatters'
import { exportInvoicesToExcel } from '@/utils/excelExport'
import { generateInvoicePDF } from '@/utils/pdfGenerator'

const statusOptions: { value: string; label: string }[] = [
  { value: '', label: 'Todos los estados' },
  { value: 'EMITIDA', label: 'Emitida' },
  { value: 'ANULADA', label: 'Anulada' },
  { value: 'ENVIADA_DIAN', label: 'Enviada DIAN' },
]

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [detailModal, setDetailModal] = useState(false)
  const [cancelDialog, setCancelDialog] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelLoading, setCancelLoading] = useState(false)
  const [dianLoading, setDianLoading] = useState<string | null>(null)

  const LIMIT = 20

  const load = useCallback(async (p = page, status = statusFilter, sd = startDate, ed = endDate) => {
    setLoading(true)
    try {
      const res = await invoiceService.getInvoices({ page: p, limit: LIMIT, status: status || undefined, startDate: sd || undefined, endDate: ed || undefined })
      setInvoices(res.data)
      setTotal(res.total)
      setTotalPages(res.totalPages)
    } catch { /* handled */ } finally { setLoading(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilter = () => { setPage(1); load(1, statusFilter, startDate, endDate) }

  const handleCancel = async () => {
    if (!selectedInvoice || !cancelReason.trim()) { toast.error('Ingresa el motivo de anulación'); return }
    setCancelLoading(true)
    try {
      await invoiceService.cancelInvoice(selectedInvoice.id, cancelReason)
      toast.success('Factura anulada correctamente')
      setCancelDialog(false)
      setCancelReason('')
      load(page, statusFilter, startDate, endDate)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al anular factura'
      toast.error(msg)
    } finally { setCancelLoading(false) }
  }

  const handleSendDian = async (invoice: Invoice) => {
    setDianLoading(invoice.id)
    try {
      await invoiceService.sendToDian(invoice.id)
      toast.success('Factura enviada a DIAN correctamente')
      load(page, statusFilter, startDate, endDate)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al enviar a DIAN'
      toast.error(msg)
    } finally { setDianLoading(null) }
  }

  const handleExport = async () => {
    if (invoices.length === 0) { toast.warning('No hay facturas para exportar'); return }
    await exportInvoicesToExcel(invoices)
    toast.success('Excel exportado correctamente')
  }

  const statusVariant = (s: InvoiceStatus): 'blue' | 'red' | 'green' | 'gray' => {
    if (s === 'EMITIDA') return 'blue'
    if (s === 'ANULADA') return 'red'
    if (s === 'ENVIADA_DIAN') return 'green'
    return 'gray'
  }

  return (
    <div>
      <PageHeader
        title="Facturación"
        description="Historial de facturas emitidas"
        actions={
          <button className="btn-outline btn-sm" onClick={handleExport}>
            <Download className="w-4 h-4" /> Exportar Excel
          </button>
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Estado</label>
            <select className="input-field w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {statusOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Desde</label>
            <input type="date" className="input-field w-40" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Hasta</label>
            <input type="date" className="input-field w-40" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <button className="btn-secondary btn-sm" onClick={handleFilter}>Filtrar</button>
          <button className="btn-ghost btn-sm text-gray-500" onClick={() => { setStatusFilter(''); setStartDate(''); setEndDate(''); setPage(1); load(1, '', '', '') }}>
            Limpiar
          </button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? <TableSkeleton rows={8} cols={6} /> : invoices.length === 0 ? (
            <EmptyState icon={<FileText className="w-8 h-8" />} title="Sin facturas" description="No se encontraron facturas con los filtros aplicados." />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-th">Número</th>
                  <th className="table-th">Fecha</th>
                  <th className="table-th">Cliente</th>
                  <th className="table-th">Total</th>
                  <th className="table-th">Estado</th>
                  <th className="table-th">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const st = invoiceStatusBadge(inv.status)
                  return (
                    <tr key={inv.id} className="table-row">
                      <td className="table-td font-mono text-xs font-semibold text-blue-900">{inv.invoiceNumber}</td>
                      <td className="table-td text-gray-500 text-xs">{formatDateTime(inv.issuedAt)}</td>
                      <td className="table-td">{inv.customer?.name ?? 'Consumidor Final'}</td>
                      <td className="table-td font-semibold">{formatCOP(inv.total)}</td>
                      <td className="table-td">
                        <Badge variant={statusVariant(inv.status)}>{st.label}</Badge>
                      </td>
                      <td className="table-td">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { setSelectedInvoice(inv); setDetailModal(true) }}
                            className="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition-colors"
                            title="Ver detalle"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {inv.status === 'EMITIDA' && (
                            <>
                              <button
                                onClick={() => handleSendDian(inv)}
                                disabled={dianLoading === inv.id}
                                className="p-1.5 rounded hover:bg-green-50 text-green-600 transition-colors"
                                title="Enviar a DIAN"
                              >
                                {dianLoading === inv.id ? <Spinner size="sm" /> : <Send className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => { setSelectedInvoice(inv); setCancelDialog(true) }}
                                className="p-1.5 rounded hover:bg-red-50 text-red-500 transition-colors"
                                title="Anular factura"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => generateInvoicePDF(inv)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                            title="Descargar PDF"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        {!loading && invoices.length > 0 && (
          <Pagination page={page} totalPages={totalPages} total={total} limit={LIMIT} onPageChange={(p) => { setPage(p); load(p) }} />
        )}
      </Card>

      {/* Detail Modal */}
      <Modal
        open={detailModal}
        onClose={() => setDetailModal(false)}
        title={`Factura ${selectedInvoice?.invoiceNumber ?? ''}`}
        size="lg"
        footer={
          <div className="flex gap-2 justify-end">
            <button className="btn-outline" onClick={() => setDetailModal(false)}>Cerrar</button>
            {selectedInvoice && (
              <button className="btn-primary" onClick={() => generateInvoicePDF(selectedInvoice)}>
                <Download className="w-4 h-4" /> Descargar PDF
              </button>
            )}
          </div>
        }
      >
        {selectedInvoice && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Número:</span> <span className="font-mono font-semibold">{selectedInvoice.invoiceNumber}</span></div>
              <div><span className="text-gray-500">Fecha:</span> {formatDateTime(selectedInvoice.issuedAt)}</div>
              <div><span className="text-gray-500">Cliente:</span> {selectedInvoice.customer?.name ?? 'Consumidor Final'}</div>
              <div><span className="text-gray-500">Estado:</span> <Badge variant={statusVariant(selectedInvoice.status)}>{invoiceStatusBadge(selectedInvoice.status).label}</Badge></div>
              {selectedInvoice.cufe && <div className="col-span-2"><span className="text-gray-500">CUFE:</span> <span className="font-mono text-xs break-all">{selectedInvoice.cufe}</span></div>}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-th">Producto</th>
                    <th className="table-th">Cant.</th>
                    <th className="table-th">Precio</th>
                    <th className="table-th">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedInvoice.items ?? []).map((item, i) => (
                    <tr key={i} className="table-row">
                      <td className="table-td">{item.product?.name ?? item.productId}</td>
                      <td className="table-td">{item.quantity}</td>
                      <td className="table-td">{formatCOP(Number(item.unitPrice))}</td>
                      <td className="table-td font-semibold">{formatCOP(Number(item.subtotal ?? item.lineTotal ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-start">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between gap-8"><span className="text-gray-500">Subtotal:</span><span>{formatCOP(selectedInvoice.subtotal)}</span></div>
                <div className="flex justify-between gap-8"><span className="text-gray-500">IVA:</span><span>{formatCOP(selectedInvoice.taxTotal)}</span></div>
                <div className="flex justify-between gap-8 font-bold text-base"><span>Total:</span><span className="text-orange-500">{formatCOP(selectedInvoice.total)}</span></div>
              </div>
              {selectedInvoice.qrData && (
                <QRCodeSVG value={selectedInvoice.qrData} size={100} />
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel Dialog */}
      <Modal
        open={cancelDialog}
        onClose={() => { setCancelDialog(false); setCancelReason('') }}
        title="Anular Factura"
        size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <button className="btn-outline" onClick={() => { setCancelDialog(false); setCancelReason('') }}>Cancelar</button>
            <button className="btn-destructive" onClick={handleCancel} disabled={cancelLoading || !cancelReason.trim()}>
              {cancelLoading && <Spinner size="sm" />} Anular
            </button>
          </div>
        }
      >
        <p className="text-sm text-gray-600 mb-4">Indica el motivo de la anulación de la factura <strong>{selectedInvoice?.invoiceNumber}</strong>:</p>
        <textarea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          className="input-field resize-none"
          rows={3}
          placeholder="Motivo de anulación..."
        />
      </Modal>
    </div>
  )
}
