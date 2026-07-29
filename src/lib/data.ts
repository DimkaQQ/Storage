import datasetMay from '../data/dataset-2026-05.json'
import datasetJune from '../data/dataset-2026-06.json'
import matchingRaw from '../data/matching.json'

// Один и тот же снимок матрицы применяется ко всем периодам — она не
// версионируется по месяцам, только факт закупок (Q:U) меняется помесячно.
const BUNDLED_DATASETS = ([datasetMay, datasetJune] as unknown as RawDataset[]).sort((a, b) => a.period.localeCompare(b.period))
export const BUNDLED_PERIODS = BUNDLED_DATASETS.map((d) => ({ period: d.period, periodLabel: d.periodLabel }))

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
  productLabels: Record<string, string>       // same keys as planPairs/planPairsByPack -> их собственное "Наименование товара" (колонка I)
  noPriceExact: Record<string, true>          // same keys as planPairs/planPairsByPack -> связь с iiko прописана точно, но цены (H) просто нет
}
export const BUNDLED_MATCHING: MatchingTable = matchingRaw as MatchingTable

const norm = (s: string) => String(s || '').trim().toLowerCase()

/**
 * Фасовка в отчёте iiko и в матрице иногда набрана по-разному для одного и
 * того же веса: запятая вместо точки в дроби ("1*0,500" vs "1*0.500"),
 * лишняя точка-сокращение в конце ("500гр." vs "500гр"). Без этого такие
 * пары не совпадают как строки — реальный матч теряется (тот же класс
 * проблемы, что был у Ayakaz, только тут виновато форматирование текста,
 * а не сборка данных). matching.json уже собран с этой же нормализацией
 * фасовки, так что она обязана совпадать с extract.py дословно.
 */
const normPack = (s: string) => {
  let p = norm(s)
  p = p.replace(/(?<=\d),(?=\d)/g, '.')
  p = p.replace(/\.$/, '')
  return p
}

// Голая единица измерения ("кг", "шт", "л"…) ничего не уточняет — ни для
// показа (не выносим её отдельной строкой под товаром), ни для сопоставления
// (см. bare-unit fallback в resolveRowPlan ниже).
const BARE_UNITS = new Set(['кг', 'шт', 'л', 'г', 'мл', 'гр', 'уп', 'кор', 'бан', 'пач'])
export const isPrecisePack = (pack: string) => {
  const p = normPack(pack)
  return p.length > 0 && !BARE_UNITS.has(p)
}

/**
 * Их же описание товара (столбец I) — просто человекочитаемый текст и
 * иногда противоречит их же названию из iiko (D/E): например факт "Рыба
 * лосось... с/м." (свежемороженая), а их описание — "охлажденка"; или факт
 * "оливки б/к." (без косточки), а их описание — "с косточкой". Привязка
 * (D/E) при этом точная, так что план верный, но показывать противоречащую
 * подпись под товаром — вводить в заблуждение, лучше вообще без подписи.
 */
function freezeState(s: string): 'frozen' | 'chilled' | null {
  const t = norm(s)
  if (t.includes('с/м') || t.includes('свежемороже') || t.includes('заморож')) return 'frozen'
  if (t.includes('охлажд')) return 'chilled'
  return null
}
function boneState(s: string): 'boneless' | 'bone' | null {
  const t = norm(s)
  if (t.includes('б/к') || /без\s+кост/.test(t)) return 'boneless'
  if (/с\s+кост/.test(t) || /на\s+кост/.test(t)) return 'bone'
  return null
}
function safeLabel(product: string, label: string | null | undefined): string | null {
  if (!label) return null
  const pf = freezeState(product), lf = freezeState(label)
  if (pf && lf && pf !== lf) return null
  const pb = boneState(product), lb = boneState(label)
  if (pb && lb && pb !== lb) return null
  return label
}

