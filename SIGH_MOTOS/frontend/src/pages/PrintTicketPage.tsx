import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Printer, ArrowLeft } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { posService } from '@/services/posService'
import api from '@/services/api'
import type { Sale } from '@/types'
import { formatCOP } from '@/utils/formatters'
import '@/styles/print-ticket.css'

interface CompanyConfig {
  name: string
  nit: string
  address: string
  phone: string
  email?: string
  footer?: string
}

const DEFAULT_COMPANY: CompanyConfig = {
  name: 'TALLER Y REPUESTOS CLAVIJOS MOTOS',
  nit: '900.XXX.XXX-X',
  address: 'CRA 16 6-40 AGUACHICA CESAR',
  phone: '3117379097',
  footer: '¡Gracias por su compra! Garantía según política de fábrica.',
}

function formatTicketDate(iso: string) {
  const d = new Date(iso)
  const date = d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
  return { date, time }
}

function paymentLabel(method: string): string {
  const map: Record<string, string> = {
    CASH: 'EFECTIVO', CARD: 'TARJETA', TRANSFER: 'TRANSFERENCIA',
    MIXED: 'MIXTO', CREDIT: 'CRÉDITO / FIADO',
    // legacy aliases
    EFECTIVO: 'EFECTIVO', TARJETA_CREDITO: 'TARJETA', TARJETA_DEBITO: 'TARJETA',
    TRANSFERENCIA_BANCARIA: 'TRANSFERENCIA', MIXTO: 'MIXTO',
  }
  return map[method] ?? method
}

