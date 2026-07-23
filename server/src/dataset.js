const MIN_TURNOVER = 0 // фильтр оборота применяется на фронте (правило ТЗ)

/**
 * Shapes raw iiko purchase facts into the dataset the frontend expects.
 * No plan matching happens here — the client resolves plan/факт entirely
 * itself from the bundled restaurant-scoped matrix (src/data/matching.json),
 * so the server's only job is grouping facts by restaurant.
 */
export function buildDataset(facts, venues) {
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
      items: list.map((f) => ({
        s: f.supplier || '',
        p: f.product,
        k: f.pack || '',
        q: Math.round(f.qty * 1000) / 1000,
        m: Math.round(f.sum * 100) / 100,
        ...(f.comment ? { c: f.comment } : {}),
      })),
    }
  })
  const now = new Date()
  const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
  return {
    period: now.toISOString().slice(0, 10),
    periodLabel: `${months[now.getMonth()]} ${now.getFullYear()}`,
    city: 'Алматы',
    category: 'Кухня',
    restaurants,
  }
}
