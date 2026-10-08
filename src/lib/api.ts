// Talks to the backend (same origin; nginx proxies /api → api service).
// Every call fails soft: if the backend is absent, the app keeps working on
// the bundled snapshot.

import { authHeaders } from './auth'

export interface SyncStatus {
  lastSync: string | null
  lastResult: string | null
  source: string | null
  message?: string
  positions?: number
  syncing?: boolean
  schedule?: { autoEnabled: boolean; interval: string }
}

export interface IikoSettings {
  provider: 'mock' | 'iikoserver' | 'iikocloud'
  serverUrl: string
  login: string
  password: string
  apiLogin: string
  organizationId: string
  autoEnabled: boolean
  interval: 'hourly' | 'daily' | 'weekly' | 'monthly'
  period: 'current-month' | 'prev-month'
  // Матрица (план-цены) — отдельный источник от iiko, Google-таблица через
  // сервисный аккаунт (см. server/src/sheets.js)
  googleServiceAccountKey: string
  googleSheetId: string
  // Астана — отдельная таблица (свои точки), тот же сервисный аккаунт выше.
  astanaSheetId: string
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { headers: authHeaders() })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

/** Текст реальной сетевой/JS-ошибки из catch(e) — раньше в каждом месте дублировался свой `${...}`. */
const errMsg = (e: unknown) => String((e as Error)?.message || e)
/** То же самое, с префиксом "Бэкенд недоступен" — для мест, где до этого даже не достучались до ответа сервера. */
const backendErr = (e: unknown) => `Бэкенд недоступен: ${errMsg(e)}`

export interface PeriodMeta { period: string; periodLabel: string }

export const fetchDataset = (period?: string) => get<any>(period ? `/api/data?period=${encodeURIComponent(period)}` : '/api/data')
export const fetchPeriods = () => get<PeriodMeta[]>('/api/periods')
export const fetchStatus = () => get<SyncStatus>('/api/status')
export const fetchSettings = () => get<IikoSettings>('/api/settings')
export const fetchEdits = () => get<any>('/api/edits')

export async function saveSettings(s: Partial<IikoSettings>): Promise<IikoSettings | null> {
  try {
    const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(s) })
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** Full-blob restore — only for "Импорт" (explicit, deliberate replace-everything action). */
export async function saveEdits(e: unknown): Promise<boolean> {
  try {
    const r = await fetch('/api/edits', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(e) })
    return r.ok
  } catch { return false }
}

/**
 * Applies ONE targeted правка to the server's copy (e.g. "set this product's
 * plan price") instead of overwriting the whole справочник — so two people
 * editing different things at the same time never clobber each other.
 */
export async function applyEditOp(type: string, payload: Record<string, unknown> = {}): Promise<boolean> {
  try {
    const r = await fetch('/api/edits/op', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ type, ...payload }) })
    return r.ok
  } catch { return false }
}

