import { useState } from 'react'
import { Plus, Edit2, Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import Modal from '../components/Modal'

type FormState = {
  name: string
  icon: string
  color: string
}

const ICONS = ['🥩', '🐟', '🥦', '🧀', '🥤', '🌶️', '🌾', '🫙', '🍷', '🧊', '🍅', '🥚', '🫐', '🍋', '🧄']

export default function Categories() {
  const { categories, inventory, addCategory, updateCategory, deleteCategory } = useStore()
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', icon: '📦', color: '' })

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
          const count = inventory.filter((i) => i.categoryId === cat.id).length
          return (
            <div key={cat.id} className="card flex items-center gap-4">
              <div className="text-3xl">{cat.icon}</div>
              <div className="flex-1">
                <p className="font-semibold" style={{ color: 'var(--white)' }}>{cat.name}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{count} товаров</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEdit(cat.id)}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (count > 0) { alert(`Удалите сначала ${count} товаров из этой категории`); return }
                    if (confirm(`Удалить категорию "${cat.name}"?`)) deleteCategory(cat.id)
                  }}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Новая категория" size="sm">
        <Form />
      </Modal>
      <Modal isOpen={!!editId} onClose={() => setEditId(null)} title="Редактировать категорию" size="sm">
        <Form />
      </Modal>
    </div>
  )
}
