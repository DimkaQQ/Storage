import datasetMay from '../data/dataset-2026-05.json'
import datasetJune from '../data/dataset-2026-06.json'
import matchingMay from '../data/matching-2026-05.json'
import matchingJune from '../data/matching-2026-06.json'

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
 *
 * The matrix itself is versioned per period too, same as the facts — prices
 * genuinely move month to month (verified: 244 pack-level prices differ
 * between the May and June exports), so May's facts must be checked against
 * May's matrix, not whichever month was uploaded last.
 */
export interface MatchingTable {
  supplierAlias: Record<string, string>       // iiko supplier name (norm) -> canonical supplier name
  planPairs: Record<string, number>           // "restaurant::supplier::product" (norm) -> plan price
  planPairsByPack: Record<string, number>     // "restaurant::supplier::product::pack" (norm) -> plan price
  productLabels: Record<string, string>       // same keys as planPairs/planPairsByPack -> их собственное "Наименование товара" (колонка I)
  noPriceExact: Record<string, true>          // same keys as planPairs/planPairsByPack -> связь с iiko прописана точно, но цены (H) просто нет
}
const BUNDLED_MATCHINGS: Record<string, MatchingTable> = {
  '2026-05': matchingMay as MatchingTable,
  '2026-06': matchingJune as MatchingTable,
}
export function bundledMatching(period?: string | null): MatchingTable {
  return (period && BUNDLED_MATCHINGS[period]) || BUNDLED_MATCHINGS[BUNDLED_PERIODS[BUNDLED_PERIODS.length - 1].period]
}
/** Latest period's matrix — used wherever a period isn't in scope (e.g. default fn params). */
export const BUNDLED_MATCHING: MatchingTable = bundledMatching()

/**
 * Пустая матрица — для тестового режима «только что загрузили отчёт iiko,
 * матрицы ещё нет» (Справочники → переключатель). Ничего не сопоставлено
 * заранее: «Название из матрицы» и «План» везде пустые, можно вписать
 * руками и посмотреть результат. Ручные правки (edits) при этом всё равно
 * работают как обычно — они всегда побеждают матрицу, пустую или нет.
 */
export const EMPTY_MATCHING: MatchingTable = {
  supplierAlias: {}, planPairs: {}, planPairsByPack: {}, productLabels: {}, noPriceExact: {},
}

export const norm = (s: string) => String(s || '').trim().toLowerCase()

/**
 * Фасовка в отчёте iiko и в матрице иногда набрана по-разному для одного и
 * того же веса: запятая вместо точки в дроби ("1*0,500" vs "1*0.500"),
 * лишняя точка-сокращение в конце ("500гр." vs "500гр"). Без этого такие
 * пары не совпадают как строки — реальный матч теряется (тот же класс
 * проблемы, что был у Ayakaz, только тут виновато форматирование текста,
 * а не сборка данных). matching.json уже собран с этой же нормализацией
 * фасовки, так что она обязана совпадать с extract.py дословно.
 */
