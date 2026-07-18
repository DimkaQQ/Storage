import { useMemo } from 'react'
import { Row, byRestaurant, moneyShort, money, fmt, pct } from '../lib/data'
import { useEdits } from '../lib/edits'
import { Section } from '../components/ui'
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

  return (
    <div className="space-y-6">
      <Section
        title="Точки продаж"
        subtitle={scope.size === 0 ? 'Показаны все точки — нажмите на карточку, чтобы посмотреть отдельно' : `Фокус: ${[...scope].join(', ')}`}
        right={scope.size > 0 ? <button onClick={() => onScope(new Set())} className="btn text-brand-300 hover:text-brand-200">Показать все</button> : undefined}
      >
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {cards.map((c, i) => {
            const s = c.summary
            const good = s.netEffect >= 0
            const isFocus = scope.has(c.name)
            const rest = restaurants.find((r) => r.name === c.name)
            return (
              <button
                key={c.name}
                onClick={() => focus(c.name)}
                style={{ animationDelay: `${i * 45}ms` }}
                className={`card card-hover group animate-fade-up p-4 text-left ${isFocus ? 'ring-1 ring-brand-500/60' : ''}`}
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

function Mini({ icon, label, value, tone }: { icon?: React.ReactNode; label: string; value: string; tone: 'bad' | 'good' | 'slate' }) {
  const cls = tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-slate-300'
  return (
    <div className="rounded-lg bg-ink-900/50 py-1.5">
      <div className={`flex items-center justify-center gap-1 text-sm font-semibold tabnum ${cls}`}>{icon}{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  )
}
