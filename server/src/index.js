import express from 'express'
import cron from 'node-cron'
import {
  getSettings, saveSettings, getStatus, saveStatus,
  getDataset, saveDataset, getPlan, getVenues, getMatching,
} from './store.js'
import { fetchFacts, testConnection } from './iiko.js'
import { buildDataset } from './dataset.js'

const app = express()
app.use(express.json({ limit: '2mb' }))
// Same-origin in prod (nginx proxies /api); permissive for local dev.
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  next()
})
app.options('*', (_req, res) => res.sendStatus(204))

let syncing = false

/** Pulls facts from the configured provider and rebuilds the dataset. */
async function runSync(trigger) {
  if (syncing) return { ok: false, message: 'Обновление уже выполняется' }
  syncing = true
  const settings = getSettings()
  try {
    const facts = await fetchFacts(settings)
    if (!facts.length) throw new Error('Провайдер вернул пустой список закупок')
    const dataset = buildDataset(facts, getPlan(), getVenues(), getMatching())
    saveDataset(dataset)
    const status = {
      lastSync: new Date().toISOString(),
      lastResult: 'ok',
      source: settings.provider,
      trigger,
      positions: facts.length,
      message: `Загружено ${facts.length} позиций`,
    }
    saveStatus(status)
    return { ok: true, ...status }
  } catch (e) {
    const status = { ...getStatus(), lastAttempt: new Date().toISOString(), lastResult: 'error', message: String(e.message || e) }
    saveStatus(status)
    return { ok: false, message: status.message }
  } finally {
    syncing = false
  }
}

/* ---------- API ---------- */

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/data', (_req, res) => res.json(getDataset()))

app.get('/api/status', (_req, res) => res.json({ ...getStatus(), syncing, schedule: describeSchedule() }))

app.post('/api/sync', async (_req, res) => {
  const result = await runSync('manual')
  res.status(result.ok ? 200 : 502).json(result)
})

app.get('/api/settings', (_req, res) => {
  const s = getSettings()
  res.json({ ...s, password: s.password ? '********' : '', apiLogin: s.apiLogin ? '********' : '' })
})

app.put('/api/settings', (req, res) => {
  const incoming = { ...req.body }
  // не затирать секреты маскированным значением
  if (incoming.password === '********') delete incoming.password
  if (incoming.apiLogin === '********') delete incoming.apiLogin
  const next = saveSettings(incoming)
  armSchedule()
  res.json({ ...next, password: next.password ? '********' : '', apiLogin: next.apiLogin ? '********' : '' })
})

app.post('/api/test-connection', async (req, res) => {
  const s = getSettings()
  const merged = { ...s, ...req.body }
  if (req.body?.password === '********') merged.password = s.password
  if (req.body?.apiLogin === '********') merged.apiLogin = s.apiLogin
  res.json(await testConnection(merged))
})

/* ---------- scheduler ---------- */

const CRON = { hourly: '0 * * * *', daily: '0 3 * * *', weekly: '0 3 * * 1', monthly: '0 3 1 * *' }
let task = null

function describeSchedule() {
  const s = getSettings()
  return { autoEnabled: s.autoEnabled, interval: s.interval }
}
function armSchedule() {
  if (task) { task.stop(); task = null }
  const s = getSettings()
  if (!s.autoEnabled) return
  const expr = CRON[s.interval] || CRON.daily
  task = cron.schedule(expr, () => { runSync('schedule') }, { timezone: process.env.TZ || 'Asia/Almaty' })
}

const PORT = process.env.PORT || 8090
app.listen(PORT, () => {
  armSchedule()
  console.log(`pricecheck-api on :${PORT} (provider=${getSettings().provider}, auto=${getSettings().autoEnabled})`)
})
