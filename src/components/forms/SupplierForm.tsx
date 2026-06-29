import { useState } from 'react'
import { useStore } from '../../store/useStore'
import type { Supplier } from '../../types'

type Props = {
  supplier?: Supplier
  onClose: () => void
}

export default function SupplierForm({ supplier, onClose }: Props) {
  const { categories, addSupplier, updateSupplier } = useStore()
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    contact: supplier?.contact ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    address: supplier?.address ?? '',
    categories: supplier?.categories ?? [],
    rating: supplier?.rating ?? 4,
    notes: supplier?.notes ?? '',
  })

  const toggleCategory = (id: string) => {
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(id) ? f.categories.filter((c) => c !== id) : [...f.categories, id],
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (supplier) {
      updateSupplier({ ...supplier, ...form })
    } else {
      addSupplier({ ...form, id: `s${Date.now()}` })
    }
    onClose()
  }

  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Название компании *</label>
        <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="ООО «Поставщик»" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Контактное лицо</label>
          <input className="input" value={form.contact} onChange={(e) => set('contact', e.target.value)} placeholder="Иванов Иван" />
        </div>
        <div>
          <label className="label">Телефон</label>
          <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+7 (495) 000-00-00" />
        </div>
      </div>
      <div>
        <label className="label">Email</label>
        <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="supplier@email.ru" />
      </div>
      <div>
        <label className="label">Адрес</label>
        <input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="г. Москва, ул. Примерная, 1" />
      </div>
      <div>
        <label className="label">Категории товаров</label>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleCategory(c.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                form.categories.includes(c.id)
                  ? 'bg-primary-500 text-white border-primary-500'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">Рейтинг (1-5)</label>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => set('rating', r)}
              className={`text-2xl transition-transform hover:scale-110 ${r <= form.rating ? 'text-amber-400' : 'text-gray-200'}`}
            >
              ★
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">Примечания</label>
        <textarea className="input resize-none" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Отмена</button>
        <button type="submit" className="btn-primary flex-1 justify-center">{supplier ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </form>
  )
}