/** Raw purchase fact as extracted from the iiko report. */
interface RawItem {
  s: string  // supplier (as in iiko)
  p: string  // product (as in iiko)
  k: string  // packaging
  q: number  // quantity
  m: number  // total sum, тг
  c?: string // их же комментарий к этой строке закупки в iiko-отчёте (если есть)
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

export type Status = 'ok' | 'wrongSupplier' | 'nomatrix'

export interface Row {
  id: string
  restaurant: string
  brand: string
  city: string
  entity: string
  category: string
  supplier: string
  supplierLabel: string | null  // их название компании из матрицы (колонка C), когда отличается от того, что пишет iiko
  product: string
  productLabel: string | null  // их собственное "Наименование товара" из матрицы (только когда status === 'ok')
  pack: string
  qty: number
  unit: number
  plan: number | null
  diffPct: number | null   // (unit - plan)/plan — informational only, no overpay/saving concept
  status: Status
  designatedSuppliers: string[]  // only set for status === 'wrongSupplier' — who it should have been bought from
  note: string | null  // их комментарий к этой закупке в iiko, либо пояснение "нет плановой цены" для unpriced-совпадений
}

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
  comment: string | null
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
  productRenames: Record<string, string>   // original product name -> display name
  acknowledgedSuppliers: Record<string, true> // iiko-имя, которого нет в справочнике, но это реально НОВЫЙ поставщик (не опечатка/дубликат) — просто отметили, что видели
  venueOverrides: Record<string, VenuePatch> // restaurant name -> corrected город/бренд/юрлицо/категория
  newVenues: Record<string, true>          // точки, добавленные вручную (ещё нет закупок в iiko)
}
export const EMPTY_EDITS: Edits = {
  productRenames: {}, acknowledgedSuppliers: {}, venueOverrides: {}, newVenues: {},
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

interface Resolved { plan: number | null; status: Status; designatedSuppliers: string[]; productLabel: string | null; unpricedMatch: boolean }

const NO_PLAN_PRICE_NOTE = 'В матрице нет плановой цены для этой позиции.'

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
interface DesignatedIndex {
  byPack: Map<string, Set<string>>     // "restaurant::product::pack" -> suppliers priced for exactly this variant
  byProduct: Map<string, Set<string>>  // "restaurant::product" -> suppliers priced for this product, any pack — used when the FACT itself has no pack to be precise about
  byProductFlatOnly: Map<string, Set<string>>  // "restaurant::product" -> suppliers designated WITHOUT a specific pack (matrix never split them by fasovka) — genuinely pack-agnostic, unlike byProduct which also includes pack-specific suppliers
  bySupplierProduct: Map<string, Set<string>>  // "restaurant::supplier::product" -> pack variants THIS supplier has priced
}

/** Built once per matching table, not per row. */
function buildDesignatedIndex(matching: MatchingTable): DesignatedIndex {
  const byPack = new Map<string, Set<string>>()
  const byProduct = new Map<string, Set<string>>()
  const byProductFlatOnly = new Map<string, Set<string>>()
  const bySupplierProduct = new Map<string, Set<string>>()
  const add = (map: Map<string, Set<string>>, k: string, v: string) => {
    const set = map.get(k) ?? new Set<string>()
    set.add(v)
    map.set(k, set)
  }
  for (const key of Object.keys(matching.planPairs)) {
    const [restaurant, supplier, product] = key.split('::')
    add(byProduct, `${restaurant}::${product}`, supplier)
    add(byProductFlatOnly, `${restaurant}::${product}`, supplier)
  }
  for (const key of Object.keys(matching.planPairsByPack)) {
    const [restaurant, supplier, product, pack] = key.split('::')
    add(byProduct, `${restaurant}::${product}`, supplier)
    add(byPack, `${restaurant}::${product}::${pack}`, supplier)
    add(bySupplierProduct, `${restaurant}::${supplier}::${product}`, pack)
  }
  // Поставщик с точной iiko-привязкой, но без цены (см. noPriceExact в
  // resolveRowPlan) — всё равно признанный, назначенный поставщик для этого
  // товара, так что должен попадать в список "должны" наравне с
  // прайсованными. НЕ добавляем его в bySupplierProduct — та карта только
  // про прайсованные варианты фасовки, иначе можно случайно испортить
  // bare-pack-фолбэк выше (посчитать вариантов больше, чем реально прайсовано).
  for (const key of Object.keys(matching.noPriceExact)) {
    const parts = key.split('::')
    const [restaurant, supplier, product, pack] = parts
    add(byProduct, `${restaurant}::${product}`, supplier)
    if (parts.length === 4) add(byPack, `${restaurant}::${product}::${pack}`, supplier)
    else add(byProductFlatOnly, `${restaurant}::${product}`, supplier)
  }
  return { byPack, byProduct, byProductFlatOnly, bySupplierProduct }
}

function resolveRowPlan(b: BaseRow, matching: MatchingTable, designatedIndex: DesignatedIndex): Resolved {
  const supplierCanon = norm(matching.supplierAlias[norm(b.supplier0)] ?? b.supplier0)
  const restaurant = norm(b.restaurant)
  const product = norm(b.product0)
  const pack = normPack(b.pack)

  const pairKey = `${restaurant}::${supplierCanon}::${product}`
  if (pack) {
    const tripleKey = `${pairKey}::${pack}`
    const plan = matching.planPairsByPack[tripleKey]
    if (plan != null) return { plan, status: 'ok', designatedSuppliers: [], productLabel: safeLabel(b.product0, matching.productLabels[tripleKey]), unpricedMatch: false }
  }
  const plan = matching.planPairs[pairKey]
  if (plan != null) return { plan, status: 'ok', designatedSuppliers: [], productLabel: safeLabel(b.product0, matching.productLabels[pairKey]), unpricedMatch: false }

  // Текст фасовки у факта и у матрицы может не совпасть буквально по кучe
  // причин, которые не про разный товар: iiko иногда пишет голую единицу
  // ("л", "кг") вместо полной фасовки с брендом ("«чудское озеро» 1л"), а для
  // весовых товаров (сыр, колбаса) конкретный вес куска каждый раз свой
  // ("1*1.328" против "1*.886") — но цена всё равно за кг, поэтому она
  // одинаковая. Раз у поставщика тут ровно ОДИН вариант фасовки — гадать не
  // нужно, это может быть только он, но только если цена сошлась ТОЧНО: это
  // и есть доказательство, а не совпадение. Малейшее расхождение в цене — не
  // совпадение, оставляем как есть, а не подгоняем (ровно то, из-за чего был
  // баг с Ayakaz). Сравниваем В ПРОЦЕНТАХ, а не в тенге: округление qty/sum
  // при делении на количество даёт разницу в доли тенге даже для той же самой
  // цены (16305 против 16305.88 — это те же самые оливки, просто округление),
  // а фиксированный порог в тенге ломается на дорогих позициях.
  if (pack) {
    const variants = designatedIndex.bySupplierProduct.get(pairKey)
    if (variants && variants.size === 1) {
      const onlyPack = [...variants][0]
      const candidateKey = `${pairKey}::${onlyPack}`
      const candidatePlan = matching.planPairsByPack[candidateKey]
      if (candidatePlan != null) {
        // Если их собственная фасовка (F) в матрице сама голая ("кг") — это
        // значит, что цена в матрице и так за килограмм, вне зависимости от
        // того, как именно расфасовано у поставщика (Креветки 16/20: у них
        // "кг", у факта конкретный блок "1.8кг" — это тот же самый товар, а
        // не другой). Раз в матрице всего ОДИН такой товар и он без деления
        // по фасовке — совпадение цены тут ничего не доказывает и не нужно,
        // само название уже точное доказательство. Порог по цене остаётся
        // только там, где у матрицы своя фасовка конкретная (голубика/малина
        // и т.п. — там угадывать по названию нельзя, только по цене).
        if (!isPrecisePack(onlyPack) || Math.abs(candidatePlan - b.unit) / candidatePlan < 0.001) {
          return { plan: candidatePlan, status: 'ok', designatedSuppliers: [], productLabel: safeLabel(b.product0, matching.productLabels[candidateKey]), unpricedMatch: false }
        }
      }
    }
  }

  // Связь с iiko прописана в матрице ТОЧНО (их же название поставщика и
  // товара), просто цена (H) не заполнена — например "Агрофирма Курминское
  // яйцо" продаёт им "Яйцо куриное" один в один как в iiko, только без
  // цены. Точное совпадение имени — не нужно гадать по словам, как ниже.
  if (pack && matching.noPriceExact[`${pairKey}::${pack}`]) {
    return { plan: null, status: 'ok', designatedSuppliers: [], productLabel: null, unpricedMatch: true }
  }
  if (matching.noPriceExact[pairKey]) {
    return { plan: null, status: 'ok', designatedSuppliers: [], productLabel: null, unpricedMatch: true }
  }

  // No price for THIS exact (supplier, pack) combo. Who's designated for
  // THIS EXACT variant (pack included) matters — e.g. Ayakaz and Alga73 both
  // price "Ягода импортная" for Сирена, but only for малина/голубика/ежевика;
  // neither has клубника priced there. Checking product-level only would
  // wrongly call that "wrong supplier" (Alga73!) instead of "not in the
  // matrix at all for this variant". So: for a packed fact, use ONLY the
  // pack-specific set, unioned with suppliers who are genuinely pack-agnostic
  // in the matrix (byProductFlatOnly — e.g. "Агрофирма Курминское яйцо"
  // never got split by fasovka at all, so they're designated regardless of
  // what pack this particular purchase happens to show) — but never suppliers
  // who are ONLY priced for some *other specific* pack. Packless facts fall
  // back to the broad byProduct set, same as before.
  let designated: Set<string> | undefined
  if (pack) {
    const packSpecific = designatedIndex.byPack.get(`${restaurant}::${product}::${pack}`)
    const flatOnly = designatedIndex.byProductFlatOnly.get(`${restaurant}::${product}`)
    if (packSpecific || flatOnly) designated = new Set([...(packSpecific ?? []), ...(flatOnly ?? [])])
  } else {
    designated = designatedIndex.byProduct.get(`${restaurant}::${product}`)
  }
  if (designated && designated.size > 0) {
    const others = [...designated].filter((s) => s !== supplierCanon)
    if (others.length > 0) return { plan: null, status: 'wrongSupplier', designatedSuppliers: others, productLabel: null, unpricedMatch: false }
  }
  return { plan: null, status: 'nomatrix', designatedSuppliers: [], productLabel: null, unpricedMatch: false }
}

/** Builds display rows by applying edits and resolving plan/status. */
export function computeRows(base: BaseRow[], edits: Edits, matching: MatchingTable = BUNDLED_MATCHING): Row[] {
  const designatedIndex = buildDesignatedIndex(matching)
  return base.map((b) => {
    // Основное название — всегда как поставщик записан в самом отчёте iiko.
    // Их название компании из матрицы (колонка C) — отдельная серая подпись
    // снизу, так же, как название товара из матрицы под самим товаром.
    const supplier = b.supplier0
    const supplierCanonical = matching.supplierAlias[norm(b.supplier0)] ?? null
    const supplierLabel = supplierCanonical && norm(supplierCanonical) !== norm(supplier) ? supplierCanonical : null
    const product = edits.productRenames[b.product0] ?? b.product0
    const venue = edits.venueOverrides[b.restaurant]
    const { plan, status, designatedSuppliers, productLabel, unpricedMatch } = resolveRowPlan(b, matching, designatedIndex)
    const diffPct = plan != null ? (b.unit - plan) / plan : null
    // Их же комментарий к этой закупке в iiko — если есть, показываем всегда,
    // независимо от статуса. Если комментария нет, но статус выставлен через
    // unpriced-fallback (по матрице, но без цены) — поясняем почему нет цены.
    const note = b.comment ?? (unpricedMatch ? NO_PLAN_PRICE_NOTE : null)
    return {
      id: b.id, restaurant: b.restaurant,
      brand: venue?.brand ?? b.brand, city: venue?.city ?? b.city, entity: venue?.entity ?? b.entity, category: venue?.category ?? b.category,
      supplier, supplierLabel, product, productLabel, pack: b.pack, qty: b.qty, unit: b.unit, plan,
      diffPct, status, designatedSuppliers, note,
    }
  })
}

/* ---------- reference lists for the editor ---------- */

export interface SupplierAgg { name: string; count: number; isNew: boolean }
export interface ProductAgg { name: string; count: number; restaurantCount: number }
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

/**
 * Временное ограничение: пока в приложении включена и хорошо перепроверена
 * только Рене — остальные точки скрыты везде (Обзор, Проверка цен,
 * Справочники), пока их так же не перепроверят. Чтобы вернуть все точки,
 * достаточно поставить сюда null.
 */
const RESTAURANT_SCOPE: string[] | null = ['Рене']

/** Parses a raw dataset (bundled seed or fresh from the backend) into app structures. */
export function parseDataset(data: RawDataset): Parsed {
  let seq = 0
  const base: BaseRow[] = []
  const restaurantsIn = RESTAURANT_SCOPE
    ? (data.restaurants || []).filter((r) => RESTAURANT_SCOPE.includes(r.name))
    : (data.restaurants || [])
  for (const r of restaurantsIn) {
    for (const it of r.items || []) {
      if (it.m < MIN_TURNOVER || it.q <= 0) continue
      base.push({
        id: 'r' + seq++,
        restaurant: r.name, brand: r.brand, city: r.city || 'Алматы', entity: r.entity, category: r.category,
        supplier0: it.s, product0: it.p, pack: it.k,
        qty: it.q, sum: it.m, unit: it.m / it.q, comment: it.c ?? null,
      })
    }
  }
  const sm = new Map<string, SupplierAgg>()
  const pm = new Map<string, ProductAgg>()
  const prm = new Map<string, Set<string>>()
  for (const b of base) {
    const s = sm.get(b.supplier0) || { name: b.supplier0, count: 0, isNew: BUNDLED_MATCHING.supplierAlias[norm(b.supplier0)] == null }
    s.count++; sm.set(b.supplier0, s)
    const p = pm.get(b.product0) || { name: b.product0, count: 0, restaurantCount: 0 }
    p.count++
    pm.set(b.product0, p)
    const rset = prm.get(b.product0) || new Set<string>()
    rset.add(b.restaurant)
    prm.set(b.product0, rset)
  }
  for (const p of pm.values()) p.restaurantCount = prm.get(p.name)?.size ?? 0
  return {
    base,
    suppliers: [...sm.values()].sort((a, b) => b.count - a.count),
    products: [...pm.values()].sort((a, b) => b.count - a.count),
    restaurants: restaurantsIn.map((r) => ({ name: r.name, entity: r.entity, brand: r.brand, city: r.city, category: r.category })),
    period: data.periodLabel,
    city: data.city,
    category: data.category,
  }
}

/** Bundled snapshot for one period — falls back to the latest if not found/omitted. */
export function bundledDataset(period?: string | null): RawDataset {
  return (period && BUNDLED_DATASETS.find((d) => d.period === period)) || BUNDLED_DATASETS[BUNDLED_DATASETS.length - 1]
}

/** Bundled snapshot (latest period) — used until the backend responds (or if it's offline). */
export const BUNDLED = parseDataset(bundledDataset())

/** Restaurant list with any manual venue corrections applied. */
export function applyVenueOverrides(restaurants: VenueMeta[], overrides: Record<string, VenuePatch>): VenueMeta[] {
  return restaurants.map((r) => {
    const o = overrides[r.name]
    return o ? { ...r, city: o.city ?? r.city, brand: o.brand ?? r.brand, entity: o.entity ?? r.entity, category: o.category ?? r.category } : r
  })
}

export const STATUS_META: Record<Status, { label: string; color: string; dot: string }> = {
  ok: { label: 'По матрице', color: 'text-good', dot: 'bg-good' },
  wrongSupplier: { label: 'Заказ не по матрице', color: 'text-warn', dot: 'bg-warn' },
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
// План/факт — точная сумма как есть, без округления до целого тенге
// (округляем только когда сумма и так целая — 2 знака максимум, не всегда).
const nfMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

export const fmt = (n: number) => nf.format(Math.round(n))
export const fmt1 = (n: number) => nf1.format(n)
export const money = (n: number) => nfMoney.format(n) + ' ₸'
export const pct = (n: number) => (n >= 0 ? '+' : '') + nf1.format(n * 100) + '%'

/** Russian plural selector: plural(n, 'правка', 'правки', 'правок'). */
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}
