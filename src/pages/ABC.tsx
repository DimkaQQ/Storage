import { useMemo } from 'react'
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  ComposedChart, Line,
} from 'recharts'
import { Row, money, moneyShort, fmt, fmt1 } from '../lib/data'
import { Section, AbcBadge } from '../components/ui'
import { C } from '../components/charts'

type Cls = 'A' | 'B' | 'C'

export default function ABC({ rows }: { rows: Row[] }) {
  // ABC by spend within the current scope (aggregated by product across restaurants).
  const { groups, classInfo, pareto } = useMemo(() => {
    const byProduct = new Map<string, { product: string; sum: number; qty: number; rows: Row[] }>()
    for (const r of rows) {
      const g = byProduct.get(r.product) || { product: r.product, sum: 0, qty: 0, rows: [] }
      g.sum += r.sum; g.qty += r.qty; g.rows.push(r)
      byProduct.set(r.product, g)
    }
    const list = [...byProduct.values()].sort((a, b) => b.sum - a.sum)
    const total = list.reduce((s, g) => s + g.sum, 0) || 1
    let cum = 0
    const groups = list.map((g) => {
      cum += g.sum
      const share = cum / total
      const cls: Cls = share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C'
      return { ...g, cls, share }
    })
    const classInfo: Record<Cls, { count: number; sum: number }> = {
      A: { count: 0, sum: 0 }, B: { count: 0, sum: 0 }, C: { count: 0, sum: 0 },
    }
    for (const g of groups) { classInfo[g.cls].count++; classInfo[g.cls].sum += g.sum }
    // pareto sample — top products with cumulative %
    const pareto = groups.slice(0, 24).map((g) => ({ name: g.product, sum: g.sum, cum: g.share * 100 }))
    return { groups, classInfo, pareto, total }
  }, [rows])

  const totalSum = classInfo.A.sum + classInfo.B.sum + classInfo.C.sum || 1
  const totalCount = classInfo.A.count + classInfo.B.count + classInfo.C.count || 1

  const clsMeta: Record<Cls, { color: string; desc: string }> = {
    A: { color: C.brand, desc: 'критично важные — 80% затрат' },
    B: { color: C.warn, desc: 'средние — следующие 15%' },
    C: { color: '#64748b', desc: 'малозначимые — последние 5%' },
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {(['A', 'B', 'C'] as Cls[]).map((cls, i) => {
          const ci = classInfo[cls]
          return (
            <div key={cls} className="card card-hover animate-fade-up p-5" style={{ animationDelay: `${i * 70}ms` }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl text-lg font-bold" style={{ background: clsMeta[cls].color + '22', color: clsMeta[cls].color }}>{cls}</span>
                  <div>
                    <div className="text-sm font-semibold text-white">Группа {cls}</div>
                    <div className="text-[11px] text-slate-500">{clsMeta[cls].desc}</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <div className="text-xl font-bold tabnum text-white">{moneyShort(ci.sum)}</div>
                  <div className="text-[11px] text-slate-500">{fmt((ci.sum / totalSum) * 100)}% затрат</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold tabnum text-slate-200">{fmt(ci.count)}</div>
                  <div className="text-[11px] text-slate-500">{fmt((ci.count / totalCount) * 100)}% позиций</div>
                </div>
              </div>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-ink-750">
                <div className="animate-grow-x h-full rounded-full" style={{ width: `${(ci.sum / totalSum) * 100}%`, background: clsMeta[cls].color }} />
              </div>
            </div>
          )
        })}
      </div>

      <Section delay={220} title="Кривая Парето" subtitle="Топ-24 товара по сумме закупки и накопленная доля затрат">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pareto} margin={{ left: 8, right: 8, top: 8, bottom: 60 }}>
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis dataKey="name" angle={-40} textAnchor="end" interval={0} height={70} tick={{ fill: C.axis, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tickFormatter={(v) => moneyShort(v)} tick={{ fill: C.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tickFormatter={(v) => v + '%'} tick={{ fill: C.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<ParetoTip />} />
              <Bar yAxisId="l" dataKey="sum" name="Сумма" radius={[3, 3, 0, 0]} barSize={16}>
                {pareto.map((_, i) => <Cell key={i} fill={C.brand} />)}
              </Bar>
              <Line yAxisId="r" dataKey="cum" name="Накоплено" stroke={C.warn} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section delay={300} title="Группа A — фокус контроля цен" subtitle="Товары, формирующие 80% закупок. Здесь любое отклонение цены даёт максимальный эффект.">
        <div className="overflow-hidden rounded-xl border border-ink-700/50">
          <table className="w-full">
            <thead className="bg-ink-800/50">
              <tr>
                <th className="th text-center">ABC</th>
                <th className="th">Товар</th>
                <th className="th text-right">Кол-во</th>
                <th className="th text-right">Сумма закупки</th>
                <th className="th text-right">Доля</th>
                <th className="th text-right">Накоплено</th>
                <th className="th">Позиций</th>
              </tr>
            </thead>
            <tbody>
              {groups.filter((g) => g.cls === 'A').slice(0, 30).map((g) => (
                <tr key={g.product} className="row-hover hover:bg-ink-800/40">
                  <td className="td text-center"><AbcBadge abc={g.cls} /></td>
                  <td className="td font-medium text-slate-100">{g.product}</td>
                  <td className="td text-right tabnum text-slate-400">{fmt1(g.qty)}</td>
                  <td className="td text-right tabnum text-slate-200">{money(g.sum)}</td>
                  <td className="td text-right tabnum text-slate-400">{fmt1((g.sum / totalSum) * 100)}%</td>
                  <td className="td text-right tabnum text-slate-500">{fmt1(g.share * 100)}%</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {statusChips(g.rows)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

function statusChips(rows: Row[]) {
  const over = rows.filter((r) => r.status === 'overpay').length
  const save = rows.filter((r) => r.status === 'saving').length
  const chips: JSX.Element[] = []
  if (over) chips.push(<span key="o" className="chip border-transparent bg-bad/10 text-bad">↑{over}</span>)
  if (save) chips.push(<span key="s" className="chip border-transparent bg-good/10 text-good">↓{save}</span>)
  if (!chips.length) chips.push(<span key="n" className="text-xs text-slate-600">—</span>)
  return chips
}

function ParetoTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-850/95 px-3 py-2 shadow-xl">
      <div className="mb-1 max-w-[220px] text-xs font-semibold text-slate-200">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.stroke }} />
          <span className="text-slate-400">{p.name}</span>
          <span className="ml-auto font-semibold tabnum text-slate-100">{p.dataKey === 'cum' ? p.value.toFixed(1) + '%' : moneyShort(p.value)}</span>
        </div>
      ))}
    </div>
  )
}
