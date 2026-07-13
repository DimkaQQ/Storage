import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell,
  PieChart, Pie,
} from 'recharts'
import { Row, summarize, byRestaurant, money, moneyShort, fmt, fmt1, pct, STATUS_META, Status } from '../lib/data'
import StatCard from '../components/StatCard'
import { Section, AnimatedNumber } from '../components/ui'
import { ChartTip, C, Legend } from '../components/charts'
import { IScale, IStore, IAlert, IArrowDown, IArrowUp, IGauge, ICheck, ISpark } from '../components/icons'

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
      {/* orientation primer */}
      <div className="animate-fade-up flex items-center gap-3 rounded-xl border border-ink-700/60 bg-ink-850/60 px-4 py-2.5 text-sm">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-500/15 text-brand-300"><ISpark width={14} height={14} /></span>
        <p className="text-slate-400">
          Сравниваем <b className="text-slate-200">плановую цену</b> (из матрицы) с <b className="text-slate-200">фактической</b> (из iiko).
          <span className="text-bad"> Красное</span> — переплата, <span className="text-good">зелёное</span> — экономия.
          Кнопка <b className="text-slate-200">«Справка»</b> вверху объясняет все термины.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard delay={0} label="Сумма закупок" info="Сколько всего денег потрачено на закупки за период по выбранным точкам." value={<AnimatedNumber value={s.spend} format={moneyShort} />} sub={`${fmt(s.positions)} позиций проверено`} accent="brand" icon={<IStore width={16} height={16} />} />
        <StatCard
          delay={60}
          label="Чистый эффект мониторинга"
          info="Экономия минус переплаты. Плюс — в сумме закупили дешевле плана, минус — дороже."
          value={<span className={s.netEffect >= 0 ? 'text-good' : 'text-bad'}><AnimatedNumber value={s.netEffect} format={moneyShort} /></span>}
          sub={s.netEffect >= 0 ? 'экономия против плана' : 'перерасход против плана'}
          accent={netAccent}
          icon={<IGauge width={16} height={16} />}
        />
        <StatCard delay={120} label="Переплаты" info="Сумма, потерянная на позициях, купленных дороже плановой цены. Это резерв для переговоров с поставщиками." value={<span className="text-bad"><AnimatedNumber value={s.overpaySum} format={moneyShort} /></span>} sub={`${s.overpayCount} позиций дороже плана`} accent="bad" icon={<IArrowUp width={16} height={16} />} />
        <StatCard delay={180} label="Экономия" infoAlign="right" info="Сумма, сэкономленная на позициях, купленных дешевле плановой цены." value={<span className="text-good"><AnimatedNumber value={s.savingSum} format={moneyShort} /></span>} sub={`${s.savingCount} позиций дешевле плана`} accent="good" icon={<IArrowDown width={16} height={16} />} />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard delay={220} label="Совпадение с матрицей" info="Доля закупленных позиций, для которых нашлась плановая цена в матрице. Остальные — «нет в матрице»." value={<AnimatedNumber value={s.matchRate * 100} format={(n) => fmt1(n) + '%'} />} sub={`${fmt(s.matched)} из ${fmt(s.positions)} позиций найдено`} accent="brand" icon={<ICheck width={16} height={16} />} />
        <StatCard delay={260} label="Нет в матрице" info="Товары, которых нет в плановой матрице — не с чем сравнить цену. Добавьте им план в разделе «Данные»." value={<AnimatedNumber value={s.noMatrixCount} format={(n) => fmt(n)} />} sub="позиции вне план-матрицы" accent="warn" icon={<IScale width={16} height={16} />} />
        <StatCard delay={300} label="Аномалии" info="Цена отличается от плана в разы — скорее всего разные единицы измерения (шт/кг). Исключены из расчёта эффекта." value={<AnimatedNumber value={s.anomalyCount} format={(n) => fmt(n)} />} sub="расхождение ед. изм. — проверить" accent="warn" icon={<IAlert width={16} height={16} />} />
        <StatCard delay={340} label="Средний перерасход" infoAlign="right" info="Средняя переплата в расчёте на одну позицию, купленную дороже плана." value={s.overpayCount ? moneyShort(s.overpaySum / s.overpayCount) : '—'} sub="на одну переплату" accent="slate" icon={<IArrowUp width={16} height={16} />} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-3 gap-4">
        <Section delay={380} title="Эффект по ресторанам" subtitle="Экономия (+) и перерасход (−) против плановых цен" className="col-span-2">
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

        <Section delay={440} title="Структура позиций" subtitle="Статус проверки цены">
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
        delay={500}
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
                {topOverpay.map((r, i) => (
                  <tr key={r.id} className="row-hover animate-fade-up hover:bg-ink-800/40" style={{ animationDelay: `${560 + i * 40}ms` }}>
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
