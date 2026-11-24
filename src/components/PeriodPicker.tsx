import { useEffect, useRef, useState } from 'react'
import { PeriodMeta } from '../lib/api'
import { IClock, IChevron, ICheck } from './icons'

/**
 * Выбор периода — одиночный выбор: в списке отмечен текущий период,
 * клик по другому сразу его выбирает и закрывает меню.
 */
export default function PeriodPicker({
  periods, value, onChange,
}: {
  periods: PeriodMeta[]
  value: string
  onChange: (period: string) => void
}) {
  const [open, setOpen] = useState(false)
  const m0 = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(value)
  const [from, setFrom] = useState(m0?.[1] ?? '')
  const [to, setTo] = useState(m0?.[2] ?? '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setFrom(m0?.[1] ?? ''); setTo(m0?.[2] ?? '') }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])


  const ordered = [...periods].reverse() // свежие сверху
  const current = periods.find((p) => p.period === value)
  const label = current?.periodLabel ?? rangeLabel(value)
  // Календарь не ограничен загруженными месяцами: можно выбрать любые даты до сегодняшних, а недостающий месяц подтягивает кнопка «Обновить»
  const minDate = `${new Date().getFullYear() - 3}-01-01` // не раньше трёх лет назад
  const maxDate = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}` })()
  const apply = () => { if (from && to && from <= to) { onChange(`${from}..${to}`); setOpen(false) } }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn w-[190px] justify-between border border-ink-600 bg-ink-800/80 px-2.5 py-2 text-xs text-fg-200 hover:border-brand-500/50 hover:bg-ink-750 hover:text-fg-50"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <IClock className="shrink-0 text-brand-300" width={14} height={14} />
          <span className="truncate">{label}</span>
        </span>
        <IChevron className={`shrink-0 text-fg-500 transition-transform ${open ? 'rotate-90' : ''}`} width={13} height={13} />
      </button>

      {open && (
        <div className="animate-scale-in absolute right-0 z-30 mt-2 w-72 origin-top-right overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-card">
          <div className="border-b border-ink-700/60 px-3 py-2">
            <span className="text-xs font-semibold text-fg-400">Период</span>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {ordered.map((p) => {
              const on = p.period === value
              return (
                <button
                  key={p.period}
                  onClick={() => { onChange(p.period); setOpen(false) }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-800 ${on ? 'text-fg-50' : 'text-fg-300'}`}
                >
                  <span className={`grid h-4 w-4 place-items-center rounded-full border ${on ? 'border-brand-400 bg-brand-500/20' : 'border-ink-600'}`}>
                    {on && <ICheck className="text-brand-300" width={12} height={12} />}
                  </span>
                  <span className="flex-1 truncate">{p.periodLabel}</span>
                </button>
              )
            })}
          </div>
          <div className="space-y-2 border-t border-ink-700/60 px-3 py-3">
            <span className="text-xs font-semibold text-fg-400">Свои даты</span>
            <div className="grid grid-cols-2 gap-2">
              <DateBox label="С" value={from} min={minDate} max={to || maxDate} onChange={setFrom} />
              <DateBox label="По" value={to} min={from || minDate} max={maxDate} onChange={setTo} />
            </div>
            <button onClick={apply} disabled={!from || !to || from > to} className="btn h-9 w-full border border-brand-500/50 bg-brand-500/15 text-xs text-fg-50 hover:bg-brand-500/25 disabled:opacity-50">Показать за эти даты</button>
            <p className="text-[11px] leading-snug text-fg-500">Дни берутся из загруженных месяцев. Если месяца ещё нет или он загружен давно, нажмите «Обновить» в Проверке цен — он загрузится из iiko вместе с раскладкой по дням.</p>
          </div>
        </div>
      )}
    </div>
  )
}

const MONTHS_G = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
/** «5 ноя – 12 ноя 2026» для отрезка, который не лежит в списке загруженных периодов. */
function rangeLabel(v: string): string {
  const r = /^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!r) return v
  const a = `${+r[3]} ${MONTHS_G[+r[2] - 1]}`, b = `${+r[6]} ${MONTHS_G[+r[5] - 1]} ${r[4]}`
  return a === b.replace(` ${r[4]}`, '') ? b : `${a} – ${b}`
}

/** Поле даты: свой текст по центру, а настоящий input лежит сверху невидимым (родное поле даты в Safari/iOS рисуется криво). */
function DateBox({ label, value, min, max, onChange }: { label: string; value: string; min?: string; max?: string; onChange: (v: string) => void }) {
  const shown = value ? new Date(value + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).replace(' г.', '') : 'Выбрать'
  return (
    <div className="block min-w-0 text-[11px] text-fg-500">
      <span className="block">{label}</span>
      <div className="relative mt-1 h-9 rounded-lg border border-ink-600 bg-ink-900/60 focus-within:border-brand-500">
        <div className={`pointer-events-none flex h-full items-center px-2 text-xs ${value ? 'text-fg-100' : 'text-fg-600'}`}><span className="truncate">{shown}</span></div>
        <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)}
          onClick={(e) => { try { e.currentTarget.showPicker?.() } catch { /* откроется само */ } }}
          aria-label={label} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </div>
    </div>
  )
}
