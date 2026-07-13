import { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = (p: P) => ({
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p,
})

export const IGauge = (p: P) => <svg {...base(p)}><path d="M12 13l4-4" /><path d="M3 12a9 9 0 0 1 18 0" /><path d="M3 12h2M19 12h2M12 5V3" /></svg>
export const IScale = (p: P) => <svg {...base(p)}><path d="M12 3v18" /><path d="M6 7h12" /><path d="M6 7l-3 6a3 3 0 0 0 6 0L6 7Z" /><path d="M18 7l-3 6a3 3 0 0 0 6 0l-3-6Z" /><path d="M8 21h8" /></svg>
export const IStore = (p: P) => <svg {...base(p)}><path d="M3 9l1.5-5h15L21 9" /><path d="M3 9v11h18V9" /><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" /><path d="M9 20v-6h6v6" /></svg>
export const ILayers = (p: P) => <svg {...base(p)}><path d="M12 3l9 5-9 5-9-5 9-5Z" /><path d="M3 13l9 5 9-5" /></svg>
export const IAlert = (p: P) => <svg {...base(p)}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
export const ISearch = (p: P) => <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
export const IArrowUp = (p: P) => <svg {...base(p)}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
export const IArrowDown = (p: P) => <svg {...base(p)}><path d="M12 5v14M5 12l7 7 7-7" /></svg>
export const IChevron = (p: P) => <svg {...base(p)}><path d="m9 18 6-6-6-6" /></svg>
export const IClose = (p: P) => <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
export const ICheck = (p: P) => <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
export const IDownload = (p: P) => <svg {...base(p)}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
export const ISort = (p: P) => <svg {...base(p)}><path d="M8 3v18M8 3 4 7M8 3l4 4" /><path d="M16 21V3M16 21l4-4M16 21l-4-4" /></svg>
export const ISpark = (p: P) => <svg {...base(p)}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>
export const IHelp = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M9.2 9a2.8 2.8 0 0 1 5.5.8c0 1.9-2.7 2.5-2.7 2.5" /><path d="M12 17h.01" /></svg>
