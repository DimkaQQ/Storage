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
  loaded?: { period: string; periodLabel: string; rows: number }[]  // что загрузили при последнем обновлении
  syncing?: boolean
  schedule?: { autoEnabled: boolean; interval: string }
  manualFreeze?: number  // версия «заморозки» связей (3 — плюс все строки матрицы с названием из E; 2 — зафиксированы по всем периодам, включая «заказ не по матрице»)
  manualLinks?: boolean  // ручной режим сопоставления включён (автоматика выключена)
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
  // Листы таблицы, которые НЕ берём (служебные, справочники «Сырье F»); undefined = список по умолчанию, см. DEFAULT_EXCLUDED_TABS
  excludedTabs?: string[]
}

/** Листы таблицы, которые не берём, выбирает пользователь; по умолчанию берутся все (как на сервере). */
export const DEFAULT_EXCLUDED_TABS: string[] = []

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
/** Включить/выключить ручной режим сопоставления (только админ). */
export async function setManualLinks(enabled: boolean, freezeVersion?: number): Promise<boolean> {
  try {
    const r = await fetch('/api/manual-links', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ enabled, ...(freezeVersion ? { freezeVersion } : {}) }) })
    return r.ok
  } catch { return false }
}
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
export async function fetchOlapSample(search = 'ягода', period = '', allTypes = false, types = ''): Promise<{ ok: boolean; rows?: unknown[]; message?: string }> {
  try {
    const q = new URLSearchParams({ search, ...(period ? { period } : {}), ...(allTypes ? { allTypes: '1' } : {}), ...(types ? { types } : {}) })
    const r = await fetch(`/api/iiko/olap-sample?${q}`, { headers: authHeaders() })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

/** «Показать типы операций» — быстрый агрегат по TransactionType (без allTypes), чтобы выбрать кандидата для types в fetchOlapSample, не гоняя дорогой allTypes-запрос наугад. */
export async function fetchOlapTypes(period = ''): Promise<{ ok: boolean; rows?: unknown[]; message?: string }> {
  try {
    const q = new URLSearchParams(period ? { period } : {})
    const r = await fetch(`/api/iiko/olap-types?${q}`, { headers: authHeaders() })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

export interface ExtraFact { restaurant: string; store: string; category: string; supplier: string; product: string; pack: string; qty: number; sum: number; reason: 'склад' | 'категория' | 'склад+категория' }
/** «Что добавится, если брать всё» — закупки, которые загрузка отбрасывает (не кухонные склады, исключённые категории); в приложение не попадают. */
export async function fetchExtraFacts(period = ''): Promise<{ ok: boolean; rows?: ExtraFact[]; message?: string }> {
  try {
    const q = new URLSearchParams(period ? { period } : {})
    const r = await fetch(`/api/iiko/extra-facts?${q}`, { headers: authHeaders() })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

/** «Куда ушли закупки» — сколько приходных накладных вернул iiko за месяц и какая часть отброшена складом/категорией. */
export async function fetchInvoiceReconcile(period = ''): Promise<{ ok: boolean; rows?: unknown; message?: string }> {
  try {
    const q = new URLSearchParams(period ? { period } : {})
    const r = await fetch(`/api/iiko/invoice-reconcile?${q}`, { headers: authHeaders() })
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

export interface ProductCategoryItem { name: string; category: string; excluded: boolean }
/** «Проверить категорию товара» — прямой ответ номенклатуры iiko "в какой категории заведён товар", без догадок и без пересинка — для диагностики EXCLUDED_CATEGORIES. */
export async function fetchProductCategorySample(search: string): Promise<{ ok: boolean; items?: ProductCategoryItem[]; message?: string }> {
  try {
    const r = await fetch(`/api/iiko/product-category-sample?search=${encodeURIComponent(search)}`, { headers: authHeaders() })
    return await r.json()
  } catch (e) { return { ok: false, message: backendErr(e) } }
}

export interface ExcludedCategoryItem { name: string; category: string; overridden: boolean }
/** «Список исключённых категорий» — весь список товаров, которых сейчас категория не пускает в Проверку цен — чтобы разобрать целиком, а не искать по одному названию. */
export async function fetchExcludedCategoryList(): Promise<{ ok: boolean; items?: ExcludedCategoryItem[]; message?: string }> {
  try {
    const r = await fetch('/api/iiko/excluded-category-list', { headers: authHeaders() })
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

export interface Venues { enabled: string[]; excluded?: string[]; discovered: string[]; all?: boolean }  // all — список не настраивали: показаны все точки из закупок
export const fetchVenues = () => get<Venues>('/api/venues')
/** Убрать точку из программы / вернуть (список исключений на сервере). */
async function postVenue(path: 'exclude' | 'include', name: string): Promise<Venues | null> {
  try {
    const r = await fetch(`/api/venues/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ name }) })
    return r.ok ? await r.json() : null
  } catch { return null }
}
export const excludeVenue = (name: string) => postVenue('exclude', name)
export const includeVenue = (name: string) => postVenue('include', name)

/** Если тело ответа — JSON с message, возвращает его; иначе общий код HTTP. */
async function errorMessage(r: Response): Promise<string> {
  try {
    const body = await r.json()
    if (body?.message) return String(body.message)
  } catch { /* тело не JSON — просто код ниже */ }
  return `HTTP ${r.status}${r.status === 401 || r.status === 403 ? ' — нет доступа, нужны права админа' : ''}`
}
/** Бэкап всех данных организации (кроме настроек подключения) — скачивается как файл, см. IikoSettings.tsx. */
/** Полная копия всей папки данных (restore.tar — с паролями и доступами) — для переноса на другой компьютер и восстановления. */
export async function fetchFullExport(withSecrets = true): Promise<{ ok: true; blob: Blob } | { ok: false; message: string }> {
  try {
    const r = await fetch(withSecrets ? '/api/org-data/full-export' : '/api/org-data/full-export?secrets=0', { headers: authHeaders() })
    if (!r.ok) return { ok: false, message: await errorMessage(r) }
    return { ok: true, blob: await r.blob() }
  } catch (e) { return { ok: false, message: errMsg(e) } }
}
/**
 * Достаёт из tar (без распаковки в память целиком) настройки организаций orgs/<id>/settings.json: читаются только заголовки и нужные
 * файлы, поэтому даже копия на сотни мегабайт обрабатывается мгновенно и в программу уходит маленький JSON, а не весь файл.
 */
async function readSettingsFromTar(file: File): Promise<{ orgId: string; settings: Record<string, unknown> }[]> {
  const out: { orgId: string; settings: Record<string, unknown> }[] = []
  const td = new TextDecoder()
  const cstr = (b: Uint8Array) => { const i = b.indexOf(0); return td.decode(i === -1 ? b : b.subarray(0, i)) }
  let off = 0, longName: string | null = null
  while (off + 512 <= file.size) {
    const h = new Uint8Array(await file.slice(off, off + 512).arrayBuffer())
    if (h.every((x) => x === 0)) break
    const size = parseInt(cstr(h.subarray(124, 136)).trim() || '0', 8)
    if (!Number.isFinite(size) || size < 0) break
    const type = String.fromCharCode(h[156] || 48)
    const data = off + 512
    if (data + size > file.size) break
    const text = async () => td.decode(await file.slice(data, data + size).arrayBuffer())
    if (type === 'L') longName = (await text()).replace(/\0+$/, '')
    else if (type === 'x') { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(await text()); if (m) longName = m[1] }
    else if (type === '0' || type === '\0') {
      const prefix = cstr(h.subarray(345, 500))
      const name = (longName ?? ((prefix ? prefix + '/' : '') + cstr(h.subarray(0, 100)))).replace(/^\.\//, '')
      longName = null
      const m = /^orgs\/([^/]+)\/settings\.json$/.exec(name)
      if (m && size < 1_000_000) out.push({ orgId: m[1], settings: JSON.parse(await text()) })
    } else if (type !== 'g') longName = null
    off = data + Math.ceil(size / 512) * 512
  }
  return out
}

/** Вернуть доступы (iiko, Google-таблицы) из скачанной ранее копии restore.tar — читаются только поля подключения. */
export async function restoreConnectionFromBackup(file: File, force = false): Promise<{ ok: boolean; restored?: string[]; missing?: string[]; message?: string; conflict?: boolean }> {
  try {
    const url = `/api/settings/restore-connection${force ? '?force=1' : ''}`
    let init: RequestInit
    try {
      // обычный tar разбираем в браузере и шлём только настройки (маленький запрос)
      if (/\.t?gz$/i.test(file.name)) throw new Error('gz')
      const candidates = await readSettingsFromTar(file)
      init = { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ candidates }) }
    } catch {
      init = { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() }, body: file } // сжатый или нестандартный файл — отправляем целиком
    }
    const r = await fetch(url, init)
    if (r.status === 409) return { ...(await r.json()), ok: false, conflict: true }
    return r.ok ? await r.json() : { ok: false, message: r.status === 413 ? 'Файл слишком большой для сервера — выберите обычный restore.tar (не сжатый)' : await errorMessage(r) }
  } catch (e) { return { ok: false, message: errMsg(e) } }
}
/** Полное восстановление данных организации из restore.tar (закупки, матрицы, снимки, точки, настройки, правки и привязки). */
export async function restoreAllFromBackup(file: File): Promise<{ ok: boolean; files?: number; periods?: number; edits?: boolean; message?: string }> {
  try {
    const r = await fetch('/api/org-data/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() }, body: file })
    if (r.status === 413) return { ok: false, message: 'Файл слишком большой для сервера (лимит веб-сервера). Увеличьте client_max_body_size в nginx.conf.' }
    return r.ok ? await r.json() : { ok: false, message: await errorMessage(r) }
  } catch (e) { return { ok: false, message: errMsg(e) } }
}
/** Стереть всё, кроме доступов к iiko и Google (закупки, матрицы, снимки, точки, правки, настройки). */
export async function wipeAllKeepConnection(): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await fetch('/api/org-data/wipe', { method: 'POST', headers: authHeaders() })
    return r.ok ? await r.json() : { ok: false, message: await errorMessage(r) }
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
type SyncResult = { ok: boolean; message?: string; rows?: number; period?: string | null; conflicts?: string[]; catalogOverlay?: boolean; catalogUnmatched?: number; catalogRows?: number }
/** Опрос фонового синка матрицы (результат берётся из /api/matrix/sync-status, до ~5 минут). */
async function pollMatrixSync(target?: 'almaty' | 'astana'): Promise<SyncResult> {
  for (let i = 0; i < 150; i++) {
    await new Promise((res) => setTimeout(res, 2000))
    try {
      const sr = await fetch(`/api/matrix/sync-status?target=${target === 'astana' ? 'astana' : 'almaty'}`, { headers: authHeaders() })
      const st = await sr.json()
      if (st && !st.running) return st.result ?? { ok: false, message: 'Результат обновления неизвестен' }
    } catch { /* разовый сбой сети — пробуем дальше */ }
  }
  return { ok: false, message: 'Обновление идёт дольше обычного — подождите минуту и нажмите «Обновить» ещё раз.' }
}
/**
 * ВРЕМЕННО, для проверок: «загрузить таблицу из файла». xlsx читается здесь (значения листов, колонки C..AF — то же, что отдаёт Google Sheets API),
 * дальше сервер ведёт ровно тот же путь, что при чтении по ссылке (разбор листов, слияние, снимок за период). period — как у syncMatrix.
 */
export async function syncMatrixFromFile(file: File, target: 'almaty' | 'astana', period?: string): Promise<SyncResult> {
  try {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellFormula: false, cellStyles: false })
    const values: Record<string, unknown[][]> = {}
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name]
      if (!ws || !ws['!ref']) { values[name] = []; continue }
      const last = XLSX.utils.decode_range(ws['!ref']).e.r
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: { s: { r: 0, c: 2 }, e: { r: last, c: 31 } }, defval: '', raw: true, blankrows: true })
      for (const row of rows) while (row.length && (row[row.length - 1] === '' || row[row.length - 1] == null)) row.pop() // как Google: хвост из пустых ячеек не отдаётся
      while (rows.length && rows[rows.length - 1].length === 0) rows.pop()
      values[name] = rows
    }
    const q = new URLSearchParams({ target, ...(period ? { period } : {}) })
    const r = await fetch(`/api/matrix/sync-file?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() }, body: JSON.stringify({ titles: wb.SheetNames, values }) })
    if (r.status === 413) return { ok: false, message: 'Файл слишком большой для сервера (лимит веб-сервера)' }
    const first = await r.json().catch(() => null)
    if (!first) return { ok: false, message: `Сервер ответил не так, как ожидалось (HTTP ${r.status})` }
    if (!first.started) return first
    return await pollMatrixSync(target)
  } catch (e) { return { ok: false, message: errMsg(e) } }
}
/** period ("YYYY-MM") — зафиксировать цены матрицы ЗА ЭТОТ месяц отдельным снимком (остальные месяцы не трогаются); без period — общая матрица, как раньше. */
export async function syncMatrix(target?: 'almaty' | 'astana', period?: string, tab?: string): Promise<SyncResult> {
  try {
    const r = await fetch('/api/matrix/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ ...(target ? { target } : {}), ...(period ? { period } : {}), ...(tab ? { tab } : {}) }) })
    const text = await r.text()
    let first: any = null
    try { first = JSON.parse(text) } catch { /* не JSON — ниже сообщим код ответа */ }
    if (!first) return { ok: false, message: `Сервер ответил не так, как ожидалось (HTTP ${r.status}) — возможно, он перезапускается или прокси оборвал запрос. Попробуйте ещё раз.` }
    if (!first.started) return first // старый сервер отвечал результатом сразу / ошибка запуска
    return await pollMatrixSync(target) // синк идёт в фоне — результат берём опросом (до ~5 минут)
  } catch (e) { return { ok: false, message: backendErr(e) } }
}
/** null — матрицу ещё не синхронизировали с Google-таблицы вообще; фронт сам падает на вшитую. period — матрица, действующая для этого месяца (снимок месяца, иначе ближайший более ранний). */
export const fetchMatching = (period?: string) => get<any>(period ? `/api/matching?period=${encodeURIComponent(period)}` : '/api/matching')
export async function deleteMatrixSnapshot(period: string, tab?: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/matrix/snapshots?period=${encodeURIComponent(period)}${tab ? `&tab=${encodeURIComponent(tab)}` : ''}`, { method: 'DELETE', headers: authHeaders() })
    return r.ok && (await r.json()).ok === true
  } catch { return false }
}
export const fetchMatrixSnapshots = () => get<{ periods: { period: string; periodLabel: string }[]; tabs?: { tab: string; period: string; periodLabel: string }[] }>('/api/matrix/snapshots')

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
