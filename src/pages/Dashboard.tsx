import { useMemo, useState } from 'react'
import { PieChart, Pie, ResponsiveContainer, Tooltip, Cell } from 'recharts'
import { Row, summarize, byRestaurant, fmt, money, pct, wrongSupplierFactPlan, STATUS_META, Status } from '../lib/data'
import StatCard from '../components/StatCard'
import { Section } from '../components/ui'
import { ChartTip, C, Legend } from '../components/charts'
import { IScale, ICheck, IStore, IChevron } from '../components/icons'

export default function Dashboard({ rows, onNav }: { rows: Row[]; onNav: (p: string) => void }) {
  const s = useMemo(() => summarize(rows), [rows])
  const [expanded, setExpanded] = useState<string | null>(null)

  // П. 2.2 Приложения №1 — факт и план по каждому ресторану, только для
  // "заказ не по матрице" (wrongSupplierFactPlan в lib/data.ts — "нет в
  // матрице" сюда специально не идёт, там сравнивать не с чем, попросили
  // не смешивать с настоящей переплатой).
  const perRest = useMemo(
    () => byRestaurant(rows).map((r) => {
      const { fact, plan } = wrongSupplierFactPlan(r.rows)
      return { name: r.name, fact, plan, delta: fact - plan }
    })
      .filter((r) => r.fact > 0)
      .sort((a, b) => b.delta - a.delta),
    [rows],
  )
  const totals = useMemo(
    () => perRest.reduce((acc, r) => ({ fact: acc.fact + r.fact, plan: acc.plan + r.plan, delta: acc.delta + r.delta }), { fact: 0, plan: 0, delta: 0 }),
    [perRest],
  )

  const statusData = useMemo(() => {
    const order: Status[] = ['ok', 'wrongSupplier', 'nomatrix']
    const counts = new Map<Status, number>()
    // Позиции без факта (в матрице есть, но не покупали) сюда не входят —
    // диаграмма про то, что реально закупили, и должна совпадать с s.positions.
    for (const r of rows) if (r.unit != null) counts.set(r.status, (counts.get(r.status) || 0) + 1)
    // notPurchased никогда реально не попадёт в counts (r.unit != null выше
    // это гарантирует) — запись здесь только чтобы Record<Status, string>
    // был полным для тайпчекера, order ниже её не использует.
    const colors: Record<Status, string> = { ok: C.good, wrongSupplier: C.warn, nomatrix: C.purple, notPurchased: C.good }
    return order.map((st) => ({ st, name: STATUS_META[st].label, value: counts.get(st) || 0, color: colors[st] }))
      .filter((d) => d.value > 0)
  }, [rows])

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard delay={0} label="Позиций проверено" info="Все закупленные позиции за период по выбранным точкам." value={fmt(s.positions)} accent="brand" icon={<IStore width={16} height={16} />} />
        <StatCard delay={60} label="По матрице" info="Доля позиций, для которых нашлась плановая цена у назначенного поставщика." value={pct(s.matchRate).replace('+', '')} sub={`${fmt(s.matched)} из ${fmt(s.positions)}`} accent="good" icon={<ICheck width={16} height={16} />} />
        <StatCard delay={120} label="Заказ не по матрице" info="Товар есть в матрице для этой точки, но куплен не у назначенного поставщика." value={fmt(s.wrongSupplierCount)} accent="warn" icon={<IScale width={16} height={16} />} />
        <StatCard delay={180} label="Нет в матрице" infoAlign="right" info="Товара нет в плановой матрице ни у одного поставщика для этой точки." value={fmt(s.noMatrixCount)} accent="warn" icon={<IScale width={16} height={16} />} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-3 gap-4">
        <Section
          delay={240}
          title="Переплата не по матрице"
          subtitle="Закупки у поставщика, которого не назначила матрица — сколько вышло и сколько должно было выйти"
          className="col-span-2"
        >
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-ink-900/50 px-3 py-2.5">
              <div className="text-[11px] text-slate-500">Вышло</div>
              <div className="text-lg font-semibold text-slate-100 tabnum">{money(totals.fact)}</div>
            </div>
            <div className="rounded-lg bg-ink-900/50 px-3 py-2.5">
              <div className="text-[11px] text-slate-500">Должно было выйти</div>
              <div className="text-lg font-semibold text-slate-100 tabnum">{money(totals.plan)}</div>
            </div>
            <div className="rounded-lg bg-warn/10 px-3 py-2.5">
              <div className="text-[11px] text-slate-500">Разница</div>
              <div className="text-lg font-semibold text-warn tabnum">{money(totals.delta)}</div>
            </div>
          </div>

          {perRest.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">Переплат не найдено 🎉</div>
          ) : (
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {perRest.map((r) => {
                const isOpen = expanded === r.name
                return (
                  <div key={r.name} className="rounded-lg border border-ink-700/60">
                    <button
                      onClick={() => setExpanded((e) => (e === r.name ? null : r.name))}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-ink-800/40"
                    >
                      <span className="flex items-center gap-2 text-sm text-slate-200">
                        <IChevron width={12} height={12} className={`text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        {r.name}
                      </span>
                      <span className="text-sm font-semibold text-warn tabnum">{money(r.delta)}</span>
                    </button>
                    {isOpen && (
                      <div className="grid grid-cols-3 gap-3 border-t border-ink-700/60 px-3 py-2.5 text-xs">
                        <div><div className="text-slate-500">Вышло</div><div className="font-medium text-slate-200 tabnum">{money(r.fact)}</div></div>
                        <div><div className="text-slate-500">Должно было выйти</div><div className="font-medium text-slate-200 tabnum">{money(r.plan)}</div></div>
                        <div><div className="text-slate-500">Разница</div><div className="font-medium text-warn tabnum">{money(r.delta)}</div></div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        <Section delay={300} title="Структура позиций" subtitle="Статус проверки цены">
          <div className="relative h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={54} outerRadius={80} paddingAngle={2} stroke="none">
                  {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<ChartTip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-white tabnum">{fmt(s.positions)}</span>
              <span className="text-[11px] text-slate-500">позиций</span>
            </div>
          </div>
          <div className="mt-2">
            <Legend items={statusData.map((d) => ({ label: d.name, color: d.color, value: fmt(d.value) }))} />
          </div>
        </Section>
      </div>

      <div className="text-center">
        <button onClick={() => onNav('pricecheck')} className="btn text-brand-300 hover:text-brand-200">Все позиции →</button>
      </div>
    </div>
  )
}