function trunc(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

export default function PrintTicketPage() {
  const { saleId } = useParams<{ saleId: string }>()
  const [sale, setSale] = useState<Sale | null>(null)
  const [company, setCompany] = useState<CompanyConfig>(DEFAULT_COMPANY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!saleId) return
    Promise.all([
      posService.getSale(saleId),
      api.get('/config')
        .then(r => {
          const d = r.data?.data ?? r.data
          return { name: d.businessName, nit: d.nit, address: d.address, phone: d.phone, email: d.email, footer: d.footer }
        })
        .catch(() => DEFAULT_COMPANY),
    ])
      .then(([saleData, configData]) => {
        setSale(saleData)
        if (configData && typeof configData === 'object') {
          setCompany({ ...DEFAULT_COMPANY, ...configData })
        }
      })
      .catch(() => setError('No se pudo cargar la venta'))
      .finally(() => setLoading(false))
  }, [saleId])

  if (loading) {
    return (
      <div className="ticket-wrapper">
        <div className="ticket-actions">
          <p className="text-gray-500 text-sm">Cargando comprobante...</p>
        </div>
      </div>
    )
  }

  if (error || !sale) {
    return (
      <div className="ticket-wrapper">
        <div className="ticket-actions">
          <button className="btn-outline flex items-center gap-2" onClick={() => window.close()}>
            <ArrowLeft className="w-4 h-4" /> Cerrar
          </button>
        </div>
        <p className="text-red-500 text-center mt-4">{error || 'Venta no encontrada'}</p>
      </div>
    )
  }

  const { date: saleDate, time: saleTime } = formatTicketDate(sale.createdAt)

  const total         = Number(sale.totalAmount  ?? sale.total        ?? 0)
  const taxAmount     = Number(sale.taxAmount    ?? sale.taxTotal     ?? 0)
  const discountAmt   = Number(sale.discountAmount ?? sale.discountTotal ?? 0)
  const taxBase       = taxAmount > 0 ? total - taxAmount : Number(sale.subtotal ?? 0) - discountAmt
  const isCreditSale  = sale.paymentMethod === 'CREDIT'
  const verifyUrl     = `${window.location.origin}/print-ticket/${sale.id}`
  const cashierName   = (sale as Sale & { cashier?: { name: string } }).cashier?.name

  return (
    <div className="ticket-wrapper">
      {/* Controles — ocultos al imprimir */}
      <div className="ticket-actions">
        <button className="btn-outline flex items-center gap-2" onClick={() => window.close()}>
          <ArrowLeft className="w-4 h-4" /> Cerrar
        </button>
        <button className="btn-primary flex items-center gap-2" onClick={() => window.print()}>
          <Printer className="w-4 h-4" /> Imprimir Ticket
        </button>
      </div>

      {/* ══════════════ TICKET ══════════════ */}
      <div className="ticket-preview">

        {/* ENCABEZADO */}
        <div className="ticket-header">
          <p className="ticket-logo-text">CLAVIJOS MOTOS</p>
          <p className="ticket-company-name">{company.name}</p>
          <p className="ticket-company-sub">NIT: {company.nit}</p>
          <p className="ticket-company-sub">{company.address}</p>
          <p className="ticket-company-sub">Tel: {company.phone}</p>
        </div>

        {/* TIPO DE DOCUMENTO */}
        <div className="ticket-doc-type">
          <p>—  DOCUMENTO EQUIVALENTE  —</p>
          <p>TICKET DE VENTA POS</p>
        </div>

        {/* DATOS DE LA VENTA */}
        <div className="ticket-meta">
          <table>
            <tbody>
              <tr><td>Fecha:</td><td>{saleDate}</td></tr>
              <tr><td>Hora:</td><td>{saleTime}</td></tr>
              <tr>
                <td>No. Venta:</td>
                <td><strong>{sale.saleNumber}</strong></td>
              </tr>
              <tr>
                <td>Adquiriente:</td>
                <td>{sale.customer ? sale.customer.name.toUpperCase() : 'CONSUMIDOR FINAL'}</td>
              </tr>
              {sale.customer?.identificationNumber && (
                <tr>
                  <td>C.C./NIT:</td>
                  <td>{sale.customer.identificationNumber}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* TABLA DE ÍTEMS */}
        <div className="ticket-items">
          <table>
            <thead>
              <tr>
                <th className="col-qty">CNT</th>
                <th className="col-ref">REF</th>
                <th className="col-desc">DESCRIPCIÓN</th>
                <th className="col-total">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((item, i) => {
                const lineTotal  = Number(item.lineTotal ?? item.subtotal ?? 0)
                const unitPrice  = Number(item.unitPrice ?? 0)
                const name       = item.productNameSnapshot ?? item.product?.name ?? 'Producto'
                const sku        = item.skuSnapshot ?? ''
                return (
                  <tr key={i} className="ticket-item-row">
                    <td className="col-qty">{item.quantity}</td>
                    <td className="col-ref">{trunc(sku, 10)}</td>
                    <td className="col-desc">
                      <div className="item-name-line">{trunc(name, 20)}</div>
                      <div className="item-unit-line">V.Unit: {formatCOP(unitPrice)}</div>
                    </td>
                    <td className="col-total">{formatCOP(lineTotal)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* TOTALES */}
        <div className="ticket-totals">
          <table>
            <tbody>
              {discountAmt > 0 && (
                <tr>
                  <td>Descuento:</td>
                  <td>-{formatCOP(discountAmt)}</td>
                </tr>
              )}
              <tr>
                <td>Base Gravable:</td>
                <td>{formatCOP(taxBase)}</td>
              </tr>
              <tr>
                <td>IVA (19%):</td>
                <td>{formatCOP(taxAmount)}</td>
              </tr>
              <tr className="ticket-total-row">
                <td>TOTAL:</td>
                <td>{formatCOP(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* FORMA DE PAGO */}
        <div className="ticket-payment-block">
          <p className="ticket-payment-label">FORMA DE PAGO</p>
          <table className="ticket-payment-table">
            <tbody>
              <tr>
                <td>{paymentLabel(sale.paymentMethod)}</td>
                <td>{formatCOP(total)}</td>
              </tr>
              {isCreditSale && (
                <tr className="ticket-credit-row">
                  <td>⚠ Pendiente de pago</td>
                  <td>{formatCOP(total)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* QR */}
        <div className="ticket-qr">
          <QRCodeSVG value={verifyUrl} size={72} level="M" />
          <p style={{ fontSize: '8px', marginTop: '3px', color: '#888' }}>
            Escanea para verificar
          </p>
        </div>

        {/* PIE */}
        <div className="ticket-footer">
          {cashierName && <p>Atendido por: {cashierName}</p>}
          <p>SIGC-Motos v2.0 | Powered by Quanta Cloud</p>
          <p style={{ marginTop: '4px' }}>{company.footer}</p>
          <p style={{ marginTop: '6px', fontSize: '8px' }}>
            No es factura electrónica DIAN
          </p>
        </div>
      </div>
    </div>
  )
}
