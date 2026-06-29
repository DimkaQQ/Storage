import { useState } from 'react'
import { Plus, Trash2, ArrowUp, ArrowDown, Package } from 'lucide-react'
import { useStore } from '../store/useStore'
import SearchInput from '../components/SearchInput'
import Modal from '../components/Modal'
import InventoryForm from '../components/forms/InventoryForm'
import type { InventoryItem } from '../types'
import { formatPrice } from '../utils/format'

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
  const { inventory, categories, updateInventoryItem, deleteInventoryItem, selectedVenueId } = useStore()
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState<InventoryItem | null>(null)
  const [qtyModal, setQtyModal] = useState<{ item: InventoryItem; type: 'in' | 'out' } | null>(null)
  const [qtyValue, setQtyValue] = useState('')
  const [writeoffReason, setWriteoffReason] = useState('Использование')

  const venueInventory = selectedVenueId ? inventory.filter((i) => i.venueId === selectedVenueId) : inventory

  const filtered = venueInventory.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = filterCat ? item.categoryId === filterCat : true
    return matchSearch && matchCat
  })

  const totalValue = venueInventory.reduce((sum, i) => sum + i.quantity * i.price, 0)
  const lowCount = venueInventory.filter((i) => getStockStatus(i) === 'low' || getStockStatus(i) === 'empty').length

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
    setWriteoffReason('Использование')
  }

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 style={{ color: 'var(--white)' }}>Склад</h1>
          <p className="text-sm mt-0.5 num" style={{ color: 'var(--muted)' }}>
            {venueInventory.length} позиций • {formatPrice(totalValue)}
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
          <p className="text-2xl font-bold num" style={{ color: 'var(--white)' }}>{venueInventory.length}</p>
        </div>
        <div className="kpi-card">
          <p className="label">Стоимость склада</p>
          <p className="text-xl font-bold num" style={{ color: 'var(--gold)' }}>{formatPrice(totalValue)}</p>
        </div>
        <div className="kpi-card">
          <p className="label">Нехватка</p>
          <p className="text-2xl font-bold num" style={{ color: lowCount > 0 ? 'var(--red)' : 'var(--green)' }}>{lowCount}</p>
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
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Table */}
        <div className="card p-0" style={{ minWidth: 0, overflow: 'hidden' }}>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Package className="w-10 h-10 mb-3" style={{ color: 'var(--muted)' }} />
              <p style={{ color: 'var(--muted)' }}>Ничего не найдено</p>
            </div>
          ) : (
            <table className="data-table" style={{ width: '100%', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '40%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Остаток</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const cat = categories.find((c) => c.id === item.categoryId)
                  const status = getStockStatus(item)
                  return (
                    <tr key={item.id}>
                      <td style={{ overflow: 'hidden' }}>
                        <button
                          className="text-left hover:underline font-medium w-full truncate block"
                          style={{ color: 'var(--white)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          onClick={() => setEditItem(item)}
                        >
                          {item.name}
                        </button>
                        {cat && (
                          <span className="block text-xs truncate mt-0.5" style={{ color: 'var(--muted)' }}>
                            {cat.icon} {cat.name}
                          </span>
                        )}
                      </td>
                      <td className="num" style={{ color: 'var(--white)' }}>
                        <span>{item.quantity}</span>
                        <span className="text-xs ml-1" style={{ color: 'var(--muted)' }}>{item.unit}</span>
                      </td>
                      <td>
                        <span className={`badge badge-${status}`}>{statusLabels[status]}</span>
                      </td>
                      <td>
                        <div className="flex items-center gap-0.5">
                          <button
                            title="Приход"
                            onClick={() => { setQtyModal({ item, type: 'in' }); setQtyValue('') }}
                            className="p-2 rounded transition-colors"
                            style={{ color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', minHeight: 44, minWidth: 36 }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(48,209,88,0.1)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                          <button
                            title="Списание"
                            onClick={() => { setQtyModal({ item, type: 'out' }); setQtyValue('') }}
                            className="p-2 rounded transition-colors"
                            style={{ color: 'var(--amber)', background: 'none', border: 'none', cursor: 'pointer', minHeight: 44, minWidth: 36 }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,214,10,0.1)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <ArrowUp className="w-4 h-4" />
                          </button>
                          <button
                            title="Удалить"
                            onClick={() => { if (confirm(`Удалить "${item.name}"?`)) deleteInventoryItem(item.id) }}
                            className="p-2 rounded transition-colors"
                            style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', minHeight: 44, minWidth: 36 }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
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

        {/* Right panel - sticky add form (desktop only) */}
        <div className="hidden lg:block">
          <div className="card sticky top-6">
            <h2 className="mb-4" style={{ color: 'var(--white)' }}>Добавить позицию</h2>
            <InventoryForm onClose={() => {}} inline />
          </div>
        </div>
      </div>

      {/* Add panel for mobile - below the table */}
      <div className="block lg:hidden">
        <div className="card">
          <h2 className="mb-4" style={{ color: 'var(--white)' }}>Добавить позицию</h2>
          <InventoryForm onClose={() => {}} inline />
        </div>
      </div>

      {/* Add modal (mobile fallback) */}
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
        onClose={() => { setQtyModal(null); setQtyValue(''); setWriteoffReason('Использование') }}
        title={qtyModal?.type === 'in' ? `Приход: ${qtyModal.item.name}` : `Списание: ${qtyModal?.item.name}`}
        size="sm"
      >
        {qtyModal && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Текущий остаток: <span className="num font-semibold" style={{ color: 'var(--white)' }}>{qtyModal.item.quantity} {qtyModal.item.unit}</span>
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
            {qtyModal.type === 'out' && (
              <div>
                <label className="label">Причина списания</label>
                <select className="input" value={writeoffReason} onChange={(e) => setWriteoffReason(e.target.value)}>
                  <option>Использование</option>
                  <option>Порча</option>
                  <option>Недостача</option>
                  <option>Прочее</option>
                </select>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setQtyModal(null); setQtyValue(''); setWriteoffReason('Использование') }} className="btn-secondary flex-1 justify-center">Отмена</button>
              <button onClick={handleQty} className={`flex-1 justify-center ${qtyModal.type === 'in' ? 'btn-primary' : 'btn-danger'}`}
                style={qtyModal.type === 'out' ? { background: 'rgba(255,69,58,0.15)', color: 'var(--red)', border: '1px solid rgba(255,69,58,0.3)' } : {}}
              >
                {qtyModal.type === 'in' ? 'Оприходовать' : 'Списать'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
