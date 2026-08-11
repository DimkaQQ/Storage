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
  CREATE TABLE IF NOT EXISTS supplier_renames (org_id TEXT NOT NULL, original TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (org_id, original));
  CREATE TABLE IF NOT EXISTS venue_overrides  (org_id TEXT NOT NULL, restaurant TEXT NOT NULL, city TEXT, brand TEXT, entity TEXT, category TEXT, PRIMARY KEY (org_id, restaurant));
  CREATE TABLE IF NOT EXISTS new_venues       (org_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (org_id, name));
  CREATE TABLE IF NOT EXISTS acknowledged_suppliers (org_id TEXT NOT NULL, raw_name TEXT NOT NULL, PRIMARY KEY (org_id, raw_name));
  CREATE TABLE IF NOT EXISTS product_pack_override (org_id TEXT NOT NULL, product TEXT NOT NULL, pack_matters INTEGER NOT NULL, PRIMARY KEY (org_id, product));
  CREATE TABLE IF NOT EXISTS pack_aliases     (org_id TEXT NOT NULL, key TEXT NOT NULL, target_pack TEXT NOT NULL, supplier TEXT NOT NULL, product TEXT NOT NULL, raw_pack TEXT NOT NULL, PRIMARY KEY (org_id, key));
  CREATE TABLE IF NOT EXISTS product_links    (org_id TEXT NOT NULL, key TEXT NOT NULL, target_product TEXT NOT NULL, supplier TEXT NOT NULL, raw_product TEXT NOT NULL, PRIMARY KEY (org_id, key));
  CREATE TABLE IF NOT EXISTS plan_overrides    (org_id TEXT NOT NULL, key TEXT NOT NULL, price REAL NOT NULL, PRIMARY KEY (org_id, key));
