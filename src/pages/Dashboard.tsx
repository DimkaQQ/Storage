import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell,
  PieChart, Pie,
} from 'recharts'
import { Row, summarize, byRestaurant, money, moneyShort, fmt, pct, STATUS_META, Status } from '../lib/data'
import StatCard from '../components/StatCard'
import { Section } from '../components/ui'
import { ChartTip, C, Legend } from '../components/charts'
import { IScale, IStore, IAlert, IArrowDown, IArrowUp, IGauge, ICheck } from '../components/icons'

export default function Dashboard({ rows, onNav }: { rows: Row[]; onNav: (p: string) => void }) {
  const s = useMemo(() => summarize(rows), [rows])

  const perRest = useMemo(
    () => byRestaurant(rows).map((r) => ({ name: r.name, effect: r.summary.netEffect, spend: r.summary.spend }))
      .sort((a, b) => a.effect - b.effect),
    [rows],
  )

  const statusData = useMemo(() => {
    const order: Status[] = ['saving', 'ok', 'overpay', 'nomatrix', 'anomaly']
    const counts = new Map<Status, number>()
    for (const r of rows) counts.set(r.status, (counts.get(r.status) || 0) + 1)
    const colors: Record<Status, string> = { saving: C.good, ok: '#64748b', overpay: C.bad, nomatrix: C.warn, anomaly: C.purple }
    return order.map((st) => ({ st, name: STATUS_META[st].label, value: counts.get(st) || 0, color: colors[st] }))
      .filter((d) => d.value > 0)
  }, [rows])

  const topOverpay = useMemo(
    () => rows.filter((r) => r.status === 'overpay').sort((a, b) => a.effect - b.effect).slice(0, 8),
    [rows],
  )

  const netAccent = s.netEffect >= 0 ? 'good' : 'bad'

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Сумма закупок" value={moneyShort(s.spend)} sub={`${fmt(s.positions)} позиций проверено`} accent="brand" icon={<IStore width={16} height={16} />} />
        <StatCard
          label="Чистый эффект мониторинга"
          value={<span className={s.netEffect >= 0 ? 'text-good' : 'text-bad'}>{moneyShort(s.netEffect)}</span>}
          sub={s.netEffect >= 0 ? 'экономия против плана' : 'перерасход против плана'}
          accent={netAccent}
          icon={<IGauge width={16} height={16} />}
        />
        <StatCard label="Переплаты" value={<span className="text-bad">{moneyShort(s.overpaySum)}</span>} sub={`${s.overpayCount} позиций дороже плана`} accent="bad" icon={<IArrowUp width={16} height={16} />} />
        <StatCard label="Экономия" value={<span className="text-good">{moneyShort(s.savingSum)}</span>} sub={`${s.savingCount} позиций дешевле плана`} accent="good" icon={<IArrowDown width={16} height={16} />} />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Совпадение с матрицей" value={pct(s.matchRate).replace('+', '')} sub={`${fmt(s.matched)} из ${fmt(s.positions)} позиций найдено`} accent="brand" icon={<ICheck width={16} height={16} />} />
        <StatCard label="Нет в матрице" value={fmt(s.noMatrixCount)} sub="позиции вне план-матрицы" accent="warn" icon={<IScale width={16} height={16} />} />
        <StatCard label="Аномалии" value={fmt(s.anomalyCount)} sub="расхождение ед. изм. — проверить" accent="warn" icon={<IAlert width={16} height={16} />} />
        <StatCard label="Средний перерасход" value={s.overpayCount ? moneyShort(s.overpaySum / s.overpayCount) : '—'} sub="на одну переплату" accent="slate" icon={<IArrowUp width={16} height={16} />} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-3 gap-4">
        <Section title="Эффект по ресторанам" subtitle="Экономия (+) и перерасход (−) против плановых цен" className="col-span-2">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perRest} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke={C.grid} />
                <XAxis type="number" tickFormatter={(v) => moneyShort(v)} tick={{ fill: C.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<ChartTip />} />
                <Bar dataKey="effect" name="Эффект" radius={[0, 4, 4, 0]} barSize={16}>
                  {perRest.map((d, i) => <Cell key={i} fill={d.effect >= 0 ? C.good : C.bad} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Структура позиций" subtitle="Статус проверки цены">
          <div className="relative h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={54} outerRadius={80} paddingAngle={2} stroke="none">
                  {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<ChartTip money={false} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-white tabnum">{fmt(s.positions)}</span>
              <span className="text-[11px] text-slate-500">позиций</span>
            </div>
          </div>
          <div className="mt-2">
            <Legend items={statusData.map((d) => ({ label: d.name, color: d.color, value: fmt(d.value) }))} />
          </div>
        </Section>
      </div>

      {/* Top overpays */}
      <Section
        title="Крупнейшие переплаты"
        subtitle="Позиции, где фактическая цена выше плановой — приоритет для переговоров"
        right={<button onClick={() => onNav('pricecheck')} className="btn text-brand-300 hover:text-brand-200">Все позиции →</button>}
      >
        {topOverpay.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Переплат в выбранном срезе не найдено 🎉</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-ink-700/50">
            <table className="w-full">
              <thead className="bg-ink-800/50">
                <tr>
                  <th className="th">Товар</th>
                  <th className="th">Ресторан</th>
                  <th className="th text-right">План</th>
                  <th className="th text-right">Факт</th>
                  <th className="th text-right">Δ</th>
                  <th className="th text-right">Перерасход</th>
                </tr>
              </thead>
              <tbody>
                {topOverpay.map((r) => (
                  <tr key={r.id} className="hover:bg-ink-800/40">
                    <td className="td font-medium text-slate-100">{r.product}<div className="text-[11px] font-normal text-slate-500">{r.supplier}</div></td>
                    <td className="td text-slate-400">{r.restaurant}</td>
                    <td className="td text-right tabnum text-slate-400">{money(r.plan!)}</td>
                    <td className="td text-right tabnum text-slate-200">{money(r.unit)}</td>
                    <td className="td text-right tabnum font-semibold text-bad">{pct(r.diffPct!)}</td>
                    <td className="td text-right tabnum font-semibold text-bad">{moneyShort(r.effect)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
