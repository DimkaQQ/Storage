import { useState } from 'react'
import { Plus, Edit2, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { useStore } from '../store/useStore'
import Modal from '../components/Modal'

type FormState = {
  name: string
  icon: string
  color: string
}

type QuickAddState = {
  categoryId: string
  name: string
  unit: string
  quantity: string
  minQuantity: string
  price: string
  venueId: string
}

const ICONS = ['🥩', '🐟', '🥦', '🧀', '🥤', '🌶️', '🌾', '🫙', '🍷', '🧊', '🍅', '🥚', '🫐', '🍋', '🧄']
const UNITS = ['кг', 'г', 'л', 'мл', 'шт']

export default function Categories() {
  const { categories, inventory, venues, selectedVenueId, addCategory, updateCategory, deleteCategory, addInventoryItem } = useStore()
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', icon: '📦', color: '' })
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null)

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openEdit = (id: string) => {
    const cat = categories.find((c) => c.id === id)
    if (cat) {
      setForm({ name: cat.name, icon: cat.icon, color: cat.color })
      setEditId(id)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editId) {
      updateCategory(editId, form)
      setEditId(null)
    } else {
      addCategory({ ...form, id: '' })
      setShowAdd(false)
    }
  }

  const openQuickAdd = (categoryId: string) => {
    setQuickAdd({
      categoryId,
      name: '',
      unit: 'кг',
      quantity: '0',
      minQuantity: '5',
      price: '0',
      venueId: selectedVenueId ?? venues[0]?.id ?? '',
    })
  }

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickAdd || !quickAdd.name.trim()) return
    addInventoryItem({
      id: `i${Date.now()}`,
      name: quickAdd.name.trim(),
      categoryId: quickAdd.categoryId,
      quantity: Number(quickAdd.quantity),
      unit: quickAdd.unit,
      minQuantity: Number(quickAdd.minQuantity),
      price: Number(quickAdd.price),
      supplierId: '',
      lastUpdated: new Date().toISOString().slice(0, 10),
      venueId: quickAdd.venueId,
    })
    setQuickAdd(null)
  }

  const Form = () => (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Название *</label>
        <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Название категории" />
      </div>
      <div>
        <label className="label">Иконка</label>
        <div className="flex flex-wrap gap-2">
          {ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              onClick={() => setForm((f) => ({ ...f, icon }))}
              className="text-xl p-2 rounded-xl transition-all"
              style={{
                border: form.icon === icon ? '2px solid var(--gold)' : '2px solid transparent',
                background: form.icon === icon ? 'rgba(200,168,75,0.1)' : 'rgba(255,255,255,0.03)',
                cursor: 'pointer',
              }}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={() => { setShowAdd(false); setEditId(null) }} className="btn-secondary flex-1 justify-center">Отмена</button>
        <button type="submit" className="btn-primary flex-1 justify-center">{editId ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </form>
  )

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 style={{ color: 'var(--white)' }}>Категории</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{categories.length} категорий</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Добавить</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {categories.map((cat) => {
          const catItems = inventory.filter((i) => i.categoryId === cat.id)
          const isExpanded = expandedIds.has(cat.id)
          return (
            <div key={cat.id} className="card p-0 overflow-hidden">
              {/* Category header row */}
              <div className="flex items-center gap-4 p-4">
                <div className="text-3xl">{cat.icon}</div>
                <div className="flex-1">
                  <p className="font-semibold" style={{ color: 'var(--white)' }}>{cat.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{catItems.length} товаров</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(cat.id)}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                    title="Редактировать"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (catItems.length > 0) { alert(`Удалите сначала ${catItems.length} товаров из этой категории`); return }
                      if (confirm(`Удалить категорию "${cat.name}"?`)) deleteCategory(cat.id)
                    }}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                    title="Удалить"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => toggleExpand(cat.id)}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--white)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                    title={isExpanded ? 'Свернуть' : 'Развернуть'}
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Accordion content */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  {catItems.length === 0 ? (
                    <p className="px-4 py-3 text-sm" style={{ color: 'var(--muted)' }}>Нет товаров в этой категории</p>
                  ) : (
                    <div>
                      {catItems.map((item, idx) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between px-4 py-2.5 text-sm"
                          style={{
                            borderBottom: idx < catItems.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                          }}
                        >
                          <span style={{ color: 'var(--white)' }}>{item.name}</span>
                          <span className="num text-xs" style={{ color: 'var(--muted)' }}>{item.quantity} {item.unit}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', padding: '0.625rem 1rem' }}>
                    <button
                      onClick={() => openQuickAdd(cat.id)}
                      className="flex items-center gap-1.5 text-xs font-medium"
                      style={{ color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      <Plus className="w-3.5 h-3.5" /> Добавить товар
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Category add/edit modals */}
      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Новая категория" size="sm">
        <Form />
      </Modal>
      <Modal isOpen={!!editId} onClose={() => setEditId(null)} title="Редактировать категорию" size="sm">
        <Form />
      </Modal>

      {/* Quick add product modal */}
      <Modal
        isOpen={!!quickAdd}
        onClose={() => setQuickAdd(null)}
        title={`Добавить товар — ${categories.find((c) => c.id === quickAdd?.categoryId)?.name ?? ''}`}
        size="sm"
      >
        {quickAdd && (
          <form onSubmit={handleQuickAdd} className="space-y-3">
            <div>
              <label className="label">Название *</label>
              <input
                className="input"
                required
                autoFocus
                value={quickAdd.name}
                onChange={(e) => setQuickAdd((q) => q && { ...q, name: e.target.value })}
                placeholder="Например: Говядина"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Ед. изм.</label>
                <select
                  className="input"
                  value={quickAdd.unit}
                  onChange={(e) => setQuickAdd((q) => q && { ...q, unit: e.target.value })}
                >
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Кол-во</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={quickAdd.quantity}
                  onChange={(e) => setQuickAdd((q) => q && { ...q, quantity: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Мин. запас</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={quickAdd.minQuantity}
                  onChange={(e) => setQuickAdd((q) => q && { ...q, minQuantity: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Цена за ед. (₸)</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={quickAdd.price}
                  onChange={(e) => setQuickAdd((q) => q && { ...q, price: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">Точка продаж</label>
              <select
                className="input"
                value={quickAdd.venueId}
                onChange={(e) => setQuickAdd((q) => q && { ...q, venueId: e.target.value })}
              >
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setQuickAdd(null)} className="btn-secondary flex-1 justify-center">Отмена</button>
              <button type="submit" className="btn-primary flex-1 justify-center">Добавить</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
