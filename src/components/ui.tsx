import { ReactNode } from 'react'
import { STATUS_META, Status } from '../lib/data'

export function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status]
  return (
    <span className={`chip border-transparent bg-ink-750/70 ${m.color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}

export function AbcBadge({ abc }: { abc: 'A' | 'B' | 'C' }) {
  const map = {
    A: 'text-brand-300 border-brand-500/40 bg-brand-500/10',
    B: 'text-warn border-warn/30 bg-warn/10',
    C: 'text-slate-400 border-ink-600 bg-ink-750/60',
  }
  return <span className={`chip ${map[abc]}`}>{abc}</span>
}

export function Delta({ value, invert = false }: { value: number; invert?: boolean }) {
  // value>0 shown green unless invert (for overpay context)
  const positive = invert ? value < 0 : value > 0
  const neutral = value === 0
  const cls = neutral ? 'text-slate-400' : positive ? 'text-good' : 'text-bad'
  return <span className={`tabnum font-semibold ${cls}`}>{value >= 0 ? '+' : '−'}{Math.abs(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</span>
}

export function Section({ title, subtitle, right, children, className = '' }: {
  title?: string; subtitle?: string; right?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-100">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-sm text-slate-500">{children}</div>
}
