import { useEffect, useMemo, useRef, useState } from 'react'
import { PeriodMeta, fetchMatrixSnapshots, deleteMatrixSnapshot, syncMatrix } from '../lib/api'
import { useEdits } from '../lib/edits'
import { useAuth } from '../lib/auth'
import { MATRIX_SNAPSHOTS } from '../lib/features'
import { IClock, IChevron, ILock, ISync } from './icons'

/**
 * Выбор периода — ОДИН календарь вместо списка загрузок («Октябрь 2026», «1–31 октября», «25–27 октября» путали, какая
 * из них правильная). Вкладка «Месяц» — 12 месяцев года с отметками (● закупки загружены, замок — матрица зафиксирована),
 * «Даты» — календарь дней: первый клик — начало, второй — конец. Любой отрезок собирается из загруженных месяцев
 * (сервер: /api/data → composeRange). Внизу — что есть по выбранному периоду и две кнопки: «Загрузить из iiko»
 * (та же updateAll, что «Обновить» в Проверке цен) и для админа «Зафиксировать матрицу» (только целый месяц; город из шапки или оба; подробно — страница «Фиксация матрицы»).
 */
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_S = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const MONTHS_G = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate() // m — 1..12
const MONTH_RE = /^(\d{4})-(\d{2})$/
const RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/
/** Границы периода «ГГГГ-ММ» или «с..по» */
export function boundsOf(p: string): { a: string; b: string } | null {
  const m = MONTH_RE.exec(p); if (m) return { a: `${p}-01`, b: `${p}-${pad(lastDay(+m[1], +m[2]))}` }
  const r = RANGE_RE.exec(p); return r ? { a: r[1], b: r[2] } : null
}
/** Отрезок ровно на весь месяц — это просто месяц (одна запись, без «1–31 октября» рядом с «Октябрь») */
const keyOf = (a: string, b: string) => { const x = boundsOf(a.slice(0, 7)); return x && x.a === a && x.b === b ? a.slice(0, 7) : `${a}..${b}` }
/** Месяцы «ГГГГ-ММ», которые задевает период */
function monthsOf(p: string): string[] {
  const b = boundsOf(p); if (!b) return []
  const out: string[] = []; let y = +b.a.slice(0, 4), m = +b.a.slice(5, 7)
  while (`${y}-${pad(m)}` <= b.b.slice(0, 7) && out.length < 40) { out.push(`${y}-${pad(m)}`); if (++m > 12) { m = 1; y++ } }
  return out
}
export function periodTitle(p: string): string {
  const m = MONTH_RE.exec(p); if (m) return `${MONTHS[+m[2] - 1]} ${m[1]}`
  const r = /^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/.exec(p); if (!r) return p
  if (r[1] + r[2] + r[3] === r[4] + r[5] + r[6]) return `${+r[3]} ${MONTHS_G[+r[2] - 1]} ${r[1]}`
  const a = `${+r[3]} ${MONTHS_G[+r[2] - 1]}${r[1] !== r[4] ? ' ' + r[1] : ''}`
  return `${a} – ${+r[6]} ${MONTHS_G[+r[5] - 1]} ${r[4]}`
}
const when = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(' г.', '')

