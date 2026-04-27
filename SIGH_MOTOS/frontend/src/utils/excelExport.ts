import ExcelJS from 'exceljs'
import { downloadBlob } from './helpers'
import { formatCOP, formatDate } from './formatters'
import type { Product, Invoice, PurchaseOrder, AbcProduct, ProfitabilityItem } from '@/types'

const BRAND_BLUE_HEX = '1E3A8A'
const BRAND_ORANGE_HEX = 'F97316'

const styleHeader = (ws: ExcelJS.Worksheet, row: ExcelJS.Row) => {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BRAND_BLUE_HEX}` } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = {
      bottom: { style: 'thin', color: { argb: `FF${BRAND_ORANGE_HEX}` } },
    }
  })
  row.height = 22
}

export const exportProductsToExcel = async (products: Product[]): Promise<void> => {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'SIGC-Motos'
  wb.created = new Date()

  const ws = wb.addWorksheet('Inventario')
  ws.columns = [
    { header: 'SKU', key: 'sku', width: 15 },
    { header: 'Código Barras', key: 'barcode', width: 16 },
    { header: 'Nombre', key: 'name', width: 40 },
    { header: 'Categoría', key: 'category', width: 20 },
    { header: 'Precio Costo', key: 'costPrice', width: 16 },
    { header: 'Precio Venta', key: 'salePrice', width: 16 },
    { header: 'IVA %', key: 'taxRate', width: 10 },
    { header: 'Stock', key: 'stock', width: 10 },
    { header: 'Stock Mín.', key: 'minStock', width: 12 },
    { header: 'Ubicación', key: 'binLocation', width: 14 },
  ]

  styleHeader(ws, ws.getRow(1))

  products.forEach((p) => {
    const row = ws.addRow({
      sku: p.sku,
      barcode: p.barcode ?? '',
      name: p.name,
      category: p.category?.name ?? '',
      costPrice: p.costPrice,
      salePrice: p.salePrice,
      taxRate: p.taxRate,
      stock: p.stock,
      minStock: p.minStock,
      binLocation: p.binLocation ?? '',
    })
    if (p.stock <= (p.minStock ?? 5)) {
      row.getCell('stock').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
    }
  })

  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'inventario.xlsx')
}

export const exportInvoicesToExcel = async (invoices: Invoice[]): Promise<void> => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Facturas')
  ws.columns = [
    { header: 'Número', key: 'invoiceNumber', width: 18 },
    { header: 'Fecha', key: 'date', width: 14 },
    { header: 'Cliente', key: 'customer', width: 30 },
    { header: 'Total', key: 'total', width: 16 },
    { header: 'Estado', key: 'status', width: 14 },
    { header: 'CUFE', key: 'cufe', width: 40 },
  ]
  styleHeader(ws, ws.getRow(1))
  invoices.forEach((inv) => {
    ws.addRow({
      invoiceNumber: inv.invoiceNumber,
      date: formatDate(inv.issuedAt),
      customer: inv.customer?.name ?? 'Consumidor Final',
      total: inv.total,
      status: inv.status,
      cufe: inv.cufe ?? '',
    })
  })
  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'facturas.xlsx')
}

export const exportPurchaseOrdersToExcel = async (orders: PurchaseOrder[]): Promise<void> => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Compras')
  ws.columns = [
    { header: 'Número', key: 'orderNumber', width: 18 },
    { header: 'Proveedor', key: 'supplier', width: 30 },
    { header: 'Total', key: 'total', width: 16 },
    { header: 'Estado', key: 'status', width: 14 },
    { header: 'Fecha Esperada', key: 'expectedDate', width: 16 },
    { header: 'Notas', key: 'notes', width: 30 },
  ]
  styleHeader(ws, ws.getRow(1))
  orders.forEach((o) => {
    ws.addRow({
      orderNumber: o.orderNumber,
      supplier: o.supplier?.name ?? '',
      total: o.total,
      status: o.status,
      expectedDate: o.expectedDate ? formatDate(o.expectedDate) : '',
      notes: o.notes ?? '',
    })
  })
  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'compras.xlsx')
}

export const exportAbcToExcel = async (items: AbcProduct[]): Promise<void> => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Análisis ABC')
  ws.columns = [
    { header: 'Producto', key: 'name', width: 40 },
    { header: 'SKU', key: 'sku', width: 15 },
    { header: 'Ingresos Totales', key: 'revenue', width: 20 },
    { header: '% del Total', key: 'pct', width: 14 },
    { header: '% Acumulado', key: 'cumulPct', width: 14 },
    { header: 'Clase', key: 'class', width: 10 },
  ]
  styleHeader(ws, ws.getRow(1))
  items.forEach((item) => {
    const row = ws.addRow({
      name: item.product?.name ?? '',
      sku: item.product?.sku ?? '',
      revenue: item.totalRevenue,
      pct: item.percentage.toFixed(2) + '%',
      cumulPct: item.cumulativePercentage.toFixed(2) + '%',
      class: item.class,
    })
    const clsColors: Record<string, string> = { A: 'FFC6EFCE', B: 'FFFFEB9C', C: 'FFFFC7CE' }
    const fill = clsColors[item.class]
    if (fill) row.getCell('class').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
  })
  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'analisis-abc.xlsx')
}

export const exportProfitabilityToExcel = async (items: ProfitabilityItem[]): Promise<void> => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Rentabilidad')
  ws.columns = [
    { header: 'Producto', key: 'name', width: 40 },
    { header: 'Precio Costo', key: 'costPrice', width: 16 },
    { header: 'Precio Venta', key: 'salePrice', width: 16 },
    { header: 'Margen Bruto', key: 'grossMargin', width: 16 },
    { header: 'Margen %', key: 'pct', width: 12 },
    { header: 'Unidades Vendidas', key: 'sold', width: 18 },
    { header: 'Utilidad Total', key: 'profit', width: 18 },
  ]
  styleHeader(ws, ws.getRow(1))
  items.forEach((item) => {
    ws.addRow({
      name: item.product?.name ?? '',
      costPrice: item.costPrice,
      salePrice: item.salePrice,
      grossMargin: formatCOP(item.grossMargin),
      pct: item.grossMarginPct.toFixed(1) + '%',
      sold: item.totalSold,
      profit: formatCOP(item.totalProfit),
    })
  })
  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'rentabilidad.xlsx')
}
