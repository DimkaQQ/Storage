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
          <h1 style={{ color: 'var(--white)' }}>Поставщики</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{suppliers.length} контрагентов</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Добавить</span>
        </button>
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Поиск поставщика..." />

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-16">
            <Truck className="w-10 h-10 mb-3" style={{ color: 'var(--muted)' }} />
            <p style={{ color: 'var(--muted)' }}>Поставщики не найдены</p>
          </div>
        ) : (
          filtered.map((s) => {
            const supCategories = categories.filter((c) => s.categories.includes(c.id))
            const itemCount = inventory.filter((i) => i.supplierId === s.id).length
            return (
              <div key={s.id} className="card">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(200,168,75,0.1)', border: '1px solid rgba(200,168,75,0.2)' }}
                    >
                      <Truck className="w-5 h-5" style={{ color: 'var(--gold)' }} />
                    </div>
                    <div>
                      <p className="font-semibold" style={{ color: 'var(--white)' }}>{s.name}</p>
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>{s.contact}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 fill-current" style={{ color: '#f59e0b' }} />
                    <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{s.rating}/5</span>
                  </div>
                </div>

                <div className="space-y-1.5 mb-3">
                  <a href={`tel:${s.phone}`} className="flex items-center gap-2 text-sm transition-colors" style={{ color: 'var(--muted)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                  >
                    <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                    {s.phone}
                  </a>
                  <a href={`mailto:${s.email}`} className="flex items-center gap-2 text-sm transition-colors" style={{ color: 'var(--muted)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                  >
                    <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                    {s.email}
                  </a>
                </div>

                {supCategories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {supCategories.map((c) => (
                      <span key={c.id} className="chip" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>
                        {c.icon} {c.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>{itemCount} товаров на складе</span>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setEditSupplier(s)}
                      className="text-xs font-medium transition-colors"
                      style={{ color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      Редактировать
                    </button>
                    <button
                      onClick={() => { if (confirm(`Удалить "${s.name}"?`)) deleteSupplier(s.id) }}
                      className="text-xs font-medium transition-colors"
                      style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
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
