import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data')
const SEED_DIR = join(__dirname, '..', 'seed')

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

// Файл существует, но не парсится — это НЕ "данных пока нет" (пустой массив/
// объект), а испорченный файл (например, процесс упал посреди записи до
// того, как write() стал атомарным ниже, либо диск/бэкап повредил байты).
// Раньше catch тут просто возвращал fallback, как для отсутствующего файла —
// то есть настройки/пользователи организации могли молча "обнулиться" без
// единой строки в логах, объясняющей почему.
const read = (p, fallback) => {
  if (!existsSync(p)) return fallback
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch (e) {
    console.error(`[store] не удалось разобрать ${p}, использую fallback:`, e.message)
    return fallback
  }
}
// Пишем во временный файл и переименовываем — rename на одной ФС атомарен,
// так что даже при падении процесса/контейнера посреди записи оригинальный
// файл остаётся либо старым целым содержимым, либо новым целым, но никогда
// обрезанным на середине (что раньше приводило бы к JSON.parse-ошибке выше).
const write = (p, v) => {
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(v, null, 2))
  renameSync(tmp, p)
}

export const norm = (s) => String(s || '').trim().toLowerCase()

/* ---------- accounts: orgs + users (global, not scoped to any one org) ---------- */

const ACCOUNTS_PATHS = {
  orgs: join(DATA_DIR, 'orgs.json'),
  users: join(DATA_DIR, 'users.json'),
}

export const listOrgs = () => read(ACCOUNTS_PATHS.orgs, [])
const saveOrgs = (orgs) => write(ACCOUNTS_PATHS.orgs, orgs)
export const getOrg = (id) => listOrgs().find((o) => o.id === id) || null

export function createOrg(name) {
  const orgs = listOrgs()
  const org = { id: randomUUID(), name: String(name || '').trim() || 'Новая сеть', createdAt: new Date().toISOString() }
  orgs.push(org)
  saveOrgs(orgs)
  orgDir(org.id) // ensure the org's data directory exists
  return org
}

export const listUsers = () => read(ACCOUNTS_PATHS.users, [])
const saveUsers = (users) => write(ACCOUNTS_PATHS.users, users)
export const listUsersByOrg = (orgId) => listUsers().filter((u) => u.orgId === orgId)
export const findUserByEmail = (email) => listUsers().find((u) => norm(u.email) === norm(email)) || null
export const getUser = (id) => listUsers().find((u) => u.id === id) || null

export function createUser({ email, passwordHash, orgId, role }) {
  const users = listUsers()
  if (findUserByEmail(email)) throw new Error('Пользователь с такой почтой уже есть')
  const user = { id: randomUUID(), email: norm(email), passwordHash, orgId, role: role === 'admin' ? 'admin' : 'employee', createdAt: new Date().toISOString() }
  users.push(user)
  saveUsers(users)
  return user
}

export function deleteUser(id, requestingOrgId) {
  const users = listUsers()
  const target = users.find((u) => u.id === id)
  if (!target || target.orgId !== requestingOrgId) return false
  saveUsers(users.filter((u) => u.id !== id))
  return true
}

/** Updates a user's password hash in place — keeps the same id, so existing session tokens stay valid. */
export function updateUserPassword(id, passwordHash) {
  const users = listUsers()
  const user = users.find((u) => u.id === id)
  if (!user) return false
  user.passwordHash = passwordHash
  saveUsers(users)
  return true
}

/** First boot: no accounts at all yet — create the default org + admin account. */
export function bootstrapAccounts(seedAdmin) {
  if (listUsers().length > 0) return null
  const org = createOrg(seedAdmin.orgName || 'Основная сеть')
  const user = createUser({ email: seedAdmin.email, passwordHash: seedAdmin.passwordHash, orgId: org.id, role: 'admin' })
  return { org, user }
}

/* ---------- per-org application data ---------- */