export async function testConnection(s: Partial<IikoSettings>): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await fetch('/api/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(s) })
    if (!r.ok) return { ok: false, message: `Ошибка сервера (HTTP ${r.status})` }
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

/** «Показать доступные поля отчёта» — вместо гадания по одному полю через "Unknown OLAP field". */
export async function fetchOlapColumns(reportType = 'TRANSACTIONS'): Promise<{ ok: boolean; columns?: unknown; message?: string }> {
  try {
    const r = await fetch(`/api/iiko/olap-columns?reportType=${encodeURIComponent(reportType)}`, { headers: authHeaders() })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

/** «Проверить сырые поля» — несколько строк отчёта с расширенным набором полей, похожих на `search`, для поиска того самого поля с фасовкой/вкусом глазами. period — "YYYY-MM", по умолчанию решает сервер (текущий/прошлый месяц из настроек). */
export async function fetchOlapSample(search = 'ягода', period = ''): Promise<{ ok: boolean; rows?: unknown[]; message?: string }> {
  try {
    const q = new URLSearchParams({ search, ...(period ? { period } : {}) })
    const r = await fetch(`/api/iiko/olap-sample?${q}`, { headers: authHeaders() })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

/** «Проверить накладную (XML)» — сырой кусок самой накладной (не OLAP) вокруг `search`, для поиска поля с фасовкой на уровне документа. period — "YYYY-MM", по умолчанию решает сервер. */
export async function fetchInvoiceSample(search = 'ягода', period = ''): Promise<{ ok: boolean; xml?: string; message?: string }> {
  try {
    const q = new URLSearchParams({ search, ...(period ? { period } : {}) })
    const r = await fetch(`/api/iiko/invoice-sample?${q}`, { headers: authHeaders() })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

/** «Проверить товар (артикул)» — карточка товара из номенклатуры по артикулу (`num`), ищем в ней имена фасовок/тар, которые resolve-ят GUID из накладной. */
export async function fetchProductSample(num: string): Promise<{ ok: boolean; xml?: string; message?: string; errorName?: string; errorStack?: string[] }> {
  try {
    const r = await fetch(`/api/iiko/product-sample?num=${encodeURIComponent(num)}`, { headers: authHeaders() })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

export interface DatasetDebugItem { restaurant: string; supplier: string; product: string; pack: string; qty: number; sum: number }
/** «Проверить сохранённый датасет» — то, что реально лежит в датасете организации после синка (не живой запрос к iiko) — для сверки с живой диагностикой. */
export async function fetchDatasetDebug(search: string, period = ''): Promise<{ ok: boolean; items?: DatasetDebugItem[]; message?: string }> {
  try {
    const q = new URLSearchParams({ search, ...(period ? { period } : {}) })
    const r = await fetch(`/api/debug/dataset-items?${q}`, { headers: authHeaders() })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

/** «Проверить склад (GUID)» — сырой кусок выгрузки складов вокруг `search`, чтобы увидеть реальное имя/иерархию конкретного GUID склада. */
export async function fetchStoresSample(search: string): Promise<{ ok: boolean; xml?: string; message?: string }> {
  try {
    const r = await fetch(`/api/iiko/stores-sample?search=${encodeURIComponent(search)}`, { headers: authHeaders() })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

export interface AssortmentDebugItem {
  product: string; storeId: string; storeName: string; restaurant: string | null; supplier: string; pack: string; containerId: string | null; qty: number; sum: number
}
/** «Проверить разброс по ресторанам» — та же логика, что настоящий синк товаров-ассортиментов, но до схлопывания — каждая строка отдельно, по всем ресторанам/складам разом. period — "YYYY-MM", по умолчанию решает сервер (текущий/прошлый месяц из настроек) — почти всегда стоит передавать явно. */
export async function fetchAssortmentDebug(search: string, period = ''): Promise<{ ok: boolean; matchedProducts?: string[]; items?: AssortmentDebugItem[]; message?: string }> {
  try {
    const q = new URLSearchParams({ search, ...(period ? { period } : {}) })
    const r = await fetch(`/api/iiko/assortment-debug?${q}`, { headers: authHeaders() })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

export interface Venues { enabled: string[]; discovered: string[] }
export const fetchVenues = () => get<Venues>('/api/venues')
export async function enableVenue(name: string): Promise<Venues | null> {
  try {
    const r = await fetch('/api/venues/enable', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ name }) })
    return r.ok ? await r.json() : null
  } catch { return null }
}
export async function disableVenue(name: string): Promise<Venues | null> {
  try {
    const r = await fetch('/api/venues/disable', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ name }) })
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** Если тело ответа — JSON с message, возвращает его; иначе общий код HTTP. */
async function errorMessage(r: Response): Promise<string> {
  try {
    const body = await r.json()
    if (body?.message) return String(body.message)
  } catch { /* тело не JSON — просто код ниже */ }
  return `HTTP ${r.status}${r.status === 401 || r.status === 403 ? ' — нет доступа, нужны права админа' : ''}`
}
/** Бэкап всех данных организации (кроме настроек подключения) — скачивается как файл, см. IikoSettings.tsx. */
export async function fetchOrgDataExport(): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  try {
    const r = await fetch('/api/org-data/export', { headers: authHeaders() })
    if (!r.ok) return { ok: false, message: await errorMessage(r) }
    return { ok: true, data: await r.json() }
  } catch (e) { return { ok: false, message: errMsg(e) } }
}
/** Безвозвратный сброс всех данных организации (факты/матрицы/правки/включённые точки) — настройки подключения не трогает. */
export async function resetOrgData(): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await fetch('/api/org-data/reset', { method: 'POST', headers: authHeaders() })
    return r.ok ? await r.json() : { ok: false, message: await errorMessage(r) }
  } catch (e) { return { ok: false, message: errMsg(e) } }
}

/**
 * Матрица (план-цены) читается прямо из Google-таблицы, не из iiko — см.
 * IikoSettings.googleSheetId/googleServiceAccountKey. target — какую из
 * двух таблиц ('almaty' по умолчанию, или 'astana' — своя таблица, тот же
 * сервисный аккаунт).
 */
export async function testMatrixConnection(s: Partial<IikoSettings>, target?: 'almaty' | 'astana'): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await fetch('/api/matrix/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ ...s, target }) })
    if (!r.ok) return { ok: false, message: `Ошибка сервера (HTTP ${r.status})` }
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}
export async function syncMatrix(target?: 'almaty' | 'astana'): Promise<{ ok: boolean; message?: string; rows?: number }> {
  try {
    const r = await fetch('/api/matrix/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ ...(target ? { target } : {}) }) })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}
/** null — матрицу ещё не синхронизировали с Google-таблицы вообще; фронт сам падает на вшитую. Без периода — план-цены не привязаны к месяцу. */
export const fetchMatching = () => get<any>('/api/matching')

/** period ("YYYY-MM") — явно загрузить этот прошлый месяц, а не current/prev-month из настроек. */
export async function triggerSync(period?: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(period ? { period } : {}) })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

export interface TeamUser { id: string; email: string; role: 'admin' | 'employee'; createdAt: string }

export async function fetchUsers(): Promise<TeamUser[] | null> {
  return get<TeamUser[]>('/api/auth/users')
}

export async function addUser(email: string, password: string, role: 'admin' | 'employee'): Promise<{ ok: boolean; message?: string; user?: TeamUser }> {
  try {
    const r = await fetch('/api/auth/users', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ email, password, role }) })
    const data = await r.json()
    return r.ok ? { ok: true, user: data } : { ok: false, message: data.message }
  } catch { return { ok: false, message: 'Сервер недоступен' } }
}

export async function removeUser(id: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/auth/users/${id}`, { method: 'DELETE', headers: authHeaders() })
    const data = await r.json()
    return r.ok && data.ok
  } catch { return false }
}
