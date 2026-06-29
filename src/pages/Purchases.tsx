import { useState } from 'react'
import { Plus, ShoppingCart, Filter } from 'lucide-react'
import { useStore } from '../store/useStore'
import SearchInput from '../components/SearchInput'
import Badge, { labels } from '../components/Badge'
import Modal from '../components/Modal'
import PurchaseForm from '../components/forms/PurchaseForm'
import { Link } from 'react-router-dom'
import type { PurchaseStatus } from '../types'

const statuses: PurchaseStatus[] = ['pending', 'ordered', 'received', 'cancelled']

export default function Purchases() {
  const { purchases, suppliers } = useStore()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<PurchaseStatus | ''>('')
  const [showAdd, setShowAdd] = useState(false)
  const [showFilter, setShowFilter] = useState(false)

  const filtered = purchases.filter((p) => {
    const supplier = suppliers.find((s) => s.id === p.supplierId)
    const matchSearch = supplier?.name.toLowerCase().includes(search.toLowerCase()) || p.notes?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus ? p.status === filterStatus : true
    return matchSearch && matchStatus
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const totalActive = purchases.filter((p) => p.status === 'pending' || p.status === 'ordered').reduce((sum, p) => sum + p.totalAmount, 0)

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Закупки</h1>
          <p className="text-sm text-gray-500 mt-0.5">{purchases.length} заказов • {totalActive.toLocaleString('ru-RU')} ₽ активных</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Создать</span>
        </button>
      </div>

      {/* Summary tabs */}
      <div className="grid grid-cols-4 gap-2">
        {statuses.map((s) => {
          const count = purchases.filter((p) => p.status === s).length
          const colors = {
            pending: 'bg-amber-50 border-amber-200 text-amber-700',
            ordered: 'bg-blue-50 border-blue-200 text-blue-700',
            received: 'bg-green-50 border-green-200 text-green-700',
            cancelled: 'bg-gray-50 border-gray-200 text-gray-500',
          }
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              className={`p-2 rounded-xl border text-center transition-all ${filterStatus === s ? colors[s] : 'bg-white border-gray-100 text-gray-500'}`}
            >
              <p className="text-lg font-bold">{count}</p>
              <p className="text-xs mt-0.5">{labels[s]}</p>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по поставщику..." />
        </div>
        <button
          onClick={() => setShowFilter(!showFilter)}
          className={`btn-secondary flex-shrink-0 ${filterStatus ? 'bg-primary-50 text-primary-600 border border-primary-200' : ''}`}
        >
          <Filter className="w-4 h-4" />
        </button>
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="card text-center py-12">
            <ShoppingCart className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400">Заказов не найдено</p>
          </div>
        ) : (
          filtered.map((p) => {
            const supplier = suppliers.find((s) => s.id === p.supplierId)
            return (
              <Link key={p.id} to={`/purchases/${p.id}`} className="card hover:shadow-md transition-all block">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{supplier?.name ?? 'Неизвестно'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{p.items.length} позиц. • {p.createdAt.slice(0, 10)}</p>
                    {p.notes && <p className="text-xs text-gray-500 mt-1 truncate max-w-xs">{p.notes}</p>}
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="font-bold text-gray-900">{p.totalAmount.toLocaleString('ru-RU')} ₽</p>
                    <Badge variant={p.status} className="mt-1">{labels[p.status]}</Badge>
                  </div>
                </div>
                {p.expectedDate && (
                  <p className="text-xs text-gray-400 mt-2">Ожидается: {p.expectedDate.slice(0, 10)}</p>
                )}
              </Link>
            )
          })
        )}
      </div>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Новый заказ" size="lg">
        <PurchaseForm onClose={() => setShowAdd(false)} />
      </Modal>
    </div>
  )
}
