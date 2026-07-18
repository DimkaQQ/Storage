import raw from '../data/dataset.json'
import matchingRaw from '../data/matching.json'

/** How confidently the plan price was matched to this purchased line. */
export type MatchKind = 'pair' | 'product' | 'manual' | null

/**
 * The plan matrix itself — the same справочник (supplier alias dictionary)
 * and pair/pack/product price tables the client used to maintain by hand in
 * Excel. Bundled straight into the app so matching/plan resolution runs
 * entirely client-side and can be corrected through edits (merges, manual
 * prices) without anyone touching a spreadsheet again.
 */
export interface MatchingTable {
  supplierAlias: Record<string, string>       // iiko supplier name (norm) -> canonical supplier name
  planPairs: Record<string, number>           // "supplier::product" (norm) -> plan price
  planPairsByPack: Record<string, number>     // "supplier::product::pack" (norm) -> plan price
  planByProduct: Record<string, number>       // product (norm) -> plan price
}
export const BUNDLED_MATCHING: MatchingTable = matchingRaw as MatchingTable

const norm = (s: string) => String(s || '').trim().toLowerCase()

/** Raw purchase fact as extracted from the iiko report + matrix join. */
interface RawItem {
  s: string  // supplier (as in iiko)
  p: string  // product (as in iiko)
  k: string  // packaging
  q: number  // quantity
  m: number  // total sum, тг
  u: number | null // actual unit price = m/q
  pl: number | null // planned price per unit from the matrix (null = not in matrix)
  pk?: 'pair' | 'product' | null // as-shipped match confidence (see MatchKind)
  sn?: boolean // supplier not found in the client's справочник (alias dictionary) — likely a genuinely new company
  c?: string // purchase category (Кухня/Бар/Алкоголь/Безалкоголь/ERO); falls back to the restaurant's category
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

export type Status = 'overpay' | 'saving' | 'ok' | 'nomatrix' | 'anomaly' | 'review' | 'excluded'

export interface Row {
  id: string
  restaurant: string
  brand: string
  city: string
  entity: string
  category: string
  supplier: string
  product: string
  product0: string   // original product name (edit key)
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
  matchKind: MatchKind     // how the plan price was found — for the trust indicator
}

// A position is "in norm" when actual is within this band of the plan.
const OK_BAND = 0.02
// Deviations larger than this (but still same unit base) are more likely a
// plan/fact naming mismatch than a real price change → "Проверить" (review).
const REVIEW_BAND = 0.5
// Beyond this ratio the plan/fact unit bases almost certainly differ (kg vs pcs);
// we treat it as a data anomaly to review, not a real price delta.
const ANOMALY_RATIO = 3

function classify(plan: number | null, unit: number): { status: Status; effect: number; diff: number | null; diffPct: number | null } {
  if (plan == null || plan <= 0) return { status: 'nomatrix', effect: 0, diff: null, diffPct: null }
  const ratio = unit / plan
  const diff = plan - unit
  const diffPct = (unit - plan) / plan
  if (ratio > ANOMALY_RATIO || ratio < 1 / ANOMALY_RATIO)
    return { status: 'anomaly', effect: 0, diff, diffPct }
  if (Math.abs(diffPct) > REVIEW_BAND)
    return { status: 'review', effect: 0, diff, diffPct }
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
  city: string
  entity: string
  category: string
  supplier0: string
  product0: string
  pack: string
  qty: number
  sum: number
  unit: number
  plan0: number | null
  planKind0: MatchKind
  supplierNew: boolean
}

// ТЗ: нули, пустые графы и позиции с оборотом до 1000 ₸ не показываем.
const MIN_TURNOVER = 1000

/** Manual corrections to a venue's meta — for when auto-derived data is wrong. */
export interface VenuePatch { city?: string; brand?: string; entity?: string }

/**
 * User edits layered over the immutable base data so the project can run
 * without Excel: rename companies/products, set or correct plan prices,
 * fix a venue's city/brand/entity, exclude false-positive comparisons.
 */
export interface Edits {
  supplierRenames: Record<string, string>  // original supplier name -> new name
  productRenames: Record<string, string>   // original product name -> new name
  planOverrides: Record<string, number>    // original product name -> plan price
  excludedProducts: Record<string, true>   // original product name -> исключён из сравнения
  venueOverrides: Record<string, VenuePatch> // restaurant name -> corrected город/бренд/юрлицо
  newSuppliers: Record<string, true>       // компании, добавленные вручную (ещё нет закупок в iiko)
  newProducts: Record<string, true>        // товары, добавленные вручную (план задаётся через planOverrides)
  newVenues: Record<string, true>          // точки, добавленные вручную (мета — через venueOverrides)
  supplierMerges: Record<string, string>   // iiko-имя, которого нет в справочнике -> существующий поставщик (тот же, что и...)
}
export const EMPTY_EDITS: Edits = {
  supplierRenames: {}, productRenames: {}, planOverrides: {}, excludedProducts: {}, venueOverrides: {},
  newSuppliers: {}, newProducts: {}, newVenues: {}, supplierMerges: {},
}

/** Appends manually-added companies that have no purchase history yet. */
export function withNewSuppliers(suppliers: SupplierAgg[], edits: Edits): SupplierAgg[] {
  const existing = new Set(suppliers.map((s) => s.name))
  const added = Object.keys(edits.newSuppliers)
    .filter((name) => !existing.has(name))
    .map((name): SupplierAgg => ({ name, count: 0, sum: 0, isNew: false }))
  return added.length ? [...suppliers, ...added] : suppliers
}

/** Appends manually-added products (e.g. to pre-set a plan price before the first purchase). */
export function withNewProducts(products: ProductAgg[], edits: Edits): ProductAgg[] {
  const existing = new Set(products.map((p) => p.name))
  const added = Object.keys(edits.newProducts)
    .filter((name) => !existing.has(name))
    .map((name): ProductAgg => {
      const plan = edits.planOverrides[name] ?? null
      return { name, count: 0, sum: 0, basePlan: plan, inMatrix: plan != null, planKind: plan != null ? 'manual' : null, restaurantCount: 0 }
    })
  return added.length ? [...products, ...added] : products
}

/** Appends manually-added venues (e.g. a new restaurant not yet flowing purchases through iiko). */
export function withNewVenues(restaurants: VenueMeta[], edits: Edits): VenueMeta[] {
  const existing = new Set(restaurants.map((r) => r.name))
  const added = Object.keys(edits.newVenues)
    .filter((name) => !existing.has(name))
    .map((name): VenueMeta => {
      const patch = edits.venueOverrides[name] || {}
      return { name, city: patch.city ?? '', brand: patch.brand ?? name, entity: patch.entity ?? '' }
    })
  return added.length ? [...restaurants, ...added] : restaurants
}

/**
 * Resolves the plan price for one purchased line entirely client-side —
 * the same chain the client's Excel matrix ran by hand (справочник ->
 * pair -> pack -> product), plus the app's own manual edits layered on top
 * so the matrix itself never needs touching again:
 *   1. a plain per-product override (set via "Сопоставить" or an inline edit)
 *   2. supplier resolution: a manual "тот же поставщик, что и..." merge
 *      wins over the bundled справочник alias, which wins over the raw name
 *   3. (supplier, product, pack) — disambiguates "assortment" SKUs where the
 *      real variant only shows up in the packaging field
 *   4. (supplier, product) pair
 *   5. product name only (lowest confidence — ignores supplier)
 *   6. whatever the backend already resolved, as a last-resort fallback
 */
function resolveRowPlan(b: BaseRow, edits: Edits, matching: MatchingTable): { plan: number | null; kind: MatchKind } {
  const productOv = edits.planOverrides[b.product0]
  if (productOv != null) return { plan: productOv, kind: 'manual' }

  const mergedTo = edits.supplierMerges[b.supplier0]
  const supplierCanon = norm(mergedTo ?? matching.supplierAlias[norm(b.supplier0)] ?? b.supplier0)
  const product = norm(b.product0)
  const pairKey = `${supplierCanon}::${product}`

  const pack = norm(b.pack)
  if (pack) {
    const tripleKey = `${pairKey}::${pack}`
    if (matching.planPairsByPack[tripleKey] != null) return { plan: matching.planPairsByPack[tripleKey], kind: 'pair' }
  }
  if (matching.planPairs[pairKey] != null) return { plan: matching.planPairs[pairKey], kind: 'pair' }
  if (matching.planByProduct[product] != null) return { plan: matching.planByProduct[product], kind: 'product' }

  if (b.plan0 != null) return { plan: b.plan0, kind: b.planKind0 }
  return { plan: null, kind: null }
}

/** Builds display rows by applying edits, then classifies and assigns ABC. */
export function computeRows(base: BaseRow[], edits: Edits, matching: MatchingTable = BUNDLED_MATCHING): Row[] {
  const rows: Row[] = base.map((b) => {
    const mergedTo = edits.supplierMerges[b.supplier0]
    const supplierDisplay = mergedTo ?? b.supplier0
    const supplier = edits.supplierRenames[supplierDisplay] ?? supplierDisplay
    const product = edits.productRenames[b.product0] ?? b.product0
    const venue = edits.venueOverrides[b.restaurant]
    const { plan, kind: matchKind } = resolveRowPlan(b, edits, matching)
    const c = classify(plan, b.unit)
    const excluded = edits.excludedProducts[b.product0] === true
    const status: Status = excluded ? 'excluded' : c.status
    const effect = status === 'overpay' || status === 'saving' ? c.effect * b.qty : 0
    return {
      id: b.id, restaurant: b.restaurant,
      brand: venue?.brand ?? b.brand, city: venue?.city ?? b.city, entity: venue?.entity ?? b.entity, category: b.category,
      supplier, product, product0: b.product0, pack: b.pack, qty: b.qty, sum: b.sum, unit: b.unit, plan,
      diff: c.diff, diffPct: c.diffPct, effect, status, abc: 'C', matchKind,
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

export interface SupplierAgg { name: string; count: number; sum: number; isNew: boolean }
export interface ProductAgg { name: string; count: number; sum: number; basePlan: number | null; inMatrix: boolean; planKind: MatchKind; restaurantCount: number }
export interface VenueMeta { name: string; entity: string; brand: string; city: string }

/** Everything derived from a dataset — parsed once, either from the bundle or the API. */
export interface Parsed {
  base: BaseRow[]
  suppliers: SupplierAgg[]
  products: ProductAgg[]
  restaurants: VenueMeta[]
  period: string
  city: string
  category: string
}

/** Parses a raw dataset (bundled seed or fresh from the backend) into app structures. */
export function parseDataset(data: RawDataset): Parsed {
  let seq = 0
  const base: BaseRow[] = []
  for (const r of data.restaurants || []) {
    for (const it of r.items || []) {
      if (it.u == null) continue
      if (it.m < MIN_TURNOVER || it.q <= 0) continue
      base.push({
        id: 'r' + seq++,
        restaurant: r.name, brand: r.brand, city: r.city || 'Алматы', entity: r.entity, category: it.c ?? r.category,
        supplier0: it.s, product0: it.p, pack: it.k,
        qty: it.q, sum: it.m, unit: it.u, plan0: it.pl,
        planKind0: it.pl != null ? (it.pk ?? 'product') : null,
        supplierNew: it.sn === true,
      })
    }
  }
  const sm = new Map<string, SupplierAgg>()
  const pm = new Map<string, ProductAgg>()
  const prm = new Map<string, Set<string>>()
  for (const b of base) {
    const s = sm.get(b.supplier0) || { name: b.supplier0, count: 0, sum: 0, isNew: b.supplierNew }
    s.count++; s.sum += b.sum; sm.set(b.supplier0, s)
    const p = pm.get(b.product0) || { name: b.product0, count: 0, sum: 0, basePlan: null, inMatrix: false, planKind: null, restaurantCount: 0 }
    p.count++; p.sum += b.sum
    if (b.plan0 != null) { p.inMatrix = true; if (p.basePlan == null) { p.basePlan = b.plan0; p.planKind = b.planKind0 } }
    pm.set(b.product0, p)
    const rset = prm.get(b.product0) || new Set<string>()
    rset.add(b.restaurant)
    prm.set(b.product0, rset)
  }
  for (const p of pm.values()) p.restaurantCount = prm.get(p.name)?.size ?? 0
  return {
    base,
    suppliers: [...sm.values()].sort((a, b) => b.sum - a.sum),
    products: [...pm.values()].sort((a, b) => b.sum - a.sum),
    restaurants: (data.restaurants || []).map((r) => ({ name: r.name, entity: r.entity, brand: r.brand, city: r.city })),
    period: data.periodLabel,
    city: data.city,
    category: data.category,
  }
}

/** Bundled snapshot — used until the backend responds (or if it's offline). */
export const BUNDLED = parseDataset(raw as unknown as RawDataset)

export const MATCH_KIND_META: Record<NonNullable<MatchKind> | 'none', { label: string; hint: string; color: string }> = {
  pair: { label: 'поставщик+товар', hint: 'Точное совпадение по поставщику и названию товара — как в рабочей матрице.', color: 'text-good' },
  product: { label: 'только товар', hint: 'Совпадение только по названию товара, без учёта поставщика — цена может относиться к другому поставщику. Стоит проверить.', color: 'text-warn' },
  manual: { label: 'вручную', hint: 'Плановая цена задана или подтверждена вручную.', color: 'text-brand-300' },
  none: { label: 'нет плана', hint: 'Плановая цена не найдена.', color: 'text-slate-500' },
}

/** Restaurant list with any manual venue corrections applied. */
export function applyVenueOverrides(restaurants: VenueMeta[], overrides: Record<string, VenuePatch>): VenueMeta[] {
  return restaurants.map((r) => {
    const o = overrides[r.name]
    return o ? { ...r, city: o.city ?? r.city, brand: o.brand ?? r.brand, entity: o.entity ?? r.entity } : r
  })
}

export const STATUS_META: Record<Status, { label: string; color: string; dot: string }> = {
  overpay: { label: 'Переплата', color: 'text-bad', dot: 'bg-bad' },
  saving: { label: 'Экономия', color: 'text-good', dot: 'bg-good' },
  ok: { label: 'В норме', color: 'text-slate-300', dot: 'bg-slate-400' },
  review: { label: 'Проверить', color: 'text-sky-300', dot: 'bg-sky-400' },
  nomatrix: { label: 'Нет в матрице', color: 'text-warn', dot: 'bg-warn' },
  anomaly: { label: 'Аномалия', color: 'text-purple-300', dot: 'bg-purple-400' },
  excluded: { label: 'Разные товары', color: 'text-slate-500', dot: 'bg-slate-600' },
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
  reviewCount: number
  anomalyCount: number
  noMatrixCount: number
  excludedCount: number
  openIssues: number   // всё, что требует ручной сверки
}

export function summarize(rows: Row[]): Summary {
  let spend = 0, overpaySum = 0, savingSum = 0, matched = 0
  let overpayCount = 0, savingCount = 0, reviewCount = 0, anomalyCount = 0, noMatrixCount = 0, excludedCount = 0
  for (const r of rows) {
    spend += r.sum
    if (r.status !== 'nomatrix' && r.status !== 'excluded') matched++
    if (r.status === 'overpay') { overpaySum += r.effect; overpayCount++ }
    else if (r.status === 'saving') { savingSum += r.effect; savingCount++ }
    else if (r.status === 'review') reviewCount++
    else if (r.status === 'anomaly') anomalyCount++
    else if (r.status === 'nomatrix') noMatrixCount++
    else if (r.status === 'excluded') excludedCount++
  }
  const comparable = rows.filter((r) => r.status !== 'excluded').length
  return {
    spend,
    positions: rows.length,
    matched,
    matchRate: comparable ? matched / comparable : 0,
    overpaySum,
    savingSum,
    netEffect: savingSum + overpaySum,
    overpayCount,
    savingCount,
    reviewCount,
    anomalyCount,
    noMatrixCount,
    excludedCount,
    openIssues: reviewCount + anomalyCount + noMatrixCount,
  }
}

export function byRestaurant(rows: Row[]) {
  return groupBy(rows, (r) => r.restaurant)
}

/** Groups rows by an arbitrary key and summarizes each group. */
export function groupBy(rows: Row[], key: (r: Row) => string) {
  const map = new Map<string, Row[]>()
  for (const r of rows) {
    const k = key(r) || '—'
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(r)
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
