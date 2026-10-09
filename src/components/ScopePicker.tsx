import { useEffect, useRef, useState } from 'react'
import { IStore, IChevron, ICheck, IClose } from './icons'

export default function ScopePicker({
  options, selected, onChange,
}: {
  options: string[]
  selected: Set<string>
  onChange: (s: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const toggle = (name: string) => {
    const next = new Set(selected)
    next.has(name) ? next.delete(name) : next.add(name)
    onChange(next)
  }

  const label =
    selected.size === 0 ? 'Все точки (консолидировано)' :
    selected.size === 1 ? [...selected][0] :
    `${selected.size} точек выбрано`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn w-[240px] justify-between border border-ink-600 bg-ink-800/80 text-slate-200 hover:border-ink-600/80 hover:bg-ink-750"
      >
        <span className="flex min-w-0 items-center gap-2">
          <IStore className="shrink-0 text-brand-300" width={16} height={16} />
          <span className="truncate">{label}</span>
        </span>
        <IChevron className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} width={16} height={16} />
      </button>

      {open && (
        <div className="animate-scale-in absolute right-0 z-30 mt-2 w-72 origin-top-right overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-card">
          <div className="flex items-center justify-between border-b border-ink-700/60 px-3 py-2">
            <span className="text-xs font-semibold text-slate-400">Выбор точек</span>
            {selected.size > 0 && (
              <button onClick={() => onChange(new Set())} className="flex items-center gap-1 text-[11px] text-brand-300 hover:text-brand-200">
                <IClose width={12} height={12} /> сбросить
              </button>
            )}
          </div>
          <button
            onClick={() => onChange(new Set())}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-800 ${
              selected.size === 0 ? 'text-white' : 'text-slate-300'
            }`}
          >
            <span className="grid h-4 w-4 place-items-center rounded border border-ink-600">
              {selected.size === 0 && <ICheck className="text-brand-300" width={12} height={12} />}
            </span>
            Все точки (консолидировано)
          </button>
          <div className="max-h-72 overflow-y-auto py-1">
            {options.map((o) => {
              const on = selected.has(o)
              return (
                <button
                  key={o}
                  onClick={() => toggle(o)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-800 ${on ? 'text-white' : 'text-slate-300'}`}
                >
                  <span className={`grid h-4 w-4 place-items-center rounded border ${on ? 'border-brand-400 bg-brand-500/20' : 'border-ink-600'}`}>
                    {on && <ICheck className="text-brand-300" width={12} height={12} />}
                  </span>
                  <span className="truncate">{o}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