function orgDir(orgId) {
  const dir = join(DATA_DIR, 'orgs', orgId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
function orgPaths(orgId) {
  const dir = orgDir(orgId)
  return {
    settings: join(dir, 'settings.json'),
    status: join(dir, 'status.json'),
    venues: join(dir, 'venues.json'),
    matrix: join(dir, 'matrix.json'),
  }
}
const orgDatasetPath = (orgId, period) => join(orgDir(orgId), `dataset-${period}.json`)
// Старые per-period файлы (matrix-<period>.json) — матрица раньше привязывалась
// к месяцу, как и факты из iiko. Больше не создаются (см. getMatrix/saveMatrix
// ниже), но функция остаётся для одноразовой миграции уже накопленных файлов
// на дисках организаций, которые успели посинкать матрицу до перехода.
const orgLegacyMatrixPath = (orgId, period) => join(orgDir(orgId), `matrix-${period}.json`)
function legacyMatrixPeriods(orgId) {
  const dir = orgDir(orgId)
  return readdirSync(dir).filter((f) => /^matrix-.+\.json$/.test(f)).map((f) => f.replace(/^matrix-|\.json$/g, ''))
}

export const DEFAULT_SETTINGS = {
  provider: 'mock',            // 'mock' | 'iikoserver' | 'iikocloud'
  // iikoServer (iikoOffice / RMS resto API)
  serverUrl: '',               // https://host:port
  login: '',
  password: '',
  // iikoCloud (api-ru.iiko.services)
  apiLogin: '',
  organizationId: '',
  // schedule
  autoEnabled: false,
  interval: 'daily',           // 'hourly' | 'daily' | 'weekly' | 'monthly'
  period: 'current-month',     // отчётный период выгрузки
  // точки сети, включённые в приложение — null = ещё не настраивали вручную,
  // тогда при первом обращении к /api/venues материализуется в
  // DEFAULT_ENABLED_RESTAURANTS (см. ниже) и с этого момента сохраняется как
  // обычное поле настроек.
  enabledRestaurants: null,
  // Матрица (план-цены) — читается напрямую из Google-таблицы Сырьё Ф через
  // сервисный аккаунт (Sheets API, только чтение), а не из iiko — iiko
  // ничего не знает про договорные цены. googleServiceAccountKey хранит
  // ВЕСЬ JSON-ключ целиком (строкой), googleSheetId — ID таблицы из её
  // ссылки (кусок между /d/ и /edit).
  googleServiceAccountKey: '',
  googleSheetId: '',
  // Астана — отдельная таблица (свои точки, свои вкладки), но тот же
  // сервисный аккаунт (googleServiceAccountKey выше) — его достаточно
  // пригласить читателем и в эту таблицу тоже. См.
  // SHEET_TO_RESTAURANT_ASTANA в sheets.js.
  astanaSheetId: '',
}

/**
 * То же самое, что раньше было зашито в коде фронтенда (RESTAURANT_SCOPE в
 * src/lib/data.ts) — те же точки, кроме "French bar". Используется только
 * как разовое стартовое значение при первом обращении к /api/venues для
 * органиазции, у которой ещё нет своего сохранённого enabledRestaurants —
 * дальше источник правды один, тут (settings.json), а не в двух местах.
 */
export const DEFAULT_ENABLED_RESTAURANTS = [
  'Рене',
  'Олово 1 (Сатпаева)',
  'Олово 2 (Достык)',
  'Pasta la vista (Богенбай)',
  'Pasta la vista (Гагарина)',
  'Pasta la vista (Толе би)',
  'Ле Дом',
  'Six coffee&wine 1',
  'Six coffee&wine 2',
  'Tangirs',
  'Акку',
  'ЦФК',
  'Сирена',
]

/**
 * Bundled demo data ships as one file per month (server/seed/dataset-<period>.json)
 * so a new month is just another file — no code change to add one. Scanned
 * fresh each call since these are tiny and only read at bootstrap/sync time.
 */
export function getSeedPeriods() {
  if (!existsSync(SEED_DIR)) return []
  return readdirSync(SEED_DIR)
    .filter((f) => /^dataset-.+\.json$/.test(f))
    .map((f) => read(join(SEED_DIR, f), null))
    .filter(Boolean)
    .sort((a, b) => a.period.localeCompare(b.period))
}
export const getSeedPeriod = (period) => getSeedPeriods().find((d) => d.period === period) || null

/**
 * The very first org ever created gets the bundled demo/seed dataset
 * (the real Кухня export this project shipped with) — one file per period.
 * Any org created afterwards starts empty — a different business's data has
 * no business seeing another org's demo numbers.
 */
export function bootstrapOrgData(orgId, { withSeed }) {
  const paths = orgPaths(orgId)
  if (!existsSync(paths.venues)) {
    const periods = withSeed ? getSeedPeriods() : []
    for (const d of periods) write(orgDatasetPath(orgId, d.period), d)
    const venueMap = new Map()
    for (const d of periods) for (const r of d.restaurants || [])
      venueMap.set(r.name, { name: r.name, entity: r.entity, brand: r.brand, city: r.city, category: r.category })
    write(paths.venues, [...venueMap.values()])
    write(paths.status, periods.length
      ? { lastSync: null, lastResult: 'seed', source: 'seed', message: 'Стартовые данные (демо)' }
      : { lastSync: null, lastResult: null, source: null, message: 'Данных пока нет — настройте подключение к iiko' })
    return
  }
  // Already-bootstrapped org (e.g. predates a since-added seed period, or the
  // old single-file dataset format): backfill any seed period files that
  // aren't on disk yet, without touching existing data/venues/status.
  if (withSeed) {
    for (const d of getSeedPeriods()) {
      if (!existsSync(orgDatasetPath(orgId, d.period))) write(orgDatasetPath(orgId, d.period), d)
    }
  }
}

export const getSettings = (orgId) => ({ ...DEFAULT_SETTINGS, ...read(orgPaths(orgId).settings, {}) })
export const saveSettings = (orgId, s) => { const next = { ...getSettings(orgId), ...s }; write(orgPaths(orgId).settings, next); return next }
export const getStatus = (orgId) => read(orgPaths(orgId).status, { lastSync: null, lastResult: null, source: null })
export const saveStatus = (orgId, s) => { write(orgPaths(orgId).status, s); return s }
export const getDataset = (orgId, period) => read(orgDatasetPath(orgId, period), { restaurants: [] })
export const saveDataset = (orgId, period, d) => write(orgDatasetPath(orgId, period), d)
export const getVenues = (orgId) => read(orgPaths(orgId).venues, [])

// Матрица (план-цены) из Google-таблицы — раньше одна на каждый период
// (как факты из iiko), но план-цены сами по себе не привязаны к месяцу:
// таблица живая, отражает текущие договорные цены на момент синка, а не
// "цены за такой-то месяц". Привязка к периоду только создавала путаницу
// (сравнение факта за один месяц против плана, засинканного для другого) и
// требовала гонять один и тот же синк по каждому месяцу отдельно. Теперь
// матрица — один актуальный файл на организацию, без периода вообще.
// Для организации без matrix.json (ещё не синканной вообще) каждый вызов
// getMatrix — а это /api/matching, дёргается при каждом заходе на любую
// страницу — раньше заново делал readdirSync по всей папке организации
// (legacyMatrixPeriods), просто чтобы убедиться "мигрировать нечего". Раз
// подтвердив это для orgId, больше не пересканируем до перезапуска сервера —
// новые legacy-файлы matrix-*.json сами по себе на живом сервере не
// появляются (их никто больше не пишет, это старый формат).
const noLegacyMatrixFound = new Set()
function migrateLegacyMatrixIfNeeded(orgId) {
  const path = orgPaths(orgId).matrix
  if (existsSync(path)) return
  if (noLegacyMatrixFound.has(orgId)) return
  const periods = legacyMatrixPeriods(orgId).sort()
  if (!periods.length) { noLegacyMatrixFound.add(orgId); return }
  // Мёрджим все найденные периоды по порядку (старые -> новые), так что при
  // совпадении ключа побеждает более свежий период — ближе к духу "актуальная
  // цена", чем просто взять последний файл и выбросить остальные.
  let merged = null
  for (const period of periods) {
    const m = read(orgLegacyMatrixPath(orgId, period), null)
    if (!m) continue
    merged = merged ? {
      supplierAlias: { ...merged.supplierAlias, ...m.supplierAlias },
      planPairs: { ...merged.planPairs, ...m.planPairs },
      planPairsByPack: { ...merged.planPairsByPack, ...m.planPairsByPack },
      productLabels: { ...merged.productLabels, ...m.productLabels },
      noPriceExact: { ...merged.noPriceExact, ...m.noPriceExact },
    } : m
  }
  if (merged) write(path, merged)
}
/** Матрица (план-цены), прочитанная из Google-таблицы — null, если ещё не синхронизировали вообще. */
export function getMatrix(orgId) {
  migrateLegacyMatrixIfNeeded(orgId)
  return read(orgPaths(orgId).matrix, null)
}
export const saveMatrix = (orgId, m) => write(orgPaths(orgId).matrix, m)

/** Available periods for this org, oldest first, read straight off the stored dataset files. */
export function listDatasetPeriods(orgId) {
  const dir = orgDir(orgId)
  return readdirSync(dir)
    .filter((f) => /^dataset-.+\.json$/.test(f))
    .map((f) => read(join(dir, f), null))
    .filter(Boolean)
    .map((d) => ({ period: d.period, periodLabel: d.periodLabel }))
    .sort((a, b) => a.period.localeCompare(b.period))
}

/**
 * Список точек, включённых в приложение для этой организации. При первом
 * обращении (enabledRestaurants ещё null) материализует и сохраняет
 * DEFAULT_ENABLED_RESTAURANTS — дальше это обычное сохранённое поле, не
 * дефолт, вычисляемый каждый раз заново.
 */
export function getEnabledRestaurants(orgId) {
  const settings = getSettings(orgId)
  if (settings.enabledRestaurants != null) return settings.enabledRestaurants
  const enabled = [...DEFAULT_ENABLED_RESTAURANTS]
  saveSettings(orgId, { enabledRestaurants: enabled })
  return enabled
}

/**
 * Добавляет одну точку в список включённых (если её там ещё нет) и
 * сохраняет. dataset.js ничего не фильтрует по точкам сам — что реально
 * пришло из iiko (buildDataset группирует факты по Store как есть), то и
 * лежит в файлах датасета, так что включить точку — это только снять
 * фильтр на фронте, без пересборки/повторной синхронизации.
 */
export function enableRestaurant(orgId, name) {
  const enabled = getEnabledRestaurants(orgId)
  if (enabled.includes(name)) return enabled
  const next = [...enabled, name]
  saveSettings(orgId, { enabledRestaurants: next })
  return next
}

/**
 * Снимает точку со включённых — обратное к enableRestaurant. Нужно для
 * точек, которые когда-то попали в enabledRestaurants (обычно при самом
 * первом обращении к /api/venues — см. getEnabledRestaurants), но
 * оказались закрытыми/не нужны вообще (как French bar/Камчатка) — без
 * этого они продолжали бы висеть пустыми "0 закупок" точками, потому что
 * DEFAULT_ENABLED_RESTAURANTS — это разовое стартовое значение, а не
 * источник правды на каждый запрос.
 */
export function disableRestaurant(orgId, name) {
  const enabled = getEnabledRestaurants(orgId)
  const next = enabled.filter((n) => n !== name)
  saveSettings(orgId, { enabledRestaurants: next })
  return next
}

/**
 * Точки, которые реально встречались в закупках этой организации (по всем
 * сохранённым периодам), но ещё не включены — кандидаты на кнопку
 * «Добавить» в Настройки iiko → «Точки сети».
 */
export function discoverRestaurants(orgId) {
  const enabled = new Set(getEnabledRestaurants(orgId))
  const seen = new Set()
  for (const { period } of listDatasetPeriods(orgId)) {
    for (const r of getDataset(orgId, period).restaurants || []) seen.add(r.name)
  }
  return [...seen].filter((name) => !enabled.has(name))
}

/**
 * Полный снимок данных организации — для «скачать бэкап» перед сбросом.
 * Намеренно НЕ включает настройки подключения (serverUrl/login/password/
 * googleServiceAccountKey/sheetId и т.п.) — это конфигурация, не данные,
 * её сброс/бэкап не просили и трогать её тут не нужно. Датасеты и матрицы
 * отдаются целиком как есть (не пересобираются), чтобы восстановление было
 * точной копией, а не пересчётом.
 */
export function exportOrgData(orgId) {
  const datasets = {}
  for (const { period } of listDatasetPeriods(orgId)) datasets[period] = getDataset(orgId, period)
  return {
    exportedAt: new Date().toISOString(),
    enabledRestaurants: getEnabledRestaurants(orgId),
    venues: getVenues(orgId),
    status: getStatus(orgId),
    datasets,
    matrix: getMatrix(orgId),
  }
}

/**
 * Полностью чистит данные организации (факты закупок за все периоды,
 * матрицы план-цен за все периоды, venues.json, список включённых точек,
 * статус синка) — НЕ трогая настройки подключения (см. exportOrgData).
 * enabledRestaurants сбрасывается в null, а не в пустой массив — на
 * следующее обращение к /api/venues он сам материализуется заново из
 * DEFAULT_ENABLED_RESTAURANTS (та же логика первого запуска организации).
 * Правки (editsDb) сюда не входят — сбрасываются отдельным вызовом
 * editsDb.resetEdits, вызывающая сторона (index.js) делает оба вызова
 * вместе под одной кнопкой «Сбросить всё».
 */
export function resetOrgData(orgId) {
  for (const { period } of listDatasetPeriods(orgId)) unlinkSync(orgDatasetPath(orgId, period))
  const matrixPath = orgPaths(orgId).matrix
  if (existsSync(matrixPath)) unlinkSync(matrixPath)
  for (const period of legacyMatrixPeriods(orgId)) unlinkSync(orgLegacyMatrixPath(orgId, period))
  write(orgPaths(orgId).venues, [])
  saveSettings(orgId, { enabledRestaurants: null })
  saveStatus(orgId, { lastSync: null, lastResult: null, source: null, message: 'Данные сброшены — настройте синк заново' })
}

