import express from 'express'
import cron from 'node-cron'
import {
  getSettings, saveSettings, getStatus, saveStatus,
  getDataset, saveDataset, getVenues, listDatasetPeriods, getSeedPeriods,
  bootstrapOrgData, bootstrapAccounts,
  listOrgs, listUsersByOrg, findUserByEmail, createUser, deleteUser, getUser, updateUserPassword,
} from './store.js'
import * as editsDb from './editsDb.js'
import { fetchFacts, testConnection } from './iiko.js'
import { buildDataset, resolveLivePeriod } from './dataset.js'
import { hashPassword, verifyPassword, signToken, requireAuth, requireAdmin } from './auth.js'

const app = express()
app.use(express.json({ limit: '2mb' }))
// Same-origin in prod (nginx proxies /api); permissive for local dev.
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  next()
})
app.options('*', (_req, res) => res.sendStatus(204))

/* ---------- first-boot bootstrap: default org + admin account ---------- */

// Demo credentials for now — override with ADMIN_EMAIL / ADMIN_PASSWORD env
// vars once the real company account replaces this demo login.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@admin.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'demo1234'

function bootstrap() {
  const created = bootstrapAccounts({ email: ADMIN_EMAIL, passwordHash: hashPassword(ADMIN_PASSWORD), orgName: 'Основная сеть' })
  if (created) {
    bootstrapOrgData(created.org.id, { withSeed: true })
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Создан первый админ-аккаунт (демо):')
    console.log(`  Почта:  ${ADMIN_EMAIL}`)
    console.log(`  Пароль: ${ADMIN_PASSWORD}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  }
  // Any org that predates multi-tenancy, was created without data yet, or is
  // missing a since-added seed period. Only orgs still on the demo/mock
  // provider get backfilled with seed data — a real iiko-connected org's
  // missing periods mean "not synced yet", not "needs demo numbers".
  for (const org of listOrgs()) bootstrapOrgData(org.id, { withSeed: getSettings(org.id).provider === 'mock' })
}
bootstrap()

let syncing = {}

/**
 * Pulls facts from the configured provider and rebuilds the dataset for one
 * org. 'mock' has no live "current period" of its own — it's a set of fixed
 * monthly snapshots baked into the seed files — so a sync re-fetches ALL of
 * them, one dataset per period. Real providers only ever fetch the single
 * period their settings point at (current/prev month), leaving whatever
 * other periods are already stored untouched.
 */
async function runSync(orgId, trigger) {
  if (syncing[orgId]) return { ok: false, message: 'Обновление уже выполняется' }
  syncing[orgId] = true
  const settings = getSettings(orgId)
  try {
    const venues = getVenues(orgId)
    const targets = settings.provider === 'mock'
      ? getSeedPeriods().map((d) => ({ period: d.period, periodLabel: d.periodLabel }))
      : [resolveLivePeriod(settings)]
    if (!targets.length) throw new Error('Нет ни одного периода для загрузки')
    let positions = 0
    for (const periodMeta of targets) {
      const facts = await fetchFacts(settings, periodMeta.period)
      if (!facts.length) continue
      saveDataset(orgId, periodMeta.period, buildDataset(facts, venues, periodMeta))
      positions += facts.length
    }
    if (!positions) throw new Error('Провайдер вернул пустой список закупок')
    const status = {
      lastSync: new Date().toISOString(),
      lastResult: 'ok',
      source: settings.provider,
      trigger,
      positions,
      message: `Загружено ${positions} позиций`,
    }
    saveStatus(orgId, status)
    return { ok: true, ...status }
  } catch (e) {
    const status = { ...getStatus(orgId), lastAttempt: new Date().toISOString(), lastResult: 'error', message: String(e.message || e) }
    saveStatus(orgId, status)
    return { ok: false, message: status.message }
  } finally {
    syncing[orgId] = false
  }
}

/* ---------- auth API (no token required to log in) ---------- */

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  const user = email && findUserByEmail(email)
  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    return res.status(401).json({ ok: false, message: 'Неверная почта или пароль' })
  }
  const token = signToken(user)
  res.json({ ok: true, token, user: { id: user.id, email: user.email, orgId: user.orgId, role: user.role } })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = getUser(req.auth.id)
  if (!user) return res.status(401).json({ ok: false })
  res.json({ id: user.id, email: user.email, orgId: user.orgId, role: user.role })
})

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {}
  const user = getUser(req.auth.id)
  if (!user || !verifyPassword(currentPassword || '', user.passwordHash)) {
    return res.status(401).json({ ok: false, message: 'Неверный текущий пароль' })
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ ok: false, message: 'Новый пароль должен быть не короче 6 символов' })
  }
  updateUserPassword(user.id, hashPassword(newPassword))
  res.json({ ok: true })
})

/* ---------- team management (admin only, scoped to the admin's own org) ---------- */

app.get('/api/auth/users', requireAuth, requireAdmin, (req, res) => {
  res.json(listUsersByOrg(req.auth.orgId).map((u) => ({ id: u.id, email: u.email, role: u.role, createdAt: u.createdAt })))
})

app.post('/api/auth/users', requireAuth, requireAdmin, (req, res) => {
  const { email, password, role } = req.body || {}
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ ok: false, message: 'Нужны почта и пароль (не короче 6 символов)' })
  }
  if (findUserByEmail(email)) return res.status(409).json({ ok: false, message: 'Пользователь с такой почтой уже есть' })
  const user = createUser({ email, passwordHash: hashPassword(password), orgId: req.auth.orgId, role: role === 'admin' ? 'admin' : 'employee' })
  res.json({ id: user.id, email: user.email, role: user.role, createdAt: user.createdAt })
})

app.delete('/api/auth/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (req.params.id === req.auth.id) return res.status(400).json({ ok: false, message: 'Нельзя удалить самого себя' })
  const ok = deleteUser(req.params.id, req.auth.orgId)
  res.json({ ok })
})

/* ---------- app data API (all scoped to req.auth.orgId) ---------- */

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/periods', requireAuth, (req, res) => res.json(listDatasetPeriods(req.auth.orgId)))

app.get('/api/data', requireAuth, (req, res) => {
  const periods = listDatasetPeriods(req.auth.orgId)
  const period = req.query.period || periods.at(-1)?.period
  if (!period) return res.json({ restaurants: [] })
  res.json(getDataset(req.auth.orgId, period))
})

app.get('/api/status', requireAuth, (req, res) => res.json({ ...getStatus(req.auth.orgId), syncing: !!syncing[req.auth.orgId], schedule: describeSchedule(req.auth.orgId) }))

app.post('/api/sync', requireAuth, async (req, res) => {
  const result = await runSync(req.auth.orgId, 'manual')
  res.status(result.ok ? 200 : 502).json(result)
})

app.get('/api/settings', requireAuth, (req, res) => {
  const s = getSettings(req.auth.orgId)
  res.json({ ...s, password: s.password ? '********' : '', apiLogin: s.apiLogin ? '********' : '' })
})

app.put('/api/settings', requireAuth, (req, res) => {
  const incoming = { ...req.body }
  // не затирать секреты маскированным значением
  if (incoming.password === '********') delete incoming.password
  if (incoming.apiLogin === '********') delete incoming.apiLogin
  const next = saveSettings(req.auth.orgId, incoming)
  armSchedule(req.auth.orgId)
  res.json({ ...next, password: next.password ? '********' : '', apiLogin: next.apiLogin ? '********' : '' })
})

app.post('/api/test-connection', requireAuth, async (req, res) => {
  const s = getSettings(req.auth.orgId)
  const merged = { ...s, ...req.body }
  if (req.body?.password === '********') merged.password = s.password
  if (req.body?.apiLogin === '********') merged.apiLogin = s.apiLogin
  res.json(await testConnection(merged))
})

app.get('/api/edits', requireAuth, (req, res) => res.json(editsDb.getEditsForOrg(req.auth.orgId)))

// Explicit full restore (used by "Импорт") — everyone else's правки go
// through /api/edits/op below, which applies one targeted change at a time
// so two people editing different things never clobber each other.
app.put('/api/edits', requireAuth, (req, res) => {
  editsDb.replaceAllEdits(req.auth.orgId, req.body || {})
  res.json({ ok: true })
})

const EDIT_OPS = {
  renameProduct: (orgId, { original, name }) => editsDb.renameProduct(orgId, original, name),
  setVenue: (orgId, { restaurant, patch }) => editsDb.setVenue(orgId, restaurant, patch),
  clearVenue: (orgId, { restaurant }) => editsDb.clearVenue(orgId, restaurant),
  addVenue: (orgId, { name, patch }) => editsDb.addVenue(orgId, name, patch),
  removeVenue: (orgId, { name }) => editsDb.removeVenue(orgId, name),
  acknowledgeSupplier: (orgId, { rawName }) => editsDb.acknowledgeSupplier(orgId, rawName),
  unacknowledgeSupplier: (orgId, { rawName }) => editsDb.unacknowledgeSupplier(orgId, rawName),
  setProductPackOverride: (orgId, { product, value }) => editsDb.setProductPackOverride(orgId, product, value),
  setPackAlias: (orgId, { key, value }) => editsDb.setPackAlias(orgId, key, value),
  reset: (orgId) => editsDb.resetEdits(orgId),
}

app.post('/api/edits/op', requireAuth, (req, res) => {
  const { type, ...payload } = req.body || {}
  const apply = EDIT_OPS[type]
  if (!apply) return res.status(400).json({ ok: false, message: `Неизвестная операция: ${type}` })
  try {
    apply(req.auth.orgId, payload)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, message: String(err?.message || err) })
  }
})

/* ---------- scheduler (one cron task per org) ---------- */

const CRON = { hourly: '0 * * * *', daily: '0 3 * * *', weekly: '0 3 * * 1', monthly: '0 3 1 * *' }
const tasks = {}

function describeSchedule(orgId) {
  const s = getSettings(orgId)
  return { autoEnabled: s.autoEnabled, interval: s.interval }
}
function armSchedule(orgId) {
  if (tasks[orgId]) { tasks[orgId].stop(); delete tasks[orgId] }
  const s = getSettings(orgId)
  if (!s.autoEnabled) return
  const expr = CRON[s.interval] || CRON.daily
  tasks[orgId] = cron.schedule(expr, () => { runSync(orgId, 'schedule') }, { timezone: process.env.TZ || 'Asia/Almaty' })
}

const PORT = process.env.PORT || 8090
app.listen(PORT, () => {
  for (const org of listOrgs()) armSchedule(org.id)
  console.log(`pricecheck-api on :${PORT} (${listOrgs().length} орг., мультитенант)`)
})
