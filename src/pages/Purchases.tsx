import { useState } from 'react'
import { Plus, ShoppingCart } from 'lucide-react'
import { useStore } from '../store/useStore'
import SearchInput from '../components/SearchInput'
import Badge, { labels } from '../components/Badge'
import Modal from '../components/Modal'
import PurchaseForm from '../components/forms/PurchaseForm'
import { Link } from 'react-router-dom'
import type { PurchaseStatus } from '../types'
import { formatPrice } from '../utils/format'

const statuses: PurchaseStatus[] = ['pending', 'ordered', 'received', 'cancelled']

const statusFilterStyle: Record<PurchaseStatus, { active: string; dot: string }> = {
  pending:   { active: 'rgba(255,214,10,0.12)', dot: 'var(--amber)' },
  ordered:   { active: 'rgba(10,132,255,0.12)', dot: 'var(--blue)' },
  received:  { active: 'rgba(48,209,88,0.12)',  dot: 'var(--green)' },
  cancelled: { active: 'rgba(255,255,255,0.06)', dot: 'var(--muted)' },
}

export default function Purchases() {
  const { purchases, suppliers, venues, selectedVenueId } = useStore()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<PurchaseStatus | ''>('')
  const [showAdd, setShowAdd] = useState(false)

  const venuePurchases = selectedVenueId ? purchases.filter((p) => p.venueId === selectedVenueId) : purchases

  const filtered = venuePurchases.filter((p) => {
    const supplier = suppliers.find((s) => s.id === p.supplierId)
    const matchSearch = supplier?.name.toLowerCase().includes(search.toLowerCase()) || p.notes?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus ? p.status === filterStatus : true
    return matchSearch && matchStatus
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const totalActive = venuePurchases
    .filter((p) => p.status === 'pending' || p.status === 'ordered')
    .reduce((sum, p) => sum + p.totalAmount, 0)

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 style={{ color: 'var(--white)' }}>Закупки</h1>
          <p className="text-sm mt-0.5 num" style={{ color: 'var(--muted)' }}>
            {venuePurchases.length} заказов • {formatPrice(totalActive)} активных
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Создать</span>
        </button>
      </div>

      {/* Status filter chips */}
      <div className="grid grid-cols-4 gap-2">
        {statuses.map((s) => {
          const count = venuePurchases.filter((p) => p.status === s).length
          const isActive = filterStatus === s
          const style = statusFilterStyle[s]
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              className="kpi-card text-center transition-all"
              style={{
                background: isActive ? style.active : 'var(--card)',
                borderColor: isActive ? style.dot : 'var(--border)',
                cursor: 'pointer',
                padding: '0.625rem',
              }}
            >
              <p className="text-lg font-bold num" style={{ color: isActive ? style.dot : 'var(--white)' }}>{count}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{labels[s]}</p>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <SearchInput value={search} onChange={setSearch} placeholder="Поиск по поставщику..." />

      {/* Table */}
      <div className="card p-0 overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ShoppingCart className="w-10 h-10 mb-3" style={{ color: 'var(--muted)' }} />
            <p style={{ color: 'var(--muted)' }}>Заказов не найдено</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Номер</th>
                <th>Поставщик</th>
                {!selectedVenueId && <th>Точка</th>}
                <th>Дата</th>
                <th>Ожидается</th>
                <th>Статус</th>
                <th>Позиций</th>
                <th>Сумма</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const supplier = suppliers.find((s) => s.id === p.supplierId)
                const venue = venues.find((v) => v.id === p.venueId)
                return (
                  <tr key={p.id}>
                    <td className="num" style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>#{p.id.replace('p', '')}</td>
                    <td>
                      <span className="font-medium" style={{ color: 'var(--white)' }}>{supplier?.name ?? 'Неизвестно'}</span>
                      {p.notes && <p className="text-xs mt-0.5 truncate max-w-xs" style={{ color: 'var(--muted)' }}>{p.notes}</p>}
                    </td>
                    {!selectedVenueId && (
                      <td>
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>{venue?.name ?? '—'}</span>
                      </td>
                    )}
                    <td className="num" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{p.createdAt.slice(0, 10)}</td>
                    <td className="num" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{p.expectedDate?.slice(0, 10) ?? '—'}</td>
                    <td>
                      <Badge variant={p.status as PurchaseStatus}>{labels[p.status as PurchaseStatus] ?? p.status}</Badge>
                    </td>
                    <td className="num" style={{ color: 'var(--muted)' }}>{p.items.length}</td>
                    <td>
                      <span className="font-semibold num" style={{ color: 'var(--white)' }}>{formatPrice(p.totalAmount)}</span>
                    </td>
                    <td>
                      <Link
                        to={`/purchases/${p.id}`}
                        className="text-xs font-medium hover:underline"
                        style={{ color: 'var(--gold)' }}
                      >
                        Открыть
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Новый заказ" size="lg">
        <PurchaseForm onClose={() => setShowAdd(false)} />
      </Modal>
    </div>
  )
}
