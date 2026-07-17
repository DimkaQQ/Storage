import { useMemo, useState } from 'react'
import { money } from '../lib/data'
import { rankSimilar } from '../lib/fuzzy'
import { IClose, ISearch, ISpark } from './icons'

/** Constructor: сопоставить закупленную позицию с плановым товаром из матрицы. */
export default function MatchModal({ target, products, onClose, onPick }: {
  target: { product0: string; product: string }
  products: { name: string; basePlan: number | null; inMatrix: boolean; sum: number }[]
  onClose: () => void
  onPick: (plan: number) => void
}) {
  const [q, setQ] = useState('')
  const withPlan = useMemo(
    () => products.filter((p) => p.basePlan != null && p.name !== target.product0),
    [products, target.product0],
  )

  // Пока пользователь не начал печатать — подсказываем похожие названия
  // (нечёткое сопоставление на клиенте, без ИИ). Как только он вводит текст —
  // переключаемся на обычный поиск по подстроке.
  const needle = q.trim()
  const suggested = useMemo(
    () => (needle ? [] : rankSimilar(target.product, withPlan, (p) => p.name).slice(0, 8)),
    [needle, withPlan, target.product],
  )
  const suggestedNames = new Set(suggested.map((s) => s.item.name))
  const searched = useMemo(
    () => (needle ? withPlan.filter((p) => p.name.toLowerCase().includes(needle.toLowerCase())) : withPlan.filter((p) => !suggestedNames.has(p.name))),
    [needle, withPlan, suggestedNames],
  )
  const list = searched.slice(0, 60)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="animate-fade-in absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-scale-in relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 shadow-card">
        <div className="border-b border-ink-700/60 px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Сопоставить с товаром из матрицы</h3>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-ink-800 hover:text-white"><IClose width={16} height={16} /></button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Закупка: <span className="text-slate-300">{target.product}</span>. Выберите плановый товар — его цена станет плановой для этой позиции.
          </p>
          <div className="relative mt-3">
            <ISearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width={16} height={16} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск планового товара…"
              className="w-full rounded-lg border border-ink-600 bg-ink-900/60 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none" />
          </div>
        </div>
        <div className="overflow-y-auto">
          {suggested.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 bg-ink-900/40 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <ISpark width={12} height={12} className="text-brand-300" /> Похоже на это
              </div>
              {suggested.map(({ item: p, score }) => (
                <button key={p.name} onClick={() => onPick(p.basePlan!)} className="flex w-full items-center justify-between gap-3 border-b border-ink-700/40 bg-brand-500/[0.04] px-5 py-2.5 text-left hover:bg-ink-800/60">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-slate-200">{p.name}</span>
                    {score > 0.6 && <span className="chip shrink-0 border-good/30 bg-good/10 text-[10px] text-good">похоже</span>}
                  </span>
                  <span className="shrink-0 tabnum text-sm font-semibold text-brand-300">{money(p.basePlan!)}</span>
                </button>
              ))}
              <div className="bg-ink-900/40 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Все товары</div>
            </div>
          )}
          {list.map((p) => (
            <button key={p.name} onClick={() => onPick(p.basePlan!)} className="flex w-full items-center justify-between border-b border-ink-700/40 px-5 py-2.5 text-left hover:bg-ink-800/60">
              <span className="text-sm text-slate-200">{p.name}</span>
              <span className="tabnum text-sm font-semibold text-brand-300">{money(p.basePlan!)}</span>
            </button>
          ))}
          {list.length === 0 && suggested.length === 0 && <div className="py-10 text-center text-sm text-slate-500">Ничего не найдено.</div>}
        </div>
      </div>
    </div>
  )
}
