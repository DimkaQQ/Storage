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
export const IInfo = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
export const IEdit = (p: P) => <svg {...base(p)}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></svg>
export const IDatabase = (p: P) => <svg {...base(p)}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>
export const IReset = (p: P) => <svg {...base(p)}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
export const IUndo = (p: P) => <svg {...base(p)}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a5 5 0 0 1 0 10h-1" /></svg>
export const IClock = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
export const IUpload = (p: P) => <svg {...base(p)}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 21h14" /></svg>
export const ISync = (p: P) => <svg {...base(p)}><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.5-4" /><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.5 4" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></svg>
export const IPlug = (p: P) => <svg {...base(p)}><path d="M9 2v6M15 2v6" /><path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" /><path d="M12 17v5" /></svg>
export const IChart = (p: P) => <svg {...base(p)}><path d="M3 3v18h18" /><rect x="7" y="10" width="3" height="7" /><rect x="12" y="6" width="3" height="11" /><rect x="17" y="13" width="3" height="4" /></svg>
export const IPin = (p: P) => <svg {...base(p)}><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
export const ILink = (p: P) => <svg {...base(p)}><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>
export const IPlus = (p: P) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
export const IUser = (p: P) => <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>
export const ILogout = (p: P) => <svg {...base(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
export const ITrash = (p: P) => <svg {...base(p)}><path d="M4 7h16" /><path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /><path d="M10 11v6M14 11v6" /></svg>
export const IPalette = (p: P) => <svg {...base(p)}><path d="M12 2a10 10 0 0 0 0 20 2.5 2.5 0 0 0 2.5-2.5c0-.7-.3-1.3-.7-1.7-.4-.5-.7-1-.7-1.6a1.7 1.7 0 0 1 1.7-1.7H17a5 5 0 0 0 5-5c0-4.4-4.5-7.5-10-7.5Z" /><circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="16.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" /></svg>
