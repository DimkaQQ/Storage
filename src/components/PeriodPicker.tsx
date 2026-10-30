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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  if (periods.length <= 1) return null // нечего переключать — один период и так виден в шапке

  const ordered = [...periods].reverse() // свежие сверху
  const current = periods.find((p) => p.period === value)
  const label = current?.periodLabel ?? value

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn w-[150px] justify-between border border-ink-600 bg-ink-800/80 px-2.5 py-2 text-xs text-fg-200 hover:border-brand-500/50 hover:bg-ink-750 hover:text-fg-50"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <IClock className="shrink-0 text-fg-500" width={14} height={14} />
          <span className="truncate">{label}</span>
        </span>
        <IChevron className={`shrink-0 text-fg-500 transition-transform ${open ? 'rotate-90' : ''}`} width={13} height={13} />
      </button>

      {open && (
        <div className="animate-scale-in absolute right-0 z-30 mt-2 w-56 origin-top-right overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-card">
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
        </div>
      )}
    </div>
  )
}
