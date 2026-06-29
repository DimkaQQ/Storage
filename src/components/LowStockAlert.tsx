import { AlertTriangle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Link } from 'react-router-dom'

export default function LowStockAlert() {
  const inventory = useStore((s) => s.inventory)
  const lowItems = inventory.filter((i) => i.quantity <= i.minQuantity)

  if (lowItems.length === 0) return null

  return (
    <div className="card border-red-100 bg-red-50">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-5 h-5 text-red-500" />
        <h3 className="font-semibold text-red-700">Нехватка товаров ({lowItems.length})</h3>
      </div>
      <div className="space-y-2">
        {lowItems.slice(0, 5).map((item) => (
          <Link key={item.id} to={`/inventory/${item.id}`} className="flex items-center justify-between py-1.5 hover:opacity-80 transition-opacity">
            <span className="text-sm text-red-800">{item.name}</span>
            <span className="text-xs font-medium bg-red-100 text-red-600 px-2 py-0.5 rounded-full border border-red-200">
              {item.quantity} / {item.minQuantity} {item.unit}
            </span>
          </Link>
        ))}
        {lowItems.length > 5 && (
          <Link to="/inventory" className="block text-xs text-red-500 hover:underline mt-1">
            Ещё {lowItems.length - 5} товаров...
          </Link>
        )}
      </div>
    </div>
  )
}
