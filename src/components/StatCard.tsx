import { ReactNode } from 'react'
import { InfoTip } from './ui'

export default function StatCard({
  label, value, sub, accent = 'brand', icon, delay = 0, info, infoAlign = 'left',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  accent?: 'brand' | 'good' | 'bad' | 'warn' | 'slate'
  icon?: ReactNode
  delay?: number
  info?: ReactNode
  infoAlign?: 'center' | 'left' | 'right'
}) {
  const ring: Record<string, string> = {
    brand: 'from-brand-500/20', good: 'from-good/20', bad: 'from-bad/20',
    warn: 'from-warn/20', slate: 'from-slate-500/10',
  }
  const ic: Record<string, string> = {
    brand: 'text-brand-300 bg-brand-500/10', good: 'text-good bg-good/10',
    bad: 'text-bad bg-bad/10', warn: 'text-warn bg-warn/10', slate: 'text-slate-300 bg-ink-750',
  }
  return (
    <div className="card card-hover animate-fade-up relative overflow-hidden p-5" style={{ animationDelay: `${delay}ms` }}>
      <div className={`pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-gradient-to-b ${ring[accent]} to-transparent blur-xl`} />
      <div className="flex min-h-[2.5rem] items-start justify-between gap-2">
        <span className="flex items-start gap-1.5 text-xs font-medium leading-snug text-slate-500">
          <span>{label}</span>
          {info && <InfoTip text={info} align={infoAlign} className="mt-0.5" />}
        </span>
        {icon && <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${ic[accent]}`}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-bold tabnum text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}
