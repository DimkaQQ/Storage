import { useMemo, useState } from 'react'
import { Row, Status, STATUS_META, MATCH_KIND_META, money, moneyShort, pct, fmt, fmt1, summarize } from '../lib/data'
import { useEdits } from '../lib/edits'
import { StatusBadge, AbcBadge, InfoTip } from '../components/ui'
import MatchModal from '../components/MatchModal'
import { ISearch, ISort, IDownload, IArrowUp, IArrowDown, ILink } from '../components/icons'

type SortKey = 'product' | 'restaurant' | 'sum' | 'plan' | 'unit' | 'diffPct' | 'effect'

const STATUS_FILTERS: { id: Status; label: string }[] = [
  { id: 'overpay', label: 'Переплата' },
  { id: 'saving', label: 'Экономия' },
  { id: 'ok', label: 'В норме' },
  { id: 'review', label: 'Проверить' },
  { id: 'nomatrix', label: 'Нет в матрице' },
  { id: 'anomaly', label: 'Аномалия' },
  { id: 'excluded', label: 'Разные товары' },
]

export default function PriceCheck({ rows }: { rows: Row[] }) {
  const { setPlan, products } = useEdits()
  const [q, setQ] = useState('')
  const [active, setActive] = useState<Set<Status>>(new Set())
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'sum', dir: -1 })
  const [limit, setLimit] = useState(60)
  const [matchFor, setMatchFor] = useState<{ product0: string; product: string } | null>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let r = rows
    if (active.size) r = r.filter((x) => active.has(x.status))
    if (needle) r = r.filter((x) => x.product.toLowerCase().includes(needle) || x.supplier.toLowerCase().includes(needle) || x.restaurant.toLowerCase().includes(needle))
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

  const exportCsv = () => {
    const head = ['Ресторан', 'Поставщик', 'Товар', 'Фасовка', 'Кол-во', 'Сумма', 'План цена', 'Факт цена', 'Δ%', 'Эффект', 'ABC', 'Статус']
    const lines = filtered.map((r) => [
      r.restaurant, r.supplier, r.product, r.pack, fmt1(r.qty), Math.round(r.sum),
      r.plan ?? '', Math.round(r.unit), r.diffPct != null ? (r.diffPct * 100).toFixed(1) : '',
      Math.round(r.effect), r.abc, STATUS_META[r.status].label,
    ])
    const csv = [head, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'proverka-cen.csv'
    a.click()
  }

  return (
    <div className="space-y-4">
      {/* mini KPIs for current filter */}
      <div className="grid grid-cols-4 gap-4">
        <MiniStat delay={0} label="Позиций в срезе" value={fmt(filtered.length)} tone="slate" />
        <MiniStat delay={50} label="Сумма закупок" value={moneyShort(s.spend)} tone="slate" />
        <MiniStat delay={100} label="Переплаты" value={moneyShort(s.overpaySum)} tone="bad" />
        <MiniStat delay={150} label="Экономия" value={moneyShort(s.savingSum)} tone="good" />
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
          <button onClick={exportCsv} className="btn border border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750">
            <IDownload width={16} height={16} /> CSV
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
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-ink-850">
              <tr>
                <Th onClick={() => setSortKey('product')} sort={sort} k="product">Товар</Th>
                <Th onClick={() => setSortKey('restaurant')} sort={sort} k="restaurant">Ресторан</Th>
                <Th onClick={() => setSortKey('sum')} sort={sort} k="sum" right tip="Общая сумма закупки этой позиции за период (сумма ÷ количество = факт. цена).">Закупка</Th>
                <Th onClick={() => setSortKey('plan')} sort={sort} k="plan" right tip="Плановая (целевая) цена за единицу из матрицы. «—» — товара нет в матрице.">План</Th>
                <Th onClick={() => setSortKey('unit')} sort={sort} k="unit" right tip="Фактическая цена за единицу, по которой реально закупили (из iiko).">Факт</Th>
                <Th onClick={() => setSortKey('diffPct')} sort={sort} k="diffPct" right tip="Отклонение факта от плана в процентах. Плюс — дороже плана, минус — дешевле.">Δ%</Th>
                <Th onClick={() => setSortKey('effect')} sort={sort} k="effect" right tip="Денежный эффект = (план − факт) × количество. Зелёное — экономия, красное — переплата.">Эффект</Th>
                <th className="th text-center">ABC</th>
                <th className="th">Статус</th>
                <th className="th text-center">Действие</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const mk = MATCH_KIND_META[r.matchKind ?? 'none']
                return (
                <tr key={r.id} className="row-hover hover:bg-ink-800/40">
                  <td className="td">
                    <div className="font-medium text-slate-100">{r.product}</div>
                    <div className="text-[11px] text-slate-500">{r.supplier} · {r.pack || '—'}</div>
                  </td>
                  <td className="td text-slate-400">{r.restaurant}</td>
                  <td className="td text-right tabnum text-slate-300">{money(r.sum)}<div className="text-[11px] text-slate-600">{fmt1(r.qty)} ед.</div></td>
                  <td className="td text-right tabnum text-slate-400">
                    {r.plan != null ? money(r.plan) : '—'}
                    {r.plan != null && <div className={`text-[10px] ${mk.color}`} title={mk.hint}>{mk.label}</div>}
                  </td>
                  <td className="td text-right tabnum text-slate-200">{money(r.unit)}</td>
                  <td className="td text-right tabnum font-semibold">
                    {r.diffPct != null ? <span className={r.status === 'overpay' ? 'text-bad' : r.status === 'saving' ? 'text-good' : 'text-slate-400'}>{pct(r.diffPct)}</span> : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="td text-right tabnum font-semibold">
                    {r.status === 'overpay' || r.status === 'saving'
                      ? <span className={r.effect >= 0 ? 'text-good' : 'text-bad'}>{moneyShort(r.effect)}</span>
                      : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="td text-center"><AbcBadge abc={r.abc} /></td>
                  <td className="td"><StatusBadge status={r.status} /></td>
                  <td className="td text-center">
                    <button
                      onClick={() => setMatchFor({ product0: r.product0, product: r.product })}
                      className="btn mx-auto border border-ink-600 bg-ink-800/70 px-2.5 py-1 text-xs text-brand-300 hover:border-brand-500/50 hover:text-brand-200"
                      title="Сопоставить с плановым товаром из матрицы вручную"
                    >
                      <ILink width={13} height={13} /> Сопоставить
                    </button>
                  </td>
                </tr>
                )
              })}
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

      {matchFor && (
        <MatchModal
          target={matchFor}
          products={products}
          onClose={() => setMatchFor(null)}
          onPick={(plan) => { setPlan(matchFor.product0, plan); setMatchFor(null) }}
        />
      )}
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

function Th({ children, onClick, sort, k, right, tip }: { children: React.ReactNode; onClick: () => void; sort: { key: string; dir: number }; k: string; right?: boolean; tip?: string }) {
  const on = sort.key === k
  return (
    <th className={`th hover:text-slate-300 ${right ? 'text-right' : ''}`}>
      <span className={`inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''}`}>
        <span className="inline-flex cursor-pointer items-center gap-1" onClick={onClick}>
          {children}
          {on ? (sort.dir === 1 ? <IArrowUp width={12} height={12} className="text-brand-300" /> : <IArrowDown width={12} height={12} className="text-brand-300" />) : <ISort width={12} height={12} className="text-slate-600" />}
        </span>
        {tip && <InfoTip text={tip} align={right ? 'right' : 'left'} />}
      </span>
    </th>
  )
}
