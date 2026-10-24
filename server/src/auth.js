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
