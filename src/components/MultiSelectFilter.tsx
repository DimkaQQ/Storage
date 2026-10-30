import { useMemo, useState } from 'react'
import { ISearch, IChevron, ICheck, IClose } from './icons'
import { useClickOutside } from '../lib/hooks'

export interface FilterOption {
  key: string
  label: string
  // Доп. строка под label для различения одинаково выглядящих значений
  // (напр. фасовка "1.5" сама по себе ничего не говорит, пока не видно,
  // у какого именно поставщика она встретилась) — опционально, не у всех
  // списков есть что уточнять.
  sublabel?: string
}

/**
 * Выпадающий фильтр с множественным выбором и поиском ВНУТРИ списка (как в
 * гугл-таблицах) — обычный <select> для Поставщика/Товара в Проверке цен
 * не годился сразу по двум причинам, обе — прямой запрос:
 * 1) нельзя выбрать несколько значений сразу;
 * 2) нельзя набрать текст и сузить длинный список (сотни фасовок/названий),
 *    native-датчик браузера звёздочкой переходит по первой букве, а не
 *    фильтрует.
 * Список рендерится в портал (как ScopePicker/ProductLabelSuggest) —
 * иначе родительская ячейка/карточка с overflow обрезала бы его.
 */
export default function MultiSelectFilter({
  allLabel, options, selected, onChange,
}: {
  allLabel: string
  options: FilterOption[]
  selected: Set<string>
  onChange: (s: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useClickOutside(() => { setOpen(false); setQ('') })

  const toggle = (key: string) => {
    const next = new Set(selected)
    next.has(key) ? next.delete(key) : next.add(key)
    onChange(next)
  }

  const needle = q.trim().toLowerCase()
  const filteredOptions = useMemo(() => {
    const list = needle
      ? options.filter((o) => o.label.toLowerCase().includes(needle) || (o.sublabel ?? '').toLowerCase().includes(needle))
      : options
    // Список может быть на тысячи строк (все названия/фасовки за период) —
    // рисуем не больше 300 за раз, непустой поиск и так почти всегда сузит
    // гораздо сильнее; остальное можно найти, уточнив текст.
    return list.slice(0, 300)
  }, [options, needle])

  const singleSelected = selected.size === 1 ? options.find((o) => o.key === [...selected][0]) : undefined
  const buttonLabel =
    selected.size === 0 ? allLabel :
    singleSelected ? (singleSelected.sublabel ? `${singleSelected.label} — ${singleSelected.sublabel}` : singleSelected.label) :
    `Выбрано: ${selected.size}`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`btn justify-between gap-2 border text-sm ${selected.size > 0 ? 'border-brand-500 bg-brand-500/10 text-brand-200' : 'border-ink-600 bg-ink-900/60 text-fg-100'} hover:border-ink-500`}
      >
        <span className="truncate">{buttonLabel}</span>
        <IChevron width={13} height={13} className={`shrink-0 text-fg-500 transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
      </button>

      {open && (
        <div className="animate-scale-in absolute left-0 z-30 mt-2 w-80 origin-top-left overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-card">
          <div className="border-b border-ink-700/60 p-2">
            <div className="relative">
              <ISearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-500" width={13} height={13} />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Найти в списке…"
                className="w-full rounded-md border border-ink-600 bg-ink-900/60 py-1.5 pl-8 pr-2 text-xs text-fg-100 placeholder:text-fg-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>
          {selected.size > 0 && (
            <button
              onClick={() => onChange(new Set())}
              className="flex w-full items-center gap-1.5 border-b border-ink-700/60 px-3 py-2 text-left text-xs text-brand-300 hover:bg-ink-800"
            >
              <IClose width={12} height={12} /> сбросить ({selected.size})
            </button>
          )}
          <div className="max-h-72 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-xs text-fg-500">Ничего не найдено.</div>
            ) : filteredOptions.map((o) => {
              const on = selected.has(o.key)
              return (
                <button
                  key={o.key}
                  onClick={() => toggle(o.key)}
                  className={`flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-ink-800 ${on ? 'text-fg-50' : 'text-fg-300'}`}
                >
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? 'border-brand-400 bg-brand-500/20' : 'border-ink-600'}`}>
                    {on && <ICheck className="text-brand-300" width={11} height={11} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{o.label}</span>
                    {o.sublabel && <span className="block truncate text-[11px] text-fg-500">{o.sublabel}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
