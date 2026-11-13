/**
 * Ключи периодов: месяц «YYYY-MM» или отрезок «YYYY-MM-DD..YYYY-MM-DD» (день, неделя, любой отрезок).
 * Ключ попадает в имя файла на диске (датасеты и снимки матрицы), поэтому проверка формы — ещё и защита
 * от выхода пути за пределы папки организации.
 */
export const MONTH_RE = /^\d{4}-\d{2}$/
export const RANGE_RE = /^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/
const pad = (n) => String(n).padStart(2, '0')

export const isValidPeriod = (p) => {
  const s = String(p)
  if (MONTH_RE.test(s)) { const mo = +s.slice(5); return mo >= 1 && mo <= 12 }
  const m = RANGE_RE.exec(s)
  if (!m) return false
  const a = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), b = new Date(Date.UTC(+m[4], +m[5] - 1, +m[6]))
  const ok = (d, y, mo, day) => d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === day
  if (!ok(a, +m[1], +m[2], +m[3]) || !ok(b, +m[4], +m[5], +m[6])) return false
  const days = (b - a) / 86400000
  return days >= 0 && days <= 92
}

/** Первый и последний день периода (ISO-даты, сравниваются как строки). */
export function periodBounds(period) {
  const s = String(period)
  const r = RANGE_RE.exec(s)
  if (r) return { start: `${r[1]}-${r[2]}-${r[3]}`, end: `${r[4]}-${r[5]}-${r[6]}` }
  const y = +s.slice(0, 4), mo = +s.slice(5, 7)
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return { start: `${y}-${pad(mo)}-01`, end: `${y}-${pad(mo)}-${pad(last)}` }
}
