import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Invoice, CashRegister, TreasuryTransaction } from '@/types'
import { formatCOP, formatDateTime, formatDate } from './formatters'

const BRAND_BLUE = [30, 58, 138] as [number, number, number]
const BRAND_ORANGE = [249, 115, 22] as [number, number, number]

const addHeader = (doc: jsPDF, title: string) => {
  doc.setFillColor(...BRAND_BLUE)
  doc.rect(0, 0, 210, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('CLAVIJOS MOTOS S.A.S.', 14, 12)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('NIT: 900.XXX.XXX-X | Aguachica, Cesar | Tel: (XXX) XXX-XXXX', 14, 19)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...BRAND_ORANGE)
  doc.text(title, 14, 26)
  doc.setTextColor(0, 0, 0)
}

export const generateInvoicePDF = (invoice: Invoice): void => {
  const doc = new jsPDF()
  addHeader(doc, `FACTURA ${invoice.invoiceNumber}`)

  let y = 36

  // Customer & invoice info
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  const left = [
    ['Fecha:', formatDateTime(invoice.issuedAt)],
    ['Cliente:', invoice.customer?.name ?? 'Consumidor Final'],
    ['Documento:', invoice.customer?.documentNumber ?? '—'],
    ['Estado:', invoice.status],
  ]
  left.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold')
    doc.text(label, 14, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, 40, y)
    y += 6
  })

  y += 4
  doc.setDrawColor(200, 200, 200)
  doc.line(14, y, 196, y)
  y += 6

  // Items table
  const rows = (invoice.items ?? []).map((item) => [
    item.product?.name ?? item.productId,
    item.quantity.toString(),
    formatCOP(item.unitPrice),
    item.discount > 0 ? formatCOP(item.discount) : '—',
    formatCOP(item.subtotal),
  ])

  autoTable(doc, {
    startY: y,
    head: [['Producto', 'Cant.', 'Precio Unit.', 'Descuento', 'Subtotal']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: BRAND_BLUE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 80 }, 4: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // Totals
  const totals = [
    ['Subtotal:', formatCOP(invoice.subtotal)],
    ['IVA (19%):', formatCOP(invoice.taxTotal)],
    ['TOTAL:', formatCOP(invoice.total)],
  ]
  totals.forEach(([label, value], i) => {
    const isTotal = i === totals.length - 1
    if (isTotal) {
      doc.setFillColor(...BRAND_ORANGE)
      doc.rect(120, finalY + i * 8 - 4, 76, 8, 'F')
      doc.setTextColor(255, 255, 255)
    }
    doc.setFont('helvetica', isTotal ? 'bold' : 'normal')
    doc.setFontSize(isTotal ? 11 : 9)
    doc.text(label, 124, finalY + i * 8 + 1)
    doc.text(value, 192, finalY + i * 8 + 1, { align: 'right' })
    if (isTotal) doc.setTextColor(0, 0, 0)
  })

  // CUFE / legal
  if (invoice.cufe) {
    const legalY = finalY + totals.length * 8 + 10
    doc.setFontSize(7)
    doc.setTextColor(120, 120, 120)
    doc.text(`CUFE: ${invoice.cufe}`, 14, legalY)
    doc.text('Esta factura es un documento legalmente válido.', 14, legalY + 5)
  }

  doc.save(`factura-${invoice.invoiceNumber}.pdf`)
}

export const generateCashReportPDF = (
  register: CashRegister,
  transactions: TreasuryTransaction[],
  totalSales: number
): void => {
  const doc = new jsPDF()
  addHeader(doc, 'REPORTE DE CAJA DIARIO')

  let y = 38
  doc.setFontSize(9)

  const info = [
    ['Apertura:', formatDateTime(register.openedAt)],
    ['Cierre:', register.closedAt ? formatDateTime(register.closedAt) : 'Abierta'],
    ['Saldo Inicial:', formatCOP(register.openingBalance)],
    ['Ventas Totales:', formatCOP(totalSales)],
    ['Saldo Esperado:', formatCOP(register.expectedBalance ?? 0)],
    ['Saldo Real:', formatCOP(register.actualBalance ?? 0)],
    ['Diferencia:', formatCOP(register.difference ?? 0)],
  ]
  info.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold')
    doc.text(label, 14, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, 60, y)
    y += 7
  })

  y += 4
  const rows = transactions.map((t) => [
    formatDate(t.createdAt),
    t.type === 'INCOME' ? 'Ingreso' : 'Egreso',
    t.concept,
    formatCOP(t.amount),
  ])

  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Tipo', 'Concepto', 'Monto']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: BRAND_BLUE, textColor: [255, 255, 255], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    margin: { left: 14, right: 14 },
  })

  doc.save(`caja-${formatDate(register.openedAt)}.pdf`)
}
