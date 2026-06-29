import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ArrowLeft, Edit2, Trash2, MapPin, Package, AlertTriangle } from 'lucide-react'
import { useStore } from '../store/useStore'
import Modal from '../components/Modal'
import InventoryForm from '../components/forms/InventoryForm'
import { formatPrice } from '../utils/format'

type StockStatus = 'ok' | 'warning' | 'low' | 'empty'

function getStockStatus(quantity: number, minQuantity: number): StockStatus {
  if (quantity === 0) return 'empty'
  if (quantity < minQuantity) return 'low'
  if (quantity < minQuantity * 2) return 'warning'
  return 'ok'
}

const statusColors: Record<StockStatus, string> = {
  ok: '#22c55e',
  warning: '#f59e0b',
  low: '#ef4444',
  empty: '#6b7280',
}

export default function InventoryItem() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { inventory, categories, suppliers, venues, deleteInventoryItem } = useStore()
  const [showEdit, setShowEdit] = useState(false)

  const item = inventory.find((i) => i.id === id)
  const cat = categories.find((c) => c.id === item?.categoryId)
  const supplier = suppliers.find((s) => s.id === item?.supplierId)
  const venue = venues.find((v) => v.id === item?.venueId)

  if (!item) return (
    <div className="p-6 text-center">
      <p style={{ color: 'var(--muted)' }}>Товар не найден</p>
      <button onClick={() => navigate('/inventory')} className="btn-secondary mt-4 mx-auto">Назад</button>
    </div>
  )

  const status = getStockStatus(item.quantity, item.minQuantity)
  const statusColor = statusColors[status]
  const value = item.quantity * item.price
  const pct = item.minQuantity === 0 ? 100 : Math.min(100, Math.round((item.quantity / (item.minQuantity * 2)) * 100))

  const handleDelete = () => {
    if (confirm(`Удалить "${item.name}"?`)) {
      deleteInventoryItem(item.id)
      navigate('/inventory')
    }
  }

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/inventory')}
          className="p-2 rounded-lg transition-colors"
          style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl" style={{ color: 'var(--white)' }}>{item.name}</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{cat?.icon} {cat?.name}</p>
        </div>
        <button onClick={() => setShowEdit(true)} className="btn-secondary">
          <Edit2 className="w-4 h-4" />
        </button>
        <button onClick={handleDelete} className="btn-danger">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Stock status */}
      <div className="card" style={{ borderColor: `${statusColor}30` }}>
        <div className="flex items-center gap-2 mb-3">
          {status === 'ok' ? (
            <Package className="w-5 h-5" style={{ color: statusColor }} />
          ) : (
            <AlertTriangle className="w-5 h-5" style={{ color: statusColor }} />
          )}
          <span className="font-semibold text-sm" style={{ color: statusColor }}>
            {status === 'ok' ? 'Запас в норме' : status === 'warning' ? 'Запас снижается' : status === 'low' ? 'Нехватка товара' : 'Товар закончился'}
          </span>
        </div>
        <div className="flex items-end gap-2 mb-3">
          <span className="text-4xl font-bold" style={{ color: 'var(--white)', fontFamily: "'Instrument Serif', serif" }}>{item.quantity}</span>
          <span className="text-lg pb-1" style={{ color: 'var(--muted)' }}>{item.unit}</span>
        </div>
        <div className="stock-bar mb-1">
          <div className={`stock-bar-fill ${status}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>Минимальный запас: {item.minQuantity} {item.unit}</p>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-3">
        <div className="kpi-card">
          <p className="label">Цена за единицу</p>
          <p className="text-xl font-bold num" style={{ color: 'var(--white)' }}>{formatPrice(item.price)}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>за {item.unit}</p>
        </div>
        <div className="kpi-card">
          <p className="label">Стоимость запаса</p>
          <p className="text-xl font-bold num" style={{ color: 'var(--green)' }}>{formatPrice(value)}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>текущий остаток</p>
        </div>
      </div>

      {/* Info */}
      <div className="card space-y-3">
        <h3 className="font-semibold" style={{ color: 'var(--white)' }}>Информация</h3>
        {venue && (
          <div className="flex items-start gap-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--gold)' }} />
            <div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Точка продаж</p>
              <p className="text-sm font-medium" style={{ color: 'var(--white)' }}>{venue.name}</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{venue.address}</p>
            </div>
          </div>
        )}
        {supplier && (
          <div className="flex items-start gap-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <Package className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--muted)' }} />
            <div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Поставщик</p>
              <p className="text-sm font-medium" style={{ color: 'var(--white)' }}>{supplier.name}</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{supplier.phone}</p>
            </div>
          </div>
        )}
        {item.location && (
          <div className="flex items-start gap-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--muted)' }} />
            <div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Место хранения</p>
              <p className="text-sm font-medium" style={{ color: 'var(--white)' }}>{item.location}</p>
            </div>
          </div>
        )}
        <div className="flex items-start gap-3 py-2">
          <Package className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--muted)' }} />
          <div>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Последнее обновление</p>
            <p className="text-sm font-medium" style={{ color: 'var(--white)' }}>{item.lastUpdated?.slice(0, 10)}</p>
          </div>
        </div>
        {item.notes && (
          <div className="rounded-lg p-3 mt-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Примечания</p>
            <p className="text-sm" style={{ color: 'var(--white)' }}>{item.notes}</p>
          </div>
        )}
      </div>

      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Редактировать товар">
        <InventoryForm item={item} onClose={() => setShowEdit(false)} />
      </Modal>
    </div>
  )
}
