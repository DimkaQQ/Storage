import { useEffect, useState } from 'react'
import { fetchMonthFixes, fetchPeriods, MonthFixMeta } from '../lib/api'
import { useEdits, periodLabelOf } from '../lib/edits'
import { ILock, ITrash } from './icons'

/**
 * «Фиксация месяца» (страница «Фиксация месяца», бывшая «Цены на период»): выбрать месяц и сохранить его целиком —
 * матрицу из таблицы (цены, названия, товары, кто назначен), привязки из Справочников и закупки из iiko. Ниже — список
 * зафиксированных месяцев: зафиксировать заново или снять фиксацию. Логика — fixMonth/unfixMonth в edits.tsx.
 */
export default function MonthFixCard() {
  const { fixMonth, unfixMonth, periodKey, dataVersion } = useEdits()
  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const prevMonth = (() => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()
  const [month, setMonth] = useState(/^\d{4}-\d{2}$/.test(periodKey) && periodKey < thisMonth ? periodKey : prevMonth)
  const [fixes, setFixes] = useState<MonthFixMeta[]>([])
  const [loaded, setLoaded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const reload = () => {
    fetchMonthFixes().then((r) => setFixes(r?.months ?? []))
    fetchPeriods().then((l) => setLoaded(new Set((l ?? []).map((p) => p.period).filter((p) => /^\d{4}-\d{2}$/.test(p)))))
  }
  useEffect(reload, [dataVersion])
  // месяцы для выбора: закончившиеся (загруженные + прошлый), свежие сверху; текущий ещё идёт — его не фиксируют
  const options = [...new Set([...loaded, prevMonth])].filter((m) => m < thisMonth).sort().reverse()
  const cur = fixes.find((f) => f.month === month)
  const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(' г.', '') : ''

  const doFix = async (m: string) => {
    const again = fixes.some((f) => f.month === m)
    if (!window.confirm(`Зафиксировать ${periodLabelOf(m)}?\n\nСохранится всё как сейчас: матрица из Google-таблицы (цены, названия, товары, кто на что назначен), привязки из Справочников и закупки из iiko. Месяц будет показываться именно таким, а загрузка из iiko за него — отключена, пока фиксацию не снимут.${again ? '\n\nМесяц уже зафиксирован — прежняя фиксация заменится сегодняшним состоянием.' : ''}`)) return
    setBusy(m); setMsg(null)
    try { const r = await fixMonth(m); setMsg({ ok: r.ok, text: r.message }); reload() } finally { setBusy(null) }
  }
  const doUnfix = async (m: string) => {
    if (!window.confirm(`Снять фиксацию «${periodLabelOf(m)}»? Месяц снова будет показываться по текущим привязкам и закупкам, и его можно будет обновить из iiko. Цены матрицы за месяц останутся.`)) return
    setBusy(m); setMsg(null)
    try { const r = await unfixMonth(m); setMsg({ ok: r.ok, text: r.message }); reload() } finally { setBusy(null) }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 rounded-2xl border border-ink-600/70 bg-ink-850 p-5">
      <div>
        <div className="mb-1 text-base font-semibold text-fg-50">Зафиксировать месяц</div>
        <p className="text-xs leading-relaxed text-fg-500">Сохраняет месяц целиком: матрицу (цены, названия, товары, кто на что назначен), привязки из Справочников и закупки из iiko. Потом таблица, Справочники и iiko могут меняться — зафиксированный месяц останется таким, каким был.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select value={month} onChange={(e) => { setMonth(e.target.value); setMsg(null) }} className="h-10 min-w-[180px] rounded-lg border border-ink-600 bg-ink-900/60 px-3 text-sm text-fg-100">
          {options.map((m) => <option key={m} value={m}>{periodLabelOf(m)}{fixes.some((f) => f.month === m) ? ' — зафиксирован' : loaded.has(m) ? '' : ' — не загружен'}</option>)}
        </select>
        <button onClick={() => doFix(month)} disabled={!!busy || !loaded.has(month)} title={loaded.has(month) ? '' : 'Сначала загрузите закупки за этот месяц (Проверка цен → «Обновить»)'}
          className="btn h-10 bg-brand-500 px-4 text-sm text-white hover:bg-brand-600 disabled:opacity-50">
          <ILock width={14} height={14} />{busy === month ? 'Фиксирую…' : cur ? 'Зафиксировать заново' : 'Зафиксировать месяц'}
        </button>
      </div>
      {!loaded.has(month) && <p className="text-xs text-warn">Закупки за {periodLabelOf(month)} ещё не загружены — загрузите их в «Проверке цен» кнопкой «Обновить».</p>}
      {msg && <p className={`text-sm ${msg.ok ? 'text-good' : 'text-bad'}`}>{msg.text}</p>}
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-500">Зафиксированные месяцы</div>
        {!fixes.length ? <p className="text-sm text-fg-500">Пока нет.</p> : (
          <div className="divide-y divide-ink-700/60 rounded-xl border border-ink-700">
            {[...fixes].reverse().map((f) => (
              <div key={f.month} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium text-fg-100"><ILock className="text-amber-300" width={12} height={12} />{periodLabelOf(f.month)}</div>
                  <div className="truncate text-xs text-fg-500">{when(f.fixedAt)}{f.by ? ` · ${f.by}` : ''}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => doFix(f.month)} disabled={!!busy} className="rounded-lg border border-ink-600 px-2.5 py-1 text-xs text-fg-200 hover:border-ink-500 disabled:opacity-50">Заново</button>
                  <button onClick={() => doUnfix(f.month)} disabled={!!busy} title="Снять фиксацию" className="rounded-lg p-1.5 text-fg-500 hover:bg-ink-800 hover:text-bad disabled:opacity-50"><ITrash width={14} height={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
