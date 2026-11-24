import { getUser } from './store.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data')
const SECRET_PATH = join(DATA_DIR, 'jwt-secret.txt')

/** A stable signing secret across restarts — env var wins, else persisted to disk once. */
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  if (existsSync(SECRET_PATH)) return readFileSync(SECRET_PATH, 'utf8').trim()
  const secret = randomBytes(48).toString('hex')
  writeFileSync(SECRET_PATH, secret)
  return secret
}
const SECRET = loadSecret()
const EXPIRY = '30d'

export const hashPassword = (password) => bcrypt.hashSync(password, 10)
export const verifyPassword = (password, hash) => bcrypt.compareSync(password, hash)

export function signToken(user) {
  return jwt.sign({ sub: user.id, orgId: user.orgId, role: user.role, email: user.email }, SECRET, { expiresIn: EXPIRY })
}

export function verifyToken(token) {
  try { return jwt.verify(token, SECRET) } catch { return null }
}

/** Express middleware: requires a valid Bearer token, attaches req.auth = {id, orgId, role, email}. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  const payload = token && verifyToken(token)
  if (!payload || payload.dev) return res.status(401).json({ ok: false, message: 'Не авторизовано' })
  req.auth = { id: payload.sub, orgId: payload.orgId, role: payload.role, email: payload.email }
  next()
}

/** Express middleware: requires requireAuth to have run first, and role === 'admin'. */
export function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') return res.status(403).json({ ok: false, message: 'Только для администратора' })
  next()
}

/**
 * Режим разработчика: часть настроек (доступы, точки сети, автообновление, резервные копии, диагностика iiko) видит и меняет только разработчик.
 * Войти в режим можно тремя способами:
 *  1) «секретная кнопка» в интерфейсе + ключ DEVELOPER_KEY из .env на сервере (POST /api/auth/developer выдаёт токен на 12 часов,
 *     клиент присылает его в заголовке X-Developer-Token) — основной способ;
 *  2) почты в DEVELOPER_EMAILS (через запятую; `*` — все админы) — разработчик без ввода ключа;
 *  3) ничего не задано: на локальной установке и вне production все админы — разработчики (как раньше), на сервере в Docker
 *     (NODE_ENV=production) никто — чтобы забытая переменная не отдала клиентам восстановление и стирание.
 * Если задан DEVELOPER_KEY или DEVELOPER_EMAILS — без токена/почты админ разработчиком НЕ считается.
 */
const devList = () => (process.env.DEVELOPER_EMAILS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
export const devKeyConfigured = () => !!(process.env.DEVELOPER_KEY ?? '').trim()
const closedByDefault = () => process.env.NODE_ENV === 'production' && !process.env.STATIC_DIR
if (!devList().length && !devKeyConfigured() && closedByDefault()) {
  console.warn('[developer] Ни DEVELOPER_KEY, ни DEVELOPER_EMAILS не заданы — на сервере режим разработчика закрыт для всех. Задайте DEVELOPER_KEY в .env (см. .env.example).')
}

/** Проверка ключа разработчика (сравнение без утечки по времени). */
export function checkDeveloperKey(key) {
  const real = (process.env.DEVELOPER_KEY ?? '').trim()
  if (!real || typeof key !== 'string') return false
  const h = (s) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(key.trim()), h(real))
}
export const signDeveloperToken = (user) => jwt.sign({ sub: user.id, dev: true }, SECRET, { expiresIn: '12h' })
function hasDeveloperToken(req, user) {
  const t = req?.headers?.['x-developer-token']
  const p = typeof t === 'string' && t ? verifyToken(t) : null
  return !!(p && p.dev === true && p.sub === user.id)
}

// простая защита от подбора ключа: не больше 5 неудач за 15 минут на пользователя
const failures = new Map()
export function developerKeyAttemptsLeft(userId) {
  const now = Date.now()
  const list = (failures.get(userId) ?? []).filter((t) => now - t < 15 * 60_000)
  if (list.length) failures.set(userId, list); else failures.delete(userId)
  return 5 - list.length
}
export const clearDeveloperKeyFailures = (userId) => { failures.delete(userId) }
export const noteDeveloperKeyFailure = (userId) => { const l = failures.get(userId) ?? []; l.push(Date.now()); failures.set(userId, l) }

export function isDeveloper(user, req) {
  if (!user || user.role !== 'admin') return false
  if (req && hasDeveloperToken(req, user)) return true
  const list = devList()
  if (list.includes('*')) return true
  if (list.length) return list.includes(String(user.email ?? '').trim().toLowerCase())
  if (devKeyConfigured()) return false
  return !closedByDefault()
}

/** Express middleware (после requireAuth): только разработчик. Проверяется по актуальной записи пользователя, а не по токену входа. */
export function requireDeveloper(req, res, next) {
  const user = getUser(req.auth?.id)
  if (!isDeveloper(user, req)) return res.status(403).json({ ok: false, message: 'Только для разработчика' })
  next()
}
