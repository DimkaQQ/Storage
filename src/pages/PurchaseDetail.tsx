import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, X, Package } from 'lucide-react'
import { useStore } from '../store/useStore'
import Badge, { labels } from '../components/Badge'
import type { PurchaseStatus } from '../types'

export default function PurchaseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { purchases, suppliers, inventory, updatePurchaseStatus, deletePurchase } = useStore()

  const purchase = purchases.find((p) => p.id === id)
  const supplier = suppliers.find((s) => s.id === purchase?.supplierId)

  if (!purchase) return (
    <div className="p-6 text-center">
      <p style={{ color: 'var(--muted)' }}>Заказ не найден</p>
      <button onClick={() => navigate('/purchases')} className="btn-secondary mt-4 mx-auto">Назад</button>
    </div>
  )

  const handleDelete = () => {
    if (confirm('Удалить этот заказ?')) {
      deletePurchase(purchase.id)
      navigate('/purchases')
    }
  }

  const transitions: Record<PurchaseStatus, PurchaseStatus[]> = {
    pending: ['ordered', 'cancelled'],
    ordered: ['received', 'cancelled'],
    received: [],
    cancelled: [],
  }

  const nextStatuses = transitions[purchase.status]

  const statusLabels: Record<string, string> = {
    ordered: 'Подтвердить заказ',
    received: 'Отметить получение',
    cancelled: 'Отменить',
  }

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/purchases')}
          className="p-2 rounded-lg transition-colors"
          style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl" style={{ color: 'var(--white)' }}>Заказ #{purchase.id.slice(-4).toUpperCase()}</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{purchase.createdAt.slice(0, 10)}</p>
        </div>
        <Badge variant={purchase.status}>{labels[purchase.status]}</Badge>
      </div>

      {/* Summary card */}
      <div className="card" style={{ borderColor: 'rgba(200,168,75,0.2)' }}>
        <p className="text-sm mb-1" style={{ color: 'var(--muted)' }}>{supplier?.name}</p>
        <p className="text-3xl font-bold" style={{ color: 'var(--gold)', fontFamily: "'Instrument Serif', serif" }}>
          {purchase.totalAmount.toLocaleString('ru-RU')} ₽
        </p>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <p className="label">Создан</p>
            <p className="text-sm font-medium" style={{ color: 'var(--white)' }}>{purchase.createdAt.slice(0, 10)}</p>
          </div>
          <div>
            <p className="label">Ожидается</p>
            <p className="text-sm font-medium" style={{ color: 'var(--white)' }}>{purchase.expectedDate?.slice(0, 10) ?? '—'}</p>
          </div>
          {purchase.receivedDate && (
            <div>
              <p className="label">Получен</p>
              <p className="text-sm font-medium" style={{ color: '#22c55e' }}>{purchase.receivedDate.slice(0, 10)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {nextStatuses.length > 0 && (
        <div className="flex gap-2">
          {nextStatuses.map((s) => (
            <button
              key={s}
              onClick={() => updatePurchaseStatus(purchase.id, s)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-colors ${
                s === 'cancelled' ? 'btn-danger' : 'btn-primary'
              }`}
            >
              {s === 'cancelled' ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
              {statusLabels[s]}
            </button>
          ))}
        </div>
      )}

      {/* Supplier info */}
      {supplier && (
        <div className="card">
          <h3 className="font-semibold mb-3" style={{ color: 'var(--white)' }}>Поставщик</h3>
          <div className="space-y-1.5">
            <p className="text-sm font-medium" style={{ color: 'var(--white)' }}>{supplier.name}</p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{supplier.contact}</p>
            <a href={`tel:${supplier.phone}`} className="text-sm" style={{ color: 'var(--gold)' }}>{supplier.phone}</a>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{supplier.email}</p>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="card p-0">
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="font-semibold" style={{ color: 'var(--white)' }}>Позиции ({purchase.items.length})</h3>
        </div>
        <div>
          {purchase.items.map((item, idx) => {
            const invItem = inventory.find((i) => i.id === item.itemId)
            return (
              <div
                key={idx}
                className="flex items-center gap-3 px-5 py-3"
                style={{ borderBottom: idx < purchase.items.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,0.04)' }}
                >
                  <Package className="w-4 h-4" style={{ color: 'var(--muted)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--white)' }}>{item.name}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {item.quantity} {item.unit} × {item.price.toLocaleString('ru-RU')} ₽
                  </p>
                </div>
                <p className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--white)' }}>
                  {(item.quantity * item.price).toLocaleString('ru-RU')} ₽
                </p>
              </div>
            )
          })}
        </div>
        <div className="flex justify-between items-center px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>Итого</span>
          <span className="text-lg font-bold" style={{ color: 'var(--gold)', fontFamily: "'Instrument Serif', serif" }}>
            {purchase.totalAmount.toLocaleString('ru-RU')} ₽
          </span>
        </div>
      </div>

      {/* Notes */}
      {purchase.notes && (
        <div className="card">
          <h3 className="font-semibold mb-2" style={{ color: 'var(--white)' }}>Примечания</h3>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{purchase.notes}</p>
        </div>
      )}

      {/* Delete */}
      {(purchase.status === 'pending' || purchase.status === 'cancelled') && (
        <button
          onClick={handleDelete}
          className="w-full py-3 text-sm font-medium rounded-xl transition-colors"
          style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', background: 'transparent', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.06)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          Удалить заказ
        </button>
      )}
    </div>
  )
}
