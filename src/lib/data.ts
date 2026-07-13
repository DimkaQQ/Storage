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

/** Immutable base row parsed from the dataset (original names + matrix plan). */
export interface BaseRow {
  id: string
  restaurant: string
  brand: string
  entity: string
  supplier0: string
  product0: string
  pack: string
  qty: number
  sum: number
  unit: number
  plan0: number | null
}

// ТЗ: нули, пустые графы и позиции с оборотом до 1000 ₸ не показываем.
const MIN_TURNOVER = 1000

let _seq = 0
export const BASE: BaseRow[] = []
for (const r of data.restaurants) {
  for (const it of r.items) {
    if (it.u == null) continue
    if (it.m < MIN_TURNOVER || it.q <= 0) continue
    BASE.push({
      id: 'r' + _seq++,
      restaurant: r.name, brand: r.brand, entity: r.entity,
      supplier0: it.s, product0: it.p, pack: it.k,
      qty: it.q, sum: it.m, unit: it.u, plan0: it.pl,
    })
  }
}

/**
 * User edits layered over the immutable base data so the project can run
 * without Excel: rename companies/products, set or correct plan prices.
 */
export interface Edits {
  supplierRenames: Record<string, string>  // original supplier name -> new name
  productRenames: Record<string, string>   // original product name -> new name
  planOverrides: Record<string, number>    // original product name -> plan price
}
export const EMPTY_EDITS: Edits = { supplierRenames: {}, productRenames: {}, planOverrides: {} }

/** Builds display rows by applying edits, then classifies and assigns ABC. */
export function computeRows(base: BaseRow[], edits: Edits): Row[] {
  const rows: Row[] = base.map((b) => {
    const supplier = edits.supplierRenames[b.supplier0] ?? b.supplier0
    const product = edits.productRenames[b.product0] ?? b.product0
    const ov = edits.planOverrides[b.product0]
    const plan = ov != null ? ov : b.plan0
    const c = classify(plan, b.unit)
    return {
      id: b.id, restaurant: b.restaurant, brand: b.brand, entity: b.entity,
      supplier, product, pack: b.pack, qty: b.qty, sum: b.sum, unit: b.unit, plan,
      diff: c.diff, diffPct: c.diffPct,
      effect: c.status === 'anomaly' || c.status === 'nomatrix' ? 0 : c.effect * b.qty,
      status: c.status, abc: 'C',
    }
  })
  assignABC(rows)
  return rows
}

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

/* ---------- reference lists for the editor ---------- */

export interface SupplierAgg { name: string; count: number; sum: number }
export interface ProductAgg { name: string; count: number; sum: number; basePlan: number | null; inMatrix: boolean }

export const SUPPLIERS_BASE: SupplierAgg[] = (() => {
  const m = new Map<string, SupplierAgg>()
  for (const b of BASE) {
    const g = m.get(b.supplier0) || { name: b.supplier0, count: 0, sum: 0 }
    g.count++; g.sum += b.sum
    m.set(b.supplier0, g)
  }
  return [...m.values()].sort((a, b) => b.sum - a.sum)
})()

export const PRODUCTS_BASE: ProductAgg[] = (() => {
  const m = new Map<string, ProductAgg>()
  for (const b of BASE) {
    const g = m.get(b.product0) || { name: b.product0, count: 0, sum: 0, basePlan: null, inMatrix: false }
    g.count++; g.sum += b.sum
    if (b.plan0 != null) { g.inMatrix = true; if (g.basePlan == null) g.basePlan = b.plan0 }
    m.set(b.product0, g)
  }
  return [...m.values()].sort((a, b) => b.sum - a.sum)
})()

export const PERIOD = data.periodLabel
export const CITY = data.city
export const CATEGORY = data.category
export const ROWS = computeRows(BASE, EMPTY_EDITS)

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

/** Russian plural selector: plural(n, 'правка', 'правки', 'правок'). */
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}