export const normPack = (s: string) => {
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
  productRaw: string  // название товара как в iiko, без переименований/подмены — нужно для setPackAlias (Row.product может быть подменён на их название)
  productLabel: string | null  // их собственное "Наименование товара" из матрицы (только когда status === 'ok')
  isAssortment: boolean  // true, если под этим iiko-названием у этого поставщика в матрице реально несколько разных товаров (категория-ассортимент, например "Пюре в асс") — различить их можно только по фасовке
  pack: string
  qty: number
  unit: number | null  // null для позиции из матрицы, которую в этом периоде вообще не покупали (status при этом всё ещё 'ok' — она есть в плане)
  plan: number | null
  diffPct: number | null   // (unit - plan)/plan — informational only, no overpay/saving concept
  status: Status
  designatedSuppliers: string[]  // only set for status === 'wrongSupplier' — who it should have been bought from
  note: string | null  // их комментарий к этой закупке в iiko, либо пояснение "нет плановой цены" для unpriced-совпадений
  availableFasovki: FasovkaOption[]  // прайсованные варианты фасовки у этого же поставщика, ни один не совпал с фактом — предложить выбрать вручную (см. packFixKey)
  packFixKey: string | null  // ключ для setPackAlias — есть, только когда availableFasovki непусто
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
/**
 * "Эта фасовка из iiko на самом деле вот эта фасовка из матрицы" — реально
 * влияет на сопоставление (см. resolveRowPlan). Ключ (supplier/product/
 * rawPack нормализованные) нужен только для лукапа при сопоставлении;
 * значения храним отдельно в их же написании — иначе список в Справочниках
 * пришлось бы собирать обратно из нижнего регистра, а этого не восстановить.
 */
export interface PackAlias { targetPack: string; supplier: string; product: string; rawPack: string }

export interface Edits {
  productRenames: Record<string, string>   // "товар::поставщик::фасовка" (raw, как в iiko) -> наше название для этой ровно позиции
  supplierRenames: Record<string, string>  // iiko-имя поставщика (raw) -> наше название — только подпись (HoverName/"Справочник"), на сопоставление с матрицей не влияет
  acknowledgedSuppliers: Record<string, true> // iiko-имя, которого нет в справочнике, но это реально НОВЫЙ поставщик (не опечатка/дубликат) — просто отметили, что видели
  productPackOverride: Record<string, boolean> // original product name -> фасовка важна для сопоставления? true = обязательна (строгое совпадение), false = не важна (сравниваем без учёта фасовки). Ручной override автоматики (см. resolveRowPlan)
  packAliases: Record<string, PackAlias>   // "поставщик(канон)::товар::фасовка как в iiko" (норм.) -> правка
  planOverrides: Record<string, number>    // "ресторан::поставщик(канон)::товар::фасовка" или без фасовки (норм.) -> план цена, задана вручную в Справочниках — та же ключевая область, что у matching.planPairsByPack/planPairs
  venueOverrides: Record<string, VenuePatch> // restaurant name -> corrected город/бренд/юрлицо/категория
  newVenues: Record<string, true>          // точки, добавленные вручную (ещё нет закупок в iiko)
}
export const EMPTY_EDITS: Edits = {
  productRenames: {}, supplierRenames: {}, acknowledgedSuppliers: {}, productPackOverride: {}, packAliases: {}, planOverrides: {}, venueOverrides: {}, newVenues: {},
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

export interface FasovkaOption { pack: string; price: number; label: string | null }

interface Resolved {
  plan: number | null
  status: Status
  designatedSuppliers: string[]
  productLabel: string | null
  unpricedMatch: boolean
  matchedKey: string | null  // the planPairs/planPairsByPack key this purchase consumed, if any — lets computeRows tell purchased matrix slots apart from ones nobody bought yet
  candidateNote: string | null  // у этого же поставщика в матрице есть цена по ДРУГОЙ фасовке — не считаем совпадением автоматически, но не молчим об этом
  availableFasovki: FasovkaOption[]  // все прайсованные варианты фасовки у ЭТОГО поставщика для этого товара, ни один не совпал с фактом — предлагаем выбрать вручную
  packFixKey: string | null  // ключ для edits.packAliases, если выбрать один из availableFasovki
  isAssortment: boolean  // фасовка может иметь значение (см. buildKnownFlatIndex) — считаем ровно тут же, где строится pairKey, чтобы не разъезжаться с computeRows
}

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

/**
 * Пары товар+поставщик, для которых матрица ЯВНО подтверждает: под этим
 * iiko-названием всегда один и тот же товар, независимо от фасовки — можно
 * смело схлопывать все фасовки в одну строку, показывать её незачем.
 *
 * Специально строим "точно НЕ ассортимент" (а не наоборот, "точно
 * ассортимент"), потому что у пары есть три исхода, не два: несколько
 * разных названий по фасовкам (это ассортимент, показываем фасовку) — тут
 * решение однозначно; ровно одно название на все фасовки (точно не
 * ассортимент) — тоже однозначно; а вот пары вовсе нет в матрице ни под
 * одной фасовкой (новый товар, ещё не сопоставлен, или тестовый режим без
 * матрицы вовсе) — про это МЫ НИЧЕГО НЕ ЗНАЕМ, и раньше это молча считалось
 * "не ассортимент" и схлопывало фасовку — из-за этого разные пачки одного
 * iiko-названия ("Roti Azik 10шт" и "…5шт") сливались в одну строку, и
 * ручная цена/название, заданные для неё, тихо применялись сразу к обеим
 * разным реальным упаковкам. Теперь по умолчанию (неизвестность) считаем,
 * что фасовка МОЖЕТ иметь значение, и показываем её отдельной строкой —
 * лишняя строка безопаснее, чем два разных товара под одной ценой.
 */
function buildKnownFlatIndex(matching: MatchingTable): Set<string> {
  const labelsByPair = new Map<string, Set<string>>()
  for (const [key, label] of Object.entries(matching.productLabels)) {
    const pairKey = key.split('::').slice(0, 3).join('::')
    const set = labelsByPair.get(pairKey) ?? new Set<string>()
    set.add(label)
    labelsByPair.set(pairKey, set)
  }
  const result = new Set<string>()
  for (const [pairKey, labels] of labelsByPair) if (labels.size === 1) result.add(pairKey)
  return result
}

function resolveRowPlan(b: BaseRow, edits: Edits, matching: MatchingTable, designatedIndex: DesignatedIndex, knownFlatPairs: Set<string>): Resolved {
  const supplierCanon = norm(matching.supplierAlias[norm(b.supplier0)] ?? b.supplier0)
  const restaurant = norm(b.restaurant)
  const product = norm(b.product0)
  const rawPack = normPack(b.pack)

  // Ручная правка "эта фасовка из iiko на самом деле вот эта фасовка из
  // матрицы" (Справочники / прямо на строке в «Проверке цен») — подставляем
  // ДО любого сопоставления, дальше вся логика работает уже с исправленным
  // текстом, как будто iiko изначально написал именно так.
  const packFixKey = rawPack ? `${supplierCanon}::${product}::${rawPack}` : null
  const packAlias = packFixKey ? edits.packAliases[packFixKey] : undefined
  const pack = packAlias ? normPack(packAlias.targetPack) : rawPack

  const pairKey = `${restaurant}::${supplierCanon}::${product}`
  // Фасовка может иметь значение (см. buildKnownFlatIndex) — если да, ПЛОСКАЯ
  // (без фасовки) ручная правка плана/названия для этой пары больше не
  // применяется вообще, только точная (с фасовкой). Иначе одна цена/название,
  // заданные для одной упаковки, тихо подставлялись бы во ВСЕ остальные
  // фасовки этого же iiko-названия — ровно баг, который уже один раз нашли
  // руками (Roti Azik 10шт/5шт получили одну и ту же цену).
  const isAssortment = !knownFlatPairs.has(pairKey)

  const NONE: Pick<Resolved, 'candidateNote' | 'availableFasovki' | 'packFixKey' | 'isAssortment'> = { candidateNote: null, availableFasovki: [], packFixKey: null, isAssortment }

  // Ручной план цены из Справочников (Товары → «План») — самая свежая,
  // осознанно введённая цена для этой ровно позиции, побеждает всё
  // остальное. Считаем по СЫРОЙ фасовке из iiko (не через packAlias) —
  // это независимый, более прямой способ поправить/задать цену, а не ещё
  // один слой поверх сопоставления фасовки.
  const rawTripleKey = rawPack ? `${pairKey}::${rawPack}` : null
  if (rawTripleKey && edits.planOverrides[rawTripleKey] != null) {
    return { plan: edits.planOverrides[rawTripleKey], status: 'ok', designatedSuppliers: [], productLabel: safeLabel(b.product0, matching.productLabels[rawTripleKey]), unpricedMatch: false, matchedKey: rawTripleKey, ...NONE }
  }
  if (!isAssortment && edits.planOverrides[pairKey] != null) {
    return { plan: edits.planOverrides[pairKey], status: 'ok', designatedSuppliers: [], productLabel: safeLabel(b.product0, matching.productLabels[pairKey]), unpricedMatch: false, matchedKey: pairKey, ...NONE }
  }

  if (pack) {
    const tripleKey = `${pairKey}::${pack}`
    const plan = matching.planPairsByPack[tripleKey]
    if (plan != null) return { plan, status: 'ok', designatedSuppliers: [], productLabel: safeLabel(b.product0, matching.productLabels[tripleKey]), unpricedMatch: false, matchedKey: tripleKey, ...NONE }
  }
  const plan = matching.planPairs[pairKey]
  if (plan != null) return { plan, status: 'ok', designatedSuppliers: [], productLabel: safeLabel(b.product0, matching.productLabels[pairKey]), unpricedMatch: false, matchedKey: pairKey, ...NONE }

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
        // и т.п. — там угадывать по названию нельзя, только по цене). Это
        // автоматическое правило можно переопределить вручную в Справочниках
        // (Товары → «Фасовка»), если для конкретного товара оно не подходит.
        const packMatters = edits.productPackOverride[b.product0] ?? isPrecisePack(onlyPack)
        if (!packMatters || Math.abs(candidatePlan - b.unit) / candidatePlan < 0.001) {
          return { plan: candidatePlan, status: 'ok', designatedSuppliers: [], productLabel: safeLabel(b.product0, matching.productLabels[candidateKey]), unpricedMatch: false, matchedKey: candidateKey, ...NONE }
        }
      }
    }
  }

  // Связь с iiko прописана в матрице ТОЧНО (их же название поставщика и
  // товара), просто цена (H) не заполнена — например "Агрофирма Курминское
  // яйцо" продаёт им "Яйцо куриное" один в один как в iiko, только без
  // цены. Точное совпадение имени — не нужно гадать по словам, как ниже.
  if (pack && matching.noPriceExact[`${pairKey}::${pack}`]) {
    return { plan: null, status: 'ok', designatedSuppliers: [], productLabel: null, unpricedMatch: true, matchedKey: null, ...NONE }
  }
  if (matching.noPriceExact[pairKey]) {
    return { plan: null, status: 'ok', designatedSuppliers: [], productLabel: null, unpricedMatch: true, matchedKey: null, ...NONE }
  }

  // Ни одна фасовка этого поставщика для этого товара не совпала с фактом —
  // ни точно, ни по единственно-возможному варианту выше. Раз у поставщика
  // вообще ЕСТЬ прайсованные варианты (один или несколько), не молчим об
  // этом: показываем их все как подсказку/варианты для ручной правки
  // фасовки (см. packFixKey/setPackAlias) — возможно, это просто иначе
  // записанная фасовка того же товара, а не другой товар вовсе.
  let availableFasovki: FasovkaOption[] = []
  if (pack) {
    const variants = designatedIndex.bySupplierProduct.get(pairKey)
    if (variants && variants.size > 0) {
      availableFasovki = [...variants]
        .map((p): FasovkaOption | null => {
          const price = matching.planPairsByPack[`${pairKey}::${p}`]
          return price != null ? { pack: p, price, label: matching.productLabels[`${pairKey}::${p}`] ?? null } : null
        })
        .filter((x): x is FasovkaOption => x != null)
        .sort((a, b) => a.pack.localeCompare(b.pack))
    }
  }
  const candidateNote = availableFasovki.length === 0 ? null
    : availableFasovki.length === 1
    ? `В матрице у этого поставщика есть цена по фасовке «${availableFasovki[0].pack}»: ${money(availableFasovki[0].price)}${availableFasovki[0].label ? ` (${availableFasovki[0].label})` : ''} — но фасовка и цена этой закупки сильно отличаются, похоже на другой товар. Если это на самом деле он же — можно поправить фасовку прямо здесь.`
    : `В матрице у этого поставщика есть ${availableFasovki.length} прайсованных варианта(ов) фасовки для этого товара, но ни один не совпал с фактом по названию — если это просто иначе записанная фасовка, поправьте её прямо здесь.`

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
  const fixKeyIfAny = availableFasovki.length > 0 ? packFixKey : null
  if (designated && designated.size > 0) {
    const others = [...designated].filter((s) => s !== supplierCanon)
    if (others.length > 0) return { plan: null, status: 'wrongSupplier', designatedSuppliers: others, productLabel: null, unpricedMatch: false, matchedKey: null, candidateNote, availableFasovki, packFixKey: fixKeyIfAny, isAssortment }
  }
  return { plan: null, status: 'nomatrix', designatedSuppliers: [], productLabel: null, unpricedMatch: false, matchedKey: null, candidateNote, availableFasovki, packFixKey: fixKeyIfAny, isAssortment }
}

