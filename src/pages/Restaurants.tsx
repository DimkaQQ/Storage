import { useMemo } from 'react'
import { Row, VenueMeta, byRestaurant, groupBy, summarize, moneyShort, money, fmt, pct } from '../lib/data'
import { useEdits } from '../lib/edits'
import { Section } from '../components/ui'
import HoverName from '../components/HoverName'
import { IStore, IArrowUp, IArrowDown, IChevron } from '../components/icons'

export default function Restaurants({
  rows, scope, onScope, onNav,
}: {
  rows: Row[]
  scope: Set<string>
  onScope: (s: Set<string>) => void
  onNav: () => void
}) {
  const { restaurants } = useEdits()
  const cards = useMemo(
    () => byRestaurant(rows).sort((a, b) => a.summary.netEffect - b.summary.netEffect),
    [rows],
  )
  const maxSpend = Math.max(...cards.map((c) => c.summary.spend), 1)

  const focus = (name: string) => onScope(new Set([name]))
  const focusedName = scope.size === 1 ? [...scope][0] : null
  const focusedMeta = useMemo(() => restaurants.find((r) => r.name === focusedName) ?? null, [restaurants, focusedName])

  // Everything below is only computed meaningfully when one restaurant is
  // focused — `rows` already comes pre-filtered to just that restaurant
  // (App.tsx applies `scope` before passing rows down), so no extra filtering needed here.
  const profileSummary = useMemo(() => summarize(rows), [rows])
  const topOverpay = useMemo(
    () => [...rows].filter((r) => r.status === 'overpay').sort((a, b) => a.effect - b.effect).slice(0, 6),
    [rows],
  )
  const topSaving = useMemo(
    () => [...rows].filter((r) => r.status === 'saving').sort((a, b) => b.effect - a.effect).slice(0, 6),
    [rows],
  )
  const topSuppliers = useMemo(
    () => groupBy(rows, (r) => r.supplier).sort((a, b) => b.summary.spend - a.summary.spend).slice(0, 6),
    [rows],
  )
  const byCategory = useMemo(
    () => groupBy(rows, (r) => r.category).sort((a, b) => b.summary.spend - a.summary.spend),
    [rows],
  )

  if (focusedName) {
    return (
      <RestaurantProfile
        name={focusedName}
        meta={focusedMeta}
        summary={profileSummary}
        topOverpay={topOverpay}
        topSaving={topSaving}
        topSuppliers={topSuppliers}
        byCategory={byCategory}
        onBack={() => onScope(new Set())}
        onNav={onNav}
      />
    )
  }

  return (
    <div className="space-y-6">
      <Section
        title="Точки продаж"
        subtitle="Показаны все точки — нажмите на карточку, чтобы посмотреть полную информацию по ресторану"
      >
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {cards.map((c, i) => {
            const s = c.summary
            const good = s.netEffect >= 0
            const rest = restaurants.find((r) => r.name === c.name)
            return (
              <button
                key={c.name}
                onClick={() => focus(c.name)}
                style={{ animationDelay: `${i * 45}ms` }}
                className="card card-hover group animate-fade-up p-4 text-left"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink-750 text-brand-300"><IStore width={16} height={16} /></span>
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{c.name}</div>
                      <div className="text-[11px] text-slate-500">{rest?.entity}</div>
                    </div>
                  </div>
                  <IChevron className="text-slate-600 group-hover:text-brand-300" width={16} height={16} />
                </div>

                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <div className="text-[11px] text-slate-500">Чистый эффект</div>
                    <div className={`text-lg font-bold tabnum ${good ? 'text-good' : 'text-bad'}`}>{moneyShort(s.netEffect)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">Закупка</div>
                    <div className="text-sm font-semibold tabnum text-slate-200">{moneyShort(s.spend)}</div>
                  </div>
                </div>

                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-750">
                  <div className="animate-grow-x h-full rounded-full bg-gradient-to-r from-brand-500/60 to-brand-400" style={{ width: `${(s.spend / maxSpend) * 100}%` }} />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Mini icon={<IArrowUp width={12} height={12} />} label="переплаты" value={fmt(s.overpayCount)} tone="bad" />
                  <Mini icon={<IArrowDown width={12} height={12} />} label="экономия" value={fmt(s.savingCount)} tone="good" />
                  <Mini label="совпад." value={pct(s.matchRate).replace('+', '')} tone="slate" />
                </div>
              </button>
            )
          })}
        </div>
      </Section>

      {/* Comparison table */}
      <Section title="Сравнение точек" subtitle="Сводная таблица по всем ресторанам в срезе" right={<button onClick={onNav} className="btn text-brand-300 hover:text-brand-200">К проверке цен →</button>}>
        <div className="overflow-x-auto rounded-xl border border-ink-700/50">
          <table className="w-full">
            <thead className="bg-ink-800/50">
              <tr>
                <th className="th">Ресторан</th>
                <th className="th text-right">Закупка</th>
                <th className="th text-right">Позиций</th>
                <th className="th text-right">Совпадение</th>
                <th className="th text-right">Переплаты</th>
                <th className="th text-right">Экономия</th>
                <th className="th text-right">Чистый эффект</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => {
                const s = c.summary
                return (
                  <tr key={c.name} className="row-hover cursor-pointer hover:bg-ink-800/40" onClick={() => focus(c.name)}>
                    <td className="td font-medium text-slate-100">{c.name}</td>
                    <td className="td text-right tabnum text-slate-300">{money(s.spend)}</td>
                    <td className="td text-right tabnum text-slate-400">{fmt(s.positions)}</td>
                    <td className="td text-right tabnum text-slate-400">{pct(s.matchRate).replace('+', '')}</td>
                    <td className="td text-right tabnum text-bad">{moneyShort(s.overpaySum)}</td>
                    <td className="td text-right tabnum text-good">{moneyShort(s.savingSum)}</td>
                    <td className={`td text-right tabnum font-semibold ${s.netEffect >= 0 ? 'text-good' : 'text-bad'}`}>{moneyShort(s.netEffect)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

type GroupedRows = { name: string; rows: Row[]; summary: ReturnType<typeof summarize> }

function RestaurantProfile({
  name, meta, summary, topOverpay, topSaving, topSuppliers, byCategory, onBack, onNav,
}: {
  name: string
  meta: VenueMeta | null
  summary: ReturnType<typeof summarize>
  topOverpay: Row[]
  topSaving: Row[]
  topSuppliers: GroupedRows[]
  byCategory: GroupedRows[]
  onBack: () => void
  onNav: () => void
}) {
  const metaLine = [meta?.entity, meta?.city, meta?.category].filter(Boolean).join(' · ')
  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-300"><IStore width={20} height={20} /></span>
          <div>
            <div className="text-base font-semibold text-white">{name}</div>
            {metaLine && <div className="text-xs text-slate-500">{metaLine}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onNav} className="btn border border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750">В «Проверке цен» →</button>
          <button onClick={onBack} className="btn text-brand-300 hover:text-brand-200">← Все точки</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
        <Stat label="Закупка" value={moneyShort(summary.spend)} tone="slate" />
        <Stat label="Позиций" value={fmt(summary.positions)} tone="slate" />
        <Stat label="Совпадение" value={pct(summary.matchRate).replace('+', '')} tone="slate" />
        <Stat label="Переплаты" value={moneyShort(summary.overpaySum)} tone="bad" />
        <Stat label="Экономия" value={moneyShort(summary.savingSum)} tone="good" />
        <Stat label="Чистый эффект" value={moneyShort(summary.netEffect)} tone={summary.netEffect >= 0 ? 'good' : 'bad'} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Крупнейшие переплаты" subtitle="Приоритет для переговоров с поставщиком">
          {topOverpay.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">Переплат не найдено 🎉</div>
          ) : (
            <TopTable rows={topOverpay} tone="bad" />
          )}
        </Section>
        <Section title="Крупнейшая экономия" subtitle="Позиции, где факт дешевле плана">
          {topSaving.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">Экономии не найдено</div>
          ) : (
            <TopTable rows={topSaving} tone="good" />
          )}
        </Section>
      </div>

      <Section title="Поставщики" subtitle="По сумме закупки в этой точке">
        {topSuppliers.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Нет данных в этом срезе</div>
        ) : (
          <div className="space-y-2">
            {topSuppliers.map((g) => {
              const max = topSuppliers[0].summary.spend || 1
              const good = g.summary.netEffect >= 0
              return (
                <div key={g.name} className="rounded-lg border border-ink-700/50 bg-ink-900/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <HoverName text={g.name} className="min-w-0 flex-1 text-sm font-medium text-slate-200" />
                    <div className="flex shrink-0 items-center gap-4 text-right">
                      <span className={`text-xs font-semibold tabnum ${good ? 'text-good' : 'text-bad'}`}>{moneyShort(g.summary.netEffect)}</span>
                      <span className="w-20 text-xs tabnum text-slate-400">{moneyShort(g.summary.spend)}</span>
                    </div>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-750">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-500/60 to-brand-400" style={{ width: `${(g.summary.spend / max) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {byCategory.length > 1 && (
        <Section title="По категориям закупок" subtitle="Кухня / Бар / Алкоголь / Безалкоголь / ERO — как выбрано в фильтре">
          <div className="overflow-x-auto rounded-xl border border-ink-700/50">
            <table className="w-full">
              <thead className="bg-ink-800/50">
                <tr>
                  <th className="th">Категория</th>
                  <th className="th text-right">Закупка</th>
                  <th className="th text-right">Позиций</th>
                  <th className="th text-right">Переплаты</th>
                  <th className="th text-right">Экономия</th>
                  <th className="th text-right">Чистый эффект</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((g) => (
                  <tr key={g.name} className="row-hover hover:bg-ink-800/40">
                    <td className="td font-medium text-slate-100">{g.name}</td>
                    <td className="td text-right tabnum text-slate-300">{money(g.summary.spend)}</td>
                    <td className="td text-right tabnum text-slate-400">{fmt(g.summary.positions)}</td>
                    <td className="td text-right tabnum text-bad">{moneyShort(g.summary.overpaySum)}</td>
                    <td className="td text-right tabnum text-good">{moneyShort(g.summary.savingSum)}</td>
                    <td className={`td text-right tabnum font-semibold ${g.summary.netEffect >= 0 ? 'text-good' : 'text-bad'}`}>{moneyShort(g.summary.netEffect)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  )
}

function TopTable({ rows, tone }: { rows: Row[]; tone: 'bad' | 'good' }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-ink-700/50">
      <table className="w-full table-fixed">
        <thead className="bg-ink-800/50">
          <tr>
            <th className="th w-[42%]">Товар</th>
            <th className="th w-[24%] text-right">План</th>
            <th className="th w-[15%] text-right">Δ%</th>
            <th className="th w-[19%] text-right">Эффект</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="row-hover hover:bg-ink-800/40">
              <td className="td overflow-hidden font-medium text-slate-100"><HoverName text={r.product} /><HoverName text={r.supplier} className="text-[11px] font-normal text-slate-500" /></td>
              <td className="td text-right tabnum text-slate-400">{money(r.plan!)}<div className="text-[11px] text-slate-600">факт {money(r.unit)}</div></td>
              <td className={`td text-right tabnum font-semibold ${tone === 'bad' ? 'text-bad' : 'text-good'}`}>{pct(r.diffPct!)}</td>
              <td className={`td text-right tabnum font-semibold ${tone === 'bad' ? 'text-bad' : 'text-good'}`}>{moneyShort(r.effect)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'bad' | 'good' | 'slate' }) {
  const cls = tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-slate-100'
  return (
    <div className="card p-3.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-lg font-bold tabnum ${cls}`}>{value}</div>
    </div>
  )
}

function Mini({ icon, label, value, tone }: { icon?: React.ReactNode; label: string; value: string; tone: 'bad' | 'good' | 'slate' }) {
  const cls = tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-slate-300'
  return (
    <div className="rounded-lg bg-ink-900/50 py-1.5">
      <div className={`flex items-center justify-center gap-1 text-sm font-semibold tabnum ${cls}`}>{icon}{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  )
}
