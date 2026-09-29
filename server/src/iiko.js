import { createHash } from 'node:crypto'
import { getSeedPeriods, getSeedPeriod } from './store.js'

const sha1 = (s) => createHash('sha1').update(s).digest('hex')

const withTimeout = async (url, opts = {}, ms = 20000) => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...opts, signal: ctrl.signal }) }
  finally { clearTimeout(t) }
}

/* ------------------------------------------------------------------ *
 * Providers return a flat list of purchase facts:
 *   { restaurant, supplier, product, pack, qty, sum }
 * ------------------------------------------------------------------ */

/** Demo provider — returns the bundled snapshot for one period, so the whole loop works without iiko. */
function mockFacts(period) {
  const seed = getSeedPeriod(period) ?? getSeedPeriods().at(-1) ?? { restaurants: [] }
  const facts = []
  for (const r of seed.restaurants || [])
    for (const it of r.items || [])
      facts.push({ restaurant: r.name, supplier: it.s, product: it.p, pack: it.k, qty: it.q, sum: it.m, comment: it.c })
  return facts
}

/* --- iikoOffice / RMS (resto API) --- */
async function iikoServerAuth({ serverUrl, login, password }) {
  const base = serverUrl.replace(/\/+$/, '')
  const res = await withTimeout(`${base}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${sha1(password)}`)
  if (!res.ok) throw new Error(`Авторизация iikoServer не удалась (HTTP ${res.status})`)
  const token = (await res.text()).trim()
  if (!token || token.length < 8) throw new Error('iikoServer вернул пустой токен — проверьте логин/пароль')
  return { base, token }
}
async function iikoServerLogout(base, token) {
  try { await withTimeout(`${base}/resto/api/logout?key=${token}`) } catch { /* ignore */ }
}

/**
 * Спрашивает у самого iikoServer, какие поля реально доступны для этого
 * типа отчёта — вместо того чтобы гадать по одному полю за раз через
 * "Unknown OLAP field". Дёргается и напрямую (кнопка «Показать доступные
 * поля отчёта» в Настройках iiko), и как подсказка внутри iikoServerFacts,
 * если запрос отчёта упал именно с этой ошибкой.
 */
export async function fetchOlapColumns(settings, reportType = 'TRANSACTIONS') {
  const { base, token } = await iikoServerAuth(settings)
  try {
    const res = await withTimeout(`${base}/resto/api/v2/reports/olap/columns?key=${token}&reportType=${encodeURIComponent(reportType)}`)
    if (!res.ok) throw new Error(`Список полей недоступен (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`)
    return await res.json()
  } finally {
    await iikoServerLogout(base, token)
  }
}

/**
 * Pulls the supply/purchase report via the OLAP endpoint.
 * NOTE: точный набор полей отчёта уточняется на реальном сервере —
 * маппинг колонок вынесен в один блок ниже.
 */
