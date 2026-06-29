import { useState } from 'react'
import { Plus, Truck, Phone, Mail, Star } from 'lucide-react'
import { useStore } from '../store/useStore'
import SearchInput from '../components/SearchInput'
import Modal from '../components/Modal'
import SupplierForm from '../components/forms/SupplierForm'
import type { Supplier } from '../types'

export default function Suppliers() {
  const { suppliers, categories, inventory, deleteSupplier } = useStore()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null)

  const filtered = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.contact.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Поставщики</h1>
          <p className="text-sm text-gray-500 mt-0.5">{suppliers.length} контрагентов</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Добавить</span>
        </button>
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Поиск поставщика..." />

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="card text-center py-12">
            <Truck className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400">Поставщики не найдены</p>
          </div>
        ) : (
          filtered.map((s) => {
            const supCategories = categories.filter((c) => s.categories.includes(c.id))
            const itemCount = inventory.filter((i) => i.supplierId === s.id).length
            return (
              <div key={s.id} className="card">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Truck className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{s.name}</p>
                      <p className="text-xs text-gray-400">{s.contact}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-amber-400">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    <span className="text-xs font-medium text-gray-600">{s.rating}/5</span>
                  </div>
                </div>

                <div className="space-y-1.5 mb-3">
                  <a href={`tel:${s.phone}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary-500">
                    <Phone className="w-3.5 h-3.5 text-gray-400" />
                    {s.phone}
                  </a>
                  <a href={`mailto:${s.email}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary-500">
                    <Mail className="w-3.5 h-3.5 text-gray-400" />
                    {s.email}
                  </a>
                </div>

                {supCategories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {supCategories.map((c) => (
                      <span key={c.id} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                        {c.icon} {c.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                  <span className="text-xs text-gray-400">{itemCount} товаров на складе</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditSupplier(s)}
                      className="text-xs text-primary-500 hover:text-primary-600 font-medium"
                    >
                      Редактировать
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Удалить "${s.name}"?`)) deleteSupplier(s.id)
                      }}
                      className="text-xs text-red-400 hover:text-red-600 font-medium"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Добавить поставщика">
        <SupplierForm onClose={() => setShowAdd(false)} />
      </Modal>

      <Modal isOpen={!!editSupplier} onClose={() => setEditSupplier(null)} title="Редактировать поставщика">
        {editSupplier && <SupplierForm supplier={editSupplier} onClose={() => setEditSupplier(null)} />}
      </Modal>
    </div>
  )
}
