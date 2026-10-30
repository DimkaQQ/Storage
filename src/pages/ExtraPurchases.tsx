import { useEffect, useMemo, useRef, useState } from 'react'
import { useEdits } from '../lib/edits'
import { fetchExtraFacts, ExtraFact } from '../lib/api'
import { computeRows, BaseRow, Row, Status, STATUS_META, fmt, money } from '../lib/data'
import { IInfo, IClose } from '../components/icons'

const MIN_TURNOVER = 1000  // та же отсечка, что у parseDataset: мелочь до 1000 ₸ не показываем
const PAGE = 200

interface Line { fact: ExtraFact; row: Row }

/**
 * «Что добавится, если брать всё» — закупки, которые загрузка сейчас отбрасывает
 * (бары, хозтовары, кальян, исключённые категории), сверенные с той же матрицей и
 * правилами сопоставления, что и Проверка цен. В Проверку цен они НЕ попадают:
 * это отдельная таблица для решения, что из этого стоит добавлять.
 */
export default function ExtraPurchases({ period }: { period: string }) {
  const { edits, matching, restaurants, periodKey } = useEdits()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facts, setFacts] = useState<ExtraFact[] | null>(null)
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState<'' | Status>('')
  const [venue, setVenue] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)

  // защита от гонок: ответ на устаревший запрос (сменили период, нажали дважды) не должен перезаписать новый
  const reqRef = useRef(0)
  const [loadedFor, setLoadedFor] = useState('')
  useEffect(() => { reqRef.current++; setFacts(null); setError(null); setLoading(false) }, [period])
  const load = async () => {
    const my = ++reqRef.current
    setLoading(true); setError(null); setFacts(null)
    const r = await fetchExtraFacts(period)
    if (my !== reqRef.current) return
    if (r.ok && r.rows) { setFacts(r.rows); setLoadedFor(period); setLimit(PAGE) } else setError(r.message || 'Не удалось загрузить')
    setLoading(false)
  }

  const lines = useMemo<Line[]>(() => {
    if (!facts) return []
    const kept = facts.filter((f) => f.sum >= MIN_TURNOVER && !f.supplier.includes(':') && !/черновик/i.test(f.supplier))
    const base: BaseRow[] = kept.map((f, i) => ({
      id: 'x' + i, period: periodKey, restaurant: f.restaurant, brand: '', city: '', entity: '', category: '',
      supplier0: f.supplier, product0: f.product, pack: f.pack, qty: f.qty, sum: f.sum, unit: f.sum / f.qty,
      comment: null, isTotalRow: false,
    }))
    const byId = new Map(kept.map((f, i) => ['x' + i, f] as const))
    return computeRows(base, edits, matching, restaurants)
      .filter((r) => r.status !== 'notPurchased' && byId.has(r.id))
      .map((row) => ({ fact: byId.get(row.id)!, row }))
  }, [facts, edits, matching, restaurants, periodKey])

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    return lines
      .filter((l) => (!reason || l.fact.reason === reason) && (!status || l.row.status === status) && (!venue || l.fact.restaurant === venue)
        && (!n || [l.fact.product, l.fact.supplier, l.fact.store, l.fact.category].some((x) => x.toLowerCase().includes(n))))
      .sort((a, b) => b.fact.sum - a.fact.sum)
  }, [lines, reason, status, venue, q])

  const totals = useMemo(() => {
    const t: Record<string, { n: number; sum: number }> = {}
    for (const l of lines) {
      const k = l.row.status
      t[k] = t[k] || { n: 0, sum: 0 }
      t[k].n++; t[k].sum += l.fact.sum
    }
    return t
  }, [lines])
  const venueNames = useMemo(() => [...new Set(lines.map((l) => l.fact.restaurant))].sort((a, b) => a.localeCompare(b)), [lines])

  const exportXlsx = async () => {
    const XLSX = await import('xlsx')
    const head = ['Точка', 'Склад', 'Поставщик', 'Товар', 'Фасовка', 'Категория', 'Почему не учитывается', 'Количество', 'Сумма', 'Цена за ед.', 'План за ед.', 'Статус по матрице']
    const body = filtered.map((l) => [l.fact.restaurant, l.fact.store, l.fact.supplier, l.fact.product, l.fact.pack, l.fact.category, l.fact.reason, l.fact.qty, l.fact.sum, l.row.unit ?? '', l.row.plan ?? '', STATUS_META[l.row.status].label])
    const ws = XLSX.utils.aoa_to_sheet([[`Закупки, которые сейчас не попадают в Проверку цен — ${loadedFor || periodKey}`], head, ...body])
    ws['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 24 }, { wch: 30 }, { wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 18 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Не в проверке цен')
    XLSX.writeFile(wb, `ne-v-proverke-cen-${loadedFor || periodKey}.xlsx`)
  }

  const sel = 'rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-xs text-fg-100 focus:border-brand-500 focus:outline-none'
  return (
    <div className="mt-4 border-t border-ink-700/60 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={load} disabled={loading} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
          <IInfo width={16} height={16} /> {loading ? 'Загружаю (до минуты)…' : 'Что добавится, если брать всё'}
        </button>
        <span className="text-xs text-fg-500">Бары, хозтовары, кальян и исключённые категории — сверка с матрицей. В Проверку цен не попадает. Ягоды/пюре «в асс.» здесь без разбивки по фасовке — статус приблизительный.</span>
      </div>
      {error && <div className="mt-3"><span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />{error}</span></div>}
      {facts && (
        <div className="mt-3">
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            {(['ok', 'wrongSupplier', 'nomatrix'] as Status[]).map((s) => (
              <span key={s} className="chip border-ink-600 bg-ink-800/60 text-fg-300">
                <span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} /> {STATUS_META[s].label}: {totals[s]?.n ?? 0} · {money(totals[s]?.sum ?? 0)}
              </span>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} placeholder="Поиск: товар, поставщик, склад, категория" className={`${sel} w-72`} />
            <select value={reason} onChange={(e) => { setReason(e.target.value); setLimit(PAGE) }} className={sel}>
              <option value="">Любая причина</option>
              <option value="склад">Склад (бар/хоз/кальян…)</option>
              <option value="категория">Категория</option>
              <option value="склад+категория">Склад + категория</option>
            </select>
            <select value={status} onChange={(e) => { setStatus(e.target.value as '' | Status); setLimit(PAGE) }} className={sel}>
              <option value="">Любой статус</option>
              {(['ok', 'wrongSupplier', 'nomatrix'] as Status[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
            <select value={venue} onChange={(e) => { setVenue(e.target.value); setLimit(PAGE) }} className={sel}>
              <option value="">Все точки</option>
              {venueNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button onClick={exportXlsx} disabled={filtered.length === 0} className="btn border border-ink-600 bg-ink-800/70 text-fg-300 hover:bg-ink-750 disabled:opacity-40">Excel</button>
            <span className="text-xs text-fg-500">{fmt(filtered.length)} строк</span>
          </div>
          <div className="max-h-[32rem] overflow-auto rounded-lg border border-ink-700">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-ink-850 text-fg-400">
                <tr>
                  <th className="px-2 py-2">Точка</th><th className="px-2 py-2">Склад</th><th className="px-2 py-2">Поставщик</th>
                  <th className="px-2 py-2">Товар</th><th className="px-2 py-2">Категория</th><th className="px-2 py-2 text-right">Сумма</th>
                  <th className="px-2 py-2 text-right">Цена / план</th><th className="px-2 py-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((l, i) => (
                  <tr key={i} className="border-t border-ink-700/60 text-fg-200">
                    <td className="px-2 py-1.5">{l.fact.restaurant}</td>
                    <td className="px-2 py-1.5 text-fg-400">{l.fact.store}<div className="text-[10px] text-fg-500">{l.fact.reason}</div></td>
                    <td className="px-2 py-1.5">{l.fact.supplier}</td>
                    <td className="px-2 py-1.5">{l.fact.product}<div className="text-[10px] text-fg-500">{l.fact.pack}</div></td>
                    <td className="px-2 py-1.5 text-fg-400">{l.fact.category}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(l.fact.sum)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.row.unit != null ? fmt(l.row.unit) : '—'} / {l.row.plan != null ? fmt(l.row.plan) : '—'}</td>
                    <td className={`px-2 py-1.5 ${STATUS_META[l.row.status].color}`}>{STATUS_META[l.row.status].label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > limit && (
            <button onClick={() => setLimit((n) => n + PAGE)} className="mt-2 text-xs text-brand-300 hover:text-brand-200">Показать ещё {Math.min(PAGE, filtered.length - limit)}</button>
          )}
        </div>
      )}
    </div>
  )
}
