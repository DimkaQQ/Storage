import { useEffect, useMemo, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { computeRows, parseDataset, EMPTY_MATCHING, money, signedMoney, pct } from '../lib/data'
import { fetchDataset, fetchMatching } from '../lib/api'
import { useEdits } from '../lib/edits'
import { Granularity, PeriodRows, Position, Series, addDays, bucketOf, buildPositions, pickPeriods, periodSpan, productsIn, summarizeSeries, trendOf, FLAT_EPS } from '../lib/dynamics'
import MultiSelectFilter from '../components/MultiSelectFilter'
import { ChartTip, C, SERIES } from '../components/charts'
import { Section, EmptyHint } from '../components/ui'
import { ISearch } from '../components/icons'

interface Loaded { period: string; data: any; matching: any }

const GRAN: { id: Granularity; label: string }[] = [{ id: 'day', label: 'Дни' }, { id: 'week', label: 'Недели' }, { id: 'month', label: 'Месяцы' }, { id: 'quarter', label: 'Кварталы' }, { id: 'year', label: 'Годы' }]
const coarser: Partial<Record<Granularity, Granularity>> = { day: 'week', week: 'month', month: 'quarter', quarter: 'year' } // следующая, более крупная детализация
const MAX_COLS = 4 // столько периодов показываем в таблице; остальные — по кнопке «Все периоды» (иначе таблица шире экрана)

/**
 * Поле даты: показываем свой текст по центру (родное поле даты в Safari/iOS рисует значение у верхнего края и разной высоты),
 * а настоящий input лежит сверху невидимым — нажатие открывает родной выбор даты.
 */
function DateField({ label, value, min, max, onChange }: { label: string; value: string; min?: string; max?: string; onChange: (v: string) => void }) {
  const shown = value ? new Date(value + 'T00:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : 'Дата'
  return (
    <div className="relative h-10 w-[128px] shrink-0 rounded-lg border border-ink-600 bg-ink-900/60 focus-within:border-brand-500">
      <div className={`pointer-events-none flex h-full items-center justify-between gap-2 px-3 text-sm ${value ? 'text-fg-100' : 'text-fg-600'}`}>
        <span className="truncate"><span className="text-fg-500">{label} </span>{shown}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-500"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </div>
      <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)}
        onClick={(e) => { try { e.currentTarget.showPicker?.() } catch { /* нет поддержки — откроется само */ } }}
        aria-label={label} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
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
  const { edits, periods, restaurants, venueLabel, status, dataVersion } = useEdits()
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
  // Страница остаётся смонтированной, пока открыта другая: после «Обновить» или фиксации цен данные на сервере меняются, и кэш периодов
  // устаревает. Версия данных (dataVersion) и время последней загрузки (status.lastSync) меняются ровно тогда — тогда кэш сбрасывается и,
  // когда страница открыта, периоды загружаются заново. Если ничего не менялось, возвращение на вкладку ничего не грузит.
  const [reload, setReload] = useState(0)
  const ver = status ? `${dataVersion}|${status.lastSync ?? ''}` : '' // пока статус не пришёл — версии нет
  const verSeen = useRef<string | null>(null)
  useEffect(() => {
    if (!ver || !active) return
    if (verSeen.current === null) { verSeen.current = ver; return } // первая версия — это не изменение
    if (verSeen.current !== ver) { verSeen.current = ver; cache.current.clear(); setReload((n) => n + 1) }
  }, [active, ver])

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
  const [pickedDates, setPickedDates] = useState(false) // даты выбраны руками (не пресетом и не окном по умолчанию) — только тогда предупреждаем о незагруженных месяцах
  const userFrom = (v: string) => { autoWindow.current = false; setPickedDates(true); setFrom(v) }
  const userTo = (v: string) => { autoWindow.current = false; setPickedDates(true); setTo(v) }

  const chosen = useMemo(() => (from && to && from <= to ? pickPeriods(allPeriods, from, to) : []), [allPeriods, from, to])

  useEffect(() => {
    let dead = false
    if (!chosen.length) { setLoaded([]); setLoading(false); setError(null); return }
    // всё уже в кэше — показываем сразу, без «загрузки»
    const cached = chosen.map((p) => cache.current.get(p))
    if (cached.every(Boolean)) { setLoaded(cached as Loaded[]); setLoading(false); setError(null); return }
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
            if (!dead) cache.current.set(p, hit) // отменённая загрузка не должна класть в кэш устаревшие данные
          }
          out.push(hit)
        } catch { failed++ }
      }
      if (dead) return
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
  // точки сгруппированы по городам: Астана и Алматы отдельными блоками, в каждом можно выбрать город целиком или любую точку
  const cityOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of restaurants) if (r.city) m.set(r.name, r.city)
    for (const d of periodRows) for (const r of d.rows) if (r.city && !m.has(r.restaurant)) m.set(r.restaurant, r.city)
    return m
  }, [restaurants, periodRows])
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
  const restaurantOptions = useMemo(() => {
    const hasCity = restaurantNames.some((n) => cityOf.get(n))
    const rank = (c?: string) => (c === 'Алматы' ? 0 : c === 'Астана' ? 1 : 2)
    return restaurantNames
      .map((n) => ({ key: n, label: venueLabel(n), group: hasCity ? cityOf.get(n) || 'Без города' : undefined }))
      .sort((a, b) => rank(a.group) - rank(b.group) || (a.group ?? '').localeCompare(b.group ?? '', 'ru') || a.label.localeCompare(b.label, 'ru'))
  }, [restaurantNames, venueLabel, cityOf])
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
  const shownBuckets = allCols ? built.buckets : built.buckets.slice(-MAX_COLS)
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

  const blocking = loading && loaded.length === 0 // пока есть что показать, прежние данные остаются на экране, а загрузка — маленькая пометка
  const noData = !loading && chosen.length === 0
  // месяцы выбранных дат, за которые в системе нет ни одного загруженного периода
  const missing = useMemo(() => {
    if (!pickedDates || !from || !to || from > to) return [] as string[]
    const out: string[] = []
    let y = +from.slice(0, 4), m = +from.slice(5, 7)
    const last = to.slice(0, 7)
    for (let guard = 0; guard < 60; guard++) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      if (key > last) break
      const sp = periodSpan(key)
      if (!chosen.some((p) => { const c = periodSpan(p); return c.start <= sp.end && c.end >= sp.start })) out.push(bucketOf(`${key}-01`, 'month').label)
      m++; if (m > 12) { m = 1; y++ }
    }
    return out
  }, [pickedDates, from, to, chosen])
  // периоды берутся целиком: если период шире выбранных дат, цена за окно считается по всему периоду — предупреждаем
  const wider = chosen.filter((p) => { const sp = periodSpan(p); return sp.start < from || sp.end > to })

  return (
    <div className="space-y-5">
      {!blocking && built.positions.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <DynStat delay={0} tone="slate" label="Позиций в выборке" value={String(base.length)} hint={`периодов: ${chosen.length}`} />
          <DynStat delay={50} tone="bad" label="Цена выросла" value={String(counts.up)} hint={counts.up ? `переплата из-за роста ${money(counts.upSum)}` : 'нет роста'} />
          <DynStat delay={100} tone="good" label="Цена снизилась" value={String(counts.down)} hint={counts.down ? `экономия из-за снижения ${money(-counts.downSum)}` : 'нет снижения'} />
          <DynStat delay={150} tone="slate" label="Без изменений" value={String(counts.flat)} hint={counts.single + counts.stale ? `не сравниваем: ${counts.single} с одной закупкой, ${counts.stale} не покупали в последнем периоде` : 'изменение меньше 0,5%'} />
        </div>
      )}

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <div className="relative w-28 shrink-0">
            <ISearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-500" width={16} height={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск" title="Поиск: товар, поставщик, точка"
              className="w-full rounded-lg border border-ink-600 bg-ink-900/60 py-2 pl-9 pr-3 text-sm text-fg-100 placeholder:text-fg-600 focus:border-brand-500 focus:outline-none" />
          </div>
          <MultiSelectFilter allLabel="Вся сеть" options={restaurantOptions} selected={scope} onChange={setScope} />
          <MultiSelectFilter allLabel="Все поставщики" options={supplierOptions} selected={supSel} onChange={setSupSel} />
          <DateField label="с" value={from} max={to || undefined} onChange={userFrom} />
          <DateField label="по" value={to} min={from || undefined} onChange={userTo} />
          <div className="flex rounded-lg border border-ink-700 bg-ink-900 p-0.5">
            {GRAN.map((g) => <button key={g.id} onClick={() => setGran(g.id)} className={`h-9 rounded-md px-2 text-sm font-normal ${gran === g.id ? 'bg-brand-500/20 text-fg-50' : 'text-fg-300 hover:bg-ink-800 hover:text-fg-50'}`}>{g.label}</button>)}
          </div>
          {loading && loaded.length > 0 && <span className="text-xs text-fg-500">Обновляю…</span>}
        </div>
      </div>

      {missing.length > 0 && !loading && !noData && <div className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn">В выбранных датах нет загруженных данных за: {missing.join(', ')}. Загрузите их в разделе «Обновление», тогда они появятся в таблице.</div>}
      {wider.length > 0 && !loading && <div className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn">Загруженные периоды шире выбранных дат ({wider.join(', ')}): цена считается по периоду целиком. Чтобы увидеть меньший отрезок, загрузите его отдельно в разделе «Обновление».</div>}
      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-xs text-bad">{error}</div>}
      {blocking && <EmptyHint>Загружаю периоды…</EmptyHint>}
      {noData && <EmptyHint>За выбранные даты нет загруженных периодов. Загрузите данные в разделе «Обновление».</EmptyHint>}


      {!loading && !noData && built.positions.length === 0 && <EmptyHint>В выбранных периодах и ресторанах нет закупок с ценой.</EmptyHint>}
      {!blocking && built.positions.length > 0 && (
        <>
          <Section
            title="Динамика цен по всем позициям"
            subtitle={`Позиция = точка + поставщик + фасовка, цена за единицу, ₸ · «К пред.» — последняя цена к предыдущей закупке этой позиции · влияние = (цена − предыдущая) × последний объём · нажмите на строку, чтобы увидеть график`}
            right={built.buckets.length > MAX_COLS ? <button onClick={() => setAllCols((v) => !v)} className="btn border border-ink-700 bg-ink-900 text-fg-300 hover:bg-ink-800">{allCols ? `Только последние ${MAX_COLS}` : `Все периоды (${built.buckets.length})`}</button> : undefined}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {([['all', 'Все', base.length], ['up', 'Выросла', counts.up], ['down', 'Снизилась', counts.down], ['flat', 'Без изменений', counts.flat], ['single', 'Одна точка', counts.single], ['stale', 'Не в последнем периоде', counts.stale]] as const).map(([id, label, n]) => (
                <button key={id} onClick={() => setTrend(id)} className={`h-8 rounded-full border px-3 text-xs ${trend === id ? 'border-brand-500 bg-brand-500/20 text-fg-50' : 'border-ink-700 bg-ink-900 text-fg-300 hover:bg-ink-800'}`}>{label} <span className="text-fg-500">{n}</span></button>
              ))}
              <label className="ml-auto flex items-center gap-2 text-xs text-fg-400">Сортировать
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-8 rounded-lg border border-ink-600 bg-ink-900 px-2 text-xs text-fg-100">
                  <option value="step">Рост к пред., %</option>
                  <option value="impact">Влияние, ₸</option>
                  <option value="total">Рост за период, %</option>
                  <option value="rest">Точка А–Я</option>
                </select>
              </label>
            </div>

            {built.buckets.length > MAX_COLS && !allCols && (
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-400">
                <span>Показаны последние {MAX_COLS} из {built.buckets.length} периодов.</span>
                {coarser[gran] && <button onClick={() => setGran(coarser[gran]!)} className="text-brand-300 hover:underline">Показать «{GRAN.find((x) => x.id === coarser[gran])!.label}»</button>}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-fg-500">
                  <th className="py-2 pr-2">Позиция</th><th className="pr-2">Точка</th>
                  {shownBuckets.map((b) => <th key={b.key} title={b.label} className="pr-2 text-right whitespace-nowrap">{b.label.replace(/^([А-Яа-я]{3})[А-Яа-я]* (\d{4})$/, '$1 $2').replace(/^Нед\. с (\d{2}\.\d{2})\.\d{4}$/, 'нед. $1').replace(/^(\d{2}\.\d{2})\.\d{4}$/, '$1')}</th>)}
                  <th className="pr-2 text-right">К пред.</th><th className="pr-2 text-right">Влияние</th><th className="text-right" title="Плановая цена; ниже — на сколько процентов цена выше (+) или ниже (−) плана">План</th>
                </tr></thead>
                <tbody>{visible.slice(0, limit).map((p) => {
                  const t = trendOf(p), tone = t === 'up' ? 'text-bad' : t === 'down' ? 'text-good' : 'text-fg-400'
                  return (
                    <tr key={p.key} tabIndex={0} onClick={() => openPosition(p)} onKeyDown={(e) => { if (e.key === 'Enter') openPosition(p) }} className={`cursor-pointer border-t border-ink-800 text-fg-200 hover:bg-ink-800/40 ${p.key === selKey && p.product === product ? 'bg-brand-500/10' : ''}`}>
                      <td className="max-w-[150px] py-2 pr-2"><div className="truncate font-medium text-fg-100" title={p.product}>{p.product}</div><div className="truncate text-xs text-fg-500" title={`${p.supplier}${p.pack ? ' · ' + p.pack : ''}`}>{p.supplier}{p.pack ? ` · ${p.pack}` : ''}</div></td>
                      <td className="max-w-[90px] truncate pr-2" title={venueLabel(p.restaurant)}>{venueLabel(p.restaurant)}</td>
                      {shownBuckets.map((b) => {
                        const c = p.cells.get(b.key)
                        if (!c) return <td key={b.key} className="pr-2 text-right text-fg-600">—</td>
                        const idx = p.keys.indexOf(b.key), pv = idx > 0 ? p.cells.get(p.keys[idx - 1])!.fact : null
                        const d = pv ? (c.fact - pv) / pv : 0
                        return <td key={b.key} title={`${c.covers}${c.plan != null ? ` · план ${money(c.plan)}` : ''}`} className={`pr-2 text-right tabular-nums whitespace-nowrap ${d > FLAT_EPS ? 'text-bad' : d < -FLAT_EPS ? 'text-good' : ''}`}>{money(c.fact)}</td>
                      })}
                      <td className={`pr-2 whitespace-nowrap text-right tabular-nums ${tone}`}>{p.stepPct == null ? '—' : <>{pct(p.stepPct)}<div className="text-xs opacity-80">{signedMoney(p.stepAbs ?? 0)}</div></>}</td>
                      <td className={`pr-2 whitespace-nowrap text-right tabular-nums ${tone}`}>{p.impact == null || t === 'flat' ? '—' : signedMoney(p.impact)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{p.plan == null ? <span className="text-fg-600">—</span> : <>{money(p.plan)}<div className={`text-xs ${p.devPct == null ? '' : p.devPct > FLAT_EPS ? 'text-bad' : p.devPct < -FLAT_EPS ? 'text-good' : 'text-fg-400'}`}>{p.devPct == null ? '' : pct(p.devPct)}</div></>}</td>
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
          {!blocking && !series.length && <EmptyHint>{built.positions.some((p) => p.product === product) ? `Позицию «${product}» скрыл фильтр по поставщику.` : `Позицию «${product}» в выбранных периодах и ресторанах не покупали.`}</EmptyHint>}
      {!blocking && series.length > 0 && (
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

          <Section title="Сводка за период" subtitle="По каждой позиции за выбранные даты: самая низкая и самая высокая цена, средняя (с учётом количества), первая и последняя, и итоговое изменение — последняя цена к первой">
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


/** Плитка итога: как в «Проверке цен», но с цветной полоской слева и пояснением под числом. */
function DynStat({ label, value, hint, tone, delay = 0 }: { label: string; value: string; hint: string; tone: 'slate' | 'bad' | 'good'; delay?: number }) {
  const val = tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-fg-50'
  const bar = tone === 'bad' ? 'bg-bad' : tone === 'good' ? 'bg-good' : 'bg-fg-600'
  return (
    <div className="card card-hover animate-fade-up relative overflow-hidden py-3 pl-5 pr-4" style={{ animationDelay: `${delay}ms` }}>
      <span className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${bar}`} />
      <div className="text-[11px] text-fg-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabnum ${val}`}>{value}</div>
      <div title={hint} className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-fg-500">{hint}</div>
    </div>
  )
}
