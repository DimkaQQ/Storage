import { useEffect, useMemo, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { computeRows, parseDataset, bundledMatching, money, signedMoney, pct } from '../lib/data'
import { fetchDataset, fetchMatching } from '../lib/api'
import { useEdits } from '../lib/edits'
import { Granularity, PeriodRows, addDays, buildSeries, pickPeriods, periodSpan, productsIn, summarizeSeries } from '../lib/dynamics'
import MultiSelectFilter from '../components/MultiSelectFilter'
import { ChartTip, C, SERIES } from '../components/charts'
import { Section, EmptyHint } from '../components/ui'

interface Loaded { period: string; data: any; matching: any }

const GRAN: { id: Granularity; label: string }[] = [{ id: 'day', label: 'По дням' }, { id: 'week', label: 'По неделям' }, { id: 'month', label: 'По месяцам' }]
const PRESETS: { label: string; days: number }[] = [{ label: 'Неделя', days: 6 }, { label: 'Месяц', days: 29 }, { label: 'Квартал', days: 89 }, { label: 'Год', days: 364 }]

/**
 * «Динамика цен по позициям»: как менялась закупочная цена выбранной позиции по загруженным периодам, с плановой ценой
 * матрицы того же периода, изменением к предыдущей точке и сравнением ресторанов. Подневная/понедельная детализация
 * настоящая только там, где данные загружены по дням/неделям (Обновление → загрузка за период); месячные данные
 * показываются одной точкой на месяц, в колонке «Данные за» видно, за какие даты точка на самом деле.
 */
export default function PriceDynamics() {
  const { edits, periods, restaurants, venueLabel, status } = useEdits()
  const manual = !!status?.manualLinks
  const allPeriods = useMemo(() => periods.map((p) => p.period), [periods])
  const latestEnd = useMemo(() => allPeriods.reduce((m, p) => { const e = periodSpan(p).end; return e > m ? e : m }, ''), [allPeriods])

  const [to, setTo] = useState('')
  const [from, setFrom] = useState('')
  const [gran, setGran] = useState<Granularity>('month')
  const [showChart, setShowChart] = useState(false) // график есть, но по умолчанию выключен — основной вид это таблица «рестораны × даты»
  const [scope, setScope] = useState<Set<string>>(new Set())
  const [product, setProduct] = useState('')
  const [loaded, setLoaded] = useState<Loaded[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cache = useRef(new Map<string, Loaded>())

  // окно по умолчанию — последние ~3 месяца, но целыми загруженными периодами: начало сдвигаем к началу самого раннего периода,
  // который попадает в окно (иначе месяц обрезается и показывается предупреждение «период шире выбранных дат»).
  // Пока человек сам не менял даты, окно пересчитывается при каждом изменении списка периодов.
  const autoWindow = useRef(true)
  useEffect(() => {
    if (!latestEnd || !autoWindow.current) return
    const cut = addDays(latestEnd, -89)
    const starts = allPeriods.filter((p) => periodSpan(p).end >= cut).map((p) => periodSpan(p).start).sort()
    setTo(latestEnd); setFrom(starts[0] && starts[0] < cut ? starts[0] : cut)
  }, [latestEnd, allPeriods])
  const userFrom = (v: string) => { autoWindow.current = false; setFrom(v) }
  const userTo = (v: string) => { autoWindow.current = false; setTo(v) }

  const chosen = useMemo(() => (from && to && from <= to ? pickPeriods(allPeriods, from, to) : []), [allPeriods, from, to])

  useEffect(() => {
    let dead = false
    if (!chosen.length) { setLoaded([]); setLoading(false); setError(null); return }
    setLoading(true); setError(null)
    ;(async () => {
      const out: Loaded[] = []
      let failed = 0
      try {
        for (const p of chosen) {
          let hit = cache.current.get(p)
          if (!hit) {
            const [data, matching] = await Promise.all([fetchDataset(p), fetchMatching(p)])
            if (!data || !data.restaurants) { failed++; continue }
            hit = { period: p, data, matching }
            cache.current.set(p, hit)
          }
          out.push(hit)
        }
      } catch { failed++ }
      if (dead) return
      setLoaded(out); setLoading(false)
      if (failed) setError(`Не удалось загрузить периодов: ${failed}`)
    })()
    return () => { dead = true }
  }, [chosen])

  // строки сверки по каждому периоду: те же связи, привязки и план-цены, что в «Проверке цен», но для СВОЕГО периода
  const parsedList = useMemo(() => loaded.map((l) => ({ l, parsed: parseDataset(l.data) })), [loaded])
  const periodRows: PeriodRows[] = useMemo(() => parsedList.map(({ l, parsed }) => (
    { period: l.period, rows: computeRows(parsed.base, edits, l.matching ?? bundledMatching(l.period), parsed.restaurants, manual) }
  )), [parsedList, edits, manual])

  const products = useMemo(() => productsIn(periodRows), [periodRows])
  const restaurantNames = useMemo(() => {
    const seen = new Set<string>()
    for (const d of periodRows) for (const r of d.rows) seen.add(r.restaurant)
    for (const r of restaurants) seen.add(r.name)
    return [...seen].sort((a, b) => venueLabel(a).localeCompare(venueLabel(b), 'ru'))
  }, [periodRows, restaurants, venueLabel])

  const series = useMemo(() => (product ? buildSeries(periodRows, product, scope, gran) : []), [periodRows, product, scope, gran])
  const labelOf = (name: string) => (restaurantNames.includes(name) ? venueLabel(name) : name)
  const multi = series.length > 1
  const lines = multi ? series.filter((_, i) => i < series.length - 1) : series
  const totalSeries = multi ? series[series.length - 1] : null
  const planSeries = series.length ? series[series.length - 1] : null // для одного ресторана — его план, для нескольких — по всей выборке

  const chartData = useMemo(() => {
    const keys = new Map<string, any>()
    series.forEach((s, i) => { for (const p of s.points) {
      const row = keys.get(p.key) ?? { key: p.key, label: p.label }
      row['s' + i] = Math.round(p.fact * 100) / 100
      keys.set(p.key, row)
    } })
    if (planSeries) for (const p of planSeries.points) { const row = keys.get(p.key); if (row && p.plan != null) row.__plan = Math.round(p.plan * 100) / 100 }
    return [...keys.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [series, planSeries])
  const hasPlan = chartData.some((r) => r.__plan != null)
  const pivotCols = useMemo(() => {
    const m = new Map<string, string>()
    series.forEach((srs) => srs.points.forEach((pt) => m.set(pt.key, pt.label)))
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [series])

  const setPreset = (days: number) => { const end = to || latestEnd; if (end) { autoWindow.current = false; setTo(end); setFrom(addDays(end, -days)) } }
  const noData = !loading && chosen.length === 0
  // периоды берутся целиком: если период шире выбранных дат, цена за окно считается по всему периоду — предупреждаем
  const wider = chosen.filter((p) => { const sp = periodSpan(p); return sp.start < from || sp.end > to })

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-end gap-4 p-4">
        <label className="block text-xs text-fg-500">Позиция
          <input list="dyn-products" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Начните вводить название…" className="mt-1 block w-72 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-fg-100 outline-none focus:border-brand-500" />
          <datalist id="dyn-products">{products.slice(0, 3000).map((p) => <option key={p.name} value={p.name} />)}</datalist>
        </label>
        <div className="text-xs text-fg-500">Рестораны
          <div className="mt-1"><MultiSelectFilter allLabel="Вся сеть" options={restaurantNames.map((n) => ({ key: n, label: venueLabel(n) }))} selected={scope} onChange={setScope} /></div>
        </div>
        <label className="block text-xs text-fg-500">С
          <input type="date" value={from} max={to || undefined} onChange={(e) => userFrom(e.target.value)} className="mt-1 block rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-fg-100 outline-none focus:border-brand-500" />
        </label>
        <label className="block text-xs text-fg-500">По
          <input type="date" value={to} min={from || undefined} onChange={(e) => userTo(e.target.value)} className="mt-1 block rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-fg-100 outline-none focus:border-brand-500" />
        </label>
        <div className="flex gap-1.5">
          {PRESETS.map((p) => <button key={p.label} onClick={() => setPreset(p.days)} className="btn border border-ink-700 bg-ink-900 text-fg-300 hover:bg-ink-800">{p.label}</button>)}
        </div>
        <div className="flex gap-1.5">
          {GRAN.map((g) => <button key={g.id} onClick={() => setGran(g.id)} className={`btn border ${gran === g.id ? 'border-brand-500/60 bg-brand-500/15 text-fg-50' : 'border-ink-700 bg-ink-900 text-fg-300 hover:bg-ink-800'}`}>{g.label}</button>)}
        </div>
      </div>

      {wider.length > 0 && !loading && <div className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn">Загруженные периоды шире выбранных дат ({wider.join(', ')}): цена считается по периоду целиком. Чтобы увидеть меньший отрезок, загрузите его отдельно в разделе «Обновление».</div>}
      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-xs text-bad">{error}</div>}
      {loading && <EmptyHint>Загружаю периоды…</EmptyHint>}
      {noData && <EmptyHint>За выбранные даты нет загруженных периодов. Загрузите данные в разделе «Обновление».</EmptyHint>}
      {!loading && !noData && !product && <EmptyHint>Выберите позицию — покажу, как менялась её закупочная цена. Периодов в выборке: {chosen.length}, позиций: {products.length}.</EmptyHint>}
      {!loading && product && !series.length && <EmptyHint>Позицию «{product}» в выбранных периодах и ресторанах не покупали.</EmptyHint>}

      {!loading && product && series.length > 0 && (
        <>
          <Section
            title={product}
            subtitle={`Закупочная цена за единицу измерения, ₸ · периодов в выборке: ${chosen.length} · красным — цена выросла к предыдущей дате, зелёным — снизилась`}
            right={<button onClick={() => setShowChart((v) => !v)} className="btn border border-ink-700 bg-ink-900 text-fg-300 hover:bg-ink-800">{showChart ? 'Скрыть график' : 'Показать график'}</button>}
          >
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-fg-500"><th className="py-2 pr-3">Ресторан</th>{pivotCols.map(([k, label]) => <th key={k} className="pr-3 text-right whitespace-nowrap">{label}</th>)}</tr></thead>
              <tbody>{series.map((srs) => (
                <tr key={srs.name} className={`border-t border-ink-800 text-fg-200 ${srs === totalSeries ? 'font-medium' : ''}`}>
                  <td className="py-2 pr-3">{labelOf(srs.name)}</td>
                  {pivotCols.map(([k], ci) => {
                    const pt = srs.points.find((x) => x.key === k)
                    if (!pt) return <td key={k} className="pr-3 text-right text-fg-600">—</td>
                    let prev: number | null = null
                    for (let j = ci - 1; j >= 0 && prev == null; j--) prev = srs.points.find((x) => x.key === pivotCols[j][0])?.fact ?? null
                    const d = prev != null ? pt.fact - prev : 0
                    return <td key={k} title={`${pt.covers}${pt.plan != null ? ` · план ${money(pt.plan)}` : ''}`} className={`pr-3 text-right tabular-nums ${d > 0.5 ? 'text-bad' : d < -0.5 ? 'text-good' : ''}`}>{money(pt.fact)}</td>
                  })}
                </tr>))}</tbody>
            </table></div>
          </Section>

          {showChart && (
          <Section title="График" subtitle={`Закупочная цена за единицу измерения, ₸ · периодов в выборке: ${chosen.length}${hasPlan ? ' · пунктиром — плановая цена матрицы за тот же период' : ''}`}>
            <div className="h-80 w-full">
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke={C.axis} tick={{ fontSize: 11 }} />
                  <YAxis stroke={C.axis} tick={{ fontSize: 11 }} width={64} domain={['auto', 'auto']} tickFormatter={(v) => Math.round(v).toLocaleString('ru-RU')} />
                  <Tooltip content={<ChartTip valueFormatter={(v: number) => money(v)} />} />
                  {lines.map((s, i) => <Line key={s.name} type="monotone" dataKey={'s' + i} name={labelOf(s.name)} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />)}
                  {hasPlan && <Line type="monotone" dataKey="__plan" name={multi ? 'План (по выборке)' : 'План'} stroke={C.warn} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {multi && <div className="mt-2 flex flex-wrap gap-3 text-xs text-fg-400">{lines.map((s, i) => <span key={s.name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />{labelOf(s.name)}</span>)}</div>}
          </Section>
          )}

          <Section title="Сводка за период" subtitle="Средняя — взвешенная по количеству; изменение — последняя цена к первой">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-fg-500"><th className="py-2 pr-3">Ресторан</th><th className="pr-3 text-right">Мин.</th><th className="pr-3 text-right">Макс.</th><th className="pr-3 text-right">Средняя</th><th className="pr-3 text-right">Первая</th><th className="pr-3 text-right">Последняя</th><th className="text-right">Изменение</th></tr></thead>
              <tbody>{series.map((s) => { const m = summarizeSeries(s.points)!; return (
                <tr key={s.name} className="border-t border-ink-800 text-fg-200">
                  <td className="py-2 pr-3">{labelOf(s.name)}</td>
                  <td className="pr-3 text-right tabular-nums">{money(m.min)}</td><td className="pr-3 text-right tabular-nums">{money(m.max)}</td><td className="pr-3 text-right tabular-nums">{money(m.avg)}</td>
                  <td className="pr-3 text-right tabular-nums">{money(m.first)}</td><td className="pr-3 text-right tabular-nums">{money(m.last)}</td>
                  <td className={`text-right tabular-nums ${m.change > 0.5 ? 'text-bad' : m.change < -0.5 ? 'text-good' : ''}`}>{m.n < 2 ? '—' : `${signedMoney(m.change)}${m.changePct != null ? ` (${pct(m.changePct)})` : ''}`}</td>
                </tr>) })}</tbody>
            </table></div>
          </Section>

          <details className="space-y-5">
            <summary className="cursor-pointer px-1 text-sm text-fg-300 hover:text-fg-100">Подробно по каждому ресторану (изменение к предыдущему, отклонение от плана)</summary>
          {series.map((s) => (
            <Section key={s.name} title={labelOf(s.name)} subtitle={s === totalSeries ? 'Все выбранные рестораны вместе' : undefined}>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-fg-500"><th className="py-2 pr-3">Период</th><th className="pr-3">Данные за</th><th className="pr-3 text-right">Цена закупки</th><th className="pr-3 text-right">К пред., ₸</th><th className="pr-3 text-right">К пред., %</th><th className="pr-3 text-right">План</th><th className="pr-3 text-right">Откл. от плана, ₸</th><th className="text-right">Откл. от плана, %</th></tr></thead>
                <tbody>{s.points.map((p, i) => {
                  const prev = i > 0 ? s.points[i - 1].fact : null
                  const d = prev != null ? p.fact - prev : null
                  const dp = p.plan != null ? p.fact - p.plan : null
                  const tone = (v: number | null) => (v == null ? '' : v > 0.5 ? 'text-bad' : v < -0.5 ? 'text-good' : '')
                  return (
                    <tr key={p.key} className="border-t border-ink-800 text-fg-200">
                      <td className="py-2 pr-3">{p.label}</td><td className="pr-3 text-fg-500">{p.covers}</td>
                      <td className="pr-3 text-right tabular-nums">{money(p.fact)}</td>
                      <td className={`pr-3 text-right tabular-nums ${tone(d)}`}>{d == null ? '—' : signedMoney(d)}</td>
                      <td className={`pr-3 text-right tabular-nums ${tone(d)}`}>{d == null || !prev ? '—' : pct(d / prev)}</td>
                      <td className="pr-3 text-right tabular-nums">{p.plan == null ? '—' : money(p.plan)}</td>
                      <td className={`pr-3 text-right tabular-nums ${tone(dp)}`}>{dp == null ? '—' : signedMoney(dp)}</td>
                      <td className={`text-right tabular-nums ${tone(dp)}`}>{dp == null || !p.plan ? '—' : pct(dp / p.plan)}</td>
                    </tr>)
                })}</tbody>
              </table></div>
            </Section>
          ))}
          </details>
          <p className="px-1 text-[11px] text-fg-600">Рост цены выделен красным (платим больше), снижение — зелёным. Откл. от плана = факт − план. Плановая цена берётся из матрицы, действовавшей в первый день каждого периода. Периоды в выборке не пересекаются: если за один месяц загружены и месяц, и неделя внутри него, берётся более полный период.</p>
        </>
      )}
    </div>
  )
}