async function iikoServerFacts(settings, period) {
  const { base, token } = await iikoServerAuth(settings)
  try {
    const { from, to } = periodRange(period)
    const body = {
      reportType: 'TRANSACTIONS',
      buildSummary: false,
      // "Supplier.Name" не существует как поле OLAP (сервер прямо ответил
      // "Unknown OLAP field 'Supplier.Name'") — контрагент по приходной
      // накладной в iikoServer называется Counteragent, не Supplier.
      groupByRowFields: ['Store', 'Product.Name', 'Counteragent.Name', 'Product.MeasureUnit'],
      aggregateFields: ['Amount', 'Sum.Incoming'],
      filters: {
        DateTime: { filterType: 'DateRange', periodType: 'CUSTOM', from, to },
        TransactionType: { filterType: 'IncludeValues', values: ['INVOICE'] },
      },
    }
    const res = await withTimeout(`${base}/resto/api/v2/reports/olap?key=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) {
      // iikoServer обычно объясняет ПОЧЕМУ отклонил тело запроса (неверное
      // поле в groupByRowFields/aggregateFields/filters для этой версии) —
      // раньше это отбрасывалось, оставался только код ответа, разобраться
      // было нечем.
      const errBody = await res.text()
      // Если снова "неизвестное поле" — сразу тащим у сервера реальный
      // список полей для TRANSACTIONS, чтобы не гадать по одному полю за
      // раз (сервер сам знает, что у него есть).
      let columnsHint = ''
      if (res.status === 400 && /Unknown OLAP field/i.test(errBody)) {
        try {
          const colsRes = await withTimeout(`${base}/resto/api/v2/reports/olap/columns?key=${token}&reportType=TRANSACTIONS`)
          if (colsRes.ok) columnsHint = ` | доступные поля: ${(await colsRes.text()).slice(0, 1500)}`
        } catch { /* необязательная подсказка — если сама не получится, не мешаем основной ошибке */ }
      }
      throw new Error(`Отчёт iikoServer недоступен (HTTP ${res.status}): ${errBody.slice(0, 500)}${columnsHint}`)
    }
    const data = await res.json()
    // --- маппинг колонок отчёта -> факты ---
    // Forward-fill защищает от пустых Товар/Поставщик в сгруппированных
    // строках отчёта — та же проблема, что клиент решает в своих формулах
    // через IF(R="",Y_prev,R). OLAP обычно отдаёт заполненные строки, но
    // это дёшево и не помешает на реальных выгрузках.
    let lastProduct = '', lastSupplier = ''
    return (data.data || []).map((row) => {
      const product = row['Product.Name'] || lastProduct
      const supplier = row['Counteragent.Name'] || lastSupplier
      lastProduct = product
      lastSupplier = supplier
      return {
        restaurant: row['Store'],
        supplier,
        product,
        pack: row['Product.MeasureUnit'] || '',
        qty: Number(row['Amount']) || 0,
        sum: Number(row['Sum.Incoming']) || 0,
      }
    }).filter((f) => f.product && f.qty > 0)
  } finally {
    await iikoServerLogout(base, token)
  }
}

/* --- iikoCloud (api-ru.iiko.services) --- */
async function iikoCloudToken({ apiLogin }) {
  const res = await withTimeout('https://api-ru.iiko.services/api/1/access_token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiLogin }),
  })
  if (!res.ok) throw new Error(`iikoCloud: не удалось получить токен (HTTP ${res.status})`)
  const { token } = await res.json()
  if (!token) throw new Error('iikoCloud: пустой токен — проверьте apiLogin')
  return token
}

/* ------------------------------------------------------------------ */

export async function fetchFacts(settings, period) {
  switch (settings.provider) {
    case 'mock': return mockFacts(period)
    case 'iikoserver': return iikoServerFacts(settings, settings.period)
    case 'iikocloud':
      // Отчёты о закупках по складам берутся из iikoServer; iikoCloud (transport)
      // ориентирован на доставку и не отдаёт складские приходы.
      await iikoCloudToken(settings)
      throw new Error('iikoCloud подключён, но отчёт о закупках доступен только через iikoServer. Укажите доступ к серверу iiko.')
    default: throw new Error(`Неизвестный провайдер: ${settings.provider}`)
  }
}

export async function testConnection(settings) {
  try {
    if (settings.provider === 'mock') return { ok: true, message: 'Демо-режим: данные из встроенного набора.' }
    if (settings.provider === 'iikoserver') {
      const { base, token } = await iikoServerAuth(settings)
      await iikoServerLogout(base, token)
      return { ok: true, message: 'Подключение к iikoServer успешно.' }
    }
    if (settings.provider === 'iikocloud') {
      await iikoCloudToken(settings)
      return { ok: true, message: 'Токен iikoCloud получен. Для отчёта о закупках нужен iikoServer.' }
    }
    return { ok: false, message: 'Неизвестный провайдер.' }
  } catch (e) {
    return { ok: false, message: String(e.message || e) }
  }
}

function periodRange(period) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (period === 'prev-month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: fmt(from), to: fmt(to) }
  }
  // current-month (default)
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: fmt(from), to: fmt(now) }
}
