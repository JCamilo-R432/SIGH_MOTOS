import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Legend,
} from 'recharts'
import { Download, RefreshCw, BarChart3, Package, TrendingUp, DollarSign } from 'lucide-react'
import { toast } from 'sonner'
import { reportService } from '@/services/reportService'
import type { AbcProduct, InventoryValuation, ProductRotation, ProfitabilityItem } from '@/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { formatCOP, formatPct, abcBadge } from '@/utils/formatters'
import { exportAbcToExcel, exportProfitabilityToExcel } from '@/utils/excelExport'
import { todayISO, startOfMonthISO } from '@/utils/helpers'

type Tab = 'abc' | 'valuation' | 'rotation' | 'profitability'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'abc', label: 'Curva ABC', icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'valuation', label: 'Valorización', icon: <Package className="w-4 h-4" /> },
  { id: 'rotation', label: 'Rotación', icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'profitability', label: 'Rentabilidad', icon: <DollarSign className="w-4 h-4" /> },
]

export default function Reports() {
  const [activeTab, setActiveTab] = useState<Tab>('abc')
  const [loading, setLoading] = useState(false)
  const [startDate, setStartDate] = useState(startOfMonthISO())
  const [endDate, setEndDate] = useState(todayISO())

  const [abcData, setAbcData] = useState<AbcProduct[]>([])
  const [valuationData, setValuationData] = useState<InventoryValuation[]>([])
  const [rotationData, setRotationData] = useState<ProductRotation[]>([])
  const [profitabilityData, setProfitabilityData] = useState<ProfitabilityItem[]>([])

  const loadData = async (tab: Tab) => {
    setLoading(true)
    const params = { startDate, endDate }
    try {
      switch (tab) {
        case 'abc':
          setAbcData(await reportService.getAbcAnalysis(params))
          break
        case 'valuation':
          setValuationData(await reportService.getInventoryValuation())
          break
        case 'rotation':
          setRotationData(await reportService.getProductRotation(params))
          break
        case 'profitability':
          setProfitabilityData(await reportService.getProfitability(params))
          break
      }
    } catch { /* handled */ } finally { setLoading(false) }
  }

  useEffect(() => { loadData(activeTab) }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = () => loadData(activeTab)

  const handleExport = async () => {
    try {
      switch (activeTab) {
        case 'abc':
          if (abcData.length === 0) { toast.warning('Sin datos para exportar'); return }
          await exportAbcToExcel(abcData)
          break
        case 'profitability':
          if (profitabilityData.length === 0) { toast.warning('Sin datos para exportar'); return }
          await exportProfitabilityToExcel(profitabilityData)
          break
        default:
          toast.info('Exportación no disponible para este reporte')
          return
      }
      toast.success('Excel exportado correctamente')
    } catch { toast.error('Error al exportar') }
  }

  // ABC chart data (top 20)
  const abcChartData = abcData.slice(0, 20).map((item) => ({
    name: item.product?.name?.slice(0, 20) ?? '',
    revenue: item.totalRevenue,
    cumulative: item.cumulativePercentage,
  }))

  // Valuation chart data
  const valuationChart = valuationData.map((v) => ({
    name: v.categoryName,
    costo: v.totalCostValue,
    venta: v.totalSaleValue,
  }))

  // Rotation chart (top 15)
  const rotationChart = rotationData.slice(0, 15).map((r) => ({
    name: r.product?.name?.slice(0, 18) ?? '',
    vendido: r.totalSold,
    revenue: r.totalRevenue,
  }))

  const abcSummary = {
    A: abcData.filter((i) => i.class === 'A'),
    B: abcData.filter((i) => i.class === 'B'),
    C: abcData.filter((i) => i.class === 'C'),
  }

  return (
    <div>
      <PageHeader
        title="Reportes y Analítica"
        description="Análisis del desempeño del negocio"
        actions={
          <div className="flex gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field w-36 text-sm" />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field w-36 text-sm" />
            <button className="btn-outline btn-sm" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
            </button>
            <button className="btn-outline btn-sm" onClick={handleExport}>
              <Download className="w-4 h-4" /> Exportar
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ABC Analysis */}
      {activeTab === 'abc' && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            {(['A', 'B', 'C'] as const).map((cls) => (
              <Card key={cls} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Clase {cls}</p>
                    <p className="text-2xl font-bold mt-1">{abcSummary[cls].length}</p>
                    <p className="text-xs text-gray-400">productos</p>
                  </div>
                  <span className={abcBadge(cls) + ' text-lg px-3 py-1'}>{cls}</span>
                </div>
                <p className="text-sm font-medium text-gray-700 mt-2">
                  {formatCOP(abcSummary[cls].reduce((s, i) => s + i.totalRevenue, 0))}
                </p>
              </Card>
            ))}
          </div>

          {/* Pareto Chart */}
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-800">Diagrama de Pareto (Top 20 productos)</h3></CardHeader>
            <CardBody>
              {loading ? (
                <div className="h-64 animate-pulse bg-gray-100 rounded" />
              ) : abcChartData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-400">Sin datos disponibles</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={abcChartData} margin={{ left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(v: number, n: string) => n === 'revenue' ? [formatCOP(v), 'Ingresos'] : [`${v.toFixed(1)}%`, '% Acumulado']} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="revenue" name="Ingresos" fill="#1e3a8a" radius={[2, 2, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="cumulative" name="% Acumulado" stroke="#f97316" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>

          {/* ABC Table */}
          <Card className="overflow-hidden">
            <CardHeader><h3 className="font-semibold text-gray-800">Detalle Clasificación ABC</h3></CardHeader>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              {loading ? <TableSkeleton rows={8} cols={5} /> : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="border-b border-gray-200">
                      <th className="table-th">#</th>
                      <th className="table-th">Producto</th>
                      <th className="table-th">Ingresos</th>
                      <th className="table-th">%</th>
                      <th className="table-th">% Acum.</th>
                      <th className="table-th">Clase</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abcData.map((item, idx) => (
                      <tr key={item.productId} className="table-row">
                        <td className="table-td text-gray-400">{idx + 1}</td>
                        <td className="table-td font-medium">{item.product?.name}</td>
                        <td className="table-td font-semibold">{formatCOP(item.totalRevenue)}</td>
                        <td className="table-td">{formatPct(item.percentage)}</td>
                        <td className="table-td">{formatPct(item.cumulativePercentage)}</td>
                        <td className="table-td"><span className={abcBadge(item.class)}>{item.class}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Inventory Valuation */}
      {activeTab === 'valuation' && (
        <div className="space-y-4">
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-800">Valorización por Categoría</h3></CardHeader>
            <CardBody>
              {loading ? <div className="h-64 animate-pulse bg-gray-100 rounded" /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={valuationChart} margin={{ bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} />
                    <Tooltip formatter={(v: number, n: string) => [formatCOP(v), n === 'costo' ? 'Valor a Costo' : 'Valor a Venta']} />
                    <Legend />
                    <Bar dataKey="costo" name="A Costo" fill="#1e3a8a" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="venta" name="A Venta" fill="#f97316" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              {loading ? <TableSkeleton rows={8} cols={6} /> : (
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="table-th">Categoría</th>
                      <th className="table-th">Productos</th>
                      <th className="table-th">Unidades</th>
                      <th className="table-th">Valor a Costo</th>
                      <th className="table-th">Valor a Venta</th>
                      <th className="table-th">Costo Prom.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valuationData.map((v) => (
                      <tr key={v.categoryId} className="table-row">
                        <td className="table-td font-medium">{v.categoryName}</td>
                        <td className="table-td">{v.totalProducts}</td>
                        <td className="table-td">{v.totalUnits}</td>
                        <td className="table-td font-semibold">{formatCOP(v.totalCostValue)}</td>
                        <td className="table-td font-semibold text-orange-600">{formatCOP(v.totalSaleValue)}</td>
                        <td className="table-td">{formatCOP(v.avgCostPrice)}</td>
                      </tr>
                    ))}
                    {valuationData.length > 0 && (
                      <tr className="bg-blue-50 border-t-2 border-blue-200">
                        <td className="table-td font-bold">TOTAL</td>
                        <td className="table-td font-bold">{valuationData.reduce((s, v) => s + v.totalProducts, 0)}</td>
                        <td className="table-td font-bold">{valuationData.reduce((s, v) => s + v.totalUnits, 0)}</td>
                        <td className="table-td font-bold">{formatCOP(valuationData.reduce((s, v) => s + v.totalCostValue, 0))}</td>
                        <td className="table-td font-bold text-orange-600">{formatCOP(valuationData.reduce((s, v) => s + v.totalSaleValue, 0))}</td>
                        <td className="table-td">—</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Product Rotation */}
      {activeTab === 'rotation' && (
        <div className="space-y-4">
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-800">Top 15 Productos más Vendidos</h3></CardHeader>
            <CardBody>
              {loading ? <div className="h-64 animate-pulse bg-gray-100 rounded" /> : rotationChart.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-400">Sin datos de ventas en el período</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={rotationChart} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} width={120} />
                    <Tooltip formatter={(v: number, n: string) => n === 'vendido' ? [v, 'Unidades'] : [formatCOP(v), 'Ingresos']} />
                    <Legend />
                    <Bar dataKey="vendido" name="Unidades" fill="#1e3a8a" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              {loading ? <TableSkeleton rows={8} cols={4} /> : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="border-b border-gray-200">
                      <th className="table-th">#</th>
                      <th className="table-th">Producto</th>
                      <th className="table-th">Unidades Vendidas</th>
                      <th className="table-th">Ingresos Totales</th>
                      <th className="table-th">Última Venta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rotationData.map((r, i) => (
                      <tr key={r.productId} className="table-row">
                        <td className="table-td text-gray-400">{i + 1}</td>
                        <td className="table-td font-medium">{r.product?.name}</td>
                        <td className="table-td"><Badge variant="blue">{r.totalSold}</Badge></td>
                        <td className="table-td font-semibold">{formatCOP(r.totalRevenue)}</td>
                        <td className="table-td text-gray-500 text-xs">{r.lastSaleDate ? new Date(r.lastSaleDate).toLocaleDateString('es-CO') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Profitability */}
      {activeTab === 'profitability' && (
        <Card className="overflow-hidden">
          <CardHeader className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Rentabilidad por Producto</h3>
            <button className="btn-outline btn-sm" onClick={handleExport}><Download className="w-4 h-4" /> Exportar</button>
          </CardHeader>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            {loading ? <TableSkeleton rows={10} cols={6} /> : profitabilityData.length === 0 ? (
              <div className="py-16 text-center text-gray-400">Sin datos de rentabilidad</div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b border-gray-200">
                    <th className="table-th">Producto</th>
                    <th className="table-th">Precio Costo</th>
                    <th className="table-th">Precio Venta</th>
                    <th className="table-th">Margen</th>
                    <th className="table-th">Margen %</th>
                    <th className="table-th">Unidades</th>
                    <th className="table-th">Utilidad Total</th>
                  </tr>
                </thead>
                <tbody>
                  {profitabilityData.map((item) => (
                    <tr key={item.productId} className="table-row">
                      <td className="table-td font-medium">{item.product?.name}</td>
                      <td className="table-td">{formatCOP(item.costPrice)}</td>
                      <td className="table-td">{formatCOP(item.salePrice)}</td>
                      <td className="table-td">{formatCOP(item.grossMargin)}</td>
                      <td className="table-td">
                        <Badge variant={item.grossMarginPct >= 30 ? 'green' : item.grossMarginPct >= 15 ? 'yellow' : 'red'}>
                          {formatPct(item.grossMarginPct)}
                        </Badge>
                      </td>
                      <td className="table-td">{item.totalSold}</td>
                      <td className="table-td font-semibold text-green-700">{formatCOP(item.totalProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
