import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { Plus, Trash2 } from 'lucide-react'
import type { PurchaseItem } from '../../types'
import { formatPrice } from '../../utils/format'

type Props = {
  onClose: () => void
}

export default function PurchaseForm({ onClose }: Props) {
  const { suppliers, inventory, venues, selectedVenueId, addPurchase } = useStore()
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [venueId, setVenueId] = useState(selectedVenueId ?? venues[0]?.id ?? '')
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<PurchaseItem[]>([
    { itemId: '', name: '', quantity: 1, unit: 'кг', price: 0 }
  ])

  const addItem = () => setItems((prev) => [...prev, { itemId: '', name: '', quantity: 1, unit: 'кг', price: 0 }])
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx))

  const updateItem = (idx: number, key: string, value: string | number) => {
    setItems((prev) => {
      const updated = [...prev]
      if (key === 'itemId') {
        const invItem = inventory.find((i) => i.id === value)
        updated[idx] = {
          ...updated[idx],
          itemId: value as string,
          name: invItem?.name ?? '',
          unit: invItem?.unit ?? 'кг',
          price: invItem?.price ?? 0,
        }
      } else {
        updated[idx] = { ...updated[idx], [key]: value }
      }
      return updated
    })
  }

  const totalAmount = items.reduce((sum, i) => sum + (Number(i.quantity) * Number(i.price)), 0)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const validItems = items.filter((i) => i.itemId && i.quantity > 0)
    if (validItems.length === 0) return
    addPurchase({
      id: `p${Date.now()}`,
      supplierId,
      venueId,
      status: 'pending',
      items: validItems,
      totalAmount,
      createdAt: new Date().toISOString().slice(0, 10),
      expectedDate,
      notes,
    })
    onClose()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Поставщик *</label>
          <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Точка продаж</label>
          <select className="input" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Ожидаемая дата</label>
        <input className="input" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label mb-0">Позиции заказа</label>
          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-1 text-xs font-medium"
            style={{ color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <Plus className="w-3.5 h-3.5" /> Добавить
          </button>
        </div>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="rounded-lg p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <select
                  className="input flex-1 text-xs"
                  value={item.itemId}
                  onChange={(e) => updateItem(idx, 'itemId', e.target.value)}
                >
                  <option value="">— Выберите товар —</option>
                  {inventory.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="p-2 flex-shrink-0 transition-colors"
                  style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label">Кол-во</label>
                  <input className="input text-xs" type="number" min="0" step="0.01" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} />
                </div>
                <div>
                  <label className="label">Ед.</label>
                  <input className="input text-xs" value={item.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} />
                </div>
                <div>
                  <label className="label">Цена (₸)</label>
                  <input className="input text-xs" type="number" min="0" step="0.01" value={item.price} onChange={(e) => updateItem(idx, 'price', e.target.value)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {totalAmount > 0 && (
        <div className="rounded-lg p-3 flex justify-between items-center" style={{ background: 'rgba(200,168,75,0.08)', border: '1px solid rgba(200,168,75,0.2)' }}>
          <span className="text-sm" style={{ color: 'var(--muted)' }}>Итого:</span>
          <span className="text-lg font-bold num" style={{ color: 'var(--gold)' }}>{formatPrice(totalAmount)}</span>
        </div>
      )}

      <div>
        <label className="label">Примечания</label>
        <textarea className="input resize-none" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Комментарии к заказу..." />
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Отмена</button>
        <button type="submit" className="btn-primary flex-1 justify-center">Создать заказ</button>
      </div>
    </form>
  )
}
