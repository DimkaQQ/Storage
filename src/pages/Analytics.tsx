import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts'
import { useStore } from '../store/useStore'
import { TrendingUp, Package, ShoppingCart } from 'lucide-react'

const COLORS = ['#F97316', '#3B82F6', '#22C55E', '#8B5CF6', '#EF4444', '#F59E0B', '#06B6D4', '#EC4899']

export default function Analytics() {
  const { purchases, inventory, categories, suppliers } = useStore()

  // Spending by supplier
  const spendBySupplier = suppliers.map((s) => ({
    name: s.name.split(' ')[0],
    amount: purchases
      .filter((p) => p.supplierId === s.id && p.status === 'received')
      .reduce((sum, p) => sum + p.totalAmount, 0),
  })).filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount)

  // Stock by category
  const stockByCategory = categories.map((c) => {
    const items = inventory.filter((i) => i.categoryId === c.id)
    const value = items.reduce((sum, i) => sum + i.quantity * i.price, 0)
    return { name: c.name.split(' ')[0], value, icon: c.icon }
  }).filter((c) => c.value > 0)

  // Purchase status distribution
  const statusData = [
    { name: 'Ожидает', value: purchases.filter((p) => p.status === 'pending').length, color: '#F59E0B' },
    { name: 'Заказан', value: purchases.filter((p) => p.status === 'ordered').length, color: '#3B82F6' },
    { name: 'Получен', value: purchases.filter((p) => p.status === 'received').length, color: '#22C55E' },
    { name: 'Отменён', value: purchases.filter((p) => p.status === 'cancelled').length, color: '#EF4444' },
  ].filter((d) => d.value > 0)

  // Top items by value
  const topItems = [...inventory]
    .sort((a, b) => (b.quantity * b.price) - (a.quantity * a.price))
    .slice(0, 8)
    .map((i) => ({ name: i.name.split(' ')[0], value: i.quantity * i.price }))

  const totalSpent = purchases.filter((p) => p.status === 'received').reduce((sum, p) => sum + p.totalAmount, 0)
  const totalStock = inventory.reduce((sum, i) => sum + i.quantity * i.price, 0)
  const avgOrder = purchases.length > 0 ? Math.round(purchases.reduce((sum, p) => sum + p.totalAmount, 0) / purchases.length) : 0

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Аналитика</h1>
        <p className="text-sm text-gray-500 mt-0.5">Статистика закупок и склада</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center">
          <p className="text-xs text-gray-400 mb-1">Потрачено всего</p>
          <p className="text-lg font-bold text-gray-900">{(totalSpent / 1000).toFixed(0)}к ₽</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-400 mb-1">Стоимость склада</p>
          <p className="text-lg font-bold text-green-600">{(totalStock / 1000).toFixed(0)}к ₽</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-400 mb-1">Средний заказ</p>
          <p className="text-lg font-bold text-primary-600">{(avgOrder / 1000).toFixed(0)}к ₽</p>
        </div>
      </div>

      {/* Spending by supplier */}
      {spendBySupplier.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-4">Расходы по поставщикам (₽)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={spendBySupplier} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}к`} />
              <Tooltip formatter={(v: number) => [`${v.toLocaleString('ru-RU')} ₽`, 'Сумма']} />
              <Bar dataKey="amount" fill="#F97316" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Two column charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Category stock value */}
        {stockByCategory.length > 0 && (
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">Запасы по категориям</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={stockByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {stockByCategory.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => [`${v.toLocaleString('ru-RU')} ₽`, 'Стоимость']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Order status */}
        {statusData.length > 0 && (
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">Статусы заказов</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                  {statusData.map((d, idx) => (
                    <Cell key={idx} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top items */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">Топ товаров по стоимости запаса</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={topItems} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}к`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={70} />
            <Tooltip formatter={(v: number) => [`${v.toLocaleString('ru-RU')} ₽`, 'Стоимость']} />
            <Bar dataKey="value" fill="#3B82F6" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Low stock warning items */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-3">Позиции требующие пополнения</h3>
        <div className="space-y-2">
          {inventory.filter((i) => i.quantity <= i.minQuantity).map((item) => {
            const cat = categories.find((c) => c.id === item.categoryId)
            const pct = Math.round((item.quantity / Math.max(item.minQuantity, 1)) * 100)
            return (
              <div key={item.id} className="flex items-center gap-3">
                <span className="text-lg">{cat?.icon ?? '📦'}</span>
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-800 truncate">{item.name}</span>
                    <span className="text-red-500 font-medium flex-shrink-0 ml-2">{item.quantity}/{item.minQuantity} {item.unit}</span>
                  </div>
                  <div className="bg-red-100 rounded-full h-1.5">
                    <div className="bg-red-400 h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              </div>
            )
          })}
          {inventory.filter((i) => i.quantity <= i.minQuantity).length === 0 && (
            <p className="text-sm text-green-600 text-center py-4">✓ Все запасы в норме!</p>
          )}
        </div>
      </div>
    </div>
  )
}
