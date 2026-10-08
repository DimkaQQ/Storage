const MIN_TURNOVER = 0 // фильтр оборота применяется на фронте (правило ТЗ)

// Единственные 4 реальные точки Астаны (см. BRAND_CODE_TO_RESTAURANT в
// iiko.js) — всё остальное гарантированно Алматы. Город здесь решаем по
// самому имени ресторана, а не по meta.city из venues.json: venues.json у
// организации материализуется ОДИН РАЗ при самом первом обращении (см.
// bootstrapOrgData в store.js), из демо/сид-данных — у части точек там
// изначально были свои (демонстрационные) значения city, и если с тех пор
// их никто не правил руками, meta.city может быть банально неактуальным
// (так Сирена/ЦФК/Tangirs/Six 2 внезапно показывались точками Астаны,
// хотя это всё Алматы). Имя ресторана — то, что мы сами присваиваем в
// resolveStoreRestaurant, ему можно доверять напрямую.
export const ASTANA_RESTAURANTS = new Set([
  'Pasta la vista (Астана)',
  'Six coffee&wine (Астана)',
  'Tangirs (Есиль, Астана)',
  'Tangirs (Сарыарка, Астана)',
])
export const cityForRestaurant = (name) => (ASTANA_RESTAURANTS.has(name) ? 'Астана' : 'Алматы')

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

/** period — "YYYY-MM". Для явно указанного прошлого периода (см. /api/sync с period в теле), не только current/prev-month. */
export function periodLabelFor(period) {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/**
 * Only for the real iiko providers (mock has fixed, known periods baked into
 * its seed files — the caller picks one of those explicitly instead). Period
 * comes from sync settings (current/prev month), not the server's clock at
 * запрос time — иначе "prev-month" всё равно подписывался бы текущим.
 */
export function resolveLivePeriod(settings) {
  const now = new Date()
  const base = settings.period === 'prev-month' ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : now
  // period — ключ ФАЙЛА датасета/матрицы за этот месяц (тот же формат
  // "YYYY-MM", что у вшитых периодов, см. BUNDLED_PERIODS в lib/data.ts).
  // Раньше тут было .slice(0, 10) — полная дата, не месяц: каждый синк в
  // рамках одного и того же месяца создавал НОВЫЙ файл датасета/матрицы
  // под ключом текущего ДНЯ вместо накопления в одном месячном периоде —
  // PeriodPicker плодил кучу дублей "Сентябрь 2026", а синхронизированная
  // сегодня матрица не находилась бы под ключом периода, под которым её
  // искали вчера.
  //
  // base.toISOString() — это UTC, а MONTHS[base.getMonth()]/getFullYear() —
  // локальное время сервера (TZ=Asia/Almaty, UTC+5, см. docker-compose.yml).
  // Раньше period брался из toISOString(), а periodLabel — из локальных
  // getMonth/getFullYear: с полуночи до 5 утра по Алматы (а именно в эти
  // часы срабатывает ежедневный cron, CRON.daily = '0 3 * * *' в index.js)
  // UTC-дата ещё "вчерашняя" — 1 июля 02:00 по Алматы это 30 июня 21:00 UTC,
  // и синк сохранял датасет под ключом "2026-06", но с подписью "Июль
  // 2026" — новый месяц тихо примешивался к данным старого. Теперь period
  // и periodLabel оба считаются из ОДНИХ и тех же локальных компонентов.
  const y = base.getFullYear(), m = base.getMonth() // m: 0-индексация
  return { period: `${y}-${String(m + 1).padStart(2, '0')}`, periodLabel: `${MONTHS[m]} ${y}` }
}

/**
 * Shapes raw iiko purchase facts into the dataset the frontend expects.
 * No plan matching happens here — the client resolves plan/факт entirely
 * itself from the bundled restaurant-scoped matrix (src/data/matching.json),
 * so the server's only job is grouping facts by restaurant.
 */
export function buildDataset(facts, venues, periodMeta) {
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
      city: cityForRestaurant(name),
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
  return {
    period: periodMeta.period,
    periodLabel: periodMeta.periodLabel,
    city: 'Алматы',
    category: 'Кухня',
    restaurants,
  }
}
