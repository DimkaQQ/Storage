import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { useStore } from '../store/useStore'
import { formatPrice } from '../utils/format'

const COLORS = ['#c8a84b', '#30d158', '#0a84ff', '#a78bfa', '#ffd60a', '#ff453a', '#06b6d4', '#ec4899']

const legendStyle = { fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }

function DarkTooltip({ active, payload, label, formatter }: {
  active?: boolean
  payload?: Array<{ value: number; name?: string; color?: string }>
  label?: string
  formatter?: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '8px',
      padding: '8px 12px',
      fontSize: '0.8rem',
    }}>
      {label && <p style={{ color: 'rgba(255,255,255,0.45)', marginBottom: '4px' }}>{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: '#f5f5f7' }}>
          {p.name && <span style={{ color: 'rgba(255,255,255,0.45)', marginRight: '6px' }}>{p.name}:</span>}
          <span style={{ color: p.color && p.color !== 'rgba(255,255,255,0.3)' ? p.color : '#f5f5f7' }}>
            {formatter ? formatter(p.value) : p.value}
          </span>
        </p>
      ))}
    </div>
  )
}

export default function Analytics() {
  const { purchases, inventory, categories, suppliers, selectedVenueId } = useStore()

  const filteredPurchases = selectedVenueId ? purchases.filter((p) => p.venueId === selectedVenueId) : purchases
  const filteredInventory = selectedVenueId ? inventory.filter((i) => i.venueId === selectedVenueId) : inventory

  const spendBySupplier = suppliers.map((s) => ({
    name: s.name.split(' ')[0],
    amount: filteredPurchases
      .filter((p) => p.supplierId === s.id && p.status === 'received')
      .reduce((sum, p) => sum + p.totalAmount, 0),
  })).filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount)

  const stockByCategory = categories.map((c) => {
    const items = filteredInventory.filter((i) => i.categoryId === c.id)
    const value = items.reduce((sum, i) => sum + i.quantity * i.price, 0)
    return { name: c.name.split(' ')[0], value, icon: c.icon }
  }).filter((c) => c.value > 0)

  const statusData = [
    { name: 'Ожидает', value: filteredPurchases.filter((p) => p.status === 'pending').length, color: '#ffd60a' },
    { name: 'Заказан', value: filteredPurchases.filter((p) => p.status === 'ordered').length, color: '#0a84ff' },
    { name: 'Получен', value: filteredPurchases.filter((p) => p.status === 'received').length, color: '#30d158' },
    { name: 'Отменён', value: filteredPurchases.filter((p) => p.status === 'cancelled').length, color: 'rgba(255,255,255,0.3)' },
  ].filter((d) => d.value > 0)

  const topItems = [...filteredInventory]
    .sort((a, b) => (b.quantity * b.price) - (a.quantity * a.price))
    .slice(0, 8)
    .map((i) => ({ name: i.name.split(' ')[0], value: i.quantity * i.price }))

  const totalSpent = filteredPurchases.filter((p) => p.status === 'received').reduce((sum, p) => sum + p.totalAmount, 0)
  const totalStock = filteredInventory.reduce((sum, i) => sum + i.quantity * i.price, 0)
  const avgOrder = filteredPurchases.length > 0
    ? Math.round(filteredPurchases.reduce((sum, p) => sum + p.totalAmount, 0) / filteredPurchases.length)
    : 0
  const lowItems = filteredInventory.filter((i) => i.quantity <= i.minQuantity)

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 style={{ color: 'var(--white)' }}>Аналитика</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Статистика закупок и склада</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Потрачено', value: totalSpent, color: 'var(--white)' },
          { label: 'Стоимость склада', value: totalStock, color: 'var(--green)' },
          { label: 'Средний заказ', value: avgOrder, color: 'var(--gold)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="kpi-card text-center" style={{ padding: '0.75rem' }}>
            <p className="label" style={{ fontSize: '0.65rem', marginBottom: '0.35rem' }}>{label}</p>
            <p className="font-bold num" style={{ color, fontSize: 'clamp(0.85rem, 3vw, 1.25rem)', whiteSpace: 'nowrap' }}>
              {formatPrice(value)}
            </p>
          </div>
        ))}
      </div>

      {/* Spending by supplier */}
      {spendBySupplier.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-4" style={{ color: 'var(--white)' }}>Расходы по поставщикам</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={spendBySupplier} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}к`} />
              <Tooltip content={<DarkTooltip formatter={formatPrice} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="amount" fill="var(--gold)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Pie charts - stack on mobile, side by side on desktop */}
      <div className="grid lg:grid-cols-2 gap-4">
        {stockByCategory.length > 0 && (
          <div className="card">
            <h3 className="font-semibold mb-3" style={{ color: 'var(--white)' }}>Запасы по категориям</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={stockByCategory}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  outerRadius={70}
                >
                  {stockByCategory.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<DarkTooltip formatter={formatPrice} />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => <span style={legendStyle}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {statusData.length > 0 && (
          <div className="card">
            <h3 className="font-semibold mb-3" style={{ color: 'var(--white)' }}>Статусы заказов</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  outerRadius={70}
                >
                  {statusData.map((d, idx) => (
                    <Cell key={idx} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip content={<DarkTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => <span style={legendStyle}>{value}</span>}
                />
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
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}к`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} width={65} />
              <Tooltip content={<DarkTooltip formatter={formatPrice} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="value" fill="var(--blue)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Low stock items */}
      <div className="card">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--white)' }}>Позиции требующие пополнения</h3>
        {lowItems.length === 0 ? (
          <p className="text-sm text-center py-4" style={{ color: 'var(--green)' }}>✓ Все запасы в норме!</p>
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
                      <span className="flex-shrink-0 ml-2 num" style={{ color: 'var(--red)', whiteSpace: 'nowrap' }}>{item.quantity}/{item.minQuantity} {item.unit}</span>
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
