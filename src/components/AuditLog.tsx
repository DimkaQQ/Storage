import { useEffect, useMemo, useRef, useState } from 'react'
import { AuditEntry, fetchAudit } from '../lib/api'
import FilterDropdown from './FilterDropdown'
import { EmptyHint } from './ui'
import { ISearch, IUser, ILayers } from './icons'

// цвет метки по категории: справочники — фирменный, цены — зелёный, команда — жёлтый, система — красный, остальное — нейтральный
const CAT_STYLE: Record<string, string> = {
  'Справочники': 'border-brand-500/30 bg-brand-500/10 text-brand-200',
  'Цены': 'border-good/30 bg-good/10 text-good',
  'Команда': 'border-warn/30 bg-warn/10 text-warn',
  'Система': 'border-bad/30 bg-bad/10 text-bad',
}
const catStyle = (c: string) => CAT_STYLE[c] ?? 'border-ink-600 bg-ink-800/70 text-fg-300'

// «Иванов Иван» из почты не получить — берём часть до @, а в подсказке показываем всю
const nameOf = (email: string | null) => (email ? email.split('@')[0] : 'неизвестно')
const AVATARS = ['bg-brand-500/20 text-brand-200', 'bg-good/20 text-good', 'bg-warn/20 text-warn', 'bg-bad/20 text-bad', 'bg-ink-700 text-fg-200']
const avatarOf = (email: string | null) => {
  let h = 0
  for (const ch of email ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATARS[h % AVATARS.length]
}

const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
function dayLabel(iso: string) {
  const d = new Date(iso), now = new Date()
  const y = new Date(now); y.setDate(now.getDate() - 1)
  const full = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' })
  if (dayKey(iso) === dayKey(now.toISOString())) return `Сегодня · ${full}`
  if (dayKey(iso) === dayKey(y.toISOString())) return `Вчера · ${full}`
  return full
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

/** Журнал действий: кто, когда и что сделал. Только для администратора. */
export default function AuditLog() {
  const [items, setItems] = useState<AuditEntry[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const [users, setUsers] = useState<string[]>([])
  const [cats, setCats] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [email, setEmail] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const seq = useRef(0) // отбрасываем ответы устаревших запросов (быстро меняли фильтры)

  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t) }, [q])

  const load = async (append: boolean) => {
    const my = ++seq.current
    setLoading(true)
    const page = await fetchAudit({ q: qDebounced, email: email ?? '', category: category ?? '', before: append ? items[items.length - 1]?.id : 0 })
    if (my !== seq.current) return
    setLoading(false)
    if (!page) { if (append) setMoreFailed(true); else setFailed(true); return }
    setFailed(false); setMoreFailed(false)
    setItems((prev) => (append ? [...prev, ...page.items] : page.items))
    setMore(page.more)
    setUsers(page.filters.users); setCats(page.filters.categories)
  }
  useEffect(() => { void load(false) }, [qDebounced, email, category]) // eslint-disable-line react-hooks/exhaustive-deps

  // записи по дням
  const days = useMemo(() => {
    const out: { key: string; label: string; rows: AuditEntry[] }[] = []
    for (const it of items) {
      const k = dayKey(it.ts)
      if (!out.length || out[out.length - 1].key !== k) out.push({ key: k, label: dayLabel(it.ts), rows: [] })
      out[out.length - 1].rows.push(it)
    }
    return out
  }, [items])

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <div className="flex flex-nowrap items-center justify-center gap-2">
          <div className="relative w-56 min-w-[120px] shrink">
            <ISearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-500" width={16} height={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по журналу"
              className="h-10 w-full rounded-lg border border-ink-600 bg-ink-900/60 pl-9 pr-3 text-sm text-fg-100 placeholder:text-fg-600 focus:border-brand-500 focus:outline-none" />
          </div>
          <FilterDropdown label="Кто" allLabel="Все люди" icon={IUser} wide value={email} options={users} onChange={setEmail} />
          <FilterDropdown label="Что" allLabel="Все события" icon={ILayers} wide value={category} options={cats} onChange={setCategory} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-700/50 px-5 py-4">
          <h2 className="text-[15px] font-semibold text-fg-50">Журнал действий</h2>
          <p className="mt-0.5 text-xs text-fg-500">Кто, когда и что сделал в программе. Записи нельзя изменить или удалить из программы, хранятся год.</p>
        </div>

        {failed && <div className="px-5 py-10"><EmptyHint>Не удалось загрузить журнал — проверьте соединение.</EmptyHint></div>}
        {!failed && !loading && items.length === 0 && <div className="px-5 py-10"><EmptyHint>{q || email || category ? 'По этим условиям ничего не найдено.' : 'Журнал пока пуст — записи появятся, когда кто-то что-то сделает.'}</EmptyHint></div>}

        {days.map((d) => (
          <div key={d.key}>
            <div className="sticky top-0 z-10 border-y border-ink-700/40 bg-ink-850/95 px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-500 backdrop-blur">{d.label}</div>
            <ul>
              {d.rows.map((r) => (
                <li key={r.id} className="flex items-start gap-4 border-b border-ink-700/30 px-5 py-3 last:border-b-0 hover:bg-ink-800/30">
                  <div className="w-11 shrink-0 pt-1 text-right text-xs tabular-nums text-fg-500" title={new Date(r.ts).toLocaleString('ru-RU')}>{timeOf(r.ts)}</div>
                  <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold uppercase ${avatarOf(r.email)}`} title={r.email ?? ''}>{nameOf(r.email).slice(0, 1)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-fg-100" title={r.email ?? ''}>{nameOf(r.email)}</span>
                      <span className="text-sm text-fg-300">{r.action}</span>
                    </div>
                    {r.details && <div className="mt-0.5 break-words text-[13px] leading-snug text-fg-500">{r.details}</div>}
                  </div>
                  <span className={`chip shrink-0 ${catStyle(r.category)}`}>{r.category}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {loading && items.length === 0 && <div className="px-5 py-10 text-center text-sm text-fg-500">Загружаю…</div>}
        {more && (
          <div className="border-t border-ink-700/40 p-4 text-center">
            <button onClick={() => load(true)} disabled={loading} className="btn h-10 border border-ink-600 bg-ink-900/60 text-fg-100 hover:border-ink-500 disabled:opacity-60">
              {loading ? 'Загружаю…' : moreFailed ? 'Не получилось — повторить' : 'Показать ещё'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
