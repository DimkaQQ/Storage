import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ArrowLeft, Edit2, Trash2, MapPin, Package, AlertTriangle } from 'lucide-react'
import { useStore } from '../store/useStore'
import Modal from '../components/Modal'
import InventoryForm from '../components/forms/InventoryForm'

export default function InventoryItem() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { inventory, categories, suppliers, deleteInventoryItem } = useStore()
  const [showEdit, setShowEdit] = useState(false)

  const item = inventory.find((i) => i.id === id)
  const cat = categories.find((c) => c.id === item?.categoryId)
  const supplier = suppliers.find((s) => s.id === item?.supplierId)

  if (!item) return (
    <div className="p-6 text-center">
      <p className="text-gray-400">Товар не найден</p>
      <button onClick={() => navigate('/inventory')} className="btn-secondary mt-4 mx-auto">Назад</button>
    </div>
  )

  const isLow = item.quantity <= item.minQuantity
  const value = item.quantity * item.price
  const pct = Math.min(100, Math.round((item.quantity / Math.max(item.minQuantity * 2, 1)) * 100))

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
        <button onClick={() => navigate('/inventory')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{item.name}</h1>
          <p className="text-sm text-gray-500">{cat?.icon} {cat?.name}</p>
        </div>
        <button onClick={() => setShowEdit(true)} className="btn-secondary">
          <Edit2 className="w-4 h-4" />
        </button>
        <button onClick={handleDelete} className="p-2.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Stock status */}
      <div className={`card ${isLow ? 'border-red-100 bg-red-50' : ''}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isLow ? (
              <AlertTriangle className="w-5 h-5 text-red-500" />
            ) : (
              <Package className="w-5 h-5 text-green-500" />
            )}
            <span className={`font-semibold ${isLow ? 'text-red-700' : 'text-green-700'}`}>
              {isLow ? 'Нехватка товара' : 'Запас в норме'}
            </span>
          </div>
        </div>
        <div className="flex items-end gap-2 mb-3">
          <span className="text-4xl font-bold text-gray-900">{item.quantity}</span>
          <span className="text-lg text-gray-500 pb-1">{item.unit}</span>
        </div>
        <div className="bg-gray-100 rounded-full h-2 overflow-hidden mb-1">
          <div className={`h-full rounded-full transition-all ${isLow ? 'bg-red-400' : 'bg-green-400'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-gray-400">Минимальный запас: {item.minQuantity} {item.unit}</p>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <p className="text-xs text-gray-400 mb-1">Цена за единицу</p>
          <p className="text-xl font-bold text-gray-900">{item.price.toLocaleString('ru-RU')} ₽</p>
          <p className="text-xs text-gray-500">за {item.unit}</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-400 mb-1">Стоимость запаса</p>
          <p className="text-xl font-bold text-green-600">{value.toLocaleString('ru-RU')} ₽</p>
          <p className="text-xs text-gray-500">текущий остаток</p>
        </div>
      </div>

      {/* Info */}
      <div className="card space-y-3">
        <h3 className="font-semibold text-gray-900">Информация</h3>
        {supplier && (
          <div className="flex items-start gap-3 py-2 border-b border-gray-50">
            <Package className="w-4 h-4 text-gray-400 mt-0.5" />
            <div>
              <p className="text-xs text-gray-400">Поставщик</p>
              <p className="text-sm font-medium text-gray-800">{supplier.name}</p>
              <p className="text-xs text-gray-500">{supplier.phone}</p>
            </div>
          </div>
        )}
        {item.location && (
          <div className="flex items-start gap-3 py-2 border-b border-gray-50">
            <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
            <div>
              <p className="text-xs text-gray-400">Место хранения</p>
              <p className="text-sm font-medium text-gray-800">{item.location}</p>
            </div>
          </div>
        )}
        <div className="flex items-start gap-3 py-2">
          <Package className="w-4 h-4 text-gray-400 mt-0.5" />
          <div>
            <p className="text-xs text-gray-400">Последнее обновление</p>
            <p className="text-sm font-medium text-gray-800">{item.lastUpdated?.slice(0, 10)}</p>
          </div>
        </div>
        {item.notes && (
          <div className="bg-gray-50 rounded-xl p-3 mt-2">
            <p className="text-xs text-gray-400 mb-1">Примечания</p>
            <p className="text-sm text-gray-700">{item.notes}</p>
          </div>
        )}
      </div>

      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Редактировать товар">
        <InventoryForm item={item} onClose={() => setShowEdit(false)} />
      </Modal>
    </div>
  )
}
