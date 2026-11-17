import { Row, unitsLookIncomparable } from './data'

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

/** Названия позиций, которые покупали в загруженных периодах (для выбора позиции), по убыванию числа закупок. */
export function productsIn(data: PeriodRows[]): { name: string; count: number }[] {
  const m = new Map<string, number>()
  for (const d of data) for (const r of d.rows) if (r.unit != null && r.unit > 0 && r.qty > 0 && !r.isTotalRow) m.set(r.product, (m.get(r.product) ?? 0) + 1)
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
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

/** Цена позиции в одной группе периодов (день/неделя/месяц). */
export interface Cell { fact: number; plan: number | null; qty: number; covers: string }

/**
 * Позиция для таблицы «все позиции сразу»: ресторан + поставщик + товар + фасовка (как купили). Фасовка входит в ключ, чтобы
 * банка 400 г и банка 250 г не склеивались в одну цену (иначе «рост» получался бы из-за смены фасовки, а не цены).
 */
export interface Position {
  key: string
  restaurant: string
  supplier: string
  product: string
  pack: string
  cells: Map<string, Cell>      // ключ группы → цена
  keys: string[]                // ключи групп, где позицию покупали, по возрастанию
  last: number                  // цена в последней группе
  lastKey: string
  lastQty: number
  prev: number | null           // цена в предыдущей группе, где позицию покупали
  prevKey: string | null
  stepPct: number | null        // последняя цена к предыдущей, доля (0,05 = +5%)
  stepAbs: number | null        // то же в ₸ за единицу
  impact: number | null         // на сколько ₸ больше (+) или меньше (−) заплатили за последний объём из-за изменения цены
  totalPct: number | null       // последняя цена к первой, доля
  plan: number | null           // плановая цена в последней группе
  devPct: number | null         // (цена − план) / план
  stale: boolean                // в последней группе окна позицию не покупали: сравнивать «последнюю» цену с «предыдущей» нельзя, иначе старый рост попадёт в итоги
}

/** Относительный порог: изменение меньше 0,5% считаем «без изменений» (копейки округления не красим). */
export const FLAT_EPS = 0.005
export type Trend = 'up' | 'down' | 'flat' | 'single' | 'stale'
export const trendOf = (p: Pick<Position, 'stepPct' | 'stale'>): Trend => (p.stale ? 'stale' : p.stepPct == null ? 'single' : p.stepPct > FLAT_EPS ? 'up' : p.stepPct < -FLAT_EPS ? 'down' : 'flat')

/** Все позиции с ценой по группам периодов и расчётом изменения. restaurants пусто = вся сеть. */
export function buildPositions(data: PeriodRows[], restaurants: Set<string>, g: Granularity): { positions: Position[]; buckets: { key: string; label: string }[] } {
  type Acc = { qty: number; sum: number; planQty: number; planSum: number; start: string; end: string }
  const pos = new Map<string, { restaurant: string; supplier: string; product: string; pack: string; acc: Map<string, Acc> }>()
  const buckets = new Map<string, string>()
  for (const d of data) {
    const span = periodSpan(d.period)
    const { key: bk, label } = bucketOf(span.start, g)
    for (const r of d.rows) {
      if (r.isTotalRow || r.unit == null || !(r.unit > 0) || !(r.qty > 0)) continue
      if (restaurants.size && !restaurants.has(r.restaurant)) continue
      buckets.set(bk, label)
      const pk = [r.restaurant, r.supplier, r.product, r.pack ?? ''].join('\u0001')
      let p = pos.get(pk)
      if (!p) { p = { restaurant: r.restaurant, supplier: r.supplier, product: r.product, pack: r.pack ?? '', acc: new Map() }; pos.set(pk, p) }
      let a = p.acc.get(bk)
      if (!a) { a = { qty: 0, sum: 0, planQty: 0, planSum: 0, start: span.start, end: span.end }; p.acc.set(bk, a) }
      a.qty += r.qty; a.sum += r.qty * r.unit
      const raw = r.plan ?? r.designatedPlan
      if (raw != null && raw > 0 && !unitsLookIncomparable(raw, r.unit)) { a.planQty += r.qty; a.planSum += r.qty * raw }
      if (span.start < a.start) a.start = span.start
      if (span.end > a.end) a.end = span.end
    }
  }
  const positions: Position[] = []
  const latest = [...buckets.keys()].sort().pop() ?? ''
  for (const [key, p] of pos) {
    const cells = new Map<string, Cell>()
    for (const [bk, a] of p.acc) cells.set(bk, { fact: a.sum / a.qty, plan: a.planQty > 0 ? a.planSum / a.planQty : null, qty: a.qty, covers: a.start === a.end ? fmtDate(a.start) : `${fmtDate(a.start)} – ${fmtDate(a.end)}` })
    const keys = [...cells.keys()].sort()
    const lastKey = keys[keys.length - 1], last = cells.get(lastKey)!
    const prevKey = keys.length > 1 ? keys[keys.length - 2] : null
    const prev = prevKey ? cells.get(prevKey)!.fact : null
    const first = cells.get(keys[0])!.fact
    // «Не покупали в последнем периоде» применяем только к месяцам: при подневной/понедельной детализации поставки редкие, и почти всё стало бы «устаревшим»
    const stale = g === 'month' && lastKey !== latest
    positions.push({
      key, restaurant: p.restaurant, supplier: p.supplier, product: p.product, pack: p.pack, cells, keys,
      last: last.fact, lastKey, lastQty: last.qty, prev, prevKey,
      stale,
      stepPct: !stale && prev ? (last.fact - prev) / prev : null,
      stepAbs: !stale && prev != null ? last.fact - prev : null,
      impact: !stale && prev != null ? (last.fact - prev) * last.qty : null,
      totalPct: keys.length > 1 && first > 0 ? (last.fact - first) / first : null,
      plan: last.plan,
      devPct: last.plan ? (last.fact - last.plan) / last.plan : null,
    })
  }
  const bl = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, label]) => ({ key, label }))
  return { positions, buckets: bl }
}
