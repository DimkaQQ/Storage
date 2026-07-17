import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend as RLegend,
} from 'recharts'
import { Row, groupBy, summarize, moneyShort, fmt, pct } from '../lib/data'
import { Section, InfoTip } from '../components/ui'
import { ChartTip, C, Legend } from '../components/charts'
import { IPin } from '../components/icons'

export default function Analytics({ rows }: { rows: Row[] }) {
  // Демо-сравнение периодов: пока выгружен только один месяц, поэтому
  // «предыдущий период» и «тот же месяц год назад» — оценочные ряды,
  // построенные от текущей суммы закупок. Как только появятся реальные
  // выгрузки за другие периоды — заменить на них 1-в-1 (структура уже готова).
  const periodCompare = useMemo(() => {
    const spend = summarize(rows).spend
    return [
      { name: 'Текущий месяц', Закупка: spend, demo: false },
      { name: 'Предыдущий месяц', Закупка: Math.round(spend * 0.93), demo: true },
      { name: 'Тот же месяц, год назад', Закупка: Math.round(spend * 0.81), demo: true },
    ]
  }, [rows])

  const cities = useMemo(() => groupBy(rows, (r) => r.city).sort((a, b) => b.summary.spend - a.summary.spend), [rows])
  const brands = useMemo(
    () => groupBy(rows, (r) => r.brand).map((g) => ({ name: g.name, effect: g.summary.netEffect, spend: g.summary.spend }))
      .sort((a, b) => a.effect - b.effect),
    [rows],
  )
  const topSuppliers = useMemo(() => {
    const g = groupBy(rows.filter((r) => r.status === 'overpay'), (r) => r.supplier)
      .map((x) => ({ name: x.name || '—', overpay: x.summary.overpaySum }))
      .sort((a, b) => a.overpay - b.overpay)
      .slice(0, 12)
    return g
  }, [rows])
  const cityBars = cities.map((c) => ({ name: c.name, Переплаты: c.summary.overpaySum, Экономия: c.summary.savingSum }))

  const multiCity = cities.length > 1

  return (
    <div className="space-y-6">
      {/* Period comparison (demo) */}
      <Section
        delay={0}
        title="Сравнение периодов"
        subtitle="Месяц к месяцу и год к году — как в ТЗ (три отчёта, три сравнения)"
        right={
          <span className="chip border-brand-500/30 bg-brand-500/10 text-[11px] text-brand-300">
            демо <InfoTip text="Сейчас выгружен только текущий месяц. «Предыдущий месяц» и «тот же месяц год назад» — иллюстративные ряды для демонстрации макета; как только появятся реальные выгрузки за другие периоды, эти два столбца заменяются на них без изменения вёрстки." />
          </span>
        }
      >
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={periodCompare} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => moneyShort(v)} tick={{ fill: C.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<ChartTip />} />
              <Bar dataKey="Закупка" radius={[4, 4, 0, 0]} barSize={56}>
                {periodCompare.map((d, i) => <Cell key={i} fill={d.demo ? C.axis : C.brand} fillOpacity={d.demo ? 0.45 : 1} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-400" /> факт</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-500" /> демо-оценка</span>
        </div>
      </Section>

      {/* City comparison cards */}
      <Section
        delay={0}
        title={multiCity ? 'Города: сравнение' : 'Город'}
        subtitle={multiCity ? 'Ключевые показатели по каждому городу рядом' : 'В данных пока один город — сравнение появится с добавлением второго'}
      >
        <div className={`grid gap-4 ${cities.length >= 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {cities.map((c) => {
            const s = c.summary
            return (
              <div key={c.name} className="rounded-2xl border border-ink-700/60 bg-ink-900/40 p-5">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500/10 text-brand-300"><IPin width={16} height={16} /></span>
                  <div>
                    <div className="text-sm font-semibold text-white">{c.name}</div>
                    <div className="text-[11px] text-slate-500">{new Set(c.rows.map((r) => r.restaurant)).size} точек · {fmt(s.positions)} позиций</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Metric label="Закупка" value={moneyShort(s.spend)} />
                  <Metric label="Чистый эффект" value={moneyShort(s.netEffect)} tone={s.netEffect >= 0 ? 'good' : 'bad'} />
                  <Metric label="Переплаты" value={moneyShort(s.overpaySum)} tone="bad" />
                  <Metric label="Экономия" value={moneyShort(s.savingSum)} tone="good" />
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Совпадение с матрицей</span>
                  <span className="tabnum text-slate-300">{pct(s.matchRate).replace('+', '')}</span>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {multiCity && (
        <Section delay={80} title="Переплаты и экономия по городам" subtitle="Где теряем и где выигрываем — в разрезе городов">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cityBars} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke={C.grid} />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => moneyShort(v)} tick={{ fill: C.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<ChartTip />} />
                <RLegend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Переплаты" fill={C.bad} radius={[4, 4, 0, 0]} barSize={40} />
                <Bar dataKey="Экономия" fill={C.good} radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Top suppliers by overpay */}
        <Section delay={140} title="Топ поставщиков по переплатам" subtitle="Где больше всего переплачиваем — приоритет для переговоров">
          {topSuppliers.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">Переплат в срезе нет 🎉</div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topSuppliers} layout="vertical" margin={{ left: 8, right: 20, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke={C.grid} />
                  <XAxis type="number" tickFormatter={(v) => moneyShort(v)} tick={{ fill: C.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<ChartTip />} />
                  <Bar dataKey="overpay" name="Переплата" radius={[0, 4, 4, 0]} barSize={14}>
                    {topSuppliers.map((_, i) => <Cell key={i} fill={C.bad} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>

        {/* Brand comparison */}
        <Section delay={200} title="Сравнение брендов" subtitle="Чистый эффект по сетям (Olovo / Pasta la vista / Six…)">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={brands} layout="vertical" margin={{ left: 8, right: 20, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke={C.grid} />
                <XAxis type="number" tickFormatter={(v) => moneyShort(v)} tick={{ fill: C.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<ChartTip />} />
                <Bar dataKey="effect" name="Эффект" radius={[0, 4, 4, 0]} barSize={16}>
                  {brands.map((d, i) => <Cell key={i} fill={d.effect >= 0 ? C.good : C.bad} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2"><Legend items={[{ label: 'экономия', color: C.good }, { label: 'перерасход', color: C.bad }]} /></div>
        </Section>
      </div>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const cls = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-white'
  return (
    <div className="rounded-lg bg-ink-900/50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-0.5 text-base font-bold tabnum ${cls}`}>{value}</div>
    </div>
  )
}
