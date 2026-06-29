import { useState } from 'react'
import { useStore } from '../../store/useStore'
import type { InventoryItem } from '../../types'

type Props = {
  item?: InventoryItem
  onClose: () => void
  inline?: boolean
}

export default function InventoryForm({ item, onClose, inline }: Props) {
  const { categories, suppliers, venues, selectedVenueId, addInventoryItem, updateInventoryItem } = useStore()
  const [form, setForm] = useState({
    name: item?.name ?? '',
    categoryId: item?.categoryId ?? (categories[0]?.id ?? ''),
    quantity: item?.quantity ?? 0,
    unit: item?.unit ?? 'кг',
    minQuantity: item?.minQuantity ?? 5,
    price: item?.price ?? 0,
    supplierId: item?.supplierId ?? (suppliers[0]?.id ?? ''),
    venueId: item?.venueId ?? (selectedVenueId ?? venues[0]?.id ?? ''),
    location: item?.location ?? '',
    notes: item?.notes ?? '',
  })
  const [submitted, setSubmitted] = useState(false)

  const units = ['кг', 'г', 'л', 'мл', 'шт', 'уп', 'бут.', 'пач']

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (item) {
      updateInventoryItem({ ...item, ...form, quantity: Number(form.quantity), minQuantity: Number(form.minQuantity), price: Number(form.price) })
    } else {
      addInventoryItem({
        ...form,
        quantity: Number(form.quantity),
        minQuantity: Number(form.minQuantity),
        price: Number(form.price),
        id: `i${Date.now()}`,
        lastUpdated: new Date().toISOString().slice(0, 10),
      })
    }
    if (inline) {
      setForm({ name: '', categoryId: categories[0]?.id ?? '', quantity: 0, unit: 'кг', minQuantity: 5, price: 0, supplierId: suppliers[0]?.id ?? '', venueId: selectedVenueId ?? venues[0]?.id ?? '', location: '', notes: '' })
      setSubmitted(true)
      setTimeout(() => setSubmitted(false), 2000)
    } else {
      onClose()
    }
  }

  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {submitted && (
        <div className="text-sm text-center py-2 rounded-lg" style={{ background: 'rgba(48,209,88,0.1)', color: 'var(--green)' }}>
          Товар добавлен!
        </div>
      )}
      <div>
        <label className="label">Название *</label>
        <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Например: Говядина (вырезка)" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Категория</label>
          <select className="input" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Поставщик</label>
          <select className="input" value={form.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
            <option value="">— Не выбран —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Точка продаж</label>
        <select className="input" value={form.venueId} onChange={(e) => set('venueId', e.target.value)}>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label">Кол-во</label>
          <input className="input" type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </div>
        <div>
          <label className="label">Ед. изм.</label>
          <select className="input" value={form.unit} onChange={(e) => set('unit', e.target.value)}>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Мин. запас</label>
          <input className="input" type="number" min="0" step="0.01" value={form.minQuantity} onChange={(e) => set('minQuantity', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label">Цена за ед. (₸)</label>
        <input className="input" type="number" min="0" step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} />
      </div>
      <div>
        <label className="label">Место хранения</label>
        <input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Холодильник А" />
      </div>
      {!inline && (
        <div>
          <label className="label">Примечания</label>
          <textarea className="input resize-none" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Дополнительная информация..." />
        </div>
      )}
      <div className="flex gap-2 pt-1">
        {!inline && (
          <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Отмена</button>
        )}
        <button type="submit" className="btn-primary flex-1 justify-center">{item ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </form>
  )
}
