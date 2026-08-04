import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data')

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
  CREATE TABLE IF NOT EXISTS product_renames  (org_id TEXT NOT NULL, original TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (org_id, original));
  CREATE TABLE IF NOT EXISTS venue_overrides  (org_id TEXT NOT NULL, restaurant TEXT NOT NULL, city TEXT, brand TEXT, entity TEXT, category TEXT, PRIMARY KEY (org_id, restaurant));
  CREATE TABLE IF NOT EXISTS new_venues       (org_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (org_id, name));
  CREATE TABLE IF NOT EXISTS acknowledged_suppliers (org_id TEXT NOT NULL, raw_name TEXT NOT NULL, PRIMARY KEY (org_id, raw_name));
  CREATE TABLE IF NOT EXISTS product_pack_override (org_id TEXT NOT NULL, product TEXT NOT NULL, pack_matters INTEGER NOT NULL, PRIMARY KEY (org_id, product));
  CREATE TABLE IF NOT EXISTS pack_aliases     (org_id TEXT NOT NULL, key TEXT NOT NULL, target_pack TEXT NOT NULL, supplier TEXT NOT NULL, product TEXT NOT NULL, raw_pack TEXT NOT NULL, PRIMARY KEY (org_id, key));
`)

const TABLES = ['product_renames', 'venue_overrides', 'new_venues', 'acknowledged_suppliers', 'product_pack_override', 'pack_aliases']

/* ---------- reads: assemble the full Edits object a client expects ---------- */

export function getEditsForOrg(orgId) {
  migrateLegacyJsonIfNeeded(orgId)
  const productRenames = Object.fromEntries(
    db.prepare('SELECT original, name FROM product_renames WHERE org_id=?').all(orgId).map((r) => [r.original, r.name]))
  const venueOverrides = Object.fromEntries(
    db.prepare('SELECT restaurant, city, brand, entity, category FROM venue_overrides WHERE org_id=?').all(orgId).map((r) => {
      const patch = {}
      if (r.city) patch.city = r.city
      if (r.brand) patch.brand = r.brand
      if (r.entity) patch.entity = r.entity
      if (r.category) patch.category = r.category
      return [r.restaurant, patch]
    }))
  const newVenues = Object.fromEntries(
    db.prepare('SELECT name FROM new_venues WHERE org_id=?').all(orgId).map((r) => [r.name, true]))
  const acknowledgedSuppliers = Object.fromEntries(
    db.prepare('SELECT raw_name FROM acknowledged_suppliers WHERE org_id=?').all(orgId).map((r) => [r.raw_name, true]))
  const productPackOverride = Object.fromEntries(
    db.prepare('SELECT product, pack_matters FROM product_pack_override WHERE org_id=?').all(orgId).map((r) => [r.product, !!r.pack_matters]))
  const packAliases = Object.fromEntries(
    db.prepare('SELECT key, target_pack, supplier, product, raw_pack FROM pack_aliases WHERE org_id=?').all(orgId)
      .map((r) => [r.key, { targetPack: r.target_pack, supplier: r.supplier, product: r.product, rawPack: r.raw_pack }]))
  return { productRenames, venueOverrides, newVenues, acknowledgedSuppliers, productPackOverride, packAliases }
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

export function renameProduct(orgId, original, name) {
  const v = String(name || '').trim()
  if (!v || v === original) db.prepare('DELETE FROM product_renames WHERE org_id=? AND original=?').run(orgId, original)
  else db.prepare('INSERT INTO product_renames (org_id, original, name) VALUES (?,?,?) ON CONFLICT(org_id, original) DO UPDATE SET name=excluded.name').run(orgId, original, v)
}

export function setVenue(orgId, restaurant, patch) {
  const row = db.prepare('SELECT city, brand, entity, category FROM venue_overrides WHERE org_id=? AND restaurant=?').get(orgId, restaurant) || {}
  const merged = { ...row, ...(patch || {}) }
  const city = merged.city || null, brand = merged.brand || null, entity = merged.entity || null, category = merged.category || null
  if (!city && !brand && !entity && !category) db.prepare('DELETE FROM venue_overrides WHERE org_id=? AND restaurant=?').run(orgId, restaurant)
  else db.prepare(`
    INSERT INTO venue_overrides (org_id, restaurant, city, brand, entity, category) VALUES (?,?,?,?,?,?)
    ON CONFLICT(org_id, restaurant) DO UPDATE SET city=excluded.city, brand=excluded.brand, entity=excluded.entity, category=excluded.category
  `).run(orgId, restaurant, city, brand, entity, category)
}

export function clearVenue(orgId, restaurant) {
  db.prepare('DELETE FROM venue_overrides WHERE org_id=? AND restaurant=?').run(orgId, restaurant)
}

export function addVenue(orgId, name, patch) {
  const v = String(name || '').trim()
  if (!v) return
  db.prepare('INSERT OR IGNORE INTO new_venues (org_id, name) VALUES (?,?)').run(orgId, v)
  if (patch) setVenue(orgId, v, patch)
}

export function removeVenue(orgId, name) {
  tx(() => {
    db.prepare('DELETE FROM new_venues WHERE org_id=? AND name=?').run(orgId, name)
    db.prepare('DELETE FROM venue_overrides WHERE org_id=? AND restaurant=?').run(orgId, name)
  })
}

export function acknowledgeSupplier(orgId, rawName) {
  db.prepare('INSERT OR IGNORE INTO acknowledged_suppliers (org_id, raw_name) VALUES (?,?)').run(orgId, rawName)
}

export function unacknowledgeSupplier(orgId, rawName) {
  db.prepare('DELETE FROM acknowledged_suppliers WHERE org_id=? AND raw_name=?').run(orgId, rawName)
}

/** value: true = фасовка обязательна (строгое совпадение), false = не важна, null = вернуть к автоматике. */
export function setProductPackOverride(orgId, product, value) {
  if (value === null || value === undefined) db.prepare('DELETE FROM product_pack_override WHERE org_id=? AND product=?').run(orgId, product)
  else db.prepare('INSERT INTO product_pack_override (org_id, product, pack_matters) VALUES (?,?,?) ON CONFLICT(org_id, product) DO UPDATE SET pack_matters=excluded.pack_matters')
    .run(orgId, product, value ? 1 : 0)
}

/** value: { targetPack, supplier, product, rawPack } — их же написание, для показа в Справочниках; null — снять правку. */
export function setPackAlias(orgId, key, value) {
  if (value === null || value === undefined) db.prepare('DELETE FROM pack_aliases WHERE org_id=? AND key=?').run(orgId, key)
  else db.prepare(`
    INSERT INTO pack_aliases (org_id, key, target_pack, supplier, product, raw_pack) VALUES (?,?,?,?,?,?)
    ON CONFLICT(org_id, key) DO UPDATE SET target_pack=excluded.target_pack, supplier=excluded.supplier, product=excluded.product, raw_pack=excluded.raw_pack
  `).run(orgId, key, String(value.targetPack || ''), String(value.supplier || ''), String(value.product || ''), String(value.rawPack || ''))
}

export function resetEdits(orgId) {
  tx(() => { for (const t of TABLES) db.prepare(`DELETE FROM ${t} WHERE org_id=?`).run(orgId) })
}

/** Full-blob restore — used by "Импорт" (explicit, deliberate user action) and the legacy-JSON migration. */
export function replaceAllEdits(orgId, e) {
  tx(() => {
    for (const t of TABLES) db.prepare(`DELETE FROM ${t} WHERE org_id=?`).run(orgId)
    for (const [original, name] of Object.entries(e.productRenames || {}))
      db.prepare('INSERT INTO product_renames (org_id, original, name) VALUES (?,?,?)').run(orgId, original, name)
    for (const [restaurant, patch] of Object.entries(e.venueOverrides || {}))
      db.prepare('INSERT INTO venue_overrides (org_id, restaurant, city, brand, entity, category) VALUES (?,?,?,?,?,?)')
        .run(orgId, restaurant, patch.city || null, patch.brand || null, patch.entity || null, patch.category || null)
    for (const name of Object.keys(e.newVenues || {}))
      db.prepare('INSERT INTO new_venues (org_id, name) VALUES (?,?)').run(orgId, name)
    for (const rawName of Object.keys(e.acknowledgedSuppliers || {}))
      db.prepare('INSERT INTO acknowledged_suppliers (org_id, raw_name) VALUES (?,?)').run(orgId, rawName)
    for (const [product, matters] of Object.entries(e.productPackOverride || {}))
      db.prepare('INSERT INTO product_pack_override (org_id, product, pack_matters) VALUES (?,?,?)').run(orgId, product, matters ? 1 : 0)
    for (const [key, v] of Object.entries(e.packAliases || {}))
      db.prepare('INSERT INTO pack_aliases (org_id, key, target_pack, supplier, product, raw_pack) VALUES (?,?,?,?,?,?)')
        .run(orgId, key, String(v.targetPack || ''), String(v.supplier || ''), String(v.product || ''), String(v.rawPack || ''))
  })
}
