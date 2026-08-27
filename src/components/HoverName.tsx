import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const TIP_MAX = 320

/**
 * Wraps truncated text so hovering shows the full value — in a portal
 * (position: fixed, escapes table/card overflow clipping) and with no
 * artificial delay, unlike the native `title` attribute which is slow to
 * appear and can get cut off at the edge of a scrolling table.
 */
export default function HoverName({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [tip, setTip] = useState<{ left: number; top: number; below: boolean } | null>(null)

  const open = () => {
    const el = ref.current
    if (!el) return
    if (el.scrollWidth <= el.clientWidth + 1) return // not actually clipped — nothing to show
    const r = el.getBoundingClientRect()
    const m = 10
    const left = Math.max(m, Math.min(window.innerWidth - m - TIP_MAX, r.left))
    const below = r.bottom + 60 < window.innerHeight
    const top = below ? r.bottom + 6 : r.top - 6
    setTip({ left, top, below })
  }
  const close = () => setTip(null)

  return (
    <span ref={ref} className={`block truncate ${className}`} onMouseEnter={open} onMouseLeave={close}>
      {text}
      {tip && createPortal(
        <div
          role="tooltip"
          style={{ position: 'fixed', left: tip.left, top: tip.top, maxWidth: TIP_MAX, transform: tip.below ? '' : 'translateY(-100%)' }}
          className="pointer-events-none z-[100] rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-xs leading-snug text-slate-200 shadow-xl"
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  )
}