const capitalize = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s

/** Builds display rows by applying edits and resolving plan/status. */
export function computeRows(base: BaseRow[], edits: Edits, matching: MatchingTable = BUNDLED_MATCHING): Row[] {
  const designatedIndex = buildDesignatedIndex(matching)
  const knownFlatPairs = buildKnownFlatIndex(matching)
  const consumed = new Set<string>()
  // Restaurants actually present in this dataset (post RESTAURANT_SCOPE), so
  // matrix entries for restaurants we don't even show don't spawn rows here.
  // First occurrence per restaurant carries the venue meta (brand/city/...)
  // to reuse for its "not purchased yet" rows below.
  const venueByRestaurant = new Map<string, BaseRow>()
  for (const b of base) {
    const key = norm(b.restaurant)
    if (!venueByRestaurant.has(key)) venueByRestaurant.set(key, b)
  }
  const supplierDisplayByNorm = new Map<string, string>()
  for (const canon of Object.values(matching.supplierAlias)) supplierDisplayByNorm.set(norm(canon), canon)

  const rows: Row[] = base.map((b) => {
    // Основное название — всегда как поставщик записан в самом отчёте iiko.
    // Их название компании из матрицы (колонка C) — отдельная серая подпись
    // снизу, так же, как название товара из матрицы под самим товаром.
    const supplier = b.supplier0
    const supplierCanonical = matching.supplierAlias[norm(b.supplier0)] ?? null
    // Ручное переименование побеждает каноническое название из матрицы —
    // только подпись, на само сопоставление (supplierCanon в resolveRowPlan)
    // не влияет, там по-прежнему используется matching.supplierAlias как есть.
    const supplierDisplay = edits.supplierRenames[b.supplier0] ?? supplierCanonical
    const supplierLabel = supplierDisplay && norm(supplierDisplay) !== norm(supplier) ? supplierDisplay : null
    const venue = edits.venueOverrides[b.restaurant]
    const { plan, status, designatedSuppliers: designatedNorm, productLabel: matrixLabel, unpricedMatch, matchedKey, candidateNote, availableFasovki, packFixKey, isAssortment } = resolveRowPlan(b, edits, matching, designatedIndex, knownFlatPairs)
    if (matchedKey) consumed.add(matchedKey)
    // Переименование хранится по товар+поставщик+фасовка (для категорий-
    // ассортиментов типа "Пюре в асс", где у одного iiko-названия за разными
    // фасовками разные реальные товары — правка бьёт ровно в одну фасовку),
    // либо по товар+поставщик без фасовки (для обычных товаров — Справочники
    // сами решают, какой ключ писать, см. DataEditor: multiItem ? triple : flat).
    // Точный ключ (с фасовкой) побеждает, если задан; плоский вообще не
    // рассматривается, когда фасовка может иметь значение (isAssortment) —
    // иначе одно название, заданное для одной упаковки, тихо подменило бы
    // название и у остальных фасовок этого же iiko-названия.
    const rename = edits.productRenames[`${b.product0}::${b.supplier0}::${b.pack}`]
      ?? (isAssortment ? undefined : edits.productRenames[`${b.product0}::${b.supplier0}`])
    const product = rename ?? b.product0
    const productLabel = matrixLabel
    const diffPct = plan != null ? (b.unit - plan) / plan : null
    // designatedNorm — нормализованные (нижний регистр) ключи из матрицы,
    // для показа переводим обратно в их же написание (колонка C).
    const designatedSuppliers = designatedNorm.map((s) => supplierDisplayByNorm.get(s) ?? s)
    // Их же комментарий к этой закупке в iiko — если есть, показываем всегда,
    // независимо от статуса и один, без остального (это живой текст от них).
    // Иначе собираем то, что применимо: "нет плановой цены" для unpriced-
    // совпадений, "рядом есть цена по другой фасовке" для отклонённых
    // кандидатов, и для "заказ не по матрице" — сколько должны были
    // заплатить у назначенного поставщика, если цена известна. Не
    // взаимоисключающие — можно показать сразу несколько.
    let note: string | null = b.comment ?? null
    if (!note) {
      const parts: string[] = []
      if (unpricedMatch) parts.push(NO_PLAN_PRICE_NOTE)
      if (candidateNote) parts.push(candidateNote)
      if (status === 'wrongSupplier' && designatedNorm.length > 0) {
        const restaurant = norm(b.restaurant), product0 = norm(b.product0), pack = normPack(b.pack)
        const prices = designatedNorm
          .map((s) => {
            const byPack = pack ? matching.planPairsByPack[`${restaurant}::${s}::${product0}::${pack}`] : null
            const price = byPack ?? matching.planPairs[`${restaurant}::${s}::${product0}`]
            return price != null ? `${supplierDisplayByNorm.get(s) ?? s}: ${money(price)}` : null
          })
          .filter((x): x is string => x != null)
        if (prices.length) parts.push(`По матрице должны были купить у: ${prices.join('; ')}.`)
      }
      note = parts.length ? parts.join(' ') : null
    }
    return {
      id: b.id, restaurant: b.restaurant,
      brand: venue?.brand ?? b.brand, city: venue?.city ?? b.city, entity: venue?.entity ?? b.entity, category: venue?.category ?? b.category,
      supplier, supplierLabel, product, productRaw: b.product0, productLabel, isAssortment, pack: b.pack, qty: b.qty, unit: b.unit, plan,
      diffPct, status, designatedSuppliers, note, availableFasovki, packFixKey,
    }
  })

  // Matrix slots nobody bought this period — the flip side of the table:
  // "what's priced for this restaurant that just didn't get ordered". Only
  // for matrix keys with an actual plan price (planPairs/planPairsByPack) —
  // noPriceExact entries have nothing to show a price for, so skipping those
  // avoids adding noise. Where a product has BOTH a flat planPairs price AND
  // per-pack breakdowns, only the per-pack entries are shown — the flat price
  // there is just a fallback resolveRowPlan itself would only use once no
  // pack-specific price exists, so listing both would double-count the item.
  const packBrokenDownPairKeys = new Set(
    Object.keys(matching.planPairsByPack).map((k) => k.split('::').slice(0, 3).join('::')),
  )
  let seq = 0
  const addPlanOnlyRow = (key: string, restaurantNorm: string, product: string, pack: string, plan: number) => {
    const venueRow = venueByRestaurant.get(restaurantNorm)
    if (!venueRow || consumed.has(key)) return
    const [, supplierNorm] = key.split('::')
    const supplierDisplay = supplierDisplayByNorm.get(supplierNorm) ?? supplierNorm
    const label = matching.productLabels[key] ?? null
    const isAssortment = !knownFlatPairs.has(key.split('::').slice(0, 3).join('::'))
    rows.push({
      id: 'np' + seq++, restaurant: venueRow.restaurant,
      brand: venueRow.brand, city: venueRow.city, entity: venueRow.entity, category: venueRow.category,
      supplier: supplierDisplay, supplierLabel: null,
      product: label ?? capitalize(product), productRaw: '', productLabel: pack || null, isAssortment,
      pack, qty: 0, unit: null, plan,
      diffPct: null, status: 'ok', designatedSuppliers: [], note: null, availableFasovki: [], packFixKey: null,
    })
  }
  for (const [key, plan] of Object.entries(matching.planPairsByPack)) {
    const [restaurant, , product, pack] = key.split('::')
    if (!venueByRestaurant.has(restaurant)) continue
    addPlanOnlyRow(key, restaurant, product, pack, plan)
  }
  for (const [key, plan] of Object.entries(matching.planPairs)) {
    if (packBrokenDownPairKeys.has(key)) continue
    const [restaurant, , product] = key.split('::')
    if (!venueByRestaurant.has(restaurant)) continue
    addPlanOnlyRow(key, restaurant, product, '', plan)
  }

  return rows
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
export function parseDataset(data: RawDataset, matching: MatchingTable = bundledMatching(data.period)): Parsed {
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
    const s = sm.get(b.supplier0) || { name: b.supplier0, count: 0, isNew: matching.supplierAlias[norm(b.supplier0)] == null }
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

// Строки без факта (unit === null — в матрице есть, но в этом периоде не
// покупали) не участвуют в "позиций проверено" / matchRate / openIssues —
// те метрики про то, что реально купили и насколько это сошлось с планом.
export function summarize(rows: Row[]): Summary {
  let matched = 0, wrongSupplierCount = 0, noMatrixCount = 0, purchased = 0
  for (const r of rows) {
    if (r.unit == null) continue
    purchased++
    if (r.status !== 'nomatrix' && r.status !== 'wrongSupplier') matched++
    else if (r.status === 'wrongSupplier') wrongSupplierCount++
    else if (r.status === 'nomatrix') noMatrixCount++
  }
  return {
    positions: purchased,
    matched,
    matchRate: purchased ? matched / purchased : 0,
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
