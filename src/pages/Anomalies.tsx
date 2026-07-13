import { useMemo, useState } from 'react'
import { Row, money, moneyShort, fmt, fmt1, summarize } from '../lib/data'
import { Section, StatusBadge } from '../components/ui'
import { IAlert, IScale } from '../components/icons'

export default function Anomalies({ rows }: { rows: Row[] }) {
  const [tab, setTab] = useState<'nomatrix' | 'anomaly'>('nomatrix')
  const s = useMemo(() => summarize(rows), [rows])

  const noMatrix = useMemo(
    () => rows.filter((r) => r.status === 'nomatrix').sort((a, b) => b.sum - a.sum),
    [rows],
  )
  const anomalies = useMemo(
    () => rows.filter((r) => r.status === 'anomaly').sort((a, b) => (b.diffPct ?? 0) - (a.diffPct ?? 0)),
    [rows],
  )
  const noMatrixSpend = noMatrix.reduce((a, r) => a + r.sum, 0)

  const list = tab === 'nomatrix' ? noMatrix : anomalies

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-warn/10 text-warn"><IScale width={18} height={18} /></span>
            <div>
              <div className="text-xs text-slate-500">Позиции вне матрицы</div>
              <div className="text-xl font-bold tabnum text-white">{fmt(s.noMatrixCount)}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Закуплено на <span className="font-semibold text-slate-300">{moneyShort(noMatrixSpend)}</span> — цены не с чем сравнить. Требуется занести в план-матрицу.</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-purple-400/10 text-purple-300"><IAlert width={18} height={18} /></span>
            <div>
              <div className="text-xs text-slate-500">Аномалии сопоставления</div>
              <div className="text-xl font-bold tabnum text-white">{fmt(s.anomalyCount)}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Факт отличается от плана более чем в 3 раза — вероятно, разные единицы измерения (шт/кг). Исключены из расчёта эффекта.</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-500/10 text-brand-300"><IScale width={18} height={18} /></span>
            <div>
              <div className="text-xs text-slate-500">Качество сопоставления</div>
              <div className="text-xl font-bold tabnum text-white">{fmt(s.matchRate * 100)}%</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Доля позиций, найденных в матрице. Чем выше — тем полнее контроль цен по точке.</p>
        </div>
      </div>

      <Section
        title="Позиции для ручной проверки"
        subtitle="Согласно ТЗ: сигнализируем о позициях, которых нет в матрице, и о нестыковках единиц измерения"
        right={
          <div className="flex gap-1 rounded-lg bg-ink-800/70 p-1">
            <button onClick={() => setTab('nomatrix')} className={`btn px-3 py-1.5 text-xs ${tab === 'nomatrix' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Нет в матрице ({fmt(noMatrix.length)})</button>
            <button onClick={() => setTab('anomaly')} className={`btn px-3 py-1.5 text-xs ${tab === 'anomaly' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Аномалии ({fmt(anomalies.length)})</button>
          </div>
        }
      >
        <div className="max-h-[calc(100vh-420px)] overflow-auto rounded-xl border border-ink-700/50">
          <table className="w-full">
            <thead className="sticky top-0 bg-ink-850">
              <tr>
                <th className="th">Товар</th>
                <th className="th">Поставщик</th>
                <th className="th">Ресторан</th>
                <th className="th text-right">Кол-во</th>
                <th className="th text-right">Закупка</th>
                {tab === 'anomaly' && <><th className="th text-right">План</th><th className="th text-right">Факт</th></>}
                <th className="th">Статус</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="hover:bg-ink-800/40">
                  <td className="td font-medium text-slate-100">{r.product}<div className="text-[11px] font-normal text-slate-500">{r.pack || '—'}</div></td>
                  <td className="td text-slate-400">{r.supplier || '—'}</td>
                  <td className="td text-slate-400">{r.restaurant}</td>
                  <td className="td text-right tabnum text-slate-400">{fmt1(r.qty)}</td>
                  <td className="td text-right tabnum text-slate-200">{money(r.sum)}</td>
                  {tab === 'anomaly' && <>
                    <td className="td text-right tabnum text-slate-400">{r.plan != null ? money(r.plan) : '—'}</td>
                    <td className="td text-right tabnum text-slate-200">{money(r.unit)}</td>
                  </>}
                  <td className="td"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <div className="py-12 text-center text-sm text-slate-500">В этом срезе таких позиций нет.</div>}
        </div>
      </Section>
    </div>
  )
}
