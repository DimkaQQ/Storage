import { useEffect, useRef, useState } from 'react'

/**
 * Как EditableText, но с выпадающим списком их вариантов названия товара —
 * один и тот же товар из iiko может называться у разных поставщиков
 * по-разному, так что у каждой подсказки виден свой поставщик, чтобы не
 * перепутать, откуда какое описание.
 */
export default function ProductLabelSuggest({
  value, suggestions, onCommit,
}: {
  value: string
  suggestions: { label: string; supplier: string }[]
  onCommit: (v: string) => void
}) {
  const [v, setV] = useState(value)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setV(value), [value])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const commit = (next: string) => {
    setV(next)
    onCommit(next)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <input
        value={v}
        title={v}
        onFocus={() => setOpen(true)}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onCommit(v)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-full max-w-md rounded-md border border-ink-700/50 bg-ink-900/40 px-2 py-1 text-sm text-slate-100 transition-colors hover:border-ink-500 focus:border-brand-500 focus:bg-ink-900/70 focus:outline-none"
      />
      {open && suggestions.length > 0 && (
        <div className="animate-scale-in absolute left-0 z-30 mt-1 max-h-64 w-80 overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 shadow-card">
          {suggestions.map((s, i) => (
            <button
              key={i}
              // onMouseDown (не onClick) + preventDefault — иначе onBlur инпута
              // срабатывает раньше клика и закрывает список до выбора.
              onMouseDown={(e) => { e.preventDefault(); commit(s.label) }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-ink-800"
            >
              <span className="w-full truncate text-sm text-slate-200">{s.label}</span>
              <span className="w-full truncate text-[11px] text-slate-500">{s.supplier}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
