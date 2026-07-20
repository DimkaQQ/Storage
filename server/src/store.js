import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data')
const SEED = join(__dirname, '..', 'seed', 'dataset.json')

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
    dataset: join(dir, 'dataset.json'),
    venues: join(dir, 'venues.json'),
  }
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
}

/**
 * The very first org ever created gets the bundled demo/seed dataset
 * (the real Кухня export this project shipped with). Any org created
 * afterwards starts empty — a different business's data has no business
 * seeing another org's demo numbers.
 */
export function bootstrapOrgData(orgId, { withSeed }) {
  const paths = orgPaths(orgId)
  if (existsSync(paths.dataset)) return
  const seed = withSeed ? read(SEED, { restaurants: [] }) : { restaurants: [] }
  write(paths.dataset, seed)
  const venues = (seed.restaurants || []).map((r) => ({ name: r.name, entity: r.entity, brand: r.brand, city: r.city, category: r.category }))
  write(paths.venues, venues)
  write(paths.status, seed.restaurants?.length
    ? { lastSync: null, lastResult: 'seed', source: 'seed', message: 'Стартовые данные (демо)' }
    : { lastSync: null, lastResult: null, source: null, message: 'Данных пока нет — настройте подключение к iiko' })
}

export const getSettings = (orgId) => ({ ...DEFAULT_SETTINGS, ...read(orgPaths(orgId).settings, {}) })
export const saveSettings = (orgId, s) => { const next = { ...getSettings(orgId), ...s }; write(orgPaths(orgId).settings, next); return next }
export const getStatus = (orgId) => read(orgPaths(orgId).status, { lastSync: null, lastResult: null, source: null })
export const saveStatus = (orgId, s) => { write(orgPaths(orgId).status, s); return s }
export const getDataset = (orgId) => read(orgPaths(orgId).dataset, { restaurants: [] })
export const saveDataset = (orgId, d) => write(orgPaths(orgId).dataset, d)
export const getVenues = (orgId) => read(orgPaths(orgId).venues, [])

/** The bundled demo dataset — used by the 'mock' provider regardless of org. */
export const getSeed = () => read(SEED, { restaurants: [] })
