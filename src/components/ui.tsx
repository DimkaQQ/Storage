import { ReactNode } from 'react'
import { STATUS_META, Status } from '../lib/data'
import { useCountUp } from '../lib/hooks'

/** A number that counts up smoothly whenever `value` changes. */
export function AnimatedNumber({ value, format, duration = 900 }: {
  value: number; format: (n: number) => string; duration?: number
}) {
  const n = useCountUp(value, duration)
  return <>{format(n)}</>
}

/** Wraps children in a staggered fade-up entrance. */
export function Reveal({ delay = 0, className = '', children }: {
  delay?: number; className?: string; children: ReactNode
}) {
  return (
    <div className={`animate-fade-up ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

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

export function Section({ title, subtitle, right, children, className = '', delay }: {
  title?: string; subtitle?: string; right?: ReactNode; children: ReactNode; className?: string; delay?: number
}) {
  return (
    <section
      className={`card p-5 ${delay != null ? 'animate-fade-up' : ''} ${className}`}
      style={delay != null ? { animationDelay: `${delay}ms` } : undefined}
    >
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
