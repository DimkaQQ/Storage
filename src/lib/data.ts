import raw from '../data/dataset.json'
import matchingRaw from '../data/matching.json'

/**
 * The plan matrix — the same справочник (supplier alias dictionary) and
 * restaurant-scoped price table the client keeps in Excel. Bundled straight
 * into the app so matching runs entirely client-side.
 *
 * Prices are keyed per RESTAURANT, not just per supplier+product — the same
 * поставщик+товар can have a different negotiated price at different points
 * (confirmed straight from their matrix: one item priced differently across
 * three restaurant tabs for the same supplier).
 */
export interface MatchingTable {
  supplierAlias: Record<string, string>       // iiko supplier name (norm) -> canonical supplier name
  planPairs: Record<string, number>           // "restaurant::supplier::product" (norm) -> plan price
  planPairsByPack: Record<string, number>     // "restaurant::supplier::product::pack" (norm) -> plan price
}
export const BUNDLED_MATCHING: MatchingTable = matchingRaw as MatchingTable

const norm = (s: string) => String(s || '').trim().toLowerCase()

/** Raw purchase fact as extracted from the iiko report. */
interface RawItem {
  s: string  // supplier (as in iiko)
  p: string  // product (as in iiko)
  k: string  // packaging
  q: number  // quantity
  m: number  // total sum, тг
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

export type Status = 'ok' | 'overpay' | 'saving' | 'wrongSupplier' | 'nomatrix'

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
  diffPct: number | null   // (unit - plan)/plan; + = overpay
  status: Status
  designatedSuppliers: string[]  // only set for status === 'wrongSupplier' — who it should have been bought from
}

// A position is "in norm" when actual is within this band of the plan.
const OK_BAND = 0.02

// ТЗ: нули, пустые графы и позиции с оборотом до 1000 ₸ не показываем.
const MIN_TURNOVER = 1000

/** Immutable base row parsed from the dataset (original names, no plan resolution yet). */
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
}

/** Manual corrections to a venue's meta — for when auto-derived data is wrong. */
export interface VenuePatch { city?: string; brand?: string; entity?: string; category?: string }

/**
 * User edits layered over the immutable base data — deliberately minimal.
 * The matrix itself (Excel) stays the source of truth for plan prices; this
 * app's job is matching iiko's names to it and flagging mismatches, not
 * re-implementing price entry.
 */
export interface Edits {
  supplierRenames: Record<string, string>  // original supplier name -> display name
  productRenames: Record<string, string>   // original product name -> display name
  supplierMerges: Record<string, string>   // iiko-имя, которого нет в справочнике -> существующий поставщик (тот же, что и...)
  venueOverrides: Record<string, VenuePatch> // restaurant name -> corrected город/бренд/юрлицо/категория
  newVenues: Record<string, true>          // точки, добавленные вручную (ещё нет закупок в iiko)
}
export const EMPTY_EDITS: Edits = {
  supplierRenames: {}, productRenames: {}, supplierMerges: {}, venueOverrides: {}, newVenues: {},
}

/** Appends manually-added venues (e.g. a new restaurant not yet flowing purchases through iiko). */
export function withNewVenues(restaurants: VenueMeta[], edits: Edits): VenueMeta[] {
  const existing = new Set(restaurants.map((r) => r.name))
  const added = Object.keys(edits.newVenues)
    .filter((name) => !existing.has(name))
    .map((name): VenueMeta => {
      const patch = edits.venueOverrides[name] || {}
      return { name, city: patch.city ?? '', brand: patch.brand ?? name, entity: patch.entity ?? '', category: patch.category ?? '' }
    })
  return added.length ? [...restaurants, ...added] : restaurants
}

interface Resolved { plan: number | null; status: Status; designatedSuppliers: string[] }

/**
 * Resolves plan + status for one purchased line, entirely client-side:
 *   1. supplier resolution: a manual "тот же поставщик, что и..." merge
 *      wins over the bundled справочник alias, which wins over the raw name
 *   2. exact match on (this restaurant, this supplier, this product, this pack)
 *   3. same but without pack, for items the matrix doesn't split by packaging
 *   4. if the product is in the matrix for this restaurant under a DIFFERENT
 *      supplier — заказано не у того поставщика (расхождение, не цена)
 *   5. otherwise — товара нет в матрице для этого ресторана вообще
 */
/** "restaurant::product" (norm) -> set of suppliers the matrix designates for it — built once per matching table, not per row. */
function buildDesignatedIndex(matching: MatchingTable): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>()
  for (const key of Object.keys(matching.planPairs)) {
    const [restaurant, supplier, product] = key.split('::')
    const k = `${restaurant}::${product}`
    const set = idx.get(k) ?? new Set<string>()
    set.add(supplier)
    idx.set(k, set)
  }
  return idx
}

function resolveRowPlan(b: BaseRow, edits: Edits, matching: MatchingTable, designatedIndex: Map<string, Set<string>>): Resolved {
  const mergedTo = edits.supplierMerges[b.supplier0]
  // A merge target might itself be a raw iiko name with its own справочник alias
  // (not yet the true canonical matrix name) — resolve through the alias table
  // either way, so merging to *either* form reaches the same matrix bucket.
  const supplierCanon = mergedTo
    ? norm(matching.supplierAlias[norm(mergedTo)] ?? mergedTo)
    : norm(matching.supplierAlias[norm(b.supplier0)] ?? b.supplier0)
  const restaurant = norm(b.restaurant)
  const product = norm(b.product0)
  const pack = norm(b.pack)

  const pairKey = `${restaurant}::${supplierCanon}::${product}`
  if (pack) {
    const tripleKey = `${pairKey}::${pack}`
    const plan = matching.planPairsByPack[tripleKey]
    if (plan != null) return { plan, status: classifyPrice(plan, b.unit), designatedSuppliers: [] }
  }
  const plan = matching.planPairs[pairKey]
  if (plan != null) return { plan, status: classifyPrice(plan, b.unit), designatedSuppliers: [] }

  // Not matched for THIS supplier — is the product in the matrix for this
  // restaurant at all, just under someone else?
  const designated = designatedIndex.get(`${restaurant}::${product}`)
  if (designated && designated.size > 0) {
    return { plan: null, status: 'wrongSupplier', designatedSuppliers: [...designated] }
  }
  return { plan: null, status: 'nomatrix', designatedSuppliers: [] }
}

