import { useMemo, useState } from 'react'
import { Row, money, moneyShort, fmt, fmt1, pct, summarize } from '../lib/data'
import { useEdits } from '../lib/edits'
import { Section, InfoTip } from '../components/ui'
import { EditablePlan } from '../components/EditableCell'
import { IAlert, IScale, ICheck, IReset } from '../components/icons'

type Tab = 'review' | 'nomatrix' | 'anomaly' | 'resolved'

export default function Reconcile({ rows }: { rows: Row[] }) {
  const { edits, setPlan, setExcluded } = useEdits()
  const [tab, setTab] = useState<Tab>('review')
  const s = useMemo(() => summarize(rows), [rows])

  const review = useMemo(() => rows.filter((r) => r.status === 'review').sort((a, b) => b.sum - a.sum), [rows])
  const nomatrix = useMemo(() => rows.filter((r) => r.status === 'nomatrix').sort((a, b) => b.sum - a.sum), [rows])
  const anomaly = useMemo(() => rows.filter((r) => r.status === 'anomaly').sort((a, b) => b.sum - a.sum), [rows])

  // Resolved = products the user has acted on (set a plan or marked "разные товары").
  const resolved = useMemo(() => {
    const keys = new Set<string>([...Object.keys(edits.planOverrides), ...Object.keys(edits.excludedProducts)])
    const map = new Map<string, { product0: string; product: string; sum: number; count: number; excluded: boolean; plan?: number }>()
    for (const r of rows) {
      if (!keys.has(r.product0)) continue
      const g = map.get(r.product0) || { product0: r.product0, product: r.product, sum: 0, count: 0, excluded: edits.excludedProducts[r.product0] === true, plan: edits.planOverrides[r.product0] }
      g.sum += r.sum; g.count++
      map.set(r.product0, g)
    }
    return [...map.values()].sort((a, b) => b.sum - a.sum)
  }, [rows, edits])

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'review', label: 'Проверить', count: review.length },
    { id: 'nomatrix', label: 'Нет в матрице', count: nomatrix.length },
    { id: 'anomaly', label: 'Аномалии', count: anomaly.length },
    { id: 'resolved', label: 'Решённые', count: resolved.length },
  ]
  const list = tab === 'review' ? review : tab === 'nomatrix' ? nomatrix : anomaly

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <IssueCard color="sky" icon={<IScale width={18} height={18} />} label="Проверить"
          value={fmt(s.reviewCount)} hint="Отклонение цены больше 50% — вероятно, разные товары под одним названием. Не входят в «Переплаты»." delay={0} />
        <IssueCard color="warn" icon={<IScale width={18} height={18} />} label="Нет в матрице"
          value={fmt(s.noMatrixCount)} hint="Товара нет в плановой матрице — задайте плановую цену, чтобы начать сравнивать." delay={60} />
        <IssueCard color="purple" icon={<IAlert width={18} height={18} />} label="Аномалии"
          value={fmt(s.anomalyCount)} hint="Цена отличается в разы — скорее всего перепутаны единицы (шт/кг)." delay={120} />
        <IssueCard color="good" icon={<ICheck width={18} height={18} />} label="Решено"
          value={fmt(resolved.length)} hint="Позиции, по которым вы задали цену или отметили «разные товары»." delay={180} />
      </div>

      <Section
        delay={220}
        title="Ручная сверка"
        subtitle="Разберите несостыковки: задайте плановую цену или отметьте «разные товары». Всё сохраняется автоматически."
        right={
          <div className="flex gap-1 rounded-lg bg-ink-800/70 p-1">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`btn px-3 py-1.5 text-xs ${tab === t.id ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>
                {t.label} ({fmt(t.count)})
              </button>
            ))}
          </div>
        }
      >
        {tab === 'resolved' ? (
          <ResolvedTable items={resolved} onUndo={(p) => { setPlan(p, null); setExcluded(p, false) }} />
        ) : (
          <IssueTable
            rows={list}
            kind={tab}
            planOverrides={edits.planOverrides}
            onPlan={setPlan}
            onExclude={(p) => setExcluded(p, true)}
          />
        )}
      </Section>
    </div>
  )
}

function IssueTable({ rows, kind, planOverrides, onPlan, onExclude }: {
  rows: Row[]
  kind: 'review' | 'nomatrix' | 'anomaly'
  planOverrides: Record<string, number>
  onPlan: (product0: string, v: number | null) => void
  onExclude: (product0: string) => void
}) {
  const [limit, setLimit] = useState(50)
  if (rows.length === 0)
    return <div className="py-12 text-center text-sm text-slate-500">Здесь пусто — в этом срезе разбирать нечего 🎉</div>

  const shown = rows.slice(0, limit)
  return (
    <>
      <div className="max-h-[calc(100vh-430px)] overflow-auto rounded-xl border border-ink-700/50">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-ink-850">
            <tr>
              <th className="th">Товар</th>
              <th className="th">Ресторан</th>
              <th className="th text-right">Закупка</th>
              <th className="th text-right">План&nbsp;<InfoTip text="Задайте правильную плановую цену за единицу — позиция сразу уйдёт из списка и начнёт сравниваться." /></th>
              <th className="th text-right">Факт</th>
              <th className="th text-right">Δ%</th>
              <th className="th text-center">Действие</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="row-hover hover:bg-ink-800/40">
                <td className="td">
                  <div className="font-medium text-slate-100">{r.product}</div>
                  <div className="text-[11px] text-slate-500">{r.supplier || '—'} · {r.pack || '—'}</div>
                </td>
                <td className="td text-slate-400">{r.restaurant}</td>
                <td className="td text-right tabnum text-slate-300">{money(r.sum)}<div className="text-[11px] text-slate-600">{fmt1(r.qty)} ед.</div></td>
                <td className="td text-right">
                  <EditablePlan
                    value={r.plan != null ? String(r.plan) : ''}
                    placeholder="задать"
                    highlighted={planOverrides[r.product0] != null}
                    onCommit={(v) => onPlan(r.product0, v)}
                  />
                </td>
                <td className="td text-right tabnum text-slate-200">{money(r.unit)}</td>
                <td className="td text-right tabnum font-semibold">
                  {r.diffPct != null ? <span className={kind === 'anomaly' ? 'text-purple-300' : 'text-sky-300'}>{pct(r.diffPct)}</span> : <span className="text-slate-600">—</span>}
                </td>
                <td className="td text-center">
                  <button
                    onClick={() => onExclude(r.product0)}
                    className="btn mx-auto border border-ink-600 bg-ink-800/70 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                    title="Отметить как разные товары под одним названием — исключить из сравнения"
                  >
                    Разные товары
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <div className="pt-3 text-center">
          <button onClick={() => setLimit((l) => l + 100)} className="btn text-brand-300 hover:text-brand-200">Показать ещё ({fmt(rows.length - shown.length)})</button>
        </div>
      )}
    </>
  )
}

function ResolvedTable({ items, onUndo }: {
  items: { product0: string; product: string; sum: number; count: number; excluded: boolean; plan?: number }[]
  onUndo: (product0: string) => void
}) {
  if (items.length === 0)
    return <div className="py-12 text-center text-sm text-slate-500">Пока ничего не решено. Разберите позиции на других вкладках.</div>
  return (
    <div className="overflow-hidden rounded-xl border border-ink-700/50">
      <table className="w-full">
        <thead className="bg-ink-800/50">
          <tr>
            <th className="th">Товар</th>
            <th className="th">Что сделано</th>
            <th className="th text-right">Позиций</th>
            <th className="th text-right">Закупка</th>
            <th className="th text-center">Отменить</th>
          </tr>
        </thead>
        <tbody>
          {items.map((g) => (
            <tr key={g.product0} className="row-hover hover:bg-ink-800/40">
              <td className="td font-medium text-slate-100">{g.product}</td>
              <td className="td">
                {g.excluded
                  ? <span className="chip border-transparent bg-ink-750 text-slate-400">Разные товары — не сравнивается</span>
                  : <span className="chip border-transparent bg-good/10 text-good">План задан: {money(g.plan!)}</span>}
              </td>
              <td className="td text-right tabnum text-slate-400">{fmt(g.count)}</td>
              <td className="td text-right tabnum text-slate-300">{moneyShort(g.sum)}</td>
              <td className="td text-center">
                <button onClick={() => onUndo(g.product0)} className="btn mx-auto px-2 py-1 text-xs text-slate-400 hover:text-white">
                  <IReset width={14} height={14} /> Вернуть
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IssueCard({ color, icon, label, value, hint, delay }: {
  color: 'sky' | 'warn' | 'purple' | 'good'; icon: React.ReactNode; label: string; value: string; hint: string; delay: number
}) {
  const ic: Record<string, string> = {
    sky: 'bg-sky-400/10 text-sky-300', warn: 'bg-warn/10 text-warn',
    purple: 'bg-purple-400/10 text-purple-300', good: 'bg-good/10 text-good',
  }
  return (
    <div className="card card-hover animate-fade-up p-5" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${ic[color]}`}>{icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">{label}<InfoTip text={hint} /></div>
          <div className="text-xl font-bold tabnum text-white">{value}</div>
        </div>
      </div>
    </div>
  )
}
