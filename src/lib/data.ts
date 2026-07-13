import raw from '../data/dataset.json'

/** Raw purchase fact as extracted from the iiko report + matrix join. */
interface RawItem {
  s: string  // supplier (as in iiko)
  p: string  // product (as in iiko)
  k: string  // packaging
  q: number  // quantity
  m: number  // total sum, тг
  u: number | null // actual unit price = m/q
  pl: number | null // planned price per unit from the matrix (null = not in matrix)
}
interface RawRestaurant {
  name: string
  entity: string
  brand: string
  city: string
  category: string
  items: RawItem[]
}
interface RawDataset {
  period: string
  periodLabel: string
  city: string
  category: string
  restaurants: RawRestaurant[]
}

export type Status = 'overpay' | 'saving' | 'ok' | 'nomatrix' | 'anomaly'

export interface Row {
  id: string
  restaurant: string
  brand: string
  entity: string
  supplier: string
  product: string
  pack: string
  qty: number
  sum: number
  unit: number
  plan: number | null
  diff: number | null      // plan - unit (per unit); + = cheaper than plan
  diffPct: number | null   // (unit - plan)/plan; + = overpay
  effect: number           // (plan - unit) * qty; + = saving, - = overpay; 0 for anomaly/nomatrix
  status: Status
  abc: 'A' | 'B' | 'C'     // by contribution to total spend (set later)
}

// A position is "in norm" when actual is within this band of the plan.
const OK_BAND = 0.02
// Beyond this ratio the plan/fact unit bases almost certainly differ (kg vs pcs);
// we treat it as a data anomaly to review, not a real price delta.
const ANOMALY_RATIO = 3

const data = raw as unknown as RawDataset

function classify(plan: number | null, unit: number): { status: Status; effect: number; diff: number | null; diffPct: number | null } {
  if (plan == null || plan <= 0) return { status: 'nomatrix', effect: 0, diff: null, diffPct: null }
  const ratio = unit / plan
  const diff = plan - unit
  const diffPct = (unit - plan) / plan
  if (ratio > ANOMALY_RATIO || ratio < 1 / ANOMALY_RATIO)
    return { status: 'anomaly', effect: 0, diff, diffPct }
  let status: Status = 'ok'
  if (diffPct > OK_BAND) status = 'overpay'
  else if (diffPct < -OK_BAND) status = 'saving'
  return { status, effect: diff, diffPct, diff }
}

let _seq = 0
const allRows: Row[] = []
// ТЗ: нули, пустые графы и позиции с оборотом до 1000 ₸ не показываем.
const MIN_TURNOVER = 1000

for (const r of data.restaurants) {
  for (const it of r.items) {
    if (it.u == null) continue
    if (it.m < MIN_TURNOVER || it.q <= 0) continue
    const c = classify(it.pl, it.u)
    allRows.push({
      id: 'r' + _seq++,
      restaurant: r.name,
      brand: r.brand,
      entity: r.entity,
      supplier: it.s,
      product: it.p,
      pack: it.k,
      qty: it.q,
      sum: it.m,
      unit: it.u,
      plan: it.pl,
      diff: c.diff,
      diffPct: c.diffPct,
      effect: c.status === 'anomaly' || c.status === 'nomatrix' ? 0 : c.effect * it.q,
      status: c.status,
      abc: 'C',
    })
  }
}

// ABC classification by spend contribution across the whole dataset.
assignABC(allRows)

export function assignABC(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => b.sum - a.sum)
  const total = sorted.reduce((s, r) => s + r.sum, 0) || 1
  let cum = 0
  for (const r of sorted) {
    cum += r.sum
    const share = cum / total
    r.abc = share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C'
  }
}

export const PERIOD = data.periodLabel
export const CITY = data.city
export const CATEGORY = data.category
export const ROWS = allRows

export const RESTAURANTS = data.restaurants.map((r) => ({
  name: r.name,
  entity: r.entity,
  brand: r.brand,
  city: r.city,
}))

export const STATUS_META: Record<Status, { label: string; color: string; dot: string }> = {
  overpay: { label: 'Переплата', color: 'text-bad', dot: 'bg-bad' },
  saving: { label: 'Экономия', color: 'text-good', dot: 'bg-good' },
  ok: { label: 'В норме', color: 'text-slate-300', dot: 'bg-slate-400' },
  nomatrix: { label: 'Нет в матрице', color: 'text-warn', dot: 'bg-warn' },
  anomaly: { label: 'Аномалия', color: 'text-purple-300', dot: 'bg-purple-400' },
}

/* ---------- aggregation helpers ---------- */

export interface Summary {
  spend: number
  positions: number
  matched: number
  matchRate: number
  overpaySum: number   // negative money lost
  savingSum: number    // positive money saved
  netEffect: number
  overpayCount: number
  savingCount: number
  anomalyCount: number
  noMatrixCount: number
}

export function summarize(rows: Row[]): Summary {
  let spend = 0, overpaySum = 0, savingSum = 0, matched = 0
  let overpayCount = 0, savingCount = 0, anomalyCount = 0, noMatrixCount = 0
  for (const r of rows) {
    spend += r.sum
    if (r.status !== 'nomatrix') matched++
    if (r.status === 'overpay') { overpaySum += r.effect; overpayCount++ }
    else if (r.status === 'saving') { savingSum += r.effect; savingCount++ }
    else if (r.status === 'anomaly') anomalyCount++
    else if (r.status === 'nomatrix') noMatrixCount++
  }
  return {
    spend,
    positions: rows.length,
    matched,
    matchRate: rows.length ? matched / rows.length : 0,
    overpaySum,
    savingSum,
    netEffect: savingSum + overpaySum,
    overpayCount,
    savingCount,
    anomalyCount,
    noMatrixCount,
  }
}

export function byRestaurant(rows: Row[]) {
  const map = new Map<string, Row[]>()
  for (const r of rows) {
    if (!map.has(r.restaurant)) map.set(r.restaurant, [])
    map.get(r.restaurant)!.push(r)
  }
  return [...map.entries()].map(([name, rs]) => ({ name, rows: rs, summary: summarize(rs) }))
}

/* ---------- formatting ---------- */

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

export const fmt = (n: number) => nf.format(Math.round(n))
export const fmt1 = (n: number) => nf1.format(n)
export const money = (n: number) => nf.format(Math.round(n)) + ' ₸'
export function moneyShort(n: number) {
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1_000_000) return `${sign}${nf1.format(a / 1_000_000)} млн ₸`
  if (a >= 1_000) return `${sign}${nf.format(Math.round(a / 1000))} тыс ₸`
  return `${sign}${nf.format(Math.round(a))} ₸`
}
export const pct = (n: number) => (n >= 0 ? '+' : '') + nf1.format(n * 100) + '%'
