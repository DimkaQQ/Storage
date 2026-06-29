import { Package, ShoppingCart, Truck, AlertTriangle, TrendingUp } from 'lucide-react'
import { useStore } from '../store/useStore'
import StatCard from '../components/StatCard'
import LowStockAlert from '../components/LowStockAlert'
import { Link } from 'react-router-dom'
import Badge, { labels } from '../components/Badge'
import type { PurchaseStatus } from '../types'

export default function Dashboard() {
  const { inventory, purchases, suppliers } = useStore()

  const lowStockCount = inventory.filter((i) => i.quantity <= i.minQuantity).length
  const totalValue = inventory.reduce((sum, i) => sum + i.quantity * i.price, 0)
  const pendingOrders = purchases.filter((p) => p.status === 'pending' || p.status === 'ordered')
  const recentPurchases = [...purchases].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)

  const monthlySpend = purchases
    .filter((p) => p.status === 'received')
    .reduce((sum, p) => sum + p.totalAmount, 0)

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 rounded-2xl p-5 lg:p-6 text-white">
        <p className="text-gray-400 text-sm">Добро пожаловать в</p>
        <h1 className="text-2xl lg:text-3xl font-bold mt-1">Склад Ресторана</h1>
        <p className="text-gray-400 text-sm mt-1">Управление запасами и закупками</p>
        <div className="flex items-center gap-2 mt-4">
          <div className="px-3 py-1 bg-primary-500/20 border border-primary-500/30 rounded-full text-primary-400 text-xs font-medium">
            PWA активен
          </div>
          {lowStockCount > 0 && (
            <div className="px-3 py-1 bg-red-500/20 border border-red-500/30 rounded-full text-red-400 text-xs font-medium flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {lowStockCount} позиций мало
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Позиций на складе" value={inventory.length} subtitle="товаров учтено" icon={Package} color="bg-blue-500" />
        <StatCard title="Стоимость склада" value={`${(totalValue / 1000).toFixed(0)}к ₽`} subtitle="текущий запас" icon={TrendingUp} color="bg-green-500" />
        <StatCard title="Активных заказов" value={pendingOrders.length} subtitle="в ожидании" icon={ShoppingCart} color="bg-primary-500" />
        <StatCard title="Поставщиков" value={suppliers.length} subtitle="контрагентов" icon={Truck} color="bg-purple-500" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Low stock */}
        <LowStockAlert />

        {/* Recent purchases */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Последние закупки</h3>
            <Link to="/purchases" className="text-xs text-primary-500 hover:underline">Все →</Link>
          </div>
          <div className="space-y-3">
            {recentPurchases.map((p) => {
              const supplier = suppliers.find((s) => s.id === p.supplierId)
              return (
                <Link key={p.id} to={`/purchases/${p.id}`} className="flex items-center justify-between hover:bg-gray-50 rounded-xl px-2 py-1.5 -mx-2 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{supplier?.name}</p>
                    <p className="text-xs text-gray-400">{p.items.length} позиц. • {p.createdAt.slice(0, 10)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">{p.totalAmount.toLocaleString('ru-RU')} ₽</p>
                    <Badge variant={p.status}>{labels[p.status as PurchaseStatus] ?? p.status}</Badge>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { to: '/inventory', label: 'Склад', desc: 'Управление запасами', icon: Package, color: 'from-blue-500 to-blue-600' },
          { to: '/purchases', label: 'Закупки', desc: 'Создать заказ', icon: ShoppingCart, color: 'from-primary-500 to-orange-600' },
          { to: '/suppliers', label: 'Поставщики', desc: 'Контакты', icon: Truck, color: 'from-purple-500 to-purple-600' },
          { to: '/analytics', label: 'Аналитика', desc: 'Графики и отчёты', icon: TrendingUp, color: 'from-green-500 to-green-600' },
        ].map(({ to, label, desc, icon: Icon, color }) => (
          <Link key={to} to={to} className={`bg-gradient-to-br ${color} rounded-2xl p-4 text-white hover:opacity-90 transition-opacity`}>
            <Icon className="w-6 h-6 mb-2 opacity-90" />
            <p className="font-semibold text-sm">{label}</p>
            <p className="text-xs opacity-75 mt-0.5">{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