function classifyPrice(plan: number, unit: number): Status {
  const diffPct = (unit - plan) / plan
  if (diffPct > OK_BAND) return 'overpay'
  if (diffPct < -OK_BAND) return 'saving'
  return 'ok'
}

/** Builds display rows by applying edits and resolving plan/status. */
export function computeRows(base: BaseRow[], edits: Edits, matching: MatchingTable = BUNDLED_MATCHING): Row[] {
  const designatedIndex = buildDesignatedIndex(matching)
  return base.map((b) => {
    const mergedTo = edits.supplierMerges[b.supplier0]
    const supplierDisplay = mergedTo ?? b.supplier0
    const supplier = edits.supplierRenames[supplierDisplay] ?? supplierDisplay
    const product = edits.productRenames[b.product0] ?? b.product0
    const venue = edits.venueOverrides[b.restaurant]
    const { plan, status, designatedSuppliers } = resolveRowPlan(b, edits, matching, designatedIndex)
    const diffPct = plan != null ? (b.unit - plan) / plan : null
    return {
      id: b.id, restaurant: b.restaurant,
      brand: venue?.brand ?? b.brand, city: venue?.city ?? b.city, entity: venue?.entity ?? b.entity, category: venue?.category ?? b.category,
      supplier, product, product0: b.product0, pack: b.pack, qty: b.qty, sum: b.sum, unit: b.unit, plan,
      diffPct, status, designatedSuppliers,
    }
  })
}

/* ---------- reference lists for the editor ---------- */

export interface SupplierAgg { name: string; count: number; sum: number; isNew: boolean }
export interface ProductAgg { name: string; count: number; sum: number; restaurantCount: number }
export interface VenueMeta { name: string; entity: string; brand: string; city: string; category: string }

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
      if (it.m < MIN_TURNOVER || it.q <= 0) continue
      base.push({
        id: 'r' + seq++,
        restaurant: r.name, brand: r.brand, city: r.city || 'Алматы', entity: r.entity, category: r.category,
        supplier0: it.s, product0: it.p, pack: it.k,
        qty: it.q, sum: it.m, unit: it.m / it.q,
      })
    }
  }
  const sm = new Map<string, SupplierAgg>()
  const pm = new Map<string, ProductAgg>()
  const prm = new Map<string, Set<string>>()
  for (const b of base) {
    const s = sm.get(b.supplier0) || { name: b.supplier0, count: 0, sum: 0, isNew: BUNDLED_MATCHING.supplierAlias[norm(b.supplier0)] == null }
    s.count++; s.sum += b.sum; sm.set(b.supplier0, s)
    const p = pm.get(b.product0) || { name: b.product0, count: 0, sum: 0, restaurantCount: 0 }
    p.count++; p.sum += b.sum
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
    restaurants: (data.restaurants || []).map((r) => ({ name: r.name, entity: r.entity, brand: r.brand, city: r.city, category: r.category })),
    period: data.periodLabel,
    city: data.city,
    category: data.category,
  }
}

/** Bundled snapshot — used until the backend responds (or if it's offline). */
export const BUNDLED = parseDataset(raw as unknown as RawDataset)

/** Restaurant list with any manual venue corrections applied. */
export function applyVenueOverrides(restaurants: VenueMeta[], overrides: Record<string, VenuePatch>): VenueMeta[] {
  return restaurants.map((r) => {
    const o = overrides[r.name]
    return o ? { ...r, city: o.city ?? r.city, brand: o.brand ?? r.brand, entity: o.entity ?? r.entity, category: o.category ?? r.category } : r
  })
}

export const STATUS_META: Record<Status, { label: string; color: string; dot: string }> = {
  overpay: { label: 'Переплата', color: 'text-bad', dot: 'bg-bad' },
  saving: { label: 'Экономия', color: 'text-good', dot: 'bg-good' },
  ok: { label: 'В норме', color: 'text-slate-300', dot: 'bg-slate-400' },
  wrongSupplier: { label: 'Не тот поставщик', color: 'text-warn', dot: 'bg-warn' },
  nomatrix: { label: 'Нет в матрице', color: 'text-purple-300', dot: 'bg-purple-400' },
}

/* ---------- aggregation helpers ---------- */

export interface Summary {
  positions: number
  matched: number
  matchRate: number
  wrongSupplierCount: number
  noMatrixCount: number
  openIssues: number   // всё, что требует внимания
}

export function summarize(rows: Row[]): Summary {
  let matched = 0, wrongSupplierCount = 0, noMatrixCount = 0
  for (const r of rows) {
    if (r.status !== 'nomatrix' && r.status !== 'wrongSupplier') matched++
    else if (r.status === 'wrongSupplier') wrongSupplierCount++
    else if (r.status === 'nomatrix') noMatrixCount++
  }
  return {
    positions: rows.length,
    matched,
    matchRate: rows.length ? matched / rows.length : 0,
    wrongSupplierCount,
    noMatrixCount,
    openIssues: wrongSupplierCount + noMatrixCount,
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
