import { useEffect, useMemo, useRef, useState } from 'react'
import { PeriodMeta, fetchMonthFixes, MonthFixMeta } from '../lib/api'
import { useEdits } from '../lib/edits'
import { useAuth } from '../lib/auth'
import { MATRIX_SNAPSHOTS } from '../lib/features'
import { IClock, IChevron, ILock, ISync } from './icons'

/**
 * Выбор периода — ОДИН календарь вместо списка загрузок («Октябрь 2026», «1–31 октября», «25–27 октября» путали, какая
 * из них правильная). Вкладка «Месяц» — 12 месяцев года с отметками (● закупки загружены, замок — цены зафиксированы),
 * «Даты» — календарь дней: первый клик — начало, второй — конец. Любой отрезок собирается из загруженных месяцев
 * (сервер: /api/data → composeRange). Внизу — что есть по выбранному периоду и две кнопки: «Загрузить из iiko»
 * (та же updateAll, что «Обновить» в Проверке цен) и для админа «Зафиксировать цены» (снимок матрицы за период, обе таблицы).
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
  const { updateAll, updateStep, syncing, matrixPriceLabel, fixMonth, unfixMonth } = useEdits()
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
  const [fixes, setFixes] = useState<MonthFixMeta[]>([])
  const [busy, setBusy] = useState<'load' | 'fix' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const loadFixes = () => { if (MATRIX_SNAPSHOTS) fetchMonthFixes().then((r) => setFixes(r?.months ?? [])) }
  // при открытии — календарь на выбранном периоде, свежий список зафиксированных цен
  useEffect(() => {
    if (!open) return
    const b = boundsOf(value)
    setYear(Number((b?.a ?? today).slice(0, 4))); setView((b?.a ?? today).slice(0, 7))
    setSelA(b && !MONTH_RE.test(value) ? b.a : null); setSelB(b && !MONTH_RE.test(value) ? b.b : null)
    setTab(MONTH_RE.test(value) ? 'month' : 'days'); setMsg(null)
    loadFixes()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const loaded = useMemo(() => new Map(periods.filter((p) => MONTH_RE.test(p.period)).map((p) => [p.period, p])), [periods])
  const fixedMap = useMemo(() => new Map(fixes.map((f) => [f.month, f])), [fixes])

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
  // цены за ровно этот период (снимок с теми же границами, ключ «ГГГГ-ММ» или «с..по» — всё равно) у всей сети
  // зафиксированный месяц: выбран сам месяц или отрезок внутри одного месяца
  const fixMonthKey = MONTH_RE.test(value) ? value : vb && vb.a.slice(0, 7) === vb.b.slice(0, 7) ? vb.a.slice(0, 7) : null
  const fixInfo = fixMonthKey ? fixedMap.get(fixMonthKey) : undefined
  const fixedNeed = need.filter((m) => fixedMap.has(m))
  const canFix = MATRIX_SNAPSHOTS && isAdmin && MONTH_RE.test(value) && value < thisMonth && have.length > 0

  const doLoad = async () => {
    setBusy('load'); setMsg(null)
    try { const r = await updateAll(city); setMsg({ ok: r.ok, text: r.message }) } finally { setBusy(null) }
  }
  const doFix = async () => {
    const t = `Зафиксировать ${periodTitle(value)}?\n\nСохранится всё как сейчас: матрица из Google-таблицы (цены, названия, товары, кто на что назначен), привязки из Справочников и закупки из iiko. Месяц будет показываться именно таким, а загрузка из iiko за него — отключена, пока фиксацию не снимут.` +
      (fixInfo ? '\n\nМесяц уже зафиксирован — прежняя фиксация заменится сегодняшним состоянием.' : '')
    if (!window.confirm(t)) return
    setBusy('fix'); setMsg(null)
    try { const r = await fixMonth(value); setMsg({ ok: r.ok, text: r.message }); loadFixes() } finally { setBusy(null) }
  }
  const doUnfix = async () => {
    if (!window.confirm(`Снять фиксацию «${periodTitle(value)}»? Месяц снова будет показываться по текущим привязкам и закупкам, и его можно будет обновить из iiko. Цены матрицы за месяц останутся.`)) return
    setBusy('fix'); setMsg(null)
    try { const r = await unfixMonth(value); setMsg({ ok: r.ok, text: r.message }); loadFixes() } finally { setBusy(null) }
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
                  const future = k > thisMonth, on = value === k, isLoaded = loaded.has(k), isFixed = fixedMap.has(k)
                  return (
                    <button key={k} disabled={future} onClick={() => pick(k)}
                      title={future ? '' : `${MONTHS[i]} ${year}: ${isFixed ? 'месяц зафиксирован' : isLoaded ? 'закупки загружены' : 'закупки ещё не загружены'}`}
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
                {MATRIX_SNAPSHOTS && <span className="flex items-center gap-1"><ILock className="text-amber-300" width={10} height={10} />месяц зафиксирован</span>}
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
                <ILock className={`mt-0.5 shrink-0 ${fixInfo ? 'text-amber-300' : 'text-fg-600'}`} width={11} height={11} />
                <span className="text-fg-400">
                  {fixInfo ? `Месяц зафиксирован${fixInfo.fixedAt ? ' ' + when(Date.parse(fixInfo.fixedAt)) : ''}${fixInfo.by ? ` (${fixInfo.by})` : ''} — матрица, привязки и закупки как на тот момент`
                    : `Не зафиксирован · цены берутся: ${matrixPriceLabel ?? '—'}`}
                </span>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={doLoad} disabled={working || need.length > 4 || fixedNeed.length > 0}
                title={fixedNeed.length ? 'Месяц зафиксирован — загрузка из iiko за него отключена. Снимите фиксацию, чтобы обновить.' : need.length > 4 ? 'За раз загружается до 4 месяцев — выберите период короче' : `Загрузить закупки из iiko за месяц(ы) этого периода (${city || 'все города'}) и прочитать названия из таблицы`}
                className="btn h-9 flex-1 border border-ink-600 bg-ink-900/60 text-xs text-fg-100 hover:border-ink-500 disabled:opacity-50">
                <ISync className={busy === 'load' ? 'animate-spin' : ''} width={13} height={13} />{have.length ? 'Обновить из iiko' : 'Загрузить из iiko'}{city ? ` (${city})` : ''}
              </button>
              {canFix && (
                <button onClick={doFix} disabled={working} title="Сохранить месяц целиком: матрицу (цены, названия, товары), привязки и закупки. Другие месяцы не меняются."
                  className="btn h-9 flex-1 border border-amber-500/40 bg-amber-500/10 text-xs text-fg-100 hover:bg-amber-500/20 disabled:opacity-50">
                  <ILock width={12} height={12} />{fixInfo ? 'Зафиксировать заново' : 'Зафиксировать месяц'}
                </button>
              )}
            </div>
            {isAdmin && fixInfo && MONTH_RE.test(value) && <button onClick={doUnfix} disabled={working} className="text-[11px] text-fg-500 underline-offset-2 hover:text-fg-300 hover:underline disabled:opacity-50">Снять фиксацию месяца</button>}
            {MATRIX_SNAPSHOTS && isAdmin && !MONTH_RE.test(value) && <p className="text-[11px] text-fg-500">Зафиксировать можно только целый месяц — выберите его на вкладке «Месяц».</p>}
            {MATRIX_SNAPSHOTS && isAdmin && value === thisMonth && <p className="text-[11px] text-fg-500">Текущий месяц ещё идёт — зафиксировать его можно после окончания.</p>}
            {busy && updateStep && <p className="text-[11px] text-fg-400">{updateStep}</p>}
            {busy === 'fix' && <p className="text-[11px] text-fg-400">Фиксирую месяц: читаю таблицу, сохраняю привязки и закупки…</p>}
            {msg && <p className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-amber-300'}`}>{msg.text}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