export default function PeriodPicker({ periods, value, onChange, city = null }: { periods: PeriodMeta[]; value: string; onChange: (period: string) => void; city?: string | null }) {
  const { updateAll, updateStep, syncing, matrixPriceLabel, refreshMatrix } = useEdits()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'month' | 'days'>(MONTH_RE.test(value) ? 'month' : 'days')
  const today = ymd(new Date())
  const minYear = new Date().getFullYear() - 3 // не раньше трёх лет назад
  const vb = boundsOf(value)
  const [year, setYear] = useState(Number((vb?.a ?? today).slice(0, 4)))
  const [view, setView] = useState((vb?.a ?? today).slice(0, 7)) // месяц, показанный в календаре дней
  const [selA, setSelA] = useState<string | null>(null)
  const [selB, setSelB] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [snaps, setSnaps] = useState<{ period: string; tab?: string; fixed?: boolean; fixedTargets?: string[] }[]>([])
  const [busy, setBusy] = useState<'load' | 'fix' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  // и снимки всей сети, и снимки отдельных ресторанов (tab)
  const loadSnaps = () => { if (MATRIX_SNAPSHOTS) fetchMatrixSnapshots().then((r) => setSnaps([...(r?.periods ?? []).map((x) => ({ period: x.period, fixedTargets: x.fixedTargets ?? [] })), ...(r?.tabs ?? []).map((x) => ({ period: x.period, tab: x.tab, fixed: x.fixed }))])) }
  // при открытии — календарь на выбранном периоде, свежий список зафиксированных цен
  useEffect(() => {
    if (!open) return
    const b = boundsOf(value)
    setYear(Number((b?.a ?? today).slice(0, 4))); setView((b?.a ?? today).slice(0, 7))
    setSelA(b && !MONTH_RE.test(value) ? b.a : null); setSelB(b && !MONTH_RE.test(value) ? b.b : null)
    setTab(MONTH_RE.test(value) ? 'month' : 'days'); setMsg(null)
    loadSnaps()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const loaded = useMemo(() => new Map(periods.filter((p) => MONTH_RE.test(p.period)).map((p) => [p.period, p])), [periods])
  // месяц с зафиксированной матрицей: город целиком (fixedTargets) или отдельный ресторан за этот месяц
  const fixedIn = (month: string) => snaps.some((x) => x.period === month && (x.tab ? x.fixed : (x.fixedTargets?.length ?? 0) > 0))

  const pick = (p: string) => { onChange(p); setOpen(false) }
  // календарь дней
  const vy = +view.slice(0, 4), vm = +view.slice(5, 7)
  const firstDow = (new Date(vy, vm - 1, 1).getDay() + 6) % 7 // 0 — понедельник
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: lastDay(vy, vm) }, (_, i) => `${view}-${pad(i + 1)}`)]
  const shiftView = (d: number) => { let y = vy, m = vm + d; if (m < 1) { m = 12; y-- } if (m > 12) { m = 1; y++ } setView(`${y}-${pad(m)}`) }
  const clickDay = (d: string) => {
    if (!selA || selB) { setSelA(d); setSelB(null); return }
    if (d < selA) { setSelB(selA); setSelA(d) } else setSelB(d)
  }
  const endB = selB ?? (selA && hover && hover >= selA ? hover : null)
  const inSel = (d: string) => !!selA && d >= selA && d <= (endB ?? selA)
  const draft = selA ? keyOf(selA, selB ?? selA) : null
  // быстрые отрезки
  const now = new Date(); const dow = (now.getDay() + 6) % 7
  const monday = (back: number) => { const d = new Date(now); d.setDate(d.getDate() - dow - back * 7); return d }
  const plus = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
  const thisMonth = today.slice(0, 7)
  const prevMonth = (() => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` })()
  const quick: [string, string][] = [
    ['Эта неделя', keyOf(ymd(monday(0)), today)],
    ['Прошлая неделя', keyOf(ymd(monday(1)), ymd(plus(monday(1), 6)))],
    ['Этот месяц', thisMonth],
    ['Прошлый месяц', prevMonth],
  ]

  // состояние выбранного периода
  const need = monthsOf(value)
  const have = need.filter((m) => loaded.has(m))
  const missing = need.filter((m) => !loaded.has(m) && m <= thisMonth)
  const oldest = have.length ? Math.min(...have.map((m) => loaded.get(m)?.updatedAt ?? Infinity)) : null
  // фиксация матрицы — только целый месяц; город — из шапки (Проверка цен), иначе оба города
  const fixedCities = MONTH_RE.test(value) ? (snaps.find((x) => !x.tab && x.period === value)?.fixedTargets ?? []) : []
  const fixedTabs = MONTH_RE.test(value) ? snaps.filter((x) => x.tab && x.fixed && x.period === value).length : 0
  const exactFixed = fixedCities.length > 0
  const targets: ['Алматы' | 'Астана', 'astana' | undefined][] = city === 'Астана' ? [['Астана', 'astana']] : city === 'Алматы' ? [['Алматы', undefined]] : [['Алматы', undefined], ['Астана', 'astana']]
  const canFix = MATRIX_SNAPSHOTS && isAdmin && MONTH_RE.test(value) && value <= thisMonth
  const cityName = (t: string) => t === 'astana' ? 'Астана' : 'Алматы'

  const doLoad = async () => {
    setBusy('load'); setMsg(null)
    try { const r = await updateAll(city); setMsg({ ok: r.ok, text: r.message }) } finally { setBusy(null) }
  }
  const doFix = async () => {
    if (!vb || !MONTH_RE.test(value)) return
    const fresh = await fetchMatrixSnapshots() // свежий список: его мог изменить другой админ
    // старые фиксации за отрезки ВНУТРИ месяца (сеть и рестораны) заменяются месячной, только когда фиксируем оба города:
    // снимок сети хранит цены обоих городов, при фиксации одного города его удалять нельзя
    const both = targets.length === 2
    const inRange = (p: string) => { if (p === value) return false; const b = boundsOf(p); return !!b && b.a >= vb.a && b.b <= vb.b }
    const inside = both ? [
      ...(fresh?.periods ?? []).filter((x) => inRange(x.period)).map((x) => ({ period: x.period, label: x.periodLabel, tab: undefined as string | undefined })),
      ...(fresh?.tabs ?? []).filter((x) => inRange(x.period)).map((x) => ({ period: x.period, label: `${x.periodLabel} (${x.tab})`, tab: x.tab as string | undefined })),
    ] : []
    const who = targets.map(([n]) => n).join(' и ')
    const text = `Зафиксировать матрицу за ${periodTitle(value)} (${who})?\n\nСохранятся плановые цены, названия, товары, поставщики и кто на что назначен — как СЕЙЧАС в Google-таблице. Привязки остаются в Справочниках, закупки из iiko обновляются как обычно.` +
      (exactFixed ? '\n\nЗа этот месяц матрица уже зафиксирована — она заменится сегодняшней.' : '') +
      (inside.length ? `\n\nВнутри месяца есть фиксации за отрезки:\n${inside.map((x) => '• ' + x.label).join('\n')}\nОни будут удалены — их заменит месячная.` : '')
    if (!window.confirm(text)) return
    setBusy('fix'); setMsg(null)
    try {
      const problems: string[] = []; let done = 0
      for (const [name, target] of targets) {
        const r = await syncMatrix(target, value)
        if (r.ok) done++
        else if (!/ID таблицы/.test(r.message ?? '')) problems.push(`${name}: ${r.message ?? 'ошибка'}`)
      }
      // отрезки внутри месяца удаляем, только если записались ВСЕ выбранные таблицы
      if (done && !problems.length) for (const x of inside) if (!(await deleteMatrixSnapshot(x.period, x.tab))) problems.push(`не удалось удалить фиксацию «${x.label}» — удалите её в «Фиксация матрицы»`)
      await refreshMatrix(); loadSnaps()
      setMsg(problems.length || !done ? { ok: false, text: 'Не получилось полностью: ' + (problems.join('; ') || 'таблица Google не подключена') } : { ok: true, text: `Матрица за ${periodTitle(value)} зафиксирована (${who})` })
    } finally { setBusy(null) }
  }

  const label = MONTH_RE.test(value) || RANGE_RE.test(value) ? periodTitle(value) : (periods.find((p) => p.period === value)?.periodLabel ?? value)
  const tabBtn = (k: 'month' | 'days', t: string) => (
    <button onClick={() => setTab(k)} className={`flex-1 rounded-md py-1.5 text-xs font-medium ${tab === k ? 'bg-ink-700 text-fg-50' : 'text-fg-400 hover:text-fg-200'}`}>{t}</button>
  )
  const working = busy !== null || syncing

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn h-10 w-[200px] justify-between border border-ink-600 bg-ink-900/60 px-3 text-sm text-fg-100 hover:border-ink-500">
        <span className="flex min-w-0 items-center gap-1.5">
          <IClock className="shrink-0 text-brand-300" width={14} height={14} />
          <span className="truncate">{label}</span>
        </span>
        <IChevron className={`shrink-0 text-fg-500 transition-transform ${open ? 'rotate-90' : ''}`} width={13} height={13} />
      </button>

      {open && (
        <div className="animate-scale-in absolute right-0 z-30 mt-2 w-[330px] max-w-[calc(100vw-24px)] origin-top-right overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-card">
          <div className="flex gap-1 border-b border-ink-700/60 p-2">{tabBtn('month', 'Месяц')}{tabBtn('days', 'Свои даты')}</div>

          {tab === 'month' ? (
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <button onClick={() => setYear((y) => y - 1)} disabled={year <= minYear} className="grid h-7 w-7 place-items-center rounded-md text-fg-400 hover:bg-ink-800 disabled:opacity-30" aria-label="Прошлый год"><IChevron className="rotate-180" width={14} height={14} /></button>
                <span className="text-sm font-semibold text-fg-100">{year}</span>
                <button onClick={() => setYear((y) => y + 1)} disabled={year >= +today.slice(0, 4)} className="grid h-7 w-7 place-items-center rounded-md text-fg-400 hover:bg-ink-800 disabled:opacity-30" aria-label="Следующий год"><IChevron width={14} height={14} /></button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {MONTHS_S.map((n, i) => {
                  const k = `${year}-${pad(i + 1)}`
                  const future = k > thisMonth, on = value === k, isLoaded = loaded.has(k), isFixed = fixedIn(k)
                  return (
                    <button key={k} disabled={future} onClick={() => pick(k)}
                      title={future ? '' : `${MONTHS[i]} ${year}: ${isLoaded ? 'закупки загружены' : 'закупки ещё не загружены'}${isFixed ? ', матрица зафиксирована' : ''}`}
                      className={`relative flex h-11 flex-col items-center justify-center rounded-lg border text-sm transition-colors disabled:cursor-default disabled:opacity-30 ${on ? 'border-brand-400 bg-brand-500/20 text-fg-50' : 'border-ink-700 text-fg-200 hover:border-ink-500 hover:bg-ink-800'}`}>
                      <span>{n}</span>
                      <span className="mt-0.5 flex h-2.5 items-center gap-1">
                        {isLoaded && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                        {isFixed && <ILock className="text-amber-300" width={10} height={10} />}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-fg-500">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />закупки загружены</span>
                {MATRIX_SNAPSHOTS && <span className="flex items-center gap-1"><ILock className="text-amber-300" width={10} height={10} />матрица зафиксирована</span>}
              </div>
            </div>
          ) : (
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <button onClick={() => shiftView(-1)} disabled={vy <= minYear && vm === 1} className="grid h-7 w-7 place-items-center rounded-md text-fg-400 hover:bg-ink-800 disabled:opacity-30" aria-label="Прошлый месяц"><IChevron className="rotate-180" width={14} height={14} /></button>
                <span className="text-sm font-semibold text-fg-100">{MONTHS[vm - 1]} {vy}</span>
                <button onClick={() => shiftView(1)} disabled={view >= thisMonth} className="grid h-7 w-7 place-items-center rounded-md text-fg-400 hover:bg-ink-800 disabled:opacity-30" aria-label="Следующий месяц"><IChevron width={14} height={14} /></button>
              </div>
              <div className="grid grid-cols-7 text-center text-[11px] text-fg-500">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => <span key={d} className="py-1">{d}</span>)}</div>
              <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(null)}>
                {cells.map((d, i) => {
                  if (!d) return <span key={'e' + i} />
                  const future = d > today, sel = inSel(d), edge = d === selA || d === (endB ?? selA)
                  return (
                    <button key={d} disabled={future} onClick={() => clickDay(d)} onMouseEnter={() => setHover(d)}
                      className={`h-8 text-xs transition-colors disabled:opacity-25 ${edge ? 'rounded-md bg-brand-500 font-semibold text-white' : sel ? 'bg-brand-500/20 text-fg-50' : 'rounded-md text-fg-200 hover:bg-ink-800'} ${!loaded.has(d.slice(0, 7)) && !sel ? 'text-fg-500' : ''}`}>
                      {+d.slice(8)}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {quick.map(([t, k]) => <button key={t} onClick={() => pick(k)} className={`rounded-full border px-2.5 py-1 text-[11px] ${value === k ? 'border-brand-400 bg-brand-500/20 text-fg-50' : 'border-ink-600 text-fg-300 hover:border-ink-500'}`}>{t}</button>)}
              </div>
              <button onClick={() => draft && pick(draft)} disabled={!draft} className="btn mt-2 h-9 w-full border border-brand-500/50 bg-brand-500/15 text-xs text-fg-50 hover:bg-brand-500/25 disabled:opacity-50">
                {draft ? `Показать: ${periodTitle(draft)}` : 'Нажмите первый и последний день'}
              </button>
            </div>
          )}

          {/* что есть по выбранному периоду и что можно сделать */}
          <div className="space-y-2 border-t border-ink-700/60 bg-ink-900/40 px-3 py-3 text-xs">
            <div className="font-semibold text-fg-200">{label}</div>
            <div className="flex items-start gap-2">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${!missing.length && have.length ? 'bg-emerald-400' : have.length ? 'bg-amber-400' : 'bg-fg-600'}`} />
              <span className="text-fg-400">
                {!have.length ? 'Закупки из iiko ещё не загружены'
                  : missing.length ? `Закупки загружены не за все месяцы — нет: ${missing.map((m) => periodTitle(m)).join(', ')}`
                  : `Закупки из iiko загружены${oldest && Number.isFinite(oldest) ? ` · обновлено ${when(oldest)}` : ''}`}
              </span>
            </div>
            {MATRIX_SNAPSHOTS && (
              <div className="flex items-start gap-2">
                <ILock className={`mt-0.5 shrink-0 ${exactFixed ? 'text-amber-300' : 'text-fg-600'}`} width={11} height={11} />
                <span className="text-fg-400">{exactFixed ? `Матрица зафиксирована: ${fixedCities.map(cityName).join(', ')}` : `Матрица и цены берутся: ${matrixPriceLabel ?? '—'}`}{fixedTabs ? ` · отдельно зафиксировано ресторанов: ${fixedTabs}` : ''}</span>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={doLoad} disabled={working || need.length > 4} title={need.length > 4 ? 'За раз загружается до 4 месяцев — выберите период короче' : `Загрузить закупки из iiko за месяц(ы) этого периода (${city || 'все города'}) и прочитать названия из таблицы`}
                className="btn h-9 flex-1 border border-ink-600 bg-ink-900/60 text-xs text-fg-100 hover:border-ink-500 disabled:opacity-50">
                <ISync className={busy === 'load' ? 'animate-spin' : ''} width={13} height={13} />{have.length ? 'Обновить из iiko' : 'Загрузить из iiko'}{city ? ` (${city})` : ''}
              </button>
              {canFix && (
                <button onClick={doFix} disabled={working} title="Зафиксировать матрицу за этот месяц: цены, названия, товары, поставщики — как сейчас в таблице. Другие месяцы не меняются."
                  className="btn h-9 flex-1 border border-amber-500/40 bg-amber-500/10 text-xs text-fg-100 hover:bg-amber-500/20 disabled:opacity-50">
                  <ILock width={12} height={12} />{exactFixed ? 'Зафиксировать заново' : 'Зафиксировать матрицу'}
                </button>
              )}
            </div>
            {MATRIX_SNAPSHOTS && isAdmin && !MONTH_RE.test(value) && <p className="text-[11px] text-fg-500">Матрица фиксируется за целый месяц — выберите его на вкладке «Месяц».</p>}
            {busy && updateStep && <p className="text-[11px] text-fg-400">{updateStep}</p>}
            {busy === 'fix' && <p className="text-[11px] text-fg-400">Фиксирую матрицу…</p>}
            {msg && <p className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-amber-300'}`}>{msg.text}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
