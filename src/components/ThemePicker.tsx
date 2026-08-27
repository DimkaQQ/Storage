import { useEffect, useRef, useState } from 'react'
import { IPalette, ICheck, IChevron } from './icons'

type ThemeId = 'indigo' | 'amethyst' | 'cyan' | 'fuchsia'
const KEY = 'pricecheck-theme'

const THEMES: { id: ThemeId; name: string; accent: string }[] = [
  { id: 'indigo', name: 'Индиго', accent: '#3d6bff' },
  { id: 'amethyst', name: 'Аметист', accent: '#8b5cf6' },
  { id: 'cyan', name: 'Циан', accent: '#06b6d4' },
  { id: 'fuchsia', name: 'Фуксия', accent: '#db2777' },
]

export default function ThemePicker() {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeId>(() => (document.documentElement.dataset.theme as ThemeId) || 'indigo')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const pick = (id: ThemeId) => {
    document.documentElement.dataset.theme = id
    try { localStorage.setItem(KEY, id) } catch { /* ignore */ }
    setTheme(id)
    setOpen(false)
  }

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn border border-ink-600 bg-ink-800/80 text-slate-300 hover:border-brand-500/50 hover:text-white"
        title="Цветовая тема"
      >
        <IPalette width={16} height={16} className="text-brand-300" />
        <span className="h-3 w-3 rounded-full" style={{ background: current.accent }} />
        <IChevron className={`text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} width={14} height={14} />
      </button>

      {open && (
        <div className="animate-scale-in absolute right-0 z-30 mt-2 w-52 origin-top-right overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-card">
          <div className="border-b border-ink-700/60 px-3 py-2 text-xs font-semibold text-slate-400">Цветовая тема</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-ink-800 ${t.id === theme ? 'text-white' : 'text-slate-300'}`}
            >
              <span className="h-5 w-5 shrink-0 rounded-full border border-white/10" style={{ background: t.accent }} />
              <span className="flex-1">{t.name}</span>
              {t.id === theme && <ICheck width={15} height={15} className="text-brand-300" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
