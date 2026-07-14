import { norm } from './store.js'

const MIN_TURNOVER = 0 // фильтр оборота применяется на фронте (правило ТЗ)

/** Joins raw purchase facts with the app-managed plan matrix into the dataset shape. */
export function buildDataset(facts, plan, venues) {
  const meta = new Map(venues.map((v) => [v.name, v]))
  const byVenue = new Map()
  for (const f of facts) {
    if (!f.product || !(f.qty > 0)) continue
    if (f.sum < MIN_TURNOVER) continue
    if (!byVenue.has(f.restaurant)) byVenue.set(f.restaurant, [])
    byVenue.get(f.restaurant).push(f)
  }
  const restaurants = [...byVenue.entries()].map(([name, list]) => {
    const m = meta.get(name) || {}
    return {
      name,
      entity: m.entity || '',
      brand: m.brand || name,
      city: m.city || 'Алматы',
      category: m.category || 'Кухня',
      items: list.map((f) => ({
        s: f.supplier || '',
        p: f.product,
        k: f.pack || '',
        q: Math.round(f.qty * 1000) / 1000,
        m: Math.round(f.sum * 100) / 100,
        u: f.qty > 0 ? Math.round((f.sum / f.qty) * 100) / 100 : null,
        pl: plan[norm(f.product)] ?? null,
      })),
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
