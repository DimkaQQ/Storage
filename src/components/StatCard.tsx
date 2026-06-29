import type { LucideIcon } from 'lucide-react'

type Props = {
  title: string
  value: string | number
  subtitle?: string
  icon: LucideIcon
  color?: string
  trend?: { value: number; label: string }
  danger?: boolean
}

export default function StatCard({ title, value, subtitle, icon: Icon, danger, trend }: Props) {
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{title}</p>
        <Icon className="w-4 h-4 flex-shrink-0" style={{ color: danger ? '#ef4444' : 'var(--gold)' }} />
      </div>
      <p
        className="text-2xl font-bold"
        style={{ color: danger ? '#ef4444' : 'var(--white)', fontFamily: "'Instrument Serif', serif" }}
      >
        {value}
      </p>
      {subtitle && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
      {trend && (
        <p className="text-xs mt-1 font-medium" style={{ color: trend.value >= 0 ? '#22c55e' : '#ef4444' }}>
          {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
        </p>
      )}
    </div>
  )
}
