import { useEffect, useRef, useState } from 'react'
import { IChevron, ICheck } from './icons'

interface Props {
  label: string
  value: string | null // null = «Все»
  options: string[]
  onChange: (v: string | null) => void
}

/** Compact single-select dropdown — replaces a long row of city/category toggle buttons. */
export default function FilterDropdown({ label, value, options, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const pick = (v: string | null) => { onChange(v); setOpen(false) }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`btn w-[110px] justify-between border px-3 py-2 text-xs ${
          value ? 'border-brand-500/50 bg-brand-500/10 text-brand-200' : 'border-ink-600 bg-ink-800/80 text-slate-300 hover:border-brand-500/50 hover:text-white'
        }`}
        title={label}
      >
        <span className="truncate">{value ?? 'Все'}</span>
        <IChevron className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} width={13} height={13} />
      </button>

      {open && (
        <div className="animate-scale-in absolute left-0 z-30 mt-2 max-h-72 w-52 origin-top-left overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 shadow-card">
          <div className="border-b border-ink-700/60 px-3 py-2 text-xs font-semibold text-slate-400">{label}</div>
          <button
            onClick={() => pick(null)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-800 ${value === null ? 'text-white' : 'text-slate-300'}`}
          >
            <span className="flex-1">Все</span>
            {value === null && <ICheck width={14} height={14} className="text-brand-300" />}
          </button>
          {options.map((o) => (
            <button
              key={o}
              onClick={() => pick(o)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-800 ${value === o ? 'text-white' : 'text-slate-300'}`}
            >
              <span className="min-w-0 flex-1 truncate">{o}</span>
              {value === o && <ICheck width={14} height={14} className="shrink-0 text-brand-300" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
