import { useMemo, useState } from 'react'
import { fmt } from '../lib/data'
import { rankSimilar } from '../lib/fuzzy'
import { IClose, ISearch, ISpark } from './icons'

/** «Это тот же поставщик, что и...» — объединить неопознанную компанию с уже известной. */
export default function SupplierMergeModal({ target, suppliers, onClose, onPick }: {
  target: { name: string }
  suppliers: { name: string; count: number; sum: number }[]
  onClose: () => void
  onPick: (canonicalName: string) => void
}) {
  const [q, setQ] = useState('')
  const candidates = useMemo(() => suppliers.filter((s) => s.name !== target.name), [suppliers, target.name])

  const needle = q.trim()
  const suggested = useMemo(
    () => (needle ? [] : rankSimilar(target.name, candidates, (s) => s.name).slice(0, 8)),
    [needle, candidates, target.name],
  )
  const suggestedNames = new Set(suggested.map((s) => s.item.name))
  const searched = useMemo(
    () => (needle ? candidates.filter((s) => s.name.toLowerCase().includes(needle.toLowerCase())) : candidates.filter((s) => !suggestedNames.has(s.name))),
    [needle, candidates, suggestedNames],
  )
  const list = searched.slice(0, 60)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="animate-fade-in absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-scale-in relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 shadow-card">
        <div className="border-b border-ink-700/60 px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Это тот же поставщик, что и...</h3>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-ink-800 hover:text-white"><IClose width={16} height={16} /></button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            «<span className="text-slate-300">{target.name}</span>» нет в справочнике. Выберите существующего поставщика —
            дальше цены для этой компании будут сравниваться так же, как для него, а в отчётах они объединятся в одну строку.
          </p>
          <div className="relative mt-3">
            <ISearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width={16} height={16} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск поставщика…"
              className="w-full rounded-lg border border-ink-600 bg-ink-900/60 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none" />
          </div>
        </div>
        <div className="overflow-y-auto">
          {suggested.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 bg-ink-900/40 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <ISpark width={12} height={12} className="text-brand-300" /> Похоже на это
              </div>
              {suggested.map(({ item: s, score }) => (
                <button key={s.name} onClick={() => onPick(s.name)} className="flex w-full items-center justify-between gap-3 border-b border-ink-700/40 bg-brand-500/[0.04] px-5 py-2.5 text-left hover:bg-ink-800/60">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-slate-200">{s.name}</span>
                    {score > 0.6 && <span className="chip shrink-0 border-good/30 bg-good/10 text-[10px] text-good">похоже</span>}
                  </span>
                  <span className="shrink-0 tabnum text-xs text-slate-500">{fmt(s.count)} поз.</span>
                </button>
              ))}
              <div className="bg-ink-900/40 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Все поставщики</div>
            </div>
          )}
          {list.map((s) => (
            <button key={s.name} onClick={() => onPick(s.name)} className="flex w-full items-center justify-between border-b border-ink-700/40 px-5 py-2.5 text-left hover:bg-ink-800/60">
              <span className="text-sm text-slate-200">{s.name}</span>
              <span className="tabnum text-xs text-slate-500">{fmt(s.count)} поз.</span>
            </button>
          ))}
          {list.length === 0 && suggested.length === 0 && <div className="py-10 text-center text-sm text-slate-500">Ничего не найдено.</div>}
        </div>
      </div>
    </div>
  )
}
