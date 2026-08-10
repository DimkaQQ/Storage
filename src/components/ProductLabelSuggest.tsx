import { useEffect, useRef, useState } from 'react'

/**
 * Как EditableText, но с выпадающим списком — начали печатать, список сам
 * сужается по подстроке (везде, где встречается введённый текст, не только
 * с начала), как автопоиск в выпадающем списке Google Sheets. Используется
 * и для товаров (список всех известных названий из матрицы — тогда у
 * подсказки виден ещё и поставщик, чтобы не перепутать, откуда какое
 * описание), и для компаний (список всех известных названий поставщиков —
 * там supplier не нужен, каждая подсказка сама по себе имя).
 */
export default function ProductLabelSuggest({
  value, suggestions, onCommit, className = '',
}: {
  value: string
  suggestions: { label: string; supplier?: string }[]
  onCommit: (v: string) => void
  className?: string
}) {
  const [v, setV] = useState(value)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setV(value), [value])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const commit = (next: string) => {
    setV(next)
    // Как и в onBlur — если кликнули подсказку, которая совпадает с уже
    // показанным значением (частый случай: подсказка ровно одна и это то,
    // что и так уже стоит), это не правка, коммитить нечего.
    if (next !== value) onCommit(next)
    setOpen(false)
  }

  // Сужаем по подстроке (не только с начала слова) — "лос" находит и
  // "Рыба лосось", и "король-лосось"; ищем и по названию, и по поставщику
  // (если он есть у подсказки), чтобы "ази" находило "Азик Трейд" даже
  // если печатают в поле товара, а не компании. Список ограничен 200
  // строками — с непустым текстом фильтр и так почти всегда сузит гораздо
  // сильнее, а без текста показываем начало полного списка, не всё разом.
  const needle = v.trim().toLowerCase()
  const filtered = (needle
    ? suggestions.filter((s) => s.label.toLowerCase().includes(needle) || (s.supplier ?? '').toLowerCase().includes(needle))
    : suggestions
  ).slice(0, 200)

  return (
    <div className="relative" ref={ref}>
      <input
        value={v}
        title={v}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setV(e.target.value); setOpen(true) }}
        // Коммитим только если реально поменяли значение — иначе просто
        // кликнуть в поле и выйти (например, случайно проходя табом) молча
        // "замораживает" текущую подсказку как ручное переименование.
        onBlur={() => { if (v !== value) onCommit(v) }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={`w-full max-w-md rounded-md border border-ink-700/50 bg-ink-900/40 px-2 py-1 text-sm text-slate-100 transition-colors hover:border-ink-500 focus:border-brand-500 focus:bg-ink-900/70 focus:outline-none ${className}`}
      />
      {open && filtered.length > 0 && (
        <div className="animate-scale-in absolute left-0 z-30 mt-1 max-h-64 w-80 overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 shadow-card">
          {filtered.map((s, i) => (
            <button
              key={i}
              // onMouseDown (не onClick) + preventDefault — иначе onBlur инпута
              // срабатывает раньше клика и закрывает список до выбора.
              onMouseDown={(e) => { e.preventDefault(); commit(s.label) }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-ink-800"
            >
              <span className="w-full truncate text-sm text-slate-200">{s.label}</span>
              {s.supplier && <span className="w-full truncate text-[11px] text-slate-500">{s.supplier}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
