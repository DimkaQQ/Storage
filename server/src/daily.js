/**
 * Подневная раскладка закупок (КП «период по дням»). Основной отчёт iiko (по месяцу) не меняется — подневные данные
 * берутся ОТДЕЛЬНЫМ запросом с датой в группировке и подкладываются к уже собранным фактам как `days`: [[ГГГГ-ММ-ДД, кол-во, сумма], …].
 * Если запрос не удался или суммы по дням не сошлись с месячным итогом позиции, позиция остаётся без `days` (месячные цифры не страдают).
 */

/** Дата из ответа iiko: «2026-11-05», «2026-11-05T00:00:00.000», «05.11.2026» → «2026-11-05». */
export function dayOf(v) {
  const s = String(v ?? '')
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(s)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

export const dayKey = (restaurant, supplier, product, pack) => [restaurant, supplier, product, pack || ''].join('\u0001')

/**
 * Строки ответа OLAP (Store, Product.Name, Counteragent.Name, Product.MeasureUnit, DateTime.DateTyped, Amount, Sum.Incoming)
 * → Map ключ позиции → [[день, кол-во, сумма]] (одинаковые дни складываются). Пустые Товар/Поставщик/День наследуются от
 * предыдущей строки (как в основном отчёте), при смене склада наследование сбрасывается.
 */
export function indexDailyRows(rows, resolveStore) {
  const out = new Map()
  let lastStore = null, lastProduct = '', lastSupplier = '', lastDay = null
  for (const row of rows || []) {
    if (row['Store'] !== lastStore) { lastStore = row['Store']; lastProduct = ''; lastSupplier = ''; lastDay = null }
    const continuation = !row['Product.Name'] && !row['Counteragent.Name'] // строка-продолжение: iiko не повторил товар и поставщика
    const product = row['Product.Name'] || lastProduct
    const supplier = row['Counteragent.Name'] || lastSupplier
    const day = dayOf(row['DateTime.DateTyped']) || (continuation ? lastDay : null) // пустую дату у строки со своим товаром не угадываем
    lastProduct = product; lastSupplier = supplier; lastDay = day
    const restaurant = resolveStore(row['Store'])
    if (restaurant === null || restaurant === undefined) continue
    const qty = Number(row['Amount']) || 0
    const sum = Number(row['Sum.Incoming']) || 0
    if (!product || !(qty > 0) || !day) continue
    const key = dayKey(restaurant, supplier, product, row['Product.MeasureUnit'])
    const list = out.get(key) ?? []
    const same = list.find((x) => x[0] === day)
    if (same) { same[1] += qty; same[2] += sum } else list.push([day, qty, sum])
    out.set(key, list)
  }
  return out
}

/** Подкладывает `days` к фактам, у которых сумма по дням сходится с итогом позиции (допуск 0,5%). Возвращает счётчики для диагностики. */
export function attachDays(facts, index) {
  let attached = 0, missing = 0, mismatch = 0
  for (const f of facts) {
    const days = index.get(dayKey(f.restaurant, f.supplier, f.product, f.pack))
    if (!days) { missing++; continue }
    const q = days.reduce((s, d) => s + d[1], 0)
    if (Math.abs(q - f.qty) > Math.max(0.001, f.qty * 0.005)) { mismatch++; continue }
    f.days = days.slice().sort((a, b) => a[0].localeCompare(b[0]))
    attached++
  }
  return { attached, missing, mismatch }
}
