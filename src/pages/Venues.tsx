import { Building2, Package, AlertTriangle, TrendingUp } from 'lucide-react'
import { useStore } from '../store/useStore'
import { formatPrice } from '../utils/format'

export default function Venues() {
  const { venues, inventory, purchases, selectedVenueId, setSelectedVenue } = useStore()

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 style={{ color: 'var(--white)' }}>Точки продаж</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Управление сетью заведений
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* "All venues" card */}
        <button
          onClick={() => setSelectedVenue(null)}
          className="card card-lift text-left w-full transition-all"
          style={{
            borderColor: selectedVenueId === null ? 'rgba(200,168,75,0.4)' : 'var(--border)',
            background: selectedVenueId === null ? 'rgba(200,168,75,0.06)' : 'var(--card)',
            cursor: 'pointer',
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--gold-dim)', border: '1px solid rgba(200,168,75,0.3)' }}
            >
              <Building2 className="w-5 h-5" style={{ color: 'var(--gold)' }} />
            </div>
            <div>
              <p className="font-semibold" style={{ color: 'var(--white)' }}>Все точки</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Сводная статистика</p>
            </div>
            {selectedVenueId === null && (
              <span className="ml-auto badge badge-ok">Активно</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="label">Позиций</p>
              <p className="text-xl font-bold num" style={{ color: 'var(--white)' }}>{inventory.length}</p>
            </div>
            <div>
              <p className="label">Нехватка</p>
              <p className="text-xl font-bold num" style={{ color: inventory.filter(i => i.quantity <= i.minQuantity).length > 0 ? 'var(--red)' : 'var(--green)' }}>
                {inventory.filter(i => i.quantity <= i.minQuantity).length}
              </p>
            </div>
            <div>
              <p className="label">Стоимость</p>
              <p className="text-sm font-bold num" style={{ color: 'var(--gold)' }}>
                {formatPrice(inventory.reduce((s, i) => s + i.quantity * i.price, 0))}
              </p>
            </div>
          </div>
        </button>

        {venues.map((venue) => {
          const venueInventory = inventory.filter((i) => i.venueId === venue.id)
          const lowCount = venueInventory.filter((i) => i.quantity <= i.minQuantity).length
          const totalValue = venueInventory.reduce((sum, i) => sum + i.quantity * i.price, 0)
          const activePurchases = purchases.filter((p) => p.venueId === venue.id && (p.status === 'pending' || p.status === 'ordered')).length
          const isSelected = selectedVenueId === venue.id

          return (
            <button
              key={venue.id}
              onClick={() => setSelectedVenue(isSelected ? null : venue.id)}
              className="card card-lift text-left w-full transition-all"
              style={{
                borderColor: isSelected ? 'rgba(200,168,75,0.4)' : 'var(--border)',
                background: isSelected ? 'rgba(200,168,75,0.06)' : 'var(--card)',
                cursor: 'pointer',
              }}
            >
              <div className="flex items-start gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: isSelected ? 'var(--gold-dim)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isSelected ? 'rgba(200,168,75,0.3)' : 'var(--border)'}`,
                  }}
                >
                  <Building2 className="w-5 h-5" style={{ color: isSelected ? 'var(--gold)' : 'var(--muted)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold" style={{ color: 'var(--white)' }}>{venue.name}</p>
                  <p className="text-xs truncate mt-0.5" style={{ color: 'var(--muted)' }}>{venue.address}</p>
                </div>
                {isSelected && (
                  <span className="badge badge-ok flex-shrink-0">Выбрана</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Package className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
                    <p className="label" style={{ margin: 0 }}>Позиций</p>
                  </div>
                  <p className="text-xl font-bold num" style={{ color: 'var(--white)' }}>{venueInventory.length}</p>
                </div>
                <div className="rounded-lg p-2.5" style={{ background: lowCount > 0 ? 'rgba(255,69,58,0.06)' : 'rgba(48,209,88,0.06)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5" style={{ color: lowCount > 0 ? 'var(--red)' : 'var(--green)' }} />
                    <p className="label" style={{ margin: 0 }}>Нехватка</p>
                  </div>
                  <p className="text-xl font-bold num" style={{ color: lowCount > 0 ? 'var(--red)' : 'var(--green)' }}>{lowCount}</p>
                </div>
              </div>

              <div className="rounded-lg p-2.5 flex items-center justify-between" style={{ background: 'rgba(200,168,75,0.06)', border: '1px solid rgba(200,168,75,0.1)' }}>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" style={{ color: 'var(--gold)' }} />
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Стоимость склада</p>
                </div>
                <p className="text-sm font-bold num" style={{ color: 'var(--gold)' }}>{formatPrice(totalValue)}</p>
              </div>

              {activePurchases > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="badge badge-ordered">{activePurchases} активных заказов</span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Low stock per venue table */}
      <div className="card">
        <h3 className="font-semibold mb-4" style={{ color: 'var(--white)' }}>Нехватка по точкам</h3>
        <div className="space-y-4">
          {venues.map((venue) => {
            const lowItems = inventory.filter((i) => i.venueId === venue.id && i.quantity <= i.minQuantity)
            if (lowItems.length === 0) return (
              <div key={venue.id} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <span className="text-sm font-medium" style={{ color: 'var(--white)' }}>{venue.name}</span>
                <span className="badge badge-ok">Всё в норме</span>
              </div>
            )
            return (
              <div key={venue.id} style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: '1rem' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--white)' }}>{venue.name}</span>
                  <span className="badge badge-low">{lowItems.length} позиций</span>
                </div>
                <div className="space-y-1.5">
                  {lowItems.slice(0, 3).map((item) => {
                    const pct = Math.min(100, Math.round((item.quantity / Math.max(item.minQuantity, 1)) * 100))
                    return (
                      <div key={item.id} className="flex items-center gap-3">
                        <span className="text-xs truncate flex-1" style={{ color: 'var(--muted)' }}>{item.name}</span>
                        <span className="text-xs num flex-shrink-0" style={{ color: 'var(--red)' }}>
                          {item.quantity}/{item.minQuantity} {item.unit}
                        </span>
                        <div className="stock-bar" style={{ width: 60 }}>
                          <div className="stock-bar-fill low" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                  {lowItems.length > 3 && (
                    <p className="text-xs" style={{ color: 'var(--red)' }}>+{lowItems.length - 3} ещё...</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
