import { norm } from './store.js'

const MIN_TURNOVER = 0 // фильтр оборота применяется на фронте (правило ТЗ)

/**
 * Resolves the plan price for a purchased line the way the client's own
 * matrix does: normalize the supplier via справочник, then look up
 * (supplier, product) as a pair first — that's what makes their matrix
 * precise when the same product name is sold by several suppliers at
 * different prices. Falls back to product-name-only, then to the
 * app-managed manual plan overrides (edited in "Данные"/"Сверка").
 */
function resolvePlan(fact, matching, manualPlan) {
  const product = norm(fact.product)
  const supplierRaw = norm(fact.supplier)
  const supplierCanon = norm(matching.supplierAlias[supplierRaw] ?? fact.supplier)
  const pairKey = `${supplierCanon}::${product}`
  if (matching.planPairs[pairKey] != null) return { plan: matching.planPairs[pairKey], kind: 'pair' }
  if (matching.planByProduct[product] != null) return { plan: matching.planByProduct[product], kind: 'product' }
  if (manualPlan[product] != null) return { plan: manualPlan[product], kind: 'manual' }
  return { plan: null, kind: null }
}

/** Joins raw purchase facts with the app-managed plan matrix into the dataset shape. */
export function buildDataset(facts, manualPlan, venues, matching) {
  const m = matching || { supplierAlias: {}, planPairs: {}, planByProduct: {} }
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
