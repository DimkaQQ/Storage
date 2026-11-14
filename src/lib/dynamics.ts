import { Row } from './data'

/**
 * Динамика закупочной цены позиции (КП «Динамика цен по позициям»).
 * Чистые функции без React: выбор загруженных периодов, сбор точек цены по ресторанам, группировка по дням/неделям/месяцам,
 * сводка. Данные берём из уже загруженных в систему периодов (месячных и «с … по …»): внутри периода iiko отдаёт закупку
 * одной строкой на склад+поставщика+товар, поэтому цена периода — средневзвешенная по количеству (Σ сумма / Σ кол-во),
 * а не простое среднее нескольких закупок по разным ценам.
 */

export type Granularity = 'day' | 'week' | 'month'

const pad = (n: number) => String(n).padStart(2, '0')
const RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/

/** Первый и последний день периода («ГГГГ-ММ» или «ГГГГ-ММ-ДД..ГГГГ-ММ-ДД») — ISO-даты, сравниваются как строки. */
export function periodSpan(period: string): { start: string; end: string } {
  const r = RANGE_RE.exec(period)
  if (r) return { start: r[1], end: r[2] }
  const y = +period.slice(0, 4), m = +period.slice(5, 7)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}` }
}

/**
 * Какие периоды брать для окна [from, to]: все пересекающиеся с ним, но без наложений — если за один месяц загружены и
 * месяц целиком, и неделя внутри него, считать закупки дважды нельзя. Приоритет у более длинного периода (он полнее),
 * при равной длине — у более позднего (свежее загрузка).
 */
export function pickPeriods(periods: string[], from: string, to: string): string[] {
  const cand = periods
    .map((p) => ({ p, ...periodSpan(p) }))
    .filter((x) => x.end >= from && x.start <= to)
    .sort((a, b) => (b.end > b.start ? daysBetween(b.start, b.end) : 0) - (a.end > a.start ? daysBetween(a.start, a.end) : 0) || b.start.localeCompare(a.start))
  const chosen: typeof cand = []
  for (const c of cand) if (!chosen.some((x) => c.start <= x.end && x.start <= c.end)) chosen.push(c)
  return chosen.sort((a, b) => a.start.localeCompare(b.start)).map((x) => x.p)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
}
export const addDays = (iso: string, n: number): string => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)

function mondayOf(iso: string): string {
  const d = new Date(Date.parse(iso + 'T00:00:00Z'))
  const wd = (d.getUTCDay() + 6) % 7 // 0 = понедельник
  return addDays(iso, -wd)
}
export const fmtDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export function bucketOf(start: string, g: Granularity): { key: string; label: string } {
  if (g === 'day') return { key: start, label: fmtDate(start) }
  if (g === 'week') { const mo = mondayOf(start); return { key: mo, label: `Нед. с ${fmtDate(mo)}` } }
  return { key: start.slice(0, 7), label: `${MONTHS[+start.slice(5, 7) - 1]} ${start.slice(0, 4)}` }
}

export interface PeriodRows { period: string; rows: Row[] }

export interface Point {
  key: string          // ключ группы (для сортировки и графика)
  label: string        // подпись на оси / в таблице
  covers: string       // за какие даты реально есть данные (может быть шире или уже группы — зависит от загруженных периодов)
  fact: number         // средневзвешенная закупочная цена
  plan: number | null  // средневзвешенная плановая цена (null — в матрице за этот период цены нет)
  qty: number
}

export interface Series { name: string; points: Point[] }

interface Acc { qty: number; sum: number; planQty: number; planSum: number; start: string; end: string }

/** Строки закупок ровно этой позиции (название как показано в «Проверке цен»), у которых есть цена и количество. */
function rowsOfProduct(rows: Row[], product: string): Row[] {
  return rows.filter((r) => r.product === product && !r.isTotalRow && r.unit != null && r.unit > 0 && r.qty > 0)
}

/** Названия позиций, которые покупали в загруженных периодах (для выбора позиции), по убыванию числа закупок. */
export function productsIn(data: PeriodRows[]): { name: string; count: number }[] {
  const m = new Map<string, number>()
  for (const d of data) for (const r of d.rows) if (r.unit != null && r.unit > 0 && r.qty > 0 && !r.isTotalRow) m.set(r.product, (m.get(r.product) ?? 0) + 1)
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
}

/**
 * Ряды цены по ресторанам (по одному на ресторан) + при нескольких ресторанах общий ряд «Вся выборка».
 * restaurants пусто = вся сеть (все рестораны, где позицию покупали).
 */
export function buildSeries(data: PeriodRows[], product: string, restaurants: Set<string>, g: Granularity, allLabel = 'Вся выборка'): Series[] {
  const per = new Map<string, Map<string, { label: string; acc: Acc }>>()
  const total = new Map<string, { label: string; acc: Acc }>()
  const add = (m: Map<string, { label: string; acc: Acc }>, key: string, label: string, r: Row, span: { start: string; end: string }) => {
    let e = m.get(key)
    if (!e) { e = { label, acc: { qty: 0, sum: 0, planQty: 0, planSum: 0, start: span.start, end: span.end } }; m.set(key, e) }
    const a = e.acc
    a.qty += r.qty; a.sum += r.qty * (r.unit as number)
    const plan = r.plan ?? r.designatedPlan
    if (plan != null && plan > 0) { a.planQty += r.qty; a.planSum += r.qty * plan }
    if (span.start < a.start) a.start = span.start
    if (span.end > a.end) a.end = span.end
  }
  for (const d of data) {
    const span = periodSpan(d.period)
    const { key, label } = bucketOf(span.start, g)
    for (const r of rowsOfProduct(d.rows, product)) {
      if (restaurants.size && !restaurants.has(r.restaurant)) continue
      if (!per.has(r.restaurant)) per.set(r.restaurant, new Map())
      add(per.get(r.restaurant)!, key, label, r, span)
      add(total, key, label, r, span)
    }
  }
  const toPoints = (m: Map<string, { label: string; acc: Acc }>): Point[] =>
    [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, { label, acc }]) => ({
      key, label,
      covers: acc.start === acc.end ? fmtDate(acc.start) : `${fmtDate(acc.start)} – ${fmtDate(acc.end)}`,
      fact: acc.sum / acc.qty,
      plan: acc.planQty > 0 ? acc.planSum / acc.planQty : null,
      qty: acc.qty,
    }))
  const out: Series[] = [...per.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([name, m]) => ({ name, points: toPoints(m) }))
  if (out.length > 1) out.push({ name: allLabel, points: toPoints(total) })
  return out
}

export interface Summary { min: number; max: number; avg: number; first: number; last: number; change: number; changePct: number | null; n: number }

/** Сводка по ряду: мин/макс/средневзвешенная и итоговое изменение с начала периода (последняя цена к первой). */
export function summarizeSeries(points: Point[]): Summary | null {
  if (!points.length) return null
  let qty = 0, sum = 0, min = Infinity, max = -Infinity
  for (const p of points) { qty += p.qty; sum += p.qty * p.fact; if (p.fact < min) min = p.fact; if (p.fact > max) max = p.fact }
  const first = points[0].fact, last = points[points.length - 1].fact
  return { min, max, avg: sum / qty, first, last, change: last - first, changePct: first > 0 ? (last - first) / first : null, n: points.length }
}
