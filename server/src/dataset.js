import { norm } from './store.js'

const MIN_TURNOVER = 0 // фильтр оборота применяется на фронте (правило ТЗ)

/**
 * Resolves the plan price for a purchased line the way the client's own
 * matrix does: normalize the supplier via справочник, then look up
 * (supplier, product, pack) first. That third key matters more than it looks —
 * for "assortment" SKUs (iiko records them under one generic name like
 * "Ягода с/м в асс" while the real flavor/variant only shows up in the
 * packaging field), the matrix keys its price by packaging too, because the
 * same generic name can span a 4x price range across flavors (their own
 * sheet does this per-row, e.g. "Frozen Fruit"'s "Ягода с/м в асс": вишня
 * 3650, слива 1280, черника 4900 — matching by name alone would silently
 * pick one arbitrary price for all of them). Falls back to (supplier,
 * product) pair, then product-name-only, then the app-managed manual plan
 * overrides (edited in "Данные"/"Сверка").
 */
function resolvePlan(fact, matching, manualPlan) {
  const product = norm(fact.product)
  const pack = norm(fact.pack)
  const supplierRaw = norm(fact.supplier)
  const supplierCanon = norm(matching.supplierAlias[supplierRaw] ?? fact.supplier)
  const triple = matching.planPairsByPack || {}
  const tripleKey = pack ? `${supplierCanon}::${product}::${pack}` : ''
  if (tripleKey && triple[tripleKey] != null) return { plan: triple[tripleKey], kind: 'pair' }
  const pairKey = `${supplierCanon}::${product}`
  if (matching.planPairs[pairKey] != null) return { plan: matching.planPairs[pairKey], kind: 'pair' }
  if (matching.planByProduct[product] != null) return { plan: matching.planByProduct[product], kind: 'product' }
  if (manualPlan[product] != null) return { plan: manualPlan[product], kind: 'manual' }
  return { plan: null, kind: null }
}

/** Joins raw purchase facts with the app-managed plan matrix into the dataset shape. */
export function buildDataset(facts, manualPlan, venues, matching) {
  const m = matching || { supplierAlias: {}, planPairs: {}, planPairsByPack: {}, planByProduct: {} }
  const meta = new Map(venues.map((v) => [v.name, v]))
  const byVenue = new Map()
  for (const f of facts) {
    if (!f.product || !(f.qty > 0)) continue
    if (f.sum < MIN_TURNOVER) continue
    if (!byVenue.has(f.restaurant)) byVenue.set(f.restaurant, [])
    byVenue.get(f.restaurant).push(f)
  }
  const restaurants = [...byVenue.entries()].map(([name, list]) => {
    const meta_ = meta.get(name) || {}
    return {
      name,
      entity: meta_.entity || '',
      brand: meta_.brand || name,
      city: meta_.city || 'Алматы',
      category: meta_.category || 'Кухня',
      items: list.map((f) => {
        const { plan, kind } = resolvePlan(f, m, manualPlan)
        return {
          s: f.supplier || '',
          p: f.product,
          k: f.pack || '',
          q: Math.round(f.qty * 1000) / 1000,
          m: Math.round(f.sum * 100) / 100,
          u: f.qty > 0 ? Math.round((f.sum / f.qty) * 100) / 100 : null,
          pl: plan,
          pk: kind,
          // справочник не знает эту компанию — вероятно, новый поставщик
          sn: m.supplierAlias[norm(f.supplier)] == null,
        }
      }),
    }
  })
  const now = new Date()
  const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
  return {
    period: now.toISOString().slice(0, 10),
    periodLabel: `${months[now.getMonth()]} ${now.getFullYear()}`,
    city: 'Алматы',
    category: 'Кухня (F)',
    restaurants,
  }
}
