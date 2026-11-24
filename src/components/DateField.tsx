/**
 * Поле даты: свой текст по центру (родное поле в Safari/iOS рисует значение у верхнего края и разной высоты),
 * а настоящий input лежит сверху невидимым — нажатие открывает родной выбор даты.
 */
export default function DateField({ label, value, min, max, onChange, className = 'w-[128px]' }: {
  label: string; value: string; min?: string; max?: string; onChange: (v: string) => void; className?: string
}) {
  const shown = value ? new Date(value + 'T00:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : 'Дата'
  return (
    <div className={`relative h-10 shrink-0 rounded-lg border border-ink-600 bg-ink-900/60 focus-within:border-brand-500 ${className}`}>
      <div className={`pointer-events-none flex h-full items-center justify-between gap-2 px-3 text-sm ${value ? 'text-fg-100' : 'text-fg-600'}`}>
        <span className="truncate"><span className="text-fg-500">{label} </span>{shown}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-500"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </div>
      <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)}
        onClick={(e) => { try { e.currentTarget.showPicker?.() } catch { /* нет поддержки — откроется само */ } }}
        aria-label={label} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </div>
  )
}
