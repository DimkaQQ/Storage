import { useState } from 'react'
import { Plus, Trash2, ArrowDownCircle, ArrowUpCircle, Package } from 'lucide-react'
import { useStore } from '../store/useStore'
import SearchInput from '../components/SearchInput'
import Modal from '../components/Modal'
import InventoryForm from '../components/forms/InventoryForm'
import type { InventoryItem } from '../types'

type StockStatus = 'ok' | 'warning' | 'low' | 'empty'

function getStockStatus(item: InventoryItem): StockStatus {
  if (item.quantity === 0) return 'empty'
  if (item.quantity < item.minQuantity) return 'low'
  if (item.quantity < item.minQuantity * 2) return 'warning'
  return 'ok'
}

const statusLabels: Record<StockStatus, string> = {
  ok: 'Норма',
  warning: 'Мало',
  low: 'Критично',
  empty: 'Пусто',
}

export default function Inventory() {
  const { inventory, categories, updateInventoryItem, deleteInventoryItem } = useStore()
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState<InventoryItem | null>(null)
  const [qtyModal, setQtyModal] = useState<{ item: InventoryItem; type: 'in' | 'out' } | null>(null)
  const [qtyValue, setQtyValue] = useState('')

  const filtered = inventory.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = filterCat ? item.categoryId === filterCat : true
    return matchSearch && matchCat
  })

  const totalValue = inventory.reduce((sum, i) => sum + i.quantity * i.price, 0)
  const lowCount = inventory.filter((i) => getStockStatus(i) === 'low' || getStockStatus(i) === 'empty').length

  const handleQty = () => {
    if (!qtyModal) return
    const delta = parseFloat(qtyValue)
    if (isNaN(delta) || delta <= 0) return
    const newQty = qtyModal.type === 'in'
      ? qtyModal.item.quantity + delta
      : Math.max(0, qtyModal.item.quantity - delta)
    updateInventoryItem({
      ...qtyModal.item,
      quantity: newQty,
      lastUpdated: new Date().toISOString().slice(0, 10),
    })
    setQtyModal(null)
    setQtyValue('')
  }

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 style={{ color: 'var(--white)' }}>Склад</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {inventory.length} позиций • {(totalValue / 1000).toFixed(1)}к ₽
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Добавить</span>
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="kpi-card">
          <p className="label">Всего позиций</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--white)', fontFamily: "'Instrument Serif', serif" }}>{inventory.length}</p>
        </div>
        <div className="kpi-card">
          <p className="label">Стоимость склада</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--gold)', fontFamily: "'Instrument Serif', serif" }}>{(totalValue / 1000).toFixed(1)}к ₽</p>
        </div>
        <div className="kpi-card">
          <p className="label">Нехватка</p>
          <p className="text-2xl font-bold" style={{ color: lowCount > 0 ? '#ef4444' : '#22c55e', fontFamily: "'Instrument Serif', serif" }}>{lowCount}</p>
        </div>
      </div>

      {/* Search + category chips */}
      <div className="space-y-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск товара..." />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setFilterCat('')} className={`chip ${!filterCat ? 'active' : ''}`}>Все</button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilterCat(c.id === filterCat ? '' : c.id)}
              className={`chip ${c.id === filterCat ? 'active' : ''}`}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main layout: table + add panel */}
      <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
        {/* Table */}
        <div className="card p-0 overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Package className="w-10 h-10 mb-3" style={{ color: 'var(--muted)' }} />
              <p style={{ color: 'var(--muted)' }}>Ничего не найдено</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Категория</th>
                  <th>Остаток</th>
                  <th>Ед.</th>
                  <th>Цена/ед.</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const cat = categories.find((c) => c.id === item.categoryId)
                  const status = getStockStatus(item)
                  const pct = item.minQuantity === 0 ? 100 : Math.min(100, Math.round((item.quantity / (item.minQuantity * 2)) * 100))
                  return (
                    <tr key={item.id}>
                      <td>
                        <button
                          className="text-left hover:underline font-medium"
                          style={{ color: 'var(--white)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          onClick={() => setEditItem(item)}
                        >
                          {item.name}
                        </button>
                      </td>
                      <td>
                        <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{cat?.icon} {cat?.name}</span>
                      </td>
                      <td style={{ minWidth: 100 }}>
                        <div className="mb-1 text-sm" style={{ color: 'var(--white)' }}>{item.quantity}</div>
                        <div className="stock-bar">
                          <div className={`stock-bar-fill ${status}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{item.unit}</td>
                      <td style={{ color: 'var(--white)' }}>{item.price.toLocaleString('ru-RU')} ₽</td>
                      <td>
                        <span className={`badge badge-${status}`}>{statusLabels[status]}</span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            title="Приход"
                            onClick={() => { setQtyModal({ item, type: 'in' }); setQtyValue('') }}
                            className="p-1.5 rounded transition-colors"
                            style={{ color: '#22c55e' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.1)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <ArrowDownCircle className="w-4 h-4" />
                          </button>
                          <button
                            title="Списание"
                            onClick={() => { setQtyModal({ item, type: 'out' }); setQtyValue('') }}
                            className="p-1.5 rounded transition-colors"
                            style={{ color: '#f59e0b' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(245,158,11,0.1)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <ArrowUpCircle className="w-4 h-4" />
                          </button>
                          <button
                            title="Удалить"
                            onClick={() => { if (confirm(`Удалить "${item.name}"?`)) deleteInventoryItem(item.id) }}
                            className="p-1.5 rounded transition-colors"
                            style={{ color: '#6b7280' }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right panel - sticky add form (hidden on mobile) */}
        <div className="hidden lg:block">
          <div className="card sticky top-6">
            <h3 className="font-semibold mb-4" style={{ color: 'var(--white)', fontFamily: "'Instrument Serif', serif", fontSize: '1.1rem' }}>Добавить позицию</h3>
            <InventoryForm onClose={() => {}} inline />
          </div>
        </div>
      </div>

      {/* Add modal (mobile) */}
      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Добавить товар">
        <InventoryForm onClose={() => setShowAdd(false)} />
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={!!editItem} onClose={() => setEditItem(null)} title="Редактировать товар">
        {editItem && <InventoryForm item={editItem} onClose={() => setEditItem(null)} />}
      </Modal>

      {/* Qty modal */}
      <Modal
        isOpen={!!qtyModal}
        onClose={() => setQtyModal(null)}
        title={qtyModal?.type === 'in' ? 'Приход товара' : 'Списание товара'}
        size="sm"
      >
        {qtyModal && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {qtyModal.item.name} — текущий остаток: <span style={{ color: 'var(--white)' }}>{qtyModal.item.quantity} {qtyModal.item.unit}</span>
            </p>
            <div>
              <label className="label">{qtyModal.type === 'in' ? 'Количество прихода' : 'Количество списания'} ({qtyModal.item.unit})</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={qtyValue}
                onChange={(e) => setQtyValue(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleQty() }}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setQtyModal(null)} className="btn-secondary flex-1 justify-center">Отмена</button>
              <button onClick={handleQty} className="btn-primary flex-1 justify-center">
                {qtyModal.type === 'in' ? 'Оприходовать' : 'Списать'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
