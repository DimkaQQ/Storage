import { useEffect, useRef, useState } from 'react'
import { PeriodMeta } from '../lib/api'
import { IClock, IChevron, ICheck } from './icons'

/** Single-select month switcher — always exactly one period selected, no "все" option. */
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

  const current = periods.find((p) => p.period === value)
  if (periods.length <= 1) return null // нечего переключать — один период и так виден в шапке

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn w-[150px] justify-between border border-ink-600 bg-ink-800/80 px-2.5 py-2 text-xs text-slate-200 hover:border-brand-500/50 hover:text-white"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <IClock className="shrink-0 text-slate-500" width={14} height={14} />
          <span className="truncate">{current?.periodLabel ?? value}</span>
        </span>
        <IChevron className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} width={13} height={13} />
      </button>

      {open && (
        <div className="animate-scale-in absolute right-0 z-30 mt-2 w-48 origin-top-right overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-card">
          <div className="border-b border-ink-700/60 px-3 py-2 text-xs font-semibold text-slate-400">Период</div>
          {[...periods].reverse().map((p) => (
            <button
              key={p.period}
              onClick={() => { onChange(p.period); setOpen(false) }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-800 ${p.period === value ? 'text-white' : 'text-slate-300'}`}
            >
              <span className="flex-1 truncate">{p.periodLabel}</span>
              {p.period === value && <ICheck width={14} height={14} className="shrink-0 text-brand-300" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
