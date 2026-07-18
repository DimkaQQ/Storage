import { useEffect, useState } from 'react'

/** Text input that commits on blur / Enter; syncs when the external value changes. */
export function EditableText({ value, onCommit, className = '' }: {
  value: string; onCommit: (v: string) => void; className?: string
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      value={v}
      title={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={`w-full max-w-md rounded-md border border-ink-700/50 bg-ink-900/40 px-2 py-1 text-sm text-slate-100 transition-colors hover:border-ink-500 focus:border-brand-500 focus:bg-ink-900/70 focus:outline-none ${className}`}
    />
  )
}

/** Numeric plan-price input. Empty value clears the override. */
export function EditablePlan({ value, placeholder, onCommit, highlighted }: {
  value: string; placeholder?: string; onCommit: (v: number | null) => void; highlighted?: boolean
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => {
    const s = v.trim().replace(/\s/g, '').replace(',', '.')
    if (s === '') return onCommit(null)
    const n = parseFloat(s)
    onCommit(isFinite(n) ? n : null)
  }
  return (
    <input
      value={v}
      inputMode="decimal"
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={`w-28 rounded-md border bg-ink-900/40 px-2 py-1 text-right text-sm tabnum text-slate-100 transition-colors hover:border-ink-600 focus:border-brand-500 focus:bg-ink-900/70 focus:outline-none ${highlighted ? 'border-brand-500/40' : 'border-transparent'}`}
    />
  )
}
