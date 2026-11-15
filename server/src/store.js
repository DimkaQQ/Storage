import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { mergeMatching, norm as sheetNorm } from './sheets.js'
import { isKitchenStore } from './kitchen-filter.js'
import { isValidPeriod, periodBounds, MONTH_RE } from './period.js'

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
export const orgDataDir = (orgId) => orgDir(orgId)
function orgPaths(orgId) {
  const dir = orgDir(orgId)
  return {
    settings: join(dir, 'settings.json'),
    status: join(dir, 'status.json'),
    venues: join(dir, 'venues.json'),
    matrix: join(dir, 'matrix.json'),
    catalog: join(dir, 'catalog.json'),
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
  excludedVenues: [],          // точки сети, которые человек убрал (закрытые бренды и т.п.); меняется только через /api/venues/exclude|include
  // Матрица (план-цены) — читается напрямую из Google-таблицы Сырьё Ф через
  // сервисный аккаунт (Sheets API, только чтение), а не из iiko — iiko
  // ничего не знает про договорные цены. googleServiceAccountKey хранит
  // ВЕСЬ JSON-ключ целиком (строкой), googleSheetId — ID таблицы из её
  // ссылки (кусок между /d/ и /edit).
  googleServiceAccountKey: '',
  googleSheetId: '',
  // Астана — отдельная таблица (свои точки, свои вкладки), но тот же
  // сервисный аккаунт (googleServiceAccountKey выше) — его достаточно
  // пригласить читателем и в эту таблицу тоже.
  // (названия вкладок берутся из таблицы как есть).
  astanaSheetId: '',
}

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
/** Датасет для показа в программе: без складов бара/хозтоваров и т.п. (kitchen-filter.js), в том числе в ранее загруженных периодах. Файл на диске и бэкапы остаются «сырыми». */
export const getDatasetVisible = (orgId, period) => {
  const d = getDataset(orgId, period)
  const hidden = new Set(getSettings(orgId).excludedVenues ?? [])
  return { ...d, restaurants: (d.restaurants || []).filter((r) => isKitchenStore(r.name) && !hidden.has(r.name)) }
}

/**
 * Точки сети = ВСЕ кухонные склады из закупок (по всем периодам) — добавляются сами. Человек может убрать ненужные (закрытые бренды и т.п.):
 * это список ИСКЛЮЧЕНИЙ (`excludedVenues`), а не список «включённых» — новые склады появляются без действий. Список меняется только
 * своими действиями (exclude/include), не через общее сохранение настроек.
 */
export function listVenues(orgId) {
  const all = new Set()
  for (const { period } of listDatasetPeriods(orgId)) for (const r of getDataset(orgId, period).restaurants || []) if (isKitchenStore(r.name)) all.add(r.name)
  const excluded = (getSettings(orgId).excludedVenues ?? []).filter((n) => typeof n === 'string')
  const hidden = new Set(excluded)
  // «убранные» — только те, что реально есть в данных (устаревшие названия из списка не показываем)
  return { enabled: [...all].filter((n) => !hidden.has(n)), excluded: [...all].filter((n) => hidden.has(n)), all: true, discovered: [] }
}
export function setVenueExcluded(orgId, name, excluded) {
  const cur = new Set(getSettings(orgId).excludedVenues ?? [])
  if (excluded) cur.add(name); else cur.delete(name)
  saveSettings(orgId, { excludedVenues: [...cur] })
  return listVenues(orgId)
}
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
// Каталог названий iiko (слепок колонок D/E/F матрицы) — собственные данные программы, «Сбросить всё» его не трогает
export const getCatalog = (orgId) => read(orgPaths(orgId).catalog, null)
export const saveCatalog = (orgId, c) => write(orgPaths(orgId).catalog, c)

// Снимки матрицы по месяцам: цены, зафиксированные «за этот месяц» (кнопка
// «Загрузить цены на период» в Настройки iiko). Файл назван matrixsnap-*, а не
// matrix-*, — последние считаются старым форматом (см. legacyMatrixPeriods).
const matrixSnapPath = (orgId, period) => join(orgDir(orgId), `matrixsnap-${period}.json`)
export const getMatrixSnapshot = (orgId, period) => read(matrixSnapPath(orgId, period), null)
export const saveMatrixSnapshot = (orgId, period, m) => write(matrixSnapPath(orgId, period), m)
export function listMatrixSnapshots(orgId) {
  return readdirSync(orgDir(orgId))
    .map((f) => /^matrixsnap-(.+)\.json$/.exec(f)?.[1])
    .filter((p) => p && isValidPeriod(p))
    .sort()
}
export function deleteMatrixSnapshot(orgId, period) {
  if (!isValidPeriod(period)) return false
  const f = matrixSnapPath(orgId, period)
  if (!existsSync(f)) return false
  unlinkSync(f)
  return true
}

// Снимки цен ОДНОГО ресторана (вкладки таблицы): matrixtab-<хэш вкладки>-<период>.json = { tab, period, savedAt, slice }.
// Имя вкладки в имя файла не кладём (в нём могут быть любые символы) — только хэш; само название лежит внутри файла.
const tabHash = (tab) => createHash('sha1').update(sheetNorm(tab)).digest('hex').slice(0, 12)
const matrixTabPath = (orgId, tab, period) => join(orgDir(orgId), `matrixtab-${tabHash(tab)}-${period}.json`)
export function saveMatrixTabSnapshot(orgId, tab, period, slice) {
  if (!isValidPeriod(period)) throw new Error('bad period')
  write(matrixTabPath(orgId, tab, period), { tab, period, savedAt: new Date().toISOString(), slice })
}
export const getMatrixTabSnapshot = (orgId, tab, period) => read(matrixTabPath(orgId, tab, period), null)
export function listMatrixTabSnapshots(orgId) {
  return readdirSync(orgDir(orgId))
    .filter((f) => /^matrixtab-[0-9a-f]{12}-.+\.json$/.test(f))
    .map((f) => { const m = read(join(orgDir(orgId), f), null); return m && m.tab && isValidPeriod(m.period) && Object.keys(m.slice ?? {}).length ? { tab: m.tab, period: m.period } : null })
    .filter(Boolean)
    .sort((a, b) => a.tab.localeCompare(b.tab) || a.period.localeCompare(b.period))
}
export function deleteMatrixTabSnapshot(orgId, tab, period) {
  if (!isValidPeriod(period)) return false
  const f = matrixTabPath(orgId, tab, period)
  if (!existsSync(f)) return false
  unlinkSync(f)
  return true
}

/**
 * Выбор версии цен для периода среди кандидатов [{ p: период снимка, tab?: true }] — по ПЕРВОМУ дню периода:
 *  1) снимок ровно этого периода; иначе из покрывающих этот день самый поздний по началу (самый «узкий»), при
 *     равенстве самый длинный; 2) иначе закончившийся последним раньше. При полном равенстве снимок ресторана
 *     (tab) важнее снимка всех ресторанов.
 */
function pickSnapshot(cands, period) {
  const { start } = periodBounds(period)
  const withB = cands.map((c) => ({ ...c, ...periodBounds(c.p) }))
  const byTab = (a, b) => (b.tab ? 1 : 0) - (a.tab ? 1 : 0)
  const exact = withB.filter((x) => x.p === period).sort(byTab)[0]
  if (exact) return exact
  const cover = withB.filter((x) => x.start <= start && start <= x.end)
    .sort((a, b) => b.start.localeCompare(a.start) || b.end.localeCompare(a.end) || byTab(a, b))[0]
  if (cover) return cover
  return withB.filter((x) => x.end < start).sort((a, b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start) || byTab(a, b))[0] ?? null
}

/**
 * Какая матрица действует для периода (месяц или отрезок «с даты по дату»). Сначала для всей сети (снимки «все
 * рестораны»): снимок периода → самый узкий покрывающий первый день → закончившийся последним раньше → общая
 * matrix.json (состояние до снимков) → ближайший поздний. Потом поверх — рестораны со своими снимками: если для
 * вкладки подходящий снимок ресторана выигрывает у снимков всей сети (см. pickSnapshot), её цены берутся из него.
 * Без period — общая, а если её нет — самый свежий снимок. withTabs: false — без накладки ресторанов (основа
 * для нового снимка всей сети).
 */
export function resolveMatrixFor(orgId, period, { allowLater = true, withTabs = true } = {}) {
  const snaps = listMatrixSnapshots(orgId)
  let matching = null, snapshotPeriod = null
  const cityPick = period && snaps.length ? pickSnapshot(snaps.map((p) => ({ p })), period) : null
  if (cityPick) { matching = getMatrixSnapshot(orgId, cityPick.p); snapshotPeriod = cityPick.p }
  else {
    const base = getMatrix(orgId)
    if (base) matching = base
    // Нет ни более раннего снимка, ни общей матрицы: для просмотра лучше показать ближайший ПОЗДНИЙ снимок, чем
    // вшитую демо-матрицу; но как основу для нового снимка (allowLater: false) он не годится — другой период.
    else if (snaps.length && (allowLater || !period)) {
      const p = period ? [...snaps].sort((a, b) => periodBounds(a).start.localeCompare(periodBounds(b).start))[0] : snaps[snaps.length - 1]
      matching = getMatrixSnapshot(orgId, p); snapshotPeriod = p
    }
  }
  const tabSnapshots = {}
  if (period && withTabs) {
    const byTab = new Map()
    for (const t of listMatrixTabSnapshots(orgId)) { if (!byTab.has(t.tab)) byTab.set(t.tab, []); byTab.get(t.tab).push(t.period) }
    for (const [tab, periods] of byTab) {
      const cands = [...periods.map((p) => ({ p, tab: true })), ...(cityPick ? [{ p: cityPick.p }] : [])]
      const pick = pickSnapshot(cands, period)
      if (!pick?.tab) continue
      const snap = read(matrixTabPath(orgId, tab, pick.p), null)
      if (!snap?.slice) continue
      // mergeMatching собирает объект по фиксированному списку полей — прочие поля основы (tabsByTarget и т.п.) возвращаем
      matching = matching ? { ...matching, ...mergeMatching(matching, snap.slice, [tab]) } : snap.slice
      tabSnapshots[tab] = pick.p
    }
  }
  // Названия, появившиеся в таблице ПОСЛЕ снимка (новые строки, листы, поставщики — их подхватывает «Синхронизировать матрицу»), добавляем
  // в снимок без цены: цену им даст только фиксация за этот период. Цены и строки самого снимка не меняются.
  if (withTabs && matching) {
    const base = getMatrix(orgId)
    if (base && matching !== base) matching = withNewNames(matching, base)
  }
  return { matching, snapshotPeriod, tabSnapshots }
}

/** Снимок + строки и названия из общей матрицы, которых в снимке нет (они без цены — noPriceExact). Исходные объекты не меняются. */
// списки вкладок по городам: объединение (вкладки снимка не пропадают, новые из таблицы добавляются)
function mergeTabLists(a, b) {
  if (!a || !b) return a ?? b
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = Array.isArray(v) || Array.isArray(out[k]) ? [...new Set([...(out[k] ?? []), ...(v ?? [])])] : (out[k] ?? v)
  return out
}

function withNewNames(m, base) {
  const has = new Set([...Object.keys(m.planPairs ?? {}), ...Object.keys(m.planPairsByPack ?? {}), ...Object.keys(m.noPriceExact ?? {})])
  const noPrice = { ...(m.noPriceExact ?? {}) }, labels = { ...(m.productLabels ?? {}) }, noName = { ...(m.noIikoName ?? {}) }
  for (const k of new Set([...Object.keys(base.planPairs ?? {}), ...Object.keys(base.planPairsByPack ?? {}), ...Object.keys(base.noPriceExact ?? {})])) {
    if (has.has(k)) continue
    noPrice[k] = true
    if (labels[k] == null && base.productLabels?.[k] != null) labels[k] = base.productLabels[k]
    if (base.noIikoName?.[k]) noName[k] = true
  }
  return {
    ...m, noPriceExact: noPrice, productLabels: labels, noIikoName: noName,
    supplierAlias: { ...(base.supplierAlias ?? {}), ...(m.supplierAlias ?? {}) },
    supplierOrder: { ...(base.supplierOrder ?? {}), ...(m.supplierOrder ?? {}) },
    restaurantNames: { ...(base.restaurantNames ?? {}), ...(m.restaurantNames ?? {}) },
    tabTitles: { ...(base.tabTitles ?? {}), ...(m.tabTitles ?? {}) },
    tabsByTarget: mergeTabLists(m.tabsByTarget, base.tabsByTarget), allTabsByTarget: mergeTabLists(m.allTabsByTarget, base.allTabsByTarget),
  }
}

/**
 * Одноразовая миграция к «ценам по периодам»: каждый уже загруженный ПРОШЛЫЙ месяц (кроме текущего — он ещё живой), у которого
 * нет своего снимка матрицы, получает копию действующей на сегодня общей матрицы (matrix.json). Дальше цены этих месяцев
 * меняются только осознанно (синк за этот период), а не при любом обновлении таблицы. Флаг matrixHistoryFrozen в настройках —
 * чтобы удалённый вручную снимок не воскресал при каждом перезапуске. Демо-организации (provider mock) не трогаем.
 */
export function freezePastMonthsOnce(orgId) {
  const settings = getSettings(orgId)
  if (settings.matrixHistoryFrozen || settings.provider === 'mock') return { frozen: [] }
  const base = getMatrix(orgId)
  if (!base) return { frozen: [] } // матрицы ещё нет — нечего фиксировать; флаг не ставим, повторим после первого синка
  const now = new Date()
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const have = new Set(listMatrixSnapshots(orgId))
  const frozen = []
  for (const { period } of listDatasetPeriods(orgId)) {
    if (!MONTH_RE.test(period) || period >= current || have.has(period)) continue
    saveMatrixSnapshot(orgId, period, base)
    frozen.push(period)
  }
  // нет ни одного загруженного месяца — фиксировать нечего, флаг не ставим (иначе поздние месяцы так и остались бы без снимка)
  if (frozen.length || listDatasetPeriods(orgId).some((d) => MONTH_RE.test(d.period))) saveSettings(orgId, { matrixHistoryFrozen: true })
  return { frozen }
}

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
    venues: getVenues(orgId),
    status: getStatus(orgId),
    datasets,
    matrix: getMatrix(orgId),
    catalog: getCatalog(orgId),
    matrixSnapshots: Object.fromEntries(listMatrixSnapshots(orgId).map((p) => [p, getMatrixSnapshot(orgId, p)])),
    matrixTabSnapshots: listMatrixTabSnapshots(orgId).map((t) => ({ ...t, slice: read(matrixTabPath(orgId, t.tab, t.period), null)?.slice })),
  }
}

