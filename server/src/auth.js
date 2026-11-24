import { getUser } from './store.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

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
  if (!payload) return res.status(401).json({ ok: false, message: 'Не авторизовано' })
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
 * Разработчики — почты из переменной окружения DEVELOPER_EMAILS (через запятую, .env на сервере); `*` — все админы.
 * Не задана: на локальной установке и при разработке (NODE_ENV не production) все админы — разработчики, как раньше;
 * на сервере в Docker (NODE_ENV=production) НИКТО — иначе забытая переменная молча отдала бы клиентам восстановление и стирание данных.
 */
const devList = () => (process.env.DEVELOPER_EMAILS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
if (!devList().length && process.env.NODE_ENV === 'production' && !process.env.STATIC_DIR) {
  console.warn('[developer] DEVELOPER_EMAILS не задан — на сервере режим разработчика закрыт для всех. Укажите почту в .env (см. .env.example).')
}
export function isDeveloper(user) {
  if (!user || user.role !== 'admin') return false
  const list = devList()
  if (list.includes('*')) return true
  if (!list.length) return !(process.env.NODE_ENV === 'production' && !process.env.STATIC_DIR)
  return list.includes(String(user.email ?? '').trim().toLowerCase())
}

/** Express middleware (после requireAuth): только разработчик. Проверяется по актуальной записи пользователя, а не по токену. */
export function requireDeveloper(req, res, next) {
  const user = getUser(req.auth?.id)
  if (!isDeveloper(user)) return res.status(403).json({ ok: false, message: 'Только для разработчика' })
  next()
}
