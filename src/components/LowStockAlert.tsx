import { AlertTriangle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Link } from 'react-router-dom'

export default function LowStockAlert() {
  const { inventory, selectedVenueId } = useStore()
  const venueInventory = selectedVenueId ? inventory.filter((i) => i.venueId === selectedVenueId) : inventory
  const lowItems = venueInventory.filter((i) => i.quantity <= i.minQuantity)

  if (lowItems.length === 0) return null

  return (
    <div className="card" style={{ borderColor: 'rgba(255,69,58,0.25)' }}>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4" style={{ color: 'var(--red)' }} />
        <h3 className="font-semibold text-sm" style={{ color: 'var(--red)' }}>Нехватка товаров ({lowItems.length})</h3>
      </div>
      <div className="space-y-2">
        {lowItems.slice(0, 5).map((item) => {
          const pct = Math.min(100, Math.round((item.quantity / Math.max(item.minQuantity, 1)) * 100))
          return (
            <Link key={item.id} to={`/inventory/${item.id}`} className="block py-1.5 hover:opacity-80 transition-opacity">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm" style={{ color: 'var(--white)' }}>{item.name}</span>
                <span className="badge badge-low num">{item.quantity} / {item.minQuantity} {item.unit}</span>
              </div>
              <div className="stock-bar">
                <div className="stock-bar-fill low" style={{ width: `${pct}%` }} />
              </div>
            </Link>
          )
        })}
        {lowItems.length > 5 && (
          <Link to="/inventory" className="block text-xs mt-1 hover:underline" style={{ color: 'var(--red)' }}>
            Ещё {lowItems.length - 5} товаров...
          </Link>
        )}
      </div>
    </div>
  )
}
