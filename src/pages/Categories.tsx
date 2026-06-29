import { useState } from 'react'
import { Plus, Tag, Edit2, Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import Modal from '../components/Modal'

type FormState = {
  name: string
  icon: string
  color: string
}

const ICONS = ['🥩', '🐟', '🥦', '🧀', '🥤', '🌶️', '🌾', '🫙', '🍷', '🧊', '🍅', '🥚', '🫐', '🍋', '🧄']
const COLORS = [
  'bg-red-100 text-red-700',
  'bg-blue-100 text-blue-700',
  'bg-green-100 text-green-700',
  'bg-yellow-100 text-yellow-700',
  'bg-purple-100 text-purple-700',
  'bg-orange-100 text-orange-700',
  'bg-amber-100 text-amber-700',
  'bg-cyan-100 text-cyan-700',
  'bg-pink-100 text-pink-700',
  'bg-indigo-100 text-indigo-700',
]

export default function Categories() {
  const { categories, inventory, addCategory, updateCategory, deleteCategory } = useStore()
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', icon: '📦', color: COLORS[0] })

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
            <button key={icon} type="button" onClick={() => setForm((f) => ({ ...f, icon }))}
              className={`text-xl p-2 rounded-xl border-2 transition-all ${form.icon === icon ? 'border-primary-500 bg-primary-50' : 'border-transparent hover:border-gray-200'}`}>
              {icon}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">Цвет метки</label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((color) => {
            const bg = color.split(' ')[0]
            return (
              <button key={color} type="button" onClick={() => setForm((f) => ({ ...f, color }))}
                className={`w-8 h-8 rounded-full border-4 transition-all ${bg} ${form.color === color ? 'border-primary-500 scale-110' : 'border-transparent'}`} />
            )
          })}
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
          <h1 className="text-2xl font-bold text-gray-900">Категории</h1>
          <p className="text-sm text-gray-500 mt-0.5">{categories.length} категорий</p>
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
            <div key={cat.id} className={`card flex items-center gap-4 ${cat.color}`}>
              <div className="text-3xl">{cat.icon}</div>
              <div className="flex-1">
                <p className="font-semibold">{cat.name}</p>
                <p className="text-xs opacity-70 mt-0.5">{count} товаров</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(cat.id)} className="p-1.5 hover:bg-white/50 rounded-lg transition-colors">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (count > 0) { alert(`Удалите сначала ${count} товаров из этой категории`); return }
                    if (confirm(`Удалить категорию "${cat.name}"?`)) deleteCategory(cat.id)
                  }}
                  className="p-1.5 hover:bg-white/50 rounded-lg transition-colors"
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
