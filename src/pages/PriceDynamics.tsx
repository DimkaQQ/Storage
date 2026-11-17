import { useEffect, useMemo, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { computeRows, parseDataset, EMPTY_MATCHING, money, signedMoney, pct } from '../lib/data'
import { fetchDataset, fetchMatching } from '../lib/api'
import { useEdits } from '../lib/edits'
import { Granularity, PeriodRows, Position, Series, addDays, buildPositions, pickPeriods, periodSpan, productsIn, summarizeSeries, trendOf, FLAT_EPS } from '../lib/dynamics'
import MultiSelectFilter from '../components/MultiSelectFilter'
import { ChartTip, C, SERIES } from '../components/charts'
import { Section, EmptyHint } from '../components/ui'

interface Loaded { period: string; data: any; matching: any }

const GRAN: { id: Granularity; label: string }[] = [{ id: 'day', label: 'По дням' }, { id: 'week', label: 'По неделям' }, { id: 'month', label: 'По месяцам' }]
const PRESETS: { label: string; days: number }[] = [{ label: 'Неделя', days: 6 }, { label: 'Месяц', days: 29 }, { label: 'Квартал', days: 89 }, { label: 'Год', days: 364 }]

/**
 * Поле даты: показываем свой текст по центру (родное поле даты в Safari/iOS рисует значение у верхнего края и разной высоты),
 * а настоящий input лежит сверху невидимым — нажатие открывает родной выбор даты.
 */
function DateField({ label, value, min, max, onChange }: { label: string; value: string; min?: string; max?: string; onChange: (v: string) => void }) {
  const shown = value ? new Date(value + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Выберите дату'
  return (
    <div className="block min-w-0 text-xs font-medium text-fg-400">{label}
      <div className="relative mt-1.5 h-10 rounded-lg border border-ink-600 bg-ink-900/60 focus-within:border-brand-500">
        <div className={`pointer-events-none flex h-full items-center justify-between gap-2 px-3 text-sm ${value ? 'text-fg-100' : 'text-fg-600'}`}>
          <span className="truncate">{shown}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-500"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
        </div>
        <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)}
          onClick={(e) => { try { e.currentTarget.showPicker?.() } catch { /* нет поддержки — откроется само */ } }}
          aria-label={label} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </div>
    </div>
  )
}