/**
 * Полностью чистит данные организации (факты закупок за все периоды,
 * матрицы план-цен за все периоды, venues.json,
 * статус синка) — НЕ трогая настройки подключения (см. exportOrgData).
 * Правки (editsDb) сюда не входят — сбрасываются отдельным вызовом
 * editsDb.resetEdits, вызывающая сторона (index.js) делает оба вызова
 * вместе под одной кнопкой «Сбросить всё».
 */
export function resetOrgData(orgId) {
  for (const { period } of listDatasetPeriods(orgId)) unlinkSync(orgDatasetPath(orgId, period))
  const matrixPath = orgPaths(orgId).matrix
  if (existsSync(matrixPath)) unlinkSync(matrixPath)
  for (const period of legacyMatrixPeriods(orgId)) unlinkSync(orgLegacyMatrixPath(orgId, period))
  for (const period of listMatrixSnapshots(orgId)) unlinkSync(matrixSnapPath(orgId, period))
  for (const t of listMatrixTabSnapshots(orgId)) deleteMatrixTabSnapshot(orgId, t.tab, t.period)
  write(orgPaths(orgId).venues, [])
  saveStatus(orgId, { lastSync: null, lastResult: null, source: null, message: 'Данные сброшены — настройте синк заново' })
}


/** Поля подключения (iiko и Google-таблицы) — единственное, что остаётся после «Стереть всё, кроме подключения». */
export const CONNECTION_KEYS = ['provider', 'serverUrl', 'login', 'password', 'apiLogin', 'organizationId', 'googleServiceAccountKey', 'googleSheetId', 'astanaSheetId']

/** Удаляет файлы данных организации (закупки, матрицы, снимки, каталог, точки, статус) — перед полным восстановлением из копии. */
export function clearOrgFiles(orgId) {
  resetOrgData(orgId)
  const catalog = orgPaths(orgId).catalog
  if (existsSync(catalog)) unlinkSync(catalog)
}

/**
 * «Стереть всё, кроме подключения»: закупки, матрицы и снимки, каталог, точки, статус и ВСЕ настройки, кроме доступов к iiko и Google.
 * Правки/привязки (editsDb) стирает вызывающая сторона. Вернуть всё можно из ранее скачанной копии restore.tar.
 */
export function wipeOrgKeepConnection(orgId) {
  resetOrgData(orgId)
  const catalog = orgPaths(orgId).catalog
  if (existsSync(catalog)) unlinkSync(catalog)
  const keep = Object.fromEntries(CONNECTION_KEYS.map((k) => [k, getSettings(orgId)[k]]))
  write(orgPaths(orgId).settings, { ...DEFAULT_SETTINGS, ...keep, matrixHistoryFrozen: true }) // новые данные не «замораживать» при следующем запуске сервера
}
