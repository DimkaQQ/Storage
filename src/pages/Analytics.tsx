import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { useStore } from '../store/useStore'

const COLORS = ['#c8a84b', '#22c55e', '#60a5fa', '#a78bfa', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899']

const tooltipStyle = {
  backgroundColor: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  color: '#f9f9f9',
  fontSize: '0.8rem',
}

export default function Analytics() {
  const { purchases, inventory, categories, suppliers } = useStore()

  const spendBySupplier = suppliers.map((s) => ({
    name: s.name.split(' ')[0],
    amount: purchases
      .filter((p) => p.supplierId === s.id && p.status === 'received')
      .reduce((sum, p) => sum + p.totalAmount, 0),
  })).filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount)

  const stockByCategory = categories.map((c) => {
    const items = inventory.filter((i) => i.categoryId === c.id)
    const value = items.reduce((sum, i) => sum + i.quantity * i.price, 0)
    return { name: c.name.split(' ')[0], value, icon: c.icon }
  }).filter((c) => c.value > 0)

  const statusData = [
    { name: 'Ожидает', value: purchases.filter((p) => p.status === 'pending').length, color: '#f59e0b' },
    { name: 'Заказан', value: purchases.filter((p) => p.status === 'ordered').length, color: '#60a5fa' },
    { name: 'Получен', value: purchases.filter((p) => p.status === 'received').length, color: '#22c55e' },
    { name: 'Отменён', value: purchases.filter((p) => p.status === 'cancelled').length, color: '#6b7280' },
  ].filter((d) => d.value > 0)

  const topItems = [...inventory]
    .sort((a, b) => (b.quantity * b.price) - (a.quantity * a.price))
    .slice(0, 8)
    .map((i) => ({ name: i.name.split(' ')[0], value: i.quantity * i.price }))

  const totalSpent = purchases.filter((p) => p.status === 'received').reduce((sum, p) => sum + p.totalAmount, 0)
  const totalStock = inventory.reduce((sum, i) => sum + i.quantity * i.price, 0)
  const avgOrder = purchases.length > 0 ? Math.round(purchases.reduce((sum, p) => sum + p.totalAmount, 0) / purchases.length) : 0
  const lowItems = inventory.filter((i) => i.quantity <= i.minQuantity)

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 style={{ color: 'var(--white)' }}>Аналитика</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Статистика закупок и склада</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="kpi-card text-center">
          <p className="label">Потрачено всего</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--white)', fontFamily: "'Instrument Serif', serif" }}>{(totalSpent / 1000).toFixed(0)}к ₽</p>
        </div>
        <div className="kpi-card text-center">
          <p className="label">Стоимость склада</p>
          <p className="text-2xl font-bold" style={{ color: '#22c55e', fontFamily: "'Instrument Serif', serif" }}>{(totalStock / 1000).toFixed(0)}к ₽</p>
        </div>
        <div className="kpi-card text-center">
          <p className="label">Средний заказ</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--gold)', fontFamily: "'Instrument Serif', serif" }}>{(avgOrder / 1000).toFixed(0)}к ₽</p>
        </div>
      </div>

      {/* Spending by supplier */}
      {spendBySupplier.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-4" style={{ color: 'var(--white)' }}>Расходы по поставщикам (₽)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={spendBySupplier} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}к`} />
              <Tooltip
                formatter={(v: number) => [`${v.toLocaleString('ru-RU')} ₽`, 'Сумма']}
                contentStyle={tooltipStyle}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <Bar dataKey="amount" fill="var(--gold)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Two column charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        {stockByCategory.length > 0 && (
          <div className="card">
            <h3 className="font-semibold mb-4" style={{ color: 'var(--white)' }}>Запасы по категориям</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={stockByCategory}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                >
                  {stockByCategory.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => [`${v.toLocaleString('ru-RU')} ₽`, 'Стоимость']} contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {statusData.length > 0 && (
          <div className="card">
            <h3 className="font-semibold mb-4" style={{ color: 'var(--white)' }}>Статусы заказов</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  label={({ name, value }) => `${name}: ${value}`}
                  labelLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                >
                  {statusData.map((d, idx) => (
                    <Cell key={idx} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top items */}
      {topItems.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-4" style={{ color: 'var(--white)' }}>Топ товаров по стоимости запаса</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topItems} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}к`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} width={70} />
              <Tooltip formatter={(v: number) => [`${v.toLocaleString('ru-RU')} ₽`, 'Стоимость']} contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="value" fill="#60a5fa" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Low stock items */}
      <div className="card">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--white)' }}>Позиции требующие пополнения</h3>
        {lowItems.length === 0 ? (
          <p className="text-sm text-center py-4" style={{ color: '#22c55e' }}>✓ Все запасы в норме!</p>
        ) : (
          <div className="space-y-3">
            {lowItems.map((item) => {
              const cat = categories.find((c) => c.id === item.categoryId)
              const pct = Math.round((item.quantity / Math.max(item.minQuantity, 1)) * 100)
              return (
                <div key={item.id} className="flex items-center gap-3">
                  <span className="text-lg flex-shrink-0">{cat?.icon ?? '📦'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium truncate" style={{ color: 'var(--white)' }}>{item.name}</span>
                      <span className="flex-shrink-0 ml-2" style={{ color: '#ef4444' }}>{item.quantity}/{item.minQuantity} {item.unit}</span>
                    </div>
                    <div className="stock-bar">
                      <div className="stock-bar-fill low" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