`)

const TABLES = ['product_renames', 'supplier_renames', 'venue_overrides', 'new_venues', 'acknowledged_suppliers', 'product_pack_override', 'pack_aliases', 'product_links', 'plan_overrides']

/* ---------- reads: assemble the full Edits object a client expects ---------- */

export function getEditsForOrg(orgId) {
  migrateLegacyJsonIfNeeded(orgId)
  const productRenames = Object.fromEntries(
    db.prepare('SELECT original, name FROM product_renames WHERE org_id=?').all(orgId).map((r) => [r.original, r.name]))
  const supplierRenames = Object.fromEntries(
    db.prepare('SELECT original, name FROM supplier_renames WHERE org_id=?').all(orgId).map((r) => [r.original, r.name]))
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
  const productLinks = Object.fromEntries(
    db.prepare('SELECT key, target_product, supplier, raw_product FROM product_links WHERE org_id=?').all(orgId)
      .map((r) => [r.key, { targetProduct: r.target_product, supplier: r.supplier, rawProduct: r.raw_product }]))
  const planOverrides = Object.fromEntries(
    db.prepare('SELECT key, price FROM plan_overrides WHERE org_id=?').all(orgId).map((r) => [r.key, r.price]))
  return { productRenames, supplierRenames, venueOverrides, newVenues, acknowledgedSuppliers, productPackOverride, packAliases, productLinks, planOverrides }
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

// Every op below is reachable straight from an authenticated user's request
// body (see EDIT_OPS in index.js) — a required string key arriving as
// undefined/null/a number used to hit SQLite's bind check directly ("cannot
// be bound to SQLite parameter") and blow up as a 500 instead of just being
// ignored. Coerce-and-no-op on empty, same as the existing v/name handling
// below, so a malformed payload never corrupts data or crashes the request.
const str = (x) => String(x ?? '').trim()

export function renameProduct(orgId, original, name) {
  const orig = str(original)
  if (!orig) return
  const v = String(name || '').trim()
  if (!v || v === orig) db.prepare('DELETE FROM product_renames WHERE org_id=? AND original=?').run(orgId, orig)
  else db.prepare('INSERT INTO product_renames (org_id, original, name) VALUES (?,?,?) ON CONFLICT(org_id, original) DO UPDATE SET name=excluded.name').run(orgId, orig, v)
}

export function renameSupplier(orgId, original, name) {
  const orig = str(original)
  if (!orig) return
  const v = String(name || '').trim()
  if (!v || v === orig) db.prepare('DELETE FROM supplier_renames WHERE org_id=? AND original=?').run(orgId, orig)
  else db.prepare('INSERT INTO supplier_renames (org_id, original, name) VALUES (?,?,?) ON CONFLICT(org_id, original) DO UPDATE SET name=excluded.name').run(orgId, orig, v)
}

export function setVenue(orgId, restaurant, patch) {
  const r = str(restaurant)
  if (!r) return
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const row = db.prepare('SELECT city, brand, entity, category FROM venue_overrides WHERE org_id=? AND restaurant=?').get(orgId, r) || {}
  const merged = { ...row, ...p }
  const city = merged.city || null, brand = merged.brand || null, entity = merged.entity || null, category = merged.category || null
  if (!city && !brand && !entity && !category) db.prepare('DELETE FROM venue_overrides WHERE org_id=? AND restaurant=?').run(orgId, r)
  else db.prepare(`
    INSERT INTO venue_overrides (org_id, restaurant, city, brand, entity, category) VALUES (?,?,?,?,?,?)
    ON CONFLICT(org_id, restaurant) DO UPDATE SET city=excluded.city, brand=excluded.brand, entity=excluded.entity, category=excluded.category
  `).run(orgId, r, city, brand, entity, category)
}

export function clearVenue(orgId, restaurant) {
  const r = str(restaurant)
  if (!r) return
  db.prepare('DELETE FROM venue_overrides WHERE org_id=? AND restaurant=?').run(orgId, r)
}

export function addVenue(orgId, name, patch) {
  const v = String(name || '').trim()
  if (!v) return
  db.prepare('INSERT OR IGNORE INTO new_venues (org_id, name) VALUES (?,?)').run(orgId, v)
  if (patch) setVenue(orgId, v, patch)
}

export function removeVenue(orgId, name) {
  const n = str(name)
  if (!n) return
  tx(() => {
    db.prepare('DELETE FROM new_venues WHERE org_id=? AND name=?').run(orgId, n)
    db.prepare('DELETE FROM venue_overrides WHERE org_id=? AND restaurant=?').run(orgId, n)
  })
}

export function acknowledgeSupplier(orgId, rawName) {
  const n = str(rawName)
  if (!n) return
  db.prepare('INSERT OR IGNORE INTO acknowledged_suppliers (org_id, raw_name) VALUES (?,?)').run(orgId, n)
}

export function unacknowledgeSupplier(orgId, rawName) {
  const n = str(rawName)
  if (!n) return
  db.prepare('DELETE FROM acknowledged_suppliers WHERE org_id=? AND raw_name=?').run(orgId, n)
}

/** value: true = фасовка обязательна (строгое совпадение), false = не важна, null = вернуть к автоматике. */
export function setProductPackOverride(orgId, product, value) {
  const p = str(product)
  if (!p) return
  if (value === null || value === undefined) db.prepare('DELETE FROM product_pack_override WHERE org_id=? AND product=?').run(orgId, p)
  else db.prepare('INSERT INTO product_pack_override (org_id, product, pack_matters) VALUES (?,?,?) ON CONFLICT(org_id, product) DO UPDATE SET pack_matters=excluded.pack_matters')
    .run(orgId, p, value ? 1 : 0)
}

/** value: { targetPack, supplier, product, rawPack } — их же написание, для показа в Справочниках; null — снять правку. */
export function setPackAlias(orgId, key, value) {
  const k = str(key)
  if (!k) return
  if (value === null || value === undefined) db.prepare('DELETE FROM pack_aliases WHERE org_id=? AND key=?').run(orgId, k)
  else {
    const v = value && typeof value === 'object' ? value : {}
    db.prepare(`
      INSERT INTO pack_aliases (org_id, key, target_pack, supplier, product, raw_pack) VALUES (?,?,?,?,?,?)
      ON CONFLICT(org_id, key) DO UPDATE SET target_pack=excluded.target_pack, supplier=excluded.supplier, product=excluded.product, raw_pack=excluded.raw_pack
    `).run(orgId, k, String(v.targetPack || ''), String(v.supplier || ''), String(v.product || ''), String(v.rawPack || ''))
  }
}

/** value: { targetProduct, supplier, rawProduct } — "это iiko-название на самом деле вот этот товар из матрицы"; null — снять привязку. */
export function setProductLink(orgId, key, value) {
  const k = str(key)
  if (!k) return
  if (value === null || value === undefined) { db.prepare('DELETE FROM product_links WHERE org_id=? AND key=?').run(orgId, k); return }
  const v = value && typeof value === 'object' ? value : {}
  db.prepare(`
    INSERT INTO product_links (org_id, key, target_product, supplier, raw_product) VALUES (?,?,?,?,?)
    ON CONFLICT(org_id, key) DO UPDATE SET target_product=excluded.target_product, supplier=excluded.supplier, raw_product=excluded.raw_product
  `).run(orgId, k, String(v.targetProduct || ''), String(v.supplier || ''), String(v.rawProduct || ''))
}

/** value: число — план цена вручную из Справочников; null — снять правку (вернуться к цене из матрицы). Не число (в т.ч. NaN от мусорного ввода) — молча игнорируем, не затираем существующую правку невалидным значением. */
export function setPlanOverride(orgId, key, value) {
  const k = str(key)
  if (!k) return
  if (value === null || value === undefined) { db.prepare('DELETE FROM plan_overrides WHERE org_id=? AND key=?').run(orgId, k); return }
  const price = Number(value)
  if (!Number.isFinite(price)) return
  db.prepare('INSERT INTO plan_overrides (org_id, key, price) VALUES (?,?,?) ON CONFLICT(org_id, key) DO UPDATE SET price=excluded.price')
    .run(orgId, k, price)
}

export function resetEdits(orgId) {
  tx(() => { for (const t of TABLES) db.prepare(`DELETE FROM ${t} WHERE org_id=?`).run(orgId) })
}

// e's fields are whatever JSON the client sent ("Импорт" uploads a file
// verbatim) — Object.entries()/keys() on a non-object (a string, an array)
// silently iterates its indices/characters instead of throwing, which used
// to insert garbage rows (numeric-string keys, single-char values) straight
// into the DB instead of being rejected. Only ever treat an actual plain
// object as a map to iterate; anything else becomes "no entries" (same as
// the field being absent), not corrupt data.
const plainObject = (x) => (x && typeof x === 'object' && !Array.isArray(x)) ? x : {}

/** Full-blob restore — used by "Импорт" (explicit, deliberate user action) and the legacy-JSON migration. */
export function replaceAllEdits(orgId, e) {
  const edits = plainObject(e)
  tx(() => {
    for (const t of TABLES) db.prepare(`DELETE FROM ${t} WHERE org_id=?`).run(orgId)
    for (const [original, name] of Object.entries(plainObject(edits.productRenames))) {
      const orig = str(original); if (!orig) continue
      db.prepare('INSERT INTO product_renames (org_id, original, name) VALUES (?,?,?)').run(orgId, orig, String(name || ''))
    }
    for (const [original, name] of Object.entries(plainObject(edits.supplierRenames))) {
      const orig = str(original); if (!orig) continue
      db.prepare('INSERT INTO supplier_renames (org_id, original, name) VALUES (?,?,?)').run(orgId, orig, String(name || ''))
    }
    for (const [restaurant, patchRaw] of Object.entries(plainObject(edits.venueOverrides))) {
      const r = str(restaurant); if (!r) continue
      const patch = plainObject(patchRaw)
      const city = patch.city || null, brand = patch.brand || null, entity = patch.entity || null, category = patch.category || null
      if (!city && !brand && !entity && !category) continue // ничего реально не переопределено — не создавать пустую запись
      db.prepare('INSERT INTO venue_overrides (org_id, restaurant, city, brand, entity, category) VALUES (?,?,?,?,?,?)')
        .run(orgId, r, city, brand, entity, category)
    }
    for (const name of Object.keys(plainObject(edits.newVenues))) {
      const n = str(name); if (!n) continue
      db.prepare('INSERT INTO new_venues (org_id, name) VALUES (?,?)').run(orgId, n)
    }
    for (const rawName of Object.keys(plainObject(edits.acknowledgedSuppliers))) {
      const n = str(rawName); if (!n) continue
      db.prepare('INSERT INTO acknowledged_suppliers (org_id, raw_name) VALUES (?,?)').run(orgId, n)
    }
    for (const [product, matters] of Object.entries(plainObject(edits.productPackOverride))) {
      const p = str(product); if (!p) continue
      db.prepare('INSERT INTO product_pack_override (org_id, product, pack_matters) VALUES (?,?,?)').run(orgId, p, matters ? 1 : 0)
    }
    for (const [key, vRaw] of Object.entries(plainObject(edits.packAliases))) {
      const k = str(key); if (!k) continue
      const v = plainObject(vRaw)
      db.prepare('INSERT INTO pack_aliases (org_id, key, target_pack, supplier, product, raw_pack) VALUES (?,?,?,?,?,?)')
        .run(orgId, k, String(v.targetPack || ''), String(v.supplier || ''), String(v.product || ''), String(v.rawPack || ''))
    }
    for (const [key, vRaw] of Object.entries(plainObject(edits.productLinks))) {
      const k = str(key); if (!k) continue
      const v = plainObject(vRaw)
      db.prepare('INSERT INTO product_links (org_id, key, target_product, supplier, raw_product) VALUES (?,?,?,?,?)')
        .run(orgId, k, String(v.targetProduct || ''), String(v.supplier || ''), String(v.rawProduct || ''))
    }
    for (const [key, price] of Object.entries(plainObject(edits.planOverrides))) {
      const k = str(key); if (!k) continue
      const p = Number(price); if (!Number.isFinite(p)) continue
      db.prepare('INSERT INTO plan_overrides (org_id, key, price) VALUES (?,?,?)').run(orgId, k, p)
    }
  })
}
