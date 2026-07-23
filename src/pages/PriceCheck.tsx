import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { Row, Status, STATUS_META, money, pct, fmt, summarize, isPrecisePack } from '../lib/data'
import { StatusBadge } from '../components/ui'
import HoverName from '../components/HoverName'
import { ISearch, ISort, IDownload, IArrowUp, IArrowDown } from '../components/icons'

type SortKey = 'product' | 'restaurant' | 'supplier' | 'plan' | 'unit' | 'diffPct'

const STATUS_FILTERS: { id: Status; label: string }[] = [
  { id: 'ok', label: 'По матрице' },
  { id: 'wrongSupplier', label: 'Заказ не по матрице' },
  { id: 'nomatrix', label: 'Нет в матрице' },
]

export default function PriceCheck({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState<Set<Status>>(new Set())
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'restaurant', dir: -1 })
  const [limit, setLimit] = useState(60)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let r = rows
    if (active.size) r = r.filter((x) => active.has(x.status))
    if (needle) r = r.filter((x) => x.product.toLowerCase().includes(needle) || x.supplier.toLowerCase().includes(needle) || x.restaurant.toLowerCase().includes(needle) || x.pack.toLowerCase().includes(needle))
    const dir = sort.dir
    const key = sort.key
    return [...r].sort((a, b) => {
      let av: any = a[key], bv: any = b[key]
      if (av == null) av = key === 'plan' || key === 'diffPct' ? -Infinity : ''
      if (bv == null) bv = key === 'plan' || key === 'diffPct' ? -Infinity : ''
      if (typeof av === 'string') return av.localeCompare(bv) * dir
      return (av - bv) * dir
    })
  }, [rows, q, active, sort])

  const s = useMemo(() => summarize(filtered), [filtered])
  const shown = filtered.slice(0, limit)

  const toggle = (st: Status) => {
    const n = new Set(active)
    n.has(st) ? n.delete(st) : n.add(st)
    setActive(n)
    setLimit(60)
  }
  const setSortKey = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }))

  const exportExcel = () => {
    const head = ['Ресторан', 'Поставщик', 'Товар', 'Фасовка', 'План цена', 'Факт цена', 'Δ%', 'Статус', 'Должны у']
    const lines = filtered.map((r) => [
      r.restaurant, r.supplier, r.product, r.pack,
      r.plan ?? '', Math.round(r.unit), r.diffPct != null ? Number((r.diffPct * 100).toFixed(1)) : '',
      STATUS_META[r.status].label, r.designatedSuppliers.join(', '),
    ])
    const ws = XLSX.utils.aoa_to_sheet([head, ...lines])
    ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 24 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Проверка цен')
    XLSX.writeFile(wb, 'proverka-cen.xlsx')
  }

  return (
    <div className="space-y-4">
      {/* mini KPIs for current filter */}
      <div className="grid grid-cols-4 gap-4">
        <MiniStat delay={0} label="Позиций в срезе" value={fmt(filtered.length)} tone="slate" />
        <MiniStat delay={50} label="Совпадает с матрицей" value={pct(s.matchRate).replace('+', '')} tone="slate" />
        <MiniStat delay={100} label="Заказ не по матрице" value={fmt(s.wrongSupplierCount)} tone="bad" />
        <MiniStat delay={150} label="Нет в матрице" value={fmt(s.noMatrixCount)} tone="bad" />
      </div>

      {/* toolbar */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <ISearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width={16} height={16} />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setLimit(60) }}
              placeholder="Поиск: товар, поставщик, ресторан…"
              className="w-full rounded-lg border border-ink-600 bg-ink-900/60 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <button onClick={exportExcel} className="btn border border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750">
            <IDownload width={16} height={16} /> Excel
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => {
            const on = active.has(f.id)
            const m = STATUS_META[f.id]
            return (
              <button
                key={f.id}
                onClick={() => toggle(f.id)}
                className={`chip transition-colors ${on ? `${m.color} border-current bg-ink-750` : 'border-ink-600 text-slate-400 hover:text-slate-200'}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                {f.label}
              </button>
            )
          })}
          {active.size > 0 && (
            <button onClick={() => setActive(new Set())} className="chip border-ink-600 text-slate-500 hover:text-slate-300">
              сбросить
            </button>
          )}
        </div>
      </div>

      {/* table */}
      <div className="card overflow-hidden p-0">
        <div>
          <table className="w-full table-fixed">
            <thead className="sticky top-0 z-10 bg-ink-850">
              <tr>
                <Th onClick={() => setSortKey('restaurant')} sort={sort} k="restaurant" width="w-[14%]" tight>Ресторан</Th>
                <Th onClick={() => setSortKey('supplier')} sort={sort} k="supplier" width="w-[20%]" tight>Поставщик</Th>
                <Th onClick={() => setSortKey('product')} sort={sort} k="product" width="w-[26%]" tight>Товар</Th>
                <Th onClick={() => setSortKey('plan')} sort={sort} k="plan" right width="w-[10%]">План</Th>
                <Th onClick={() => setSortKey('unit')} sort={sort} k="unit" right width="w-[10%]">Факт</Th>
                <Th onClick={() => setSortKey('diffPct')} sort={sort} k="diffPct" right width="w-[8%]">Δ%</Th>
                <th className="th w-[12%]">Статус</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="row-hover hover:bg-ink-800/40">
                  <td className="td overflow-hidden px-2 text-slate-400"><HoverName text={r.restaurant} /></td>
                  <td className="td overflow-hidden px-2 text-slate-300">
                    <HoverName text={r.supplier} />
                  </td>
                  <td className="td overflow-hidden px-2 font-medium text-slate-100">
                    <HoverName text={r.product} />
                    {r.productLabel ? (
                      <HoverName text={r.productLabel} className="block text-[11px] font-normal text-slate-500" />
                    ) : (
                      isPrecisePack(r.pack) && <HoverName text={r.pack} className="block text-[11px] font-normal text-slate-500" />
                    )}
                  </td>
                  <td className="td text-right tabnum text-slate-400">{r.plan != null ? money(r.plan) : '—'}</td>
                  <td className="td text-right tabnum text-slate-200">{money(r.unit)}</td>
                  <td className="td text-right tabnum font-semibold text-slate-300">
                    {r.diffPct != null ? pct(r.diffPct) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="td overflow-hidden">
                    <StatusBadge status={r.status} />
                    {r.status === 'wrongSupplier' && r.designatedSuppliers.length > 0 && (
                      <HoverName text={`должны: ${r.designatedSuppliers.join(', ')}`} className="mt-0.5 block text-[11px] text-slate-500" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="py-12 text-center text-sm text-slate-500">Ничего не найдено по заданным фильтрам.</div>}
        </div>
        {filtered.length > shown.length && (
          <div className="border-t border-ink-700/50 p-3 text-center">
            <button onClick={() => setLimit((l) => l + 100)} className="btn text-brand-300 hover:text-brand-200">
              Показать ещё ({fmt(filtered.length - shown.length)})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value, tone, delay = 0 }: { label: string; value: string; tone: 'slate' | 'bad' | 'good'; delay?: number }) {
  const cls = tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-white'
  return (
    <div className="card card-hover animate-fade-up px-4 py-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabnum ${cls}`}>{value}</div>
    </div>
  )
}

function Th({ children, onClick, sort, k, right, width, tight }: { children: React.ReactNode; onClick: () => void; sort: { key: string; dir: number }; k: string; right?: boolean; width?: string; tight?: boolean }) {
  const on = sort.key === k
  return (
    <th className={`th hover:text-slate-300 ${right ? 'text-right' : ''} ${tight ? 'px-2' : ''} ${width ?? ''}`}>
      <span className={`inline-flex cursor-pointer items-center gap-1 ${right ? 'flex-row-reverse' : ''}`} onClick={onClick}>
        {children}
        {on ? (sort.dir === 1 ? <IArrowUp width={12} height={12} className="text-brand-300" /> : <IArrowDown width={12} height={12} className="text-brand-300" />) : <ISort width={12} height={12} className="text-slate-600" />}
      </span>
    </th>
  )
}
