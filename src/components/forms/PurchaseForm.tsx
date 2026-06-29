import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { Plus, Trash2 } from 'lucide-react'
import type { PurchaseItem } from '../../types'
import { formatPrice } from '../../utils/format'

type Props = {
  onClose: () => void
}

type LineItem = PurchaseItem & { _customName: string; _mode: 'inventory' | 'custom' }

function newLine(): LineItem {
  return {
    id: `li${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    inventoryItemId: undefined,
    name: '',
    quantity: 1,
    unit: 'кг',
    unitPrice: 0,
    categoryId: undefined,
    addToInventory: false,
    _customName: '',
    _mode: 'inventory',
  }
}

export default function PurchaseForm({ onClose }: Props) {
  const { suppliers, inventory, venues, categories, selectedVenueId, addPurchase } = useStore()
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [venueId, setVenueId] = useState(selectedVenueId ?? venues[0]?.id ?? '')
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineItem[]>([newLine()])

  const addLine = () => setLines((prev) => [...prev, newLine()])
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx))

  const updateLine = (idx: number, patch: Partial<LineItem>) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], ...patch }
      return updated
    })
  }

  const handleSelectInventoryItem = (idx: number, invId: string) => {
    if (!invId) {
      updateLine(idx, { inventoryItemId: undefined, name: '', unit: 'кг', unitPrice: 0 })
      return
    }
    const invItem = inventory.find((i) => i.id === invId)
    if (invItem) {
      updateLine(idx, {
        inventoryItemId: invId,
        name: invItem.name,
        unit: invItem.unit,
        unitPrice: invItem.price,
        categoryId: invItem.categoryId,
      })
    }
  }

  const handleModeSwitch = (idx: number, mode: 'inventory' | 'custom') => {
    updateLine(idx, {
      _mode: mode,
      inventoryItemId: undefined,
      name: mode === 'custom' ? lines[idx]._customName : '',
      unit: 'кг',
      unitPrice: 0,
    })
  }

  const totalAmount = lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const validItems: PurchaseItem[] = lines
      .filter((l) => l.name.trim() && Number(l.quantity) > 0)
      .map((l) => ({
        id: l.id,
        inventoryItemId: l.inventoryItemId,
        name: l.name.trim(),
        quantity: Number(l.quantity),
        unit: l.unit,
        unitPrice: Number(l.unitPrice),
        categoryId: l.categoryId,
        addToInventory: l.addToInventory,
      }))
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
      {/* Supplier + Venue */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Поставщик *</label>
          <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="">— Выберите —</option>
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

      {/* Line items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label mb-0">Позиции заказа</label>
          <button
            type="button"
            onClick={addLine}
            className="flex items-center gap-1 text-xs font-medium"
            style={{ color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <Plus className="w-3.5 h-3.5" /> Добавить позицию
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((line, idx) => (
            <div
              key={line.id}
              className="rounded-lg p-3 space-y-2"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}
            >
              {/* Mode toggle */}
              <div className="flex items-center gap-2 mb-1">
                <button
                  type="button"
                  onClick={() => handleModeSwitch(idx, 'inventory')}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: line._mode === 'inventory' ? 'rgba(200,168,75,0.15)' : 'rgba(255,255,255,0.05)',
                    color: line._mode === 'inventory' ? 'var(--gold)' : 'var(--muted)',
                    border: line._mode === 'inventory' ? '1px solid rgba(200,168,75,0.3)' : '1px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  Со склада
                </button>
                <button
                  type="button"
                  onClick={() => handleModeSwitch(idx, 'custom')}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: line._mode === 'custom' ? 'rgba(200,168,75,0.15)' : 'rgba(255,255,255,0.05)',
                    color: line._mode === 'custom' ? 'var(--gold)' : 'var(--muted)',
                    border: line._mode === 'custom' ? '1px solid rgba(200,168,75,0.3)' : '1px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  Произвольный
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {line._mode === 'inventory' ? (
                <select
                  className="input text-xs"
                  value={line.inventoryItemId ?? ''}
                  onChange={(e) => handleSelectInventoryItem(idx, e.target.value)}
                >
                  <option value="">— Выберите товар со склада —</option>
                  {inventory.map((i) => {
                    const cat = categories.find((c) => c.id === i.categoryId)
                    return <option key={i.id} value={i.id}>{cat?.icon} {i.name}</option>
                  })}
                </select>
              ) : (
                <input
                  className="input text-xs"
                  placeholder="Название товара"
                  value={line._customName}
                  onChange={(e) => {
                    const v = e.target.value
                    updateLine(idx, { _customName: v, name: v })
                  }}
                />
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label">Кол-во</label>
                  <input
                    className="input text-xs"
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.quantity}
                    onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="label">Ед.</label>
                  <select
                    className="input text-xs"
                    value={line.unit}
                    onChange={(e) => updateLine(idx, { unit: e.target.value })}
                  >
                    {['кг', 'г', 'л', 'мл', 'шт', 'уп', 'бут.', 'пач'].map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Цена (₸)</label>
                  <input
                    className="input text-xs"
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(idx, { unitPrice: Number(e.target.value) })}
                  />
                </div>
              </div>

              {/* Add to inventory checkbox */}
              <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                <input
                  type="checkbox"
                  checked={!!line.addToInventory}
                  onChange={(e) => updateLine(idx, { addToInventory: e.target.checked })}
                  style={{ accentColor: 'var(--gold)', width: 14, height: 14 }}
                />
                Добавить в склад при получении
              </label>
            </div>
          ))}
        </div>
      </div>

      {totalAmount > 0 && (
        <div
          className="rounded-lg p-3 flex justify-between items-center"
          style={{ background: 'rgba(200,168,75,0.08)', border: '1px solid rgba(200,168,75,0.2)' }}
        >
          <span className="text-sm" style={{ color: 'var(--muted)' }}>Итого:</span>
          <span className="text-lg font-bold num" style={{ color: 'var(--gold)' }}>{formatPrice(totalAmount)}</span>
        </div>
      )}

      <div>
        <label className="label">Примечания</label>
        <textarea
          className="input resize-none"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Комментарии к заказу..."
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Отмена</button>
        <button type="submit" className="btn-primary flex-1 justify-center">Создать заказ</button>
      </div>
    </form>
  )
}
