import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data')

const norm = (s) => String(s || '').trim().toLowerCase()
const pairKey = (supplier, product) => `${norm(supplier)}::${norm(product)}`

// Built into Node itself (22.5+) — no native module to compile, so no
// build toolchain (python3/make/g++) needed in the Docker image at all.
const db = new DatabaseSync(join(DATA_DIR, 'edits.db'))
db.exec('PRAGMA journal_mode = WAL')

/** better-sqlite3 had db.transaction(fn); node:sqlite doesn't — same shape by hand. */
function tx(fn) {
  db.exec('BEGIN')
  try { fn(); db.exec('COMMIT') }
  catch (err) { db.exec('ROLLBACK'); throw err }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS supplier_renames (org_id TEXT NOT NULL, original TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (org_id, original));
  CREATE TABLE IF NOT EXISTS product_renames  (org_id TEXT NOT NULL, original TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (org_id, original));
  CREATE TABLE IF NOT EXISTS plan_overrides   (org_id TEXT NOT NULL, product TEXT NOT NULL, plan REAL NOT NULL, PRIMARY KEY (org_id, product));
  CREATE TABLE IF NOT EXISTS plan_pair_overrides (org_id TEXT NOT NULL, pair_key TEXT NOT NULL, plan REAL NOT NULL, PRIMARY KEY (org_id, pair_key));
  CREATE TABLE IF NOT EXISTS excluded_products (org_id TEXT NOT NULL, product TEXT NOT NULL, PRIMARY KEY (org_id, product));
  CREATE TABLE IF NOT EXISTS venue_overrides  (org_id TEXT NOT NULL, restaurant TEXT NOT NULL, city TEXT, brand TEXT, entity TEXT, PRIMARY KEY (org_id, restaurant));
  CREATE TABLE IF NOT EXISTS new_suppliers    (org_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (org_id, name));
  CREATE TABLE IF NOT EXISTS new_products     (org_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (org_id, name));
  CREATE TABLE IF NOT EXISTS new_venues       (org_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (org_id, name));
  CREATE TABLE IF NOT EXISTS supplier_merges  (org_id TEXT NOT NULL, raw_name TEXT NOT NULL, canonical_name TEXT NOT NULL, PRIMARY KEY (org_id, raw_name));
`)

const TABLES = [
  'supplier_renames', 'product_renames', 'plan_overrides', 'plan_pair_overrides',
  'excluded_products', 'venue_overrides', 'new_suppliers', 'new_products', 'new_venues', 'supplier_merges',
]

/* ---------- reads: assemble the full Edits object a client expects ---------- */

export function getEditsForOrg(orgId) {
  migrateLegacyJsonIfNeeded(orgId)
  const supplierRenames = Object.fromEntries(
    db.prepare('SELECT original, name FROM supplier_renames WHERE org_id=?').all(orgId).map((r) => [r.original, r.name]))
  const productRenames = Object.fromEntries(
    db.prepare('SELECT original, name FROM product_renames WHERE org_id=?').all(orgId).map((r) => [r.original, r.name]))
  const planOverrides = Object.fromEntries(
    db.prepare('SELECT product, plan FROM plan_overrides WHERE org_id=?').all(orgId).map((r) => [r.product, r.plan]))
  const planPairOverrides = Object.fromEntries(
    db.prepare('SELECT pair_key, plan FROM plan_pair_overrides WHERE org_id=?').all(orgId).map((r) => [r.pair_key, r.plan]))
  const excludedProducts = Object.fromEntries(
    db.prepare('SELECT product FROM excluded_products WHERE org_id=?').all(orgId).map((r) => [r.product, true]))
  const venueOverrides = Object.fromEntries(
    db.prepare('SELECT restaurant, city, brand, entity FROM venue_overrides WHERE org_id=?').all(orgId).map((r) => {
      const patch = {}
      if (r.city) patch.city = r.city
      if (r.brand) patch.brand = r.brand
      if (r.entity) patch.entity = r.entity
      return [r.restaurant, patch]
    }))
  const newSuppliers = Object.fromEntries(
    db.prepare('SELECT name FROM new_suppliers WHERE org_id=?').all(orgId).map((r) => [r.name, true]))
  const newProducts = Object.fromEntries(
    db.prepare('SELECT name FROM new_products WHERE org_id=?').all(orgId).map((r) => [r.name, true]))
  const newVenues = Object.fromEntries(
    db.prepare('SELECT name FROM new_venues WHERE org_id=?').all(orgId).map((r) => [r.name, true]))
  const supplierMerges = Object.fromEntries(
    db.prepare('SELECT raw_name, canonical_name FROM supplier_merges WHERE org_id=?').all(orgId).map((r) => [r.raw_name, r.canonical_name]))
  return {
    supplierRenames, productRenames, planOverrides, planPairOverrides, excludedProducts,
    venueOverrides, newSuppliers, newProducts, newVenues, supplierMerges,
  }
}

function hasAnyRows(orgId) {
  return TABLES.some((t) => db.prepare(`SELECT 1 FROM ${t} WHERE org_id=? LIMIT 1`).get(orgId))
}

/**
 * One-time upgrade path: orgs created before this SQLite migration kept
 * their edits in a single edits.json blob (DATA_DIR/orgs/<id>/edits.json).
 * If the DB is still empty for this org and that file exists, import it once.
 */
function migrateLegacyJsonIfNeeded(orgId) {
  if (hasAnyRows(orgId)) return
  const legacyPath = join(DATA_DIR, 'orgs', orgId, 'edits.json')
  if (!existsSync(legacyPath)) return
  try {
    const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))
    if (legacy && typeof legacy === 'object') replaceAllEdits(orgId, legacy)
  } catch { /* corrupt or unreadable — leave the org starting empty */ }
}

/* ---------- writes: one targeted operation per call — safe under concurrent editors ---------- */

export function renameSupplier(orgId, original, name) {
  const v = String(name || '').trim()
  if (!v || v === original) db.prepare('DELETE FROM supplier_renames WHERE org_id=? AND original=?').run(orgId, original)
  else db.prepare('INSERT INTO supplier_renames (org_id, original, name) VALUES (?,?,?) ON CONFLICT(org_id, original) DO UPDATE SET name=excluded.name').run(orgId, original, v)
}

export function renameProduct(orgId, original, name) {
  const v = String(name || '').trim()
  if (!v || v === original) db.prepare('DELETE FROM product_renames WHERE org_id=? AND original=?').run(orgId, original)
  else db.prepare('INSERT INTO product_renames (org_id, original, name) VALUES (?,?,?) ON CONFLICT(org_id, original) DO UPDATE SET name=excluded.name').run(orgId, original, v)
}

export function setPlan(orgId, product, plan) {
  if (plan == null || !isFinite(plan) || plan <= 0) db.prepare('DELETE FROM plan_overrides WHERE org_id=? AND product=?').run(orgId, product)
  else db.prepare('INSERT INTO plan_overrides (org_id, product, plan) VALUES (?,?,?) ON CONFLICT(org_id, product) DO UPDATE SET plan=excluded.plan').run(orgId, product, plan)
}

export function setPairPlan(orgId, supplier, product, plan) {
  const s = String(supplier || '').trim(), p = String(product || '').trim()
  if (!s || !p) return
  const key = pairKey(s, p)
  if (plan == null || !isFinite(plan) || plan <= 0) db.prepare('DELETE FROM plan_pair_overrides WHERE org_id=? AND pair_key=?').run(orgId, key)
  else db.prepare('INSERT INTO plan_pair_overrides (org_id, pair_key, plan) VALUES (?,?,?) ON CONFLICT(org_id, pair_key) DO UPDATE SET plan=excluded.plan').run(orgId, key, plan)
}

export function setExcluded(orgId, product, excluded) {
  if (excluded) db.prepare('INSERT OR IGNORE INTO excluded_products (org_id, product) VALUES (?,?)').run(orgId, product)
  else db.prepare('DELETE FROM excluded_products WHERE org_id=? AND product=?').run(orgId, product)
}

export function setVenue(orgId, restaurant, patch) {
  const row = db.prepare('SELECT city, brand, entity FROM venue_overrides WHERE org_id=? AND restaurant=?').get(orgId, restaurant) || {}
  const merged = { ...row, ...(patch || {}) }
  const city = merged.city || null, brand = merged.brand || null, entity = merged.entity || null
  if (!city && !brand && !entity) db.prepare('DELETE FROM venue_overrides WHERE org_id=? AND restaurant=?').run(orgId, restaurant)
  else db.prepare(`
    INSERT INTO venue_overrides (org_id, restaurant, city, brand, entity) VALUES (?,?,?,?,?)
    ON CONFLICT(org_id, restaurant) DO UPDATE SET city=excluded.city, brand=excluded.brand, entity=excluded.entity
  `).run(orgId, restaurant, city, brand, entity)
}

export function clearVenue(orgId, restaurant) {
  db.prepare('DELETE FROM venue_overrides WHERE org_id=? AND restaurant=?').run(orgId, restaurant)
}

export function addSupplier(orgId, name) {
  const v = String(name || '').trim()
  if (!v) return
  db.prepare('INSERT OR IGNORE INTO new_suppliers (org_id, name) VALUES (?,?)').run(orgId, v)
}

export function addProduct(orgId, name, plan) {
  const v = String(name || '').trim()
  if (!v) return
  db.prepare('INSERT OR IGNORE INTO new_products (org_id, name) VALUES (?,?)').run(orgId, v)
  if (plan != null && isFinite(plan) && plan > 0) setPlan(orgId, v, plan)
}

export function addVenue(orgId, name, patch) {
  const v = String(name || '').trim()
  if (!v) return
  db.prepare('INSERT OR IGNORE INTO new_venues (org_id, name) VALUES (?,?)').run(orgId, v)
  if (patch) setVenue(orgId, v, patch)
}

export function removeSupplier(orgId, name) {
  db.prepare('DELETE FROM new_suppliers WHERE org_id=? AND name=?').run(orgId, name)
}

export function removeProduct(orgId, name) {
  const suffix = `::${norm(name)}`
  tx(() => {
    db.prepare('DELETE FROM new_products WHERE org_id=? AND name=?').run(orgId, name)
    db.prepare('DELETE FROM plan_overrides WHERE org_id=? AND product=?').run(orgId, name)
    db.prepare("DELETE FROM plan_pair_overrides WHERE org_id=? AND pair_key LIKE '%' || ?").run(orgId, suffix)
  })
}

export function removeVenue(orgId, name) {
  tx(() => {
    db.prepare('DELETE FROM new_venues WHERE org_id=? AND name=?').run(orgId, name)
    db.prepare('DELETE FROM venue_overrides WHERE org_id=? AND restaurant=?').run(orgId, name)
  })
}

export function mergeSupplier(orgId, rawName, canonicalName) {
  const v = String(canonicalName || '').trim()
  if (!v || v === rawName) return
  db.prepare('INSERT INTO supplier_merges (org_id, raw_name, canonical_name) VALUES (?,?,?) ON CONFLICT(org_id, raw_name) DO UPDATE SET canonical_name=excluded.canonical_name').run(orgId, rawName, v)
}

export function unmergeSupplier(orgId, rawName) {
  db.prepare('DELETE FROM supplier_merges WHERE org_id=? AND raw_name=?').run(orgId, rawName)
}

export function resetEdits(orgId) {
  tx(() => { for (const t of TABLES) db.prepare(`DELETE FROM ${t} WHERE org_id=?`).run(orgId) })
}

/** Full-blob restore — used by "Импорт" (explicit, deliberate user action) and the legacy-JSON migration. */
export function replaceAllEdits(orgId, e) {
  tx(() => {
    for (const t of TABLES) db.prepare(`DELETE FROM ${t} WHERE org_id=?`).run(orgId)
    for (const [original, name] of Object.entries(e.supplierRenames || {}))
      db.prepare('INSERT INTO supplier_renames (org_id, original, name) VALUES (?,?,?)').run(orgId, original, name)
    for (const [original, name] of Object.entries(e.productRenames || {}))
      db.prepare('INSERT INTO product_renames (org_id, original, name) VALUES (?,?,?)').run(orgId, original, name)
    for (const [product, plan] of Object.entries(e.planOverrides || {}))
      db.prepare('INSERT INTO plan_overrides (org_id, product, plan) VALUES (?,?,?)').run(orgId, product, plan)
    for (const [key, plan] of Object.entries(e.planPairOverrides || {}))
      db.prepare('INSERT INTO plan_pair_overrides (org_id, pair_key, plan) VALUES (?,?,?)').run(orgId, key, plan)
    for (const product of Object.keys(e.excludedProducts || {}))
      db.prepare('INSERT INTO excluded_products (org_id, product) VALUES (?,?)').run(orgId, product)
    for (const [restaurant, patch] of Object.entries(e.venueOverrides || {}))
      db.prepare('INSERT INTO venue_overrides (org_id, restaurant, city, brand, entity) VALUES (?,?,?,?,?)')
        .run(orgId, restaurant, patch.city || null, patch.brand || null, patch.entity || null)
    for (const name of Object.keys(e.newSuppliers || {}))
      db.prepare('INSERT INTO new_suppliers (org_id, name) VALUES (?,?)').run(orgId, name)
    for (const name of Object.keys(e.newProducts || {}))
      db.prepare('INSERT INTO new_products (org_id, name) VALUES (?,?)').run(orgId, name)
    for (const name of Object.keys(e.newVenues || {}))
      db.prepare('INSERT INTO new_venues (org_id, name) VALUES (?,?)').run(orgId, name)
    for (const [rawName, canonicalName] of Object.entries(e.supplierMerges || {}))
      db.prepare('INSERT INTO supplier_merges (org_id, raw_name, canonical_name) VALUES (?,?,?)').run(orgId, rawName, canonicalName)
  })
}
