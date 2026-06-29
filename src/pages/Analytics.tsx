import { useStore } from '../store/useStore'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'

const COLORS = ['#F97316', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4', '#84CC16']

export default function Analytics() {
  const { inventory, purchases, categories, suppliers } = useStore()

  // Spending by category
  const categorySpend = categories.map((cat) => {
    const items = inventory.filter((i) => i.categoryId === cat.id)
    const value = items.reduce((s, i) => s + i.quantity * i.price, 0)
    return { name: cat.name.split(' ')[0], value, icon: cat.icon }
  }).filter((c) => c.value > 0).sort((a, b) => b.value - a.value)

  // Spending by supplier (received orders)
  const supplierSpend = suppliers.map((sup) => {
    const total = purchases.filter((p) => p.supplierId === sup.id && p.status === 'received').reduce((s, p) => s + p.totalAmount, 0)
    return { name: sup.name, value: total }
  }).filter((s) => s.value > 0).sort((a, b) => b.value - a.value)

  // Monthly purchases (by createdAt)
  const monthlyMap: Record<string, number> = {}
  purchases.filter((p) => p.status === 'received').forEach((p) => {
    const month = p.createdAt.slice(0, 7)
    monthlyMap[month] = (monthlyMap[month] ?? 0) + p.totalAmount
  })
  const monthly = Object.entries(monthlyMap).sort().map(([k, v]) => ({ month: k.slice(5), value: v }))

  // Totals
  const totalReceived = purchases.filter((p) => p.status === 'received').reduce((s, p) => s + p.totalAmount, 0)
  const totalPending = purchases.filter((p) => p.status === 'pending' || p.status === 'ordered').reduce((s, p) => s + p.totalAmount, 0)
  const stockValue = inventory.reduce((s, i) => s + i.quantity * i.price, 0)
  const avgOrder = purchases.filter((p) => p.status === 'received').length > 0
    ? Math.round(totalReceived / purchases.filter((p) => p.status === 'received').length)
    : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Аналитика</h1>
        <p className="text-sm text-gray-500">Финансовые показатели склада</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Куплено всего', value: totalReceived.toLocaleString() + ' ₽', color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'В ожидании', value: totalPending.toLocaleString() + ' ₽', color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Стоимость склада', value: stockValue.toLocaleString() + ' ₽', color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Средний заказ', value: avgOrder.toLocaleString() + ' ₽', color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map((kpi) => (
          <div key={kpi.label} className={`card p-4 ${kpi.bg}`}>
            <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
            <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Bar chart: monthly */}
      {monthly.length > 0 && (
        <div className="card p-4">
          <h2 className="font-semibold text-gray-900 mb-4">Расходы по месяцам</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthly} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}к`} />
              <Tooltip formatter={(v: number) => [`${v.toLocaleString()} ₽`, 'Сумма']} />
              <Bar dataKey="value" fill="#F97316" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Pie: by category */}
        {categorySpend.length > 0 && (
          <div className="card p-4">
            <h2 className="font-semibold text-gray-900 mb-4">Склад по категориям</h2>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={categorySpend} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                  {categorySpend.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [`${v.toLocaleString()} ₽`]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Bar: by supplier */}
        {supplierSpend.length > 0 && (
          <div className="card p-4">
            <h2 className="font-semibold text-gray-900 mb-4">Расходы по поставщикам</h2>
            <div className="space-y-2.5">
              {supplierSpend.map((s, i) => {
                const pct = Math.round((s.value / supplierSpend[0].value) * 100)
                return (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700 font-medium">{s.name}</span>
                      <span className="text-gray-500">{s.value.toLocaleString()} ₽</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Top expensive items */}
      <div className="card p-4">
        <h2 className="font-semibold text-gray-900 mb-4">Топ по стоимости на складе</h2>
        <div className="space-y-2">
          {[...inventory].sort((a, b) => (b.quantity * b.price) - (a.quantity * a.price)).slice(0, 8).map((item, i) => {
            const cat = categories.find((c) => c.id === item.categoryId)
            return (
              <div key={item.id} className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-400 w-5">#{i+1}</span>
                <span className="text-lg">{cat?.icon ?? '📦'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                  <p className="text-xs text-gray-500">{item.quantity} {item.unit} × {item.price} ₽/ед.</p>
                </div>
                <span className="font-bold text-gray-900">{(item.quantity * item.price).toLocaleString()} ₽</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
