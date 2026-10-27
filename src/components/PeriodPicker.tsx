import { useEffect, useRef, useState } from 'react'
import { PeriodMeta } from '../lib/api'
import { IClock, IChevron, ICheck, IClose } from './icons'

const MAX_PERIODS = 3

/**
 * Выбор периода — мультивыбор по образцу ScopePicker/CityPicker: пустой
 * набор не допускается (всегда выбран хотя бы один месяц), максимум
 * MAX_PERIODS месяцев. Синим горят выбранные пункты и сама кнопка при
 * выборе нескольких периодов.
 */
export default function PeriodPicker({
  periods, value, onChange,
}: {
  periods: PeriodMeta[]
  value: string
  onChange: (period: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Мульти-состояние живёт здесь; наружу (в useEdits) каждый раз уходит
  // ОДИН период — самый свежий из выбранных (данные в dataset пока
  // одномесячные; когда сервер начнёт отдавать несколько месяцев, сюда же
  // подключится реальная агрегация).
  const [picked, setPicked] = useState<Set<string>>(new Set([value]))

  // Снаружи период мог смениться сам (например, «Обновление» подтянуло
  // новый месяц или страница «Синхронизировать период» выбрала его) —
  // синхронизируем набор, иначе чип показывал бы устаревший выбор.
  useEffect(() => {
    setPicked((prev) => (prev.has(value) ? prev : new Set([value])))
  }, [value])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  if (periods.length <= 1) return null // нечего переключать — один период и так виден в шапке

  const ordered = [...periods].reverse() // свежие сверху
  const newestFirst = (s: Set<string>) => ordered.filter((p) => s.has(p.period)).map((p) => p.period)

  const emit = (next: Set<string>) => {
    const arr = newestFirst(next)
    if (!arr.length) return // пустой выбор недопустим — всегда минимум один месяц
    setPicked(next)
    onChange(arr[0])
  }

  const toggle = (period: string) => {
    const next = new Set(picked)
    if (next.has(period)) {
      if (next.size === 1) return // последний выбранный снимать нельзя
      next.delete(period)
    } else {
      if (next.size >= MAX_PERIODS) return // лимит — максимум MAX_PERIODS месяцев
      next.add(period)
    }
    emit(next)
  }

  const current = periods.find((p) => p.period === value)
  const multi = picked.size > 1
  const label = multi ? `${picked.size} периода (макс. 3)` : (current?.periodLabel ?? value)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`btn w-[150px] justify-between border bg-ink-800/80 px-2.5 py-2 text-xs hover:bg-ink-750 ${
          multi ? 'border-brand-500/60 text-fg-50' : 'border-ink-600 text-fg-200 hover:border-brand-500/50 hover:text-fg-50'
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <IClock className={`shrink-0 ${multi ? 'text-brand-300' : 'text-fg-500'}`} width={14} height={14} />
          <span className="truncate">{label}</span>
        </span>
        <IChevron className={`shrink-0 text-fg-500 transition-transform ${open ? 'rotate-90' : ''}`} width={13} height={13} />
      </button>

      {open && (
        <div className="animate-scale-in absolute right-0 z-30 mt-2 w-56 origin-top-right overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-card">
          <div className="flex items-center justify-between border-b border-ink-700/60 px-3 py-2">
            <span className="text-xs font-semibold text-fg-400">Период · до {MAX_PERIODS}</span>
            {multi && (
              <button
                onClick={() => emit(new Set([ordered[0]?.period ?? value]))}
                className="flex items-center gap-1 text-[11px] text-brand-300 hover:text-brand-200"
              >
                <IClose width={12} height={12} /> сбросить
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {ordered.map((p) => {
              const on = picked.has(p.period)
              return (
                <button
                  key={p.period}
                  onClick={() => toggle(p.period)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-800 ${on ? 'text-fg-50' : 'text-fg-300'}`}
                >
                  <span className={`grid h-4 w-4 place-items-center rounded border ${on ? 'border-brand-400 bg-brand-500/20' : 'border-ink-600'}`}>
                    {on && <ICheck className="text-brand-300" width={12} height={12} />}
                  </span>
                  <span className="flex-1 truncate">{p.periodLabel}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
