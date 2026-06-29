import { useState } from 'react'
import { Plus, Package, Filter } from 'lucide-react'
import { useStore } from '../store/useStore'
import SearchInput from '../components/SearchInput'
import Modal from '../components/Modal'
import InventoryForm from '../components/forms/InventoryForm'
import { Link } from 'react-router-dom'

export default function Inventory() {
  const { inventory, categories } = useStore()
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showFilter, setShowFilter] = useState(false)

  const filtered = inventory.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = filterCat ? item.categoryId === filterCat : true
    return matchSearch && matchCat
  })

  const isLow = (item: typeof inventory[0]) => item.quantity <= item.minQuantity

  const totalValue = filtered.reduce((sum, i) => sum + i.quantity * i.price, 0)
  const lowCount = inventory.filter(isLow).length

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Склад</h1>
          <p className="text-sm text-gray-500 mt-0.5">{inventory.length} позиций • {(totalValue / 1000).toFixed(1)}к ₽</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Добавить</span>
        </button>
      </div>

      {/* Alerts */}
      {lowCount > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 animate-pulse" />
          <p className="text-sm text-red-700 font-medium">{lowCount} товаров заканчиваются</p>
        </div>
      )}

      {/* Search & filter */}
      <div className="flex gap-2">
        <div className="flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск товара..." />
        </div>
        <button
          onClick={() => setShowFilter(!showFilter)}
          className={`btn-secondary flex-shrink-0 ${filterCat ? 'bg-primary-50 text-primary-600 border border-primary-200' : ''}`}
        >
          <Filter className="w-4 h-4" />
        </button>
      </div>

      {/* Category filter */}
      {showFilter && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterCat('')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${!filterCat ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200'}`}
          >
            Все
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilterCat(c.id === filterCat ? '' : c.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${c.id === filterCat ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200'}`}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Items grid */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="card text-center py-12">
            <Package className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400">Ничего не найдено</p>
          </div>
        ) : (
          filtered.map((item) => {
            const cat = categories.find((c) => c.id === item.categoryId)
            const low = isLow(item)
            const value = item.quantity * item.price
            const pct = Math.min(100, Math.round((item.quantity / Math.max(item.minQuantity * 2, 1)) * 100))
            return (
              <Link
                key={item.id}
                to={`/inventory/${item.id}`}
                className={`card flex items-center gap-4 hover:shadow-md transition-all ${low ? 'border-red-100 bg-red-50/30' : ''}`}
              >
                <div className="text-2xl flex-shrink-0">{cat?.icon ?? '📦'}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 truncate">{item.name}</p>
                    {low && <span className="flex-shrink-0 text-xs bg-red-100 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-full">Мало</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{cat?.name}</p>
                  <div className="mt-2 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${low ? 'bg-red-400' : 'bg-green-400'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-gray-900">{item.quantity} {item.unit}</p>
                  <p className="text-xs text-gray-400">мин: {item.minQuantity}</p>
                  <p className="text-xs text-green-600 font-medium mt-0.5">{value.toLocaleString('ru-RU')} ₽</p>
                </div>
              </Link>
            )
          })
        )}
      </div>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Добавить товар">
        <InventoryForm onClose={() => setShowAdd(false)} />
      </Modal>
    </div>
  )
}
