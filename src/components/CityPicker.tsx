import { useEffect, useRef, useState } from 'react'
import { IPin, IChevron, ICheck, IClose } from './icons'

/**
 * Выбор города — ОДИН город (radio-поведение), но визуально точно как
 * ScopePicker (выбор точек): та же кнопка, панель со списком, синяя
 * подсветка выбранного. Пустое значение = «Все города».
 */
export default function CityPicker({
  options, selected, onChange,
}: {
  options: string[]
  selected: string | null // null = все города
  onChange: (city: string | null) => void
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

  const label = selected ?? 'Все города'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`btn w-[200px] justify-between border bg-ink-800/80 hover:bg-ink-750 ${
          selected
            ? 'border-brand-500/60 text-fg-50'
            : 'border-ink-600 text-fg-200 hover:border-ink-600/80'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <IPin className="shrink-0 text-brand-300" width={16} height={16} />
          <span className="truncate">{label}</span>
        </span>
        <IChevron className={`shrink-0 text-fg-500 transition-transform ${open ? 'rotate-90' : ''}`} width={16} height={16} />
      </button>

      {open && (
        <div className="animate-scale-in absolute right-0 z-30 mt-2 w-64 origin-top-right overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-card">
          <div className="flex items-center justify-between border-b border-ink-700/60 px-3 py-2">
            <span className="text-xs font-semibold text-fg-400">Выбор города</span>
            {selected && (
              <button onClick={() => onChange(null)} className="flex items-center gap-1 text-[11px] text-brand-300 hover:text-brand-200">
                <IClose width={12} height={12} /> сбросить
              </button>
            )}
          </div>
          <button
            onClick={() => onChange(null)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-800 ${
              !selected ? 'text-fg-50' : 'text-fg-300'
            }`}
          >
            <span className="grid h-4 w-4 place-items-center rounded border border-ink-600">
              {!selected && <ICheck className="text-brand-300" width={12} height={12} />}
            </span>
            Все города
          </button>
          <div className="max-h-72 overflow-y-auto py-1">
            {options.map((o) => {
              const on = selected === o
              return (
                <button
                  key={o}
                  onClick={() => onChange(o)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-800 ${on ? 'text-fg-50' : 'text-fg-300'}`}
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
