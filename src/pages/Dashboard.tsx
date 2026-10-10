import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell,
  PieChart, Pie,
} from 'recharts'
import { Row, summarize, byRestaurant, fmt, money, pct, mismatchMoney, STATUS_META, Status } from '../lib/data'
import StatCard from '../components/StatCard'
import { Section } from '../components/ui'
import { ChartTip, C, Legend } from '../components/charts'
import { IScale, ICheck, IStore } from '../components/icons'

export default function Dashboard({ rows, onNav }: { rows: Row[]; onNav: (p: string) => void }) {
  const s = useMemo(() => summarize(rows), [rows])

  // П. 2.2 Приложения №1 — разница в ₸ по каждому ресторану между фактом
  // закупок не по матрице и тем, сколько заплатили бы по матрице за то же
  // количество (mismatchMoney, см. lib/data.ts), а не количество позиций.
  const perRest = useMemo(
    () => byRestaurant(rows).map((r) => ({ name: r.name, mismatch: r.rows.reduce((sum, row) => sum + mismatchMoney(row), 0) }))
      .sort((a, b) => b.mismatch - a.mismatch)
      .filter((r) => r.mismatch > 0),
    [rows],
  )
  const totalMismatch = useMemo(() => perRest.reduce((sum, r) => sum + r.mismatch, 0), [perRest])

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
          title="Несостыковки по ресторанам"
          subtitle="Переплата из-за закупок не по матрице, в ₸"
          right={totalMismatch > 0 ? <span className="whitespace-nowrap rounded-lg bg-warn/10 px-3 py-1.5 text-sm font-semibold text-warn">Итого: {money(totalMismatch)}</span> : undefined}
          className="col-span-2"
        >
          {perRest.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">Несостыковок в выбранном срезе не найдено 🎉</div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perRest} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke={C.grid} />
                  <XAxis type="number" tick={{ fill: C.axis, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt(v)} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<ChartTip valueFormatter={money} />} />
                  <Bar dataKey="mismatch" name="Переплата" radius={[0, 4, 4, 0]} barSize={16} fill={C.warn} />
                </BarChart>
              </ResponsiveContainer>
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
