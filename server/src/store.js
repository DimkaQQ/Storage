import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data')
const SEED_DIR = join(__dirname, '..', 'seed')

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

const read = (p, fallback) => {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback } catch { return fallback }
}
const write = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2))

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
  }
}
const orgDatasetPath = (orgId, period) => join(orgDir(orgId), `dataset-${period}.json`)

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
export const saveDataset = (orgId, period, d) => write(orgDatasetPath(orgId, period), d)
export const getVenues = (orgId) => read(orgPaths(orgId).venues, [])

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
