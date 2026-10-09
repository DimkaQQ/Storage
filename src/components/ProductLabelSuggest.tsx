import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Как EditableText, но с выпадающим списком — начали печатать, список сам
 * сужается по подстроке (везде, где встречается введённый текст, не только
 * с начала), как автопоиск в выпадающем списке Google Sheets. Используется
 * и для товаров (список всех известных названий из матрицы — у части
 * подсказок одинаковый текст на самом деле означает разные товары у разных
 * поставщиков; поставщик виден при наведении на подсказку, всплывающей
 * табличкой, а не постоянной второй строкой — не захламляет список тем,
 * кто и так узнаёт нужный товар по названию), и для компаний (список всех
 * известных названий поставщиков — там supplier не нужен, каждая подсказка
 * сама по себе имя).
 *
 * Список рендерится в портал (document.body), а не обычным потомком поля —
 * иначе его обрезает ячейка таблицы (у неё overflow-hidden, чтобы длинный
 * текст не ломал ширину колонки), и на узком экране видна едва ли одна
 * строка списка вместо всего выпадающего меню. Та же причина и то же
 * решение, что уже применено в InfoTip.
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
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const [tip, setTip] = useState<{ left: number; top: number; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => setV(value), [value])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (inputRef.current?.contains(t)) return
      if (dropRef.current?.contains(t)) return
      setOpen(false)
      setTip(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const TIP_WIDTH = 240

  // Поставщик у подсказки товара — не постоянной второй строкой (список
  // тогда становится вдвое выше и захламляется для тех, кто и так узнаёт
  // товар по названию), а всплывающей табличкой только при наведении —
  // так же, как ⓘ у InfoTip. Пробуем показать справа от подсказки; если
  // справа не хватает места (список у правого края экрана) — слева.
  const openTip = (el: HTMLElement, text: string) => {
    const r = el.getBoundingClientRect()
    const m = 10
    const onRight = window.innerWidth - r.right >= TIP_WIDTH + 16
    const left = onRight ? r.right + 8 : Math.max(m, r.left - TIP_WIDTH - 8)
    const top = Math.max(m, Math.min(r.top, window.innerHeight - m - 50))
    setTip({ left, top, text })
  }
  const closeTip = () => setTip(null)

  const DROPDOWN_MAX_H = 256 // max-h-64

  const updatePos = () => {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // visualViewport — реально видимая область; на мобильном при открытой
    // клавиатуре она заметно меньше window.innerHeight (тот остаётся
    // полным размером страницы даже под клавиатурой), из-за чего список,
    // посчитанный по window.innerHeight, мог оказаться отрисован НИЖЕ
    // видимой части экрана — визуально неотличимо от "не появился вовсе".
    const vv = window.visualViewport
    const viewportH = vv?.height ?? window.innerHeight
    const viewportW = vv?.width ?? window.innerWidth
    const width = Math.max(r.width, 260)
    const left = Math.max(10, Math.min(r.left, viewportW - width - 10))
    // Обычно открываем прямо под полем; если снизу видимой области не
    // хватает места (клавиатура съела низ экрана) — прижимаем к низу
    // видимой области, а не туда, где список гарантированно скрыт.
    const spaceBelow = viewportH - r.bottom
    const top = spaceBelow >= 80 ? r.bottom + 4 : Math.max(10, viewportH - DROPDOWN_MAX_H - 10)
    setPos({ left, top, width })
  }

  const openDropdown = () => {
    updatePos()
    setOpen(true)
  }

  // Пока список открыт — пересчитываем позицию при скролле/ресайзе.
  // Особенно важно на мобильном: фокус на поле открывает клавиатуру, а
  // вьюпорт "доезжает" (скроллится/сжимается) уже ПОСЛЕ момента фокуса —
  // разовый расчёт координат в openDropdown к этому моменту устаревает, и
  // список рисуется не там, где кажется, будто его нет вовсе. capture:true
  // на scroll — таблица обычно сама горизонтально скроллится (overflow-x),
  // и это тоже "скролл", но не всплывает без capture. visualViewport —
  // отдельно, потому что на iOS Safari появление клавиатуры не всегда
  // генерирует обычный window resize, а visualViewport.resize — надёжнее.
  useEffect(() => {
    if (!open) return
    updatePos()
    const vv = window.visualViewport
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    vv?.addEventListener('resize', updatePos)
    vv?.addEventListener('scroll', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
      vv?.removeEventListener('resize', updatePos)
      vv?.removeEventListener('scroll', updatePos)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const commit = (next: string) => {
    setV(next)
    // Как и в onBlur — если кликнули подсказку, которая совпадает с уже
    // показанным значением (частый случай: подсказка ровно одна и это то,
    // что и так уже стоит), это не правка, коммитить нечего.
    if (next !== value) onCommit(next)
    setOpen(false)
    setTip(null)
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
    <div className="relative">
      <input
        ref={inputRef}
        value={v}
        title={v}
        onFocus={openDropdown}
        onChange={(e) => { setV(e.target.value); openDropdown() }}
        // Коммитим только если реально поменяли значение — иначе просто
        // кликнуть в поле и выйти (например, случайно проходя табом) молча
        // "замораживает" текущую подсказку как ручное переименование.
        onBlur={() => { if (v !== value) onCommit(v) }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={`w-full max-w-md rounded-md border border-ink-700/50 bg-ink-900/40 px-2 py-1 text-sm text-slate-100 transition-colors hover:border-ink-500 focus:border-brand-500 focus:bg-ink-900/70 focus:outline-none ${className}`}
      />
      {open && pos && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width }}
          className="animate-scale-in z-[100] max-h-64 overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 shadow-xl"
        >
          {filtered.length > 0 ? filtered.map((s, i) => (
            <button
              key={i}
              // onMouseDown (не onClick) + preventDefault — иначе onBlur инпута
              // срабатывает раньше клика и закрывает список до выбора.
              onMouseDown={(e) => { e.preventDefault(); commit(s.label) }}
              onMouseEnter={(e) => { if (s.supplier) openTip(e.currentTarget, s.supplier) }}
              onMouseLeave={closeTip}
              className="block w-full truncate px-3 py-2 text-left text-sm text-slate-200 hover:bg-ink-800"
            >
              {s.label}
            </button>
          )) : (
            // Пустой список подсказок молча пропадал совсем — на вид
            // неотличимо от "поле сломалось". Список суженный по подстроке
            // ищет только среди того, что уже известно ИМЕННО этому
            // поставщику — если печатаете что-то от другой компании,
            // подсказок закономерно не будет; но поле всё равно рабочее,
            // можно вписать текст свободно, просто без автоподбора.
            <div className="px-3 py-2.5 text-xs text-slate-500">
              Ничего не найдено среди уже известного — можно вписать своим текстом.
            </div>
          )}
        </div>,
        document.body,
      )}
      {tip && createPortal(
        <div
          role="tooltip"
          style={{ position: 'fixed', left: tip.left, top: tip.top, width: TIP_WIDTH }}
          className="pointer-events-none z-[110] rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-xs leading-snug text-slate-300 shadow-xl"
        >
          {tip.text}
        </div>,
        document.body,
      )}
    </div>
  )
}
