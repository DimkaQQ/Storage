import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
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
      <p className="text-gray-400">Заказ не найден</p>
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
        <button onClick={() => navigate('/purchases')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Заказ #{purchase.id.slice(-4).toUpperCase()}</h1>
          <p className="text-sm text-gray-500">{purchase.createdAt.slice(0, 10)}</p>
        </div>
        <Badge variant={purchase.status}>{labels[purchase.status]}</Badge>
      </div>

      {/* Summary card */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-5 text-white">
        <p className="text-gray-400 text-sm">{supplier?.name}</p>
        <p className="text-3xl font-bold mt-1">{purchase.totalAmount.toLocaleString('ru-RU')} ₽</p>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <p className="text-xs text-gray-400">Создан</p>
            <p className="text-sm font-medium">{purchase.createdAt.slice(0, 10)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Ожидается</p>
            <p className="text-sm font-medium">{purchase.expectedDate?.slice(0, 10) ?? '—'}</p>
          </div>
          {purchase.receivedDate && (
            <div>
              <p className="text-xs text-gray-400">Получен</p>
              <p className="text-sm font-medium text-green-400">{purchase.receivedDate.slice(0, 10)}</p>
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
                s === 'cancelled'
                  ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                  : 'btn-primary'
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
          <h3 className="font-semibold text-gray-900 mb-3">Поставщик</h3>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-800">{supplier.name}</p>
            <p className="text-sm text-gray-500">{supplier.contact}</p>
            <p className="text-sm text-primary-500">{supplier.phone}</p>
            <p className="text-sm text-gray-500">{supplier.email}</p>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-3">Позиции ({purchase.items.length})</h3>
        <div className="divide-y divide-gray-50">
          {purchase.items.map((item, idx) => {
            const invItem = inventory.find((i) => i.id === item.itemId)
            return (
              <div key={idx} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Package className="w-4 h-4 text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                  <p className="text-xs text-gray-400">{item.quantity} {item.unit} × {item.price.toLocaleString('ru-RU')} ₽</p>
                </div>
                <p className="text-sm font-semibold text-gray-900 flex-shrink-0">
                  {(item.quantity * item.price).toLocaleString('ru-RU')} ₽
                </p>
              </div>
            )
          })}
        </div>
        <div className="border-t border-gray-100 pt-3 mt-1 flex justify-between items-center">
          <span className="text-sm font-medium text-gray-600">Итого</span>
          <span className="text-lg font-bold text-gray-900">{purchase.totalAmount.toLocaleString('ru-RU')} ₽</span>
        </div>
      </div>

      {/* Notes */}
      {purchase.notes && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-2">Примечания</h3>
          <p className="text-sm text-gray-600">{purchase.notes}</p>
        </div>
      )}

      {/* Delete */}
      {(purchase.status === 'pending' || purchase.status === 'cancelled') && (
        <button onClick={handleDelete} className="w-full py-3 text-red-500 text-sm font-medium hover:bg-red-50 rounded-xl transition-colors">
          Удалить заказ
        </button>
      )}
    </div>
  )
}