/** Выбор позиции: поле с подсказками (без родного списка браузера — он рисуется по-разному и ломает ровность). */
function ProductPicker({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { name: string; count: number }[] }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const needle = (open ? q : value).trim().toLowerCase()
  const list = useMemo(() => (needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options).slice(0, 60), [options, needle])
  return (
    <div className="relative text-xs font-medium text-fg-400" ref={ref}>
      Позиция
      <div className="relative mt-1.5">
        <input
          value={open ? q : value}
          onFocus={() => { setQ(''); setOpen(true) }}
          onChange={(e) => { setQ(e.target.value); setOpen(true); const exact = options.find((o) => o.name.toLowerCase() === e.target.value.trim().toLowerCase()); if (exact) onChange(exact.name) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { onChange(list[0].name); setOpen(false); (e.target as HTMLInputElement).blur() } }}
          placeholder="Начните вводить название…"
          className="block h-10 w-full rounded-lg border border-ink-600 bg-ink-900/60 pl-3 pr-9 text-sm font-normal text-fg-100 outline-none placeholder:text-fg-600 focus:border-brand-500"
        />
        {value && <button aria-label="Очистить" onClick={() => { onChange(''); setQ(''); setOpen(false) }} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md text-fg-500 hover:text-fg-100">×</button>}
      </div>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1.5 max-h-72 overflow-auto rounded-xl border border-ink-700 bg-ink-850 py-1 shadow-card">
          {list.length === 0 && <div className="px-3 py-2 text-sm font-normal text-fg-500">Ничего не найдено</div>}
          {list.map((o) => (
            <button key={o.name} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(o.name); setOpen(false) }} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-normal hover:bg-ink-800 ${o.name === value ? 'text-brand-300' : 'text-fg-200'}`}>
              <span className="truncate">{o.name}</span><span className="shrink-0 text-xs text-fg-500">{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * «Динамика цен по позициям»: как менялась закупочная цена выбранной позиции по загруженным периодам, с плановой ценой
 * матрицы того же периода, изменением к предыдущей точке и сравнением ресторанов. Подневная/понедельная детализация
 * настоящая только там, где данные загружены по дням/неделям (Обновление → загрузка за период); месячные данные
 * показываются одной точкой на месяц, в колонке «Данные за» видно, за какие даты точка на самом деле.
 */
export default function PriceDynamics({ active = true }: { active?: boolean }) {
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
  const [scrollTick, setScrollTick] = useState(0)
  const [selKey, setSelKey] = useState('') // позиция, по строке которой открыли подробности
  const [q, setQ] = useState('')
  const [supSel, setSupSel] = useState<Set<string>>(new Set())
  const [trend, setTrend] = useState<'all' | 'up' | 'down' | 'flat' | 'single' | 'stale'>('all')
  const [sort, setSort] = useState<'step' | 'impact' | 'total' | 'rest'>('step')
  const [allCols, setAllCols] = useState(false)
  const [limit, setLimit] = useState(100)
  const detailRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<Loaded[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cache = useRef(new Map<string, Loaded>())
  // Страница остаётся смонтированной, пока открыта другая: после синка или фиксации цен кэш периодов устаревает.
  // При возвращении на вкладку кэш старше 30 секунд сбрасываем и грузим периоды заново.
  const [reload, setReload] = useState(0)
  const wasActive = useRef(active)
  const loadedAt = useRef(Date.now())
  useEffect(() => {
    const back = active && !wasActive.current
    wasActive.current = active
    if (back && Date.now() - loadedAt.current > 30_000) { cache.current.clear(); setReload((n) => n + 1) }
  }, [active])

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
      for (const p of chosen) {
        try { // сбой одного периода не должен обрывать загрузку остальных
          let hit = cache.current.get(p)
          if (!hit) {
            const [data, matching] = await Promise.all([fetchDataset(p), fetchMatching(p)])
            if (!data || !data.restaurants) { failed++; continue }
            hit = { period: p, data, matching }
            cache.current.set(p, hit)
          }
          out.push(hit)
        } catch { failed++ }
      }
      if (dead) return
      loadedAt.current = Date.now()
      setLoaded(out); setLoading(false)
      if (failed) setError(`Не удалось загрузить периодов: ${failed}`)
    })()
    return () => { dead = true }
  }, [chosen, reload])

  // строки сверки по каждому периоду: те же связи, привязки и план-цены, что в «Проверке цен», но для СВОЕГО периода
  const parsedList = useMemo(() => loaded.map((l) => ({ l, parsed: parseDataset(l.data) })), [loaded])
  const periodRows: PeriodRows[] = useMemo(() => parsedList.map(({ l, parsed }) => (
    { period: l.period, rows: computeRows(parsed.base, edits, l.matching ?? EMPTY_MATCHING, parsed.restaurants, manual) }
  )), [parsedList, edits, manual])

  const products = useMemo(() => productsIn(periodRows), [periodRows])
  const restaurantNames = useMemo(() => {
    const seen = new Set<string>()
    for (const d of periodRows) for (const r of d.rows) seen.add(r.restaurant)
    for (const r of restaurants) seen.add(r.name)
    return [...seen].sort((a, b) => venueLabel(a).localeCompare(venueLabel(b), 'ru'))
  }, [periodRows, restaurants, venueLabel])

  // ---- «все позиции сразу» (основной вид, как в «Проверке цен»): цена по группам периодов, изменение к предыдущей, влияние в ₸ ----
  const built = useMemo(() => buildPositions(periodRows, scope, gran), [periodRows, scope, gran])
  const supplierOptions = useMemo(() => [...new Set(built.positions.map((p) => p.supplier))].sort((a, b) => a.localeCompare(b, 'ru')).map((x) => ({ key: x, label: x })), [built])
  // выбранные поставщики, которых нет в текущей выборке (сменили точки/даты), не стираем из выбора, но и не фильтруем по ним
  const activeSup = useMemo(() => { const ok = new Set(supplierOptions.map((o) => o.key)); return new Set([...supSel].filter((x) => ok.has(x))) }, [supSel, supplierOptions])
  const base = useMemo(() => {
    const n = q.trim().toLowerCase()
    return built.positions.filter((p) => (!n || `${p.product} ${p.supplier} ${venueLabel(p.restaurant)}`.toLowerCase().includes(n)) && (!activeSup.size || activeSup.has(p.supplier)))
  }, [built, q, activeSup, venueLabel])
  const counts = useMemo(() => {
    const c = { up: 0, down: 0, flat: 0, single: 0, stale: 0, upSum: 0, downSum: 0 }
    for (const p of base) { const t = trendOf(p); c[t]++; if (p.impact != null && t === 'up') c.upSum += p.impact; if (p.impact != null && t === 'down') c.downSum += p.impact }
    return c
  }, [base])
  const visible = useMemo(() => {
    const list = base.filter((p) => trend === 'all' || trendOf(p) === trend)
    const num = (v: number | null) => (v == null ? -Infinity : v)
    const cmp: Record<typeof sort, (a: Position, b: Position) => number> = {
      step: (a, b) => num(b.stepPct) - num(a.stepPct),
      impact: (a, b) => num(b.impact) - num(a.impact),
      total: (a, b) => num(b.totalPct) - num(a.totalPct),
      rest: (a, b) => venueLabel(a.restaurant).localeCompare(venueLabel(b.restaurant), 'ru') || a.product.localeCompare(b.product, 'ru'),
    }
    return [...list].sort((a, b) => cmp[sort](a, b) || a.product.localeCompare(b.product, 'ru'))
  }, [base, trend, sort, venueLabel])
  // Подробности открываются по ТЕМ ЖЕ позициям, что в таблице (точка + поставщик + фасовка): так цены в таблице и на графике совпадают
  // (раньше подробности склеивали разных поставщиков и фасовки одного товара в одну цену).
  const series = useMemo<Series[]>(() => {
    if (!product) return []
    const lab = new Map(built.buckets.map((b) => [b.key, b.label]))
    const ps = built.positions.filter((p) => p.product === product && (!activeSup.size || activeSup.has(p.supplier))).sort((a, b) => (a.key === selKey ? -1 : b.key === selKey ? 1 : 0) || b.lastQty - a.lastQty)
    return ps.map((p) => ({
      name: `${venueLabel(p.restaurant)} · ${p.supplier}${p.pack ? ' · ' + p.pack : ''}`,
      points: p.keys.map((k) => { const c = p.cells.get(k)!; return { key: k, label: lab.get(k) ?? k, covers: c.covers, fact: c.fact, plan: c.plan, qty: c.qty } }),
    }))
  }, [built, product, selKey, activeSup, venueLabel])
  const multi = series.length > 1
  const lines = series
  const planSeries = selKey || series.length === 1 ? series[0] ?? null : null // план показываем у выбранной строки (или если позиция одна)
  useEffect(() => { setLimit(100) }, [trend, sort, q, supSel, scope, gran, loaded])
  const shownBuckets = allCols ? built.buckets : built.buckets.slice(-6)
  const openPosition = (p: Position) => { setProduct(p.product); setSelKey(p.key); setScrollTick((n) => n + 1) }
  useEffect(() => { if (scrollTick) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [scrollTick])

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
      <div className="card space-y-4 p-4">
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 lg:grid-cols-[minmax(260px,1.6fr)_minmax(180px,1fr)_168px_168px] lg:gap-x-4">
          <label className="col-span-2 block text-xs font-medium text-fg-400 lg:col-span-1">Поиск
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Товар, поставщик или точка" className="mt-1.5 block h-10 w-full rounded-lg border border-ink-600 bg-ink-900/60 px-3 text-sm font-normal text-fg-100 outline-none placeholder:text-fg-600 focus:border-brand-500" />
          </label>
          <div className="col-span-2 text-xs font-medium text-fg-400 lg:col-span-1">Рестораны
            <div className="mt-1.5 [&>div]:w-full [&>div>button:first-child]:h-10 [&>div>button:first-child]:w-full [&>div>button:first-child]:rounded-lg">
              <MultiSelectFilter allLabel="Вся сеть" options={restaurantNames.map((n) => ({ key: n, label: venueLabel(n) }))} selected={scope} onChange={setScope} />
            </div>
          </div>
          <DateField label="С" value={from} max={to || undefined} onChange={userFrom} />
          <DateField label="По" value={to} min={from || undefined} onChange={userTo} />
        </div>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-[auto_auto_minmax(220px,300px)] sm:justify-start">
          <div className="min-w-0 text-xs font-medium text-fg-400">Поставщик
            <div className="mt-1.5 [&>div]:w-full [&>div>button:first-child]:h-10 [&>div>button:first-child]:w-full [&>div>button:first-child]:rounded-lg">
              <MultiSelectFilter allLabel="Все поставщики" options={supplierOptions} selected={supSel} onChange={setSupSel} />
            </div>
          </div>
          <div className="min-w-0 text-xs font-medium text-fg-400">Быстрый период
            <div className="mt-1.5 flex rounded-lg border border-ink-700 bg-ink-900 p-0.5">
              {PRESETS.map((p) => <button key={p.label} onClick={() => setPreset(p.days)} className="h-9 flex-1 rounded-md px-3 text-sm font-normal text-fg-300 hover:bg-ink-800 hover:text-fg-50 sm:flex-none">{p.label}</button>)}
            </div>
          </div>
          <div className="min-w-0 text-xs font-medium text-fg-400">Детализация
            <div className="mt-1.5 flex rounded-lg border border-ink-700 bg-ink-900 p-0.5">
              {GRAN.map((g) => <button key={g.id} onClick={() => setGran(g.id)} className={`h-9 flex-1 rounded-md px-3 text-sm font-normal sm:flex-none ${gran === g.id ? 'bg-brand-500/20 text-fg-50' : 'text-fg-300 hover:bg-ink-800 hover:text-fg-50'}`}>{g.label}</button>)}
            </div>
          </div>
        </div>
      </div>

      {wider.length > 0 && !loading && <div className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn">Загруженные периоды шире выбранных дат ({wider.join(', ')}): цена считается по периоду целиком. Чтобы увидеть меньший отрезок, загрузите его отдельно в разделе «Обновление».</div>}
      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-xs text-bad">{error}</div>}
      {loading && <EmptyHint>Загружаю периоды…</EmptyHint>}
      {noData && <EmptyHint>За выбранные даты нет загруженных периодов. Загрузите данные в разделе «Обновление».</EmptyHint>}


      {!loading && !noData && built.positions.length === 0 && <EmptyHint>В выбранных периодах и ресторанах нет закупок с ценой.</EmptyHint>}
      {!loading && built.positions.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="card p-4"><div className="text-xs text-fg-500">Позиций в выборке</div><div className="mt-1 text-2xl font-semibold tabular-nums text-fg-50">{base.length}</div><div className="mt-0.5 text-xs text-fg-500">периодов: {chosen.length}</div></div>
            <div className="card p-4"><div className="text-xs text-fg-500">Цена выросла</div><div className="mt-1 text-2xl font-semibold tabular-nums text-bad">{counts.up}</div><div className="mt-0.5 text-xs text-fg-500">{counts.up ? `переплата из-за роста ${money(counts.upSum)}` : 'нет роста'}</div></div>
            <div className="card p-4"><div className="text-xs text-fg-500">Цена снизилась</div><div className="mt-1 text-2xl font-semibold tabular-nums text-good">{counts.down}</div><div className="mt-0.5 text-xs text-fg-500">{counts.down ? `экономия из-за снижения ${money(-counts.downSum)}` : 'нет снижения'}</div></div>
            <div className="card p-4"><div className="text-xs text-fg-500">Без изменений</div><div className="mt-1 text-2xl font-semibold tabular-nums text-fg-50">{counts.flat}</div><div className="mt-0.5 text-xs text-fg-500">{counts.single + counts.stale ? `не сравниваем: ${counts.single} с одной закупкой, ${counts.stale} не покупали в последнем периоде` : 'изменение меньше 0,5%'}</div></div>
          </div>

          <Section
            title="Динамика цен по всем позициям"
            subtitle={`Позиция = точка + поставщик + фасовка, цена за единицу, ₸ · «К пред.» — последняя цена к предыдущей закупке этой позиции · влияние = (цена − предыдущая) × последний объём · нажмите на строку, чтобы увидеть график`}
            right={built.buckets.length > 6 ? <button onClick={() => setAllCols((v) => !v)} className="btn border border-ink-700 bg-ink-900 text-fg-300 hover:bg-ink-800">{allCols ? 'Только последние 6' : `Все периоды (${built.buckets.length})`}</button> : undefined}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {([['all', 'Все', base.length], ['up', 'Выросла', counts.up], ['down', 'Снизилась', counts.down], ['flat', 'Без изменений', counts.flat], ['single', 'Одна точка', counts.single], ['stale', 'Не в последнем периоде', counts.stale]] as const).map(([id, label, n]) => (
                <button key={id} onClick={() => setTrend(id)} className={`h-8 rounded-full border px-3 text-xs ${trend === id ? 'border-brand-500 bg-brand-500/20 text-fg-50' : 'border-ink-700 bg-ink-900 text-fg-300 hover:bg-ink-800'}`}>{label} <span className="text-fg-500">{n}</span></button>
              ))}
              <label className="ml-auto flex items-center gap-2 text-xs text-fg-400">Сортировка
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-8 rounded-lg border border-ink-600 bg-ink-900 px-2 text-xs text-fg-100">
                  <option value="step">Сначала самый большой рост, %</option>
                  <option value="impact">Сначала самое большое влияние, ₸</option>
                  <option value="total">Сначала рост за весь период, %</option>
                  <option value="rest">По точкам</option>
                </select>
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-fg-500">
                  <th className="py-2 pr-3">Позиция</th><th className="pr-3">Точка</th>
                  {shownBuckets.map((b) => <th key={b.key} className="pr-3 text-right whitespace-nowrap">{b.label}</th>)}
                  <th className="pr-3 text-right">К пред.</th><th className="pr-3 text-right">Влияние</th><th className="pr-3 text-right">План</th><th className="text-right" title="На сколько процентов цена выше (+) или ниже (−) плановой">Выше плана</th>
                </tr></thead>
                <tbody>{visible.slice(0, limit).map((p) => {
                  const t = trendOf(p), tone = t === 'up' ? 'text-bad' : t === 'down' ? 'text-good' : 'text-fg-400'
                  return (
                    <tr key={p.key} tabIndex={0} onClick={() => openPosition(p)} onKeyDown={(e) => { if (e.key === 'Enter') openPosition(p) }} className={`cursor-pointer border-t border-ink-800 text-fg-200 hover:bg-ink-800/40 ${p.key === selKey && p.product === product ? 'bg-brand-500/10' : ''}`}>
                      <td className="max-w-[260px] py-2 pr-3"><div className="truncate font-medium text-fg-100" title={p.product}>{p.product}</div><div className="truncate text-xs text-fg-500" title={`${p.supplier}${p.pack ? ' · ' + p.pack : ''}`}>{p.supplier}{p.pack ? ` · ${p.pack}` : ''}</div></td>
                      <td className="pr-3 whitespace-nowrap">{venueLabel(p.restaurant)}</td>
                      {shownBuckets.map((b) => {
                        const c = p.cells.get(b.key)
                        if (!c) return <td key={b.key} className="pr-3 text-right text-fg-600">—</td>
                        const idx = p.keys.indexOf(b.key), pv = idx > 0 ? p.cells.get(p.keys[idx - 1])!.fact : null
                        const d = pv ? (c.fact - pv) / pv : 0
                        return <td key={b.key} title={`${c.covers}${c.plan != null ? ` · план ${money(c.plan)}` : ''}`} className={`pr-3 text-right tabular-nums whitespace-nowrap ${d > FLAT_EPS ? 'text-bad' : d < -FLAT_EPS ? 'text-good' : ''}`}>{money(c.fact)}</td>
                      })}
                      <td className={`pr-3 whitespace-nowrap text-right tabular-nums ${tone}`}>{p.stepPct == null ? '—' : <>{pct(p.stepPct)}<div className="text-xs opacity-80">{signedMoney(p.stepAbs ?? 0)}</div></>}</td>
                      <td className={`pr-3 whitespace-nowrap text-right tabular-nums ${tone}`}>{p.impact == null || t === 'flat' ? '—' : signedMoney(p.impact)}</td>
                      <td className="pr-3 whitespace-nowrap text-right tabular-nums">{p.plan == null ? <span className="text-fg-600">—</span> : money(p.plan)}</td>
                      <td className={`text-right tabular-nums ${p.devPct == null ? 'text-fg-600' : p.devPct > FLAT_EPS ? 'text-bad' : p.devPct < -FLAT_EPS ? 'text-good' : ''}`}>{p.devPct == null ? '—' : pct(p.devPct)}</td>
                    </tr>)
                })}</tbody>
              </table>
            </div>

            {visible.length === 0 && <EmptyHint>Нет позиций под выбранные фильтры.</EmptyHint>}
            {visible.length > limit && <div className="mt-3 text-center"><button onClick={() => setLimit((n) => n + 200)} className="btn border border-ink-700 bg-ink-900 text-fg-300 hover:bg-ink-800">Показать ещё (осталось {visible.length - limit})</button></div>}
          </Section>
        </>
      )}

      {product && (
        <div ref={detailRef} className="space-y-5">
          <div className="card flex flex-wrap items-end justify-between gap-3 p-4">
            <div className="min-w-[260px] flex-1"><ProductPicker value={product} onChange={(v) => { setProduct(v); setSelKey('') }} options={products} /></div>
            <button onClick={() => { setProduct(''); setSelKey('') }} className="btn border border-ink-700 bg-ink-900 text-fg-300 hover:bg-ink-800">Закрыть подробности</button>
          </div>
          {!loading && !series.length && <EmptyHint>{built.positions.some((p) => p.product === product) ? `Позицию «${product}» скрыл фильтр по поставщику.` : `Позицию «${product}» в выбранных периодах и ресторанах не покупали.`}</EmptyHint>}
      {!loading && series.length > 0 && (
        <>
          <Section
            title={product}
            subtitle={`Закупочная цена за единицу измерения, ₸ · периодов в выборке: ${chosen.length} · красным — цена выросла к предыдущей дате, зелёным — снизилась`}
            right={<button onClick={() => setShowChart((v) => !v)} className="btn border border-ink-700 bg-ink-900 text-fg-300 hover:bg-ink-800">{showChart ? 'Скрыть график' : 'Показать график'}</button>}
          >
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-fg-500"><th className="py-2 pr-3">Точка · поставщик · фасовка</th>{pivotCols.map(([k, label]) => <th key={k} className="pr-3 text-right whitespace-nowrap">{label}</th>)}</tr></thead>
              <tbody>{series.map((srs) => (
                <tr key={srs.name} className="border-t border-ink-800 text-fg-200">
                  <td className="py-2 pr-3">{srs.name}</td>
                  {pivotCols.map(([k], ci) => {
                    const pt = srs.points.find((x) => x.key === k)
                    if (!pt) return <td key={k} className="pr-3 text-right text-fg-600">—</td>
                    let prev: number | null = null
                    for (let j = ci - 1; j >= 0 && prev == null; j--) prev = srs.points.find((x) => x.key === pivotCols[j][0])?.fact ?? null
                    const d = prev ? (pt.fact - prev) / prev : 0
                    return <td key={k} title={`${pt.covers}${pt.plan != null ? ` · план ${money(pt.plan)}` : ''}`} className={`pr-3 text-right tabular-nums whitespace-nowrap ${d > FLAT_EPS ? 'text-bad' : d < -FLAT_EPS ? 'text-good' : ''}`}>{money(pt.fact)}</td>
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
                  {lines.map((s, i) => <Line key={s.name} type="monotone" dataKey={'s' + i} name={s.name} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />)}
                  {hasPlan && <Line type="monotone" dataKey="__plan" name={multi ? 'План (выбранной позиции)' : 'План'} stroke={C.warn} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {multi && <div className="mt-2 flex flex-wrap gap-3 text-xs text-fg-400">{lines.map((s, i) => <span key={s.name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />{s.name}</span>)}</div>}
          </Section>
          )}

          <Section title="Сводка за период" subtitle="Средняя — взвешенная по количеству; изменение — последняя цена к первой">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-fg-500"><th className="py-2 pr-3">Позиция</th><th className="pr-3 text-right">Мин.</th><th className="pr-3 text-right">Макс.</th><th className="pr-3 text-right">Средняя</th><th className="pr-3 text-right">Первая</th><th className="pr-3 text-right">Последняя</th><th className="text-right">Изменение</th></tr></thead>
              <tbody>{series.map((s) => { const m = summarizeSeries(s.points)!; return (
                <tr key={s.name} className="border-t border-ink-800 text-fg-200">
                  <td className="py-2 pr-3">{s.name}</td>
                  <td className="pr-3 text-right tabular-nums">{money(m.min)}</td><td className="pr-3 text-right tabular-nums">{money(m.max)}</td><td className="pr-3 text-right tabular-nums">{money(m.avg)}</td>
                  <td className="pr-3 text-right tabular-nums">{money(m.first)}</td><td className="pr-3 text-right tabular-nums">{money(m.last)}</td>
                  <td className={`text-right tabular-nums ${m.change > 0.5 ? 'text-bad' : m.change < -0.5 ? 'text-good' : ''}`}>{m.n < 2 ? '—' : `${signedMoney(m.change)}${m.changePct != null ? ` (${pct(m.changePct)})` : ''}`}</td>
                </tr>) })}</tbody>
            </table></div>
          </Section>

          <details className="space-y-5">
            <summary className="cursor-pointer px-1 text-sm text-fg-300 hover:text-fg-100">Подробно по каждому ресторану (изменение к предыдущему, отклонение от плана)</summary>
          {series.map((s) => (
            <Section key={s.name} title={s.name} >
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
      )}
    </div>
  )
}
