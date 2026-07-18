import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data')
const SEED = join(__dirname, '..', 'seed', 'dataset.json')

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

const MATCHING_SEED = join(__dirname, '..', 'seed', 'matching.json')

const paths = {
  settings: join(DATA_DIR, 'settings.json'),
  status: join(DATA_DIR, 'status.json'),
  dataset: join(DATA_DIR, 'dataset.json'),
  plan: join(DATA_DIR, 'planmatrix.json'),
  venues: join(DATA_DIR, 'venues.json'),
}

const read = (p, fallback) => {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback } catch { return fallback }
}
const write = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2))

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

export const norm = (s) => String(s || '').trim().toLowerCase()

/** On first run, derive the plan matrix and venue meta from the seed dataset. */
function bootstrap() {
  if (!existsSync(paths.dataset)) {
    const seed = read(SEED, { restaurants: [] })
    write(paths.dataset, seed)
    // plan matrix: product(norm) -> plan price (first non-null seen)
    if (!existsSync(paths.plan)) {
      const plan = {}
      for (const r of seed.restaurants || [])
        for (const it of r.items || [])
          if (it.pl != null && plan[norm(it.p)] == null) plan[norm(it.p)] = it.pl
      write(paths.plan, plan)
    }
    if (!existsSync(paths.venues)) {
      const venues = (seed.restaurants || []).map((r) => ({
        name: r.name, entity: r.entity, brand: r.brand, city: r.city, category: r.category,
      }))
      write(paths.venues, venues)
    }
    if (!existsSync(paths.status))
      write(paths.status, { lastSync: null, lastResult: 'seed', source: 'seed', message: 'Стартовые данные (демо)' })
  }
}
bootstrap()

export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...read(paths.settings, {}) })
export const saveSettings = (s) => { const next = { ...getSettings(), ...s }; write(paths.settings, next); return next }
export const getStatus = () => read(paths.status, { lastSync: null, lastResult: null, source: null })
export const saveStatus = (s) => { write(paths.status, s); return s }
export const getDataset = () => read(paths.dataset, { restaurants: [] })
export const saveDataset = (d) => write(paths.dataset, d)
export const getPlan = () => read(paths.plan, {})
export const savePlan = (p) => write(paths.plan, p)
export const getVenues = () => read(paths.venues, [])
export const getSeed = () => read(SEED, { restaurants: [] })

/**
 * Supplier-alias + (supplier, product) plan-price tables extracted from the
 * client's own working matrix (справочник + Сырье F Алматы). Used to match
 * fresh iiko purchases as precisely as their spreadsheet does: by normalized
 * supplier + exact product name first, falling back to product name alone.
 */
const EMPTY_MATCHING = { supplierAlias: {}, planPairs: {}, planPairsByPack: {}, planByProduct: {} }
export const getMatching = () => read(MATCHING_SEED, EMPTY_MATCHING)
