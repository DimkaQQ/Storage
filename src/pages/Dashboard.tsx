import { Package, ShoppingCart, Truck, AlertTriangle, TrendingUp } from 'lucide-react'
import { useStore } from '../store/useStore'
import StatCard from '../components/StatCard'
import LowStockAlert from '../components/LowStockAlert'
import { Link } from 'react-router-dom'
import Badge, { labels } from '../components/Badge'
import type { PurchaseStatus } from '../types'
import { formatPrice } from '../utils/format'

export default function Dashboard() {
  const { inventory, purchases, suppliers, selectedVenueId, venues } = useStore()

  const filteredInventory = selectedVenueId ? inventory.filter((i) => i.venueId === selectedVenueId) : inventory
  const filteredPurchases = selectedVenueId ? purchases.filter((p) => p.venueId === selectedVenueId) : purchases

  const selectedVenue = venues.find((v) => v.id === selectedVenueId)
  const lowStockCount = filteredInventory.filter((i) => i.quantity <= i.minQuantity).length
  const totalValue = filteredInventory.reduce((sum, i) => sum + i.quantity * i.price, 0)
  const pendingOrders = filteredPurchases.filter((p) => p.status === 'pending' || p.status === 'ordered')
  const recentPurchases = [...filteredPurchases].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div>
        <p className="text-sm mb-1" style={{ color: 'var(--muted)' }}>
          {selectedVenue ? selectedVenue.name : 'Все точки продаж'}
        </p>
        <h1 className="text-3xl" style={{ color: 'var(--white)' }}>Склад Ресторана</h1>
        <div className="flex items-center gap-2 mt-3">
          {selectedVenue && (
            <span className="badge badge-ordered">{selectedVenue.address}</span>
          )}
          {lowStockCount > 0 && (
            <span className="badge badge-low flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {lowStockCount} позиций мало
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Позиций на складе" value={filteredInventory.length} subtitle="товаров учтено" icon={Package} />
        <StatCard title="Стоимость склада" value={formatPrice(totalValue)} subtitle="текущий запас" icon={TrendingUp} />
        <StatCard title="Активных заказов" value={pendingOrders.length} subtitle="в ожидании" icon={ShoppingCart} />
        <StatCard title="Поставщиков" value={suppliers.length} subtitle="контрагентов" icon={Truck} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Low stock */}
        <LowStockAlert />

        {/* Recent purchases */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold" style={{ color: 'var(--white)' }}>Последние закупки</h3>
            <Link to="/purchases" className="text-xs hover:underline" style={{ color: 'var(--gold)' }}>Все →</Link>
          </div>
          <div className="space-y-3">
            {recentPurchases.map((p) => {
              const supplier = suppliers.find((s) => s.id === p.supplierId)
              const venue = venues.find((v) => v.id === p.venueId)
              return (
                <Link
                  key={p.id}
                  to={`/purchases/${p.id}`}
                  className="flex items-center justify-between rounded-lg px-2 py-2 -mx-2 transition-colors"
                  style={{ color: 'inherit' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--white)' }}>{supplier?.name}</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {p.items.length} позиц. • {p.createdAt.slice(0, 10)}
                      {venue && !selectedVenueId && <span> • {venue.name}</span>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold num" style={{ color: 'var(--white)' }}>{formatPrice(p.totalAmount)}</p>
                    <Badge variant={p.status}>{labels[p.status as PurchaseStatus] ?? p.status}</Badge>
                  </div>
                </Link>
              )
            })}
            {recentPurchases.length === 0 && (
              <p className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>Нет закупок</p>
            )}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h3 className="text-sm font-medium mb-3 uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Быстрый доступ</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { to: '/inventory', label: 'Склад', desc: 'Управление запасами', icon: Package },
            { to: '/purchases', label: 'Закупки', desc: 'Создать заказ', icon: ShoppingCart },
            { to: '/suppliers', label: 'Поставщики', desc: 'Контакты', icon: Truck },
            { to: '/analytics', label: 'Аналитика', desc: 'Графики и отчёты', icon: TrendingUp },
          ].map(({ to, label, desc, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="kpi-card card-lift block"
              style={{ textDecoration: 'none' }}
            >
              <Icon className="w-5 h-5 mb-2" style={{ color: 'var(--gold)' }} />
              <p className="font-semibold text-sm" style={{ color: 'var(--white)' }}>{label}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
