import { ReactNode } from 'react'
import { moneyShort } from '../lib/data'

// Palette — one coherent system (see dataviz guidance).
export const C = {
  brand: '#5b8bff',
  good: '#2fd2a5',
  bad: '#ff5d73',
  warn: '#ffb547',
  purple: '#a889ff',
  grid: '#232f4a',
  axis: '#64748b',
}

export const SERIES = ['#5b8bff', '#2fd2a5', '#ffb547', '#a889ff', '#ff5d73', '#38bdf8', '#f472b6', '#84cc16']

export function ChartTip({ active, payload, label, money = true }: any) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-850/95 px-3 py-2 shadow-xl backdrop-blur">
      {label != null && <div className="mb-1 text-xs font-semibold text-slate-200">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-400">{p.name}</span>
          <span className="ml-auto font-semibold tabnum text-slate-100">
            {money ? moneyShort(p.value) : p.value.toLocaleString('ru-RU')}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; value?: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
          <span className="text-slate-400">{it.label}</span>
          {it.value != null && <span className="font-semibold tabnum text-slate-200">{it.value}</span>}
        </div>
      ))}
    </div>
  )
}
