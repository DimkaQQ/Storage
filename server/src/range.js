import { periodLabelFor } from './dataset.js'

/**
 * Датасет за произвольный отрезок [from, to] (ГГГГ-ММ-ДД) из месячных датасетов с подневной раскладкой (`d` у позиций).
 * Позиция месяца, у которого нет подневных данных (месяц загружен до обновления или iiko не отдал дни), входит только если месяц
 * целиком внутри отрезка; иначе она пропускается и считается в `partial.skippedItems`, чтобы показать предупреждение.
 */
export function monthBounds(period) {
  const y = +period.slice(0, 4), m = +period.slice(5, 7)
  const pad = (n) => String(n).padStart(2, '0')
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` }
}

export function composeRange(months, from, to) {
  const byVenue = new Map()
  let skippedItems = 0   // позиции месяцев, загруженных без раскладки по дням (лечится повторной загрузкой месяца)
  let noDayItems = 0     // позиции без дней в месяце, где дни есть у остальных (ассортименты, суммы по дням не сошлись) — повторная загрузка не поможет
  const withoutDays = new Set()
  for (const { period, dataset } of months) {
    const { start, end } = monthBounds(period)
    if (end < from || start > to) continue
    const full = from <= start && end <= to
    const monthHasDays = (dataset.restaurants || []).some((r) => (r.items || []).some((it) => Array.isArray(it.d)))
    for (const r of dataset.restaurants || []) {
      let v = byVenue.get(r.name)
      if (!v) { v = { meta: { ...r, items: undefined, stores: undefined }, stores: new Set(), items: new Map() }; byVenue.set(r.name, v) }
      for (const s of r.stores || []) v.stores.add(s)
      for (const it of r.items || []) {
        let q, m
        if (Array.isArray(it.d)) {
          const sel = it.d.filter((x) => x[0] >= from && x[0] <= to)
          if (!sel.length) continue
          q = sel.reduce((a, x) => a + x[1], 0); m = sel.reduce((a, x) => a + x[2], 0)
        } else if (full) { q = it.q; m = it.m } else if (monthHasDays) { noDayItems++; continue } else { skippedItems++; withoutDays.add(period); continue }
        const key = [it.s, it.p, it.k, it.c || ''].join('\u0001')
        const cur = v.items.get(key)
        if (cur) { cur.q += q; cur.m += m } else v.items.set(key, { s: it.s, p: it.p, k: it.k, q, m, ...(it.c ? { c: it.c } : {}) })
      }
    }
  }
  const restaurants = [...byVenue.values()].map((v) => ({
    ...v.meta,
    stores: [...v.stores].sort(),
    items: [...v.items.values()].map((i) => ({ ...i, q: Math.round(i.q * 1000) / 1000, m: Math.round(i.m * 100) / 100 })),
  }))
  const period = `${from}..${to}`
  return { period, periodLabel: periodLabelFor(period), city: 'Алматы', category: 'Кухня', restaurants, partial: { skippedItems, noDayItems, monthsWithoutDays: [...withoutDays].sort() } }
}
