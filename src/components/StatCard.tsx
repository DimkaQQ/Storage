import type { LucideIcon } from 'lucide-react'

type Props = {
  title: string
  value: string | number
  subtitle?: string
  icon: LucideIcon
  color: string
  trend?: { value: number; label: string }
}

export default function StatCard({ title, value, subtitle, icon: Icon, color, trend }: Props) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`p-3 rounded-xl ${color} flex-shrink-0`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-500 font-medium">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        {trend && (
          <p className={`text-xs mt-1 font-medium ${trend.value >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
          </p>
        )}
      </div>
    </div>
  )
}
