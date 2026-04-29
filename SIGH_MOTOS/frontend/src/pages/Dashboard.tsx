import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, Package, DollarSign, AlertTriangle, ShoppingCart, Plus, BarChart3,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { reportService } from '@/services/reportService'
import type { DashboardData } from '@/types'
import { KpiCard, Card, CardHeader, CardBody } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { CardSkeleton, TableSkeleton } from '@/components/ui/Skeleton'
import { formatCOP, formatDateTime, saleStatusBadge } from '@/utils/formatters'

const PIE_COLORS = ['#1e3a8a', '#f97316', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b']

export default function Dashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    reportService.getDashboard()
      .then(setData)
      .catch(() => {/* handled by api interceptor */})
      .finally(() => setLoading(false))
  }, [])

  const kpis = data?.kpis
  const salesTrend = data?.salesTrend ?? []
  const categorySales = data?.categorySales ?? []
  const recentSales = data?.recentSales ?? []
  const lowStock = data?.lowStockProducts ?? []

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Resumen del día y métricas principales"
        actions={
          <div className="flex gap-2">
            <button className="btn-outline btn-sm" onClick={() => navigate('/reports')}>
              <BarChart3 className="w-4 h-4" /> Ver Reportes
            </button>
            <button className="btn-primary btn-sm" onClick={() => navigate('/pos')}>
              <ShoppingCart className="w-4 h-4" /> Nueva Venta
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard
              title="Ventas Hoy"
              value={formatCOP(kpis?.salesToday ?? 0)}
              icon={<TrendingUp />}
              color="blue"
              subtitle="Ingresos del día"
            />
            <KpiCard
              title="Ingresos del Mes"
              value={formatCOP(kpis?.salesMonthTotal ?? 0)}
              icon={<DollarSign />}
              color="green"
              subtitle="Total acumulado"
            />
            <KpiCard
              title="Gastos del Mes"
              value={formatCOP(kpis?.expensesMonth ?? 0)}
              icon={<DollarSign />}
              color="red"
              subtitle="Egresos registrados"
            />
            <KpiCard
              title="Productos Bajo Stock"
              value={kpis?.lowStockCount ?? 0}
              icon={<AlertTriangle />}
              color="orange"
              subtitle="Requieren reposición"
            />
          </>
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        {/* Sales trend */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Ventas últimos 30 días</h2>
          </CardHeader>
          <CardBody>
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="animate-pulse bg-gray-100 w-full h-full rounded" />
              </div>
            ) : salesTrend.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
                Sin datos de ventas disponibles
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={salesTrend} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number) => [formatCOP(v), 'Ventas']}
                    labelFormatter={(l) => `Fecha: ${l}`}
                  />
                  <Line type="monotone" dataKey="total" stroke="#1e3a8a" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        {/* Category pie */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Ventas por Categoría</h2>
          </CardHeader>
          <CardBody>
            {loading ? (
              <div className="h-64 animate-pulse bg-gray-100 rounded" />
            ) : categorySales.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Sin datos</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={categorySales} dataKey="total" nameKey="category" cx="50%" cy="45%" outerRadius={80} label={false}>
                    {categorySales.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => formatCOP(v)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Tables row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Recent sales */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Últimas Ventas</h2>
            <button className="text-sm text-blue-600 hover:text-blue-800" onClick={() => navigate('/invoices')}>
              Ver todas
            </button>
          </CardHeader>
          <div className="overflow-x-auto">
            {loading ? (
              <TableSkeleton rows={5} cols={4} />
            ) : recentSales.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">Sin ventas recientes</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="table-th">Número</th>
                    <th className="table-th">Fecha</th>
                    <th className="table-th">Total</th>
                    <th className="table-th">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map((sale) => {
                    const st = saleStatusBadge(sale.status)
                    return (
                      <tr key={sale.id} className="table-row">
                        <td className="table-td font-mono text-xs">{sale.saleNumber}</td>
                        <td className="table-td text-gray-500">{formatDateTime(sale.createdAt)}</td>
                        <td className="table-td font-semibold">{formatCOP(sale.total ?? 0)}</td>
                        <td className="table-td">
                          <span className={st.cls}>{st.label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* Low stock alerts */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Alertas de Stock</h2>
            <button className="text-sm text-blue-600 hover:text-blue-800" onClick={() => navigate('/inventory')}>
              Ver inventario
            </button>
          </CardHeader>
          <div className="overflow-x-auto">
            {loading ? (
              <TableSkeleton rows={5} cols={3} />
            ) : lowStock.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
                <Package className="w-8 h-8 text-green-400" />
                Todos los productos tienen stock adecuado
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="table-th">Producto</th>
                    <th className="table-th">Stock</th>
                    <th className="table-th">Mín.</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((p) => (
                    <tr key={p.id} className="table-row">
                      <td className="table-td">
                        <div>
                          <p className="font-medium text-gray-800 text-xs">{p.name}</p>
                          <p className="text-gray-400 text-xs">{p.sku}</p>
                        </div>
                      </td>
                      <td className="table-td">
                        <Badge variant={p.stock <= 0 ? 'red' : 'yellow'}>{p.stock}</Badge>
                      </td>
                      <td className="table-td text-gray-500">{p.minStock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
