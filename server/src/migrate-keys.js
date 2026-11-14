#!/usr/bin/env node
/**
 * Одноразовый перенос матрицы и ручных привязок товаров на ключи v2 («независимо от колонок D/E/F»):
 * строка матрицы = ресторан + поставщик (C) + название товара (I), без названий iiko (E), фасовки (F) и алиасов (D).
 *
 *   docker exec pricecheck-api node src/migrate-keys.js            # ПРОБНЫЙ прогон: ничего не меняет, печатает итог
 *   docker exec pricecheck-api node src/migrate-keys.js --apply    # перенос (сначала копия данных в data/_backup-keys-…)
 *   добавки: --org <id> (только одна организация), --force (даже если ручной режим связей не включён)
 *
 * После --apply в настройках организации ставится matrixKeysV2: следующие синки матрицы читают только C, I и H.
 * Идемпотентно: повторный запуск ничего не делает, пока флаг стоит.
 */
import { cpSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  listOrgs, getSettings, saveSettings, getMatrix, saveMatrix,
  listMatrixSnapshots, getMatrixSnapshot, saveMatrixSnapshot,
  listMatrixTabSnapshots, getMatrixTabSnapshot, saveMatrixTabSnapshot,
} from './store.js'
import * as editsDb from './editsDb.js'
import { remapMatchingToV2, norm, normPack } from './sheets.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data')
const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const ONLY = process.argv.includes('--org') ? process.argv[process.argv.indexOf('--org') + 1] : null

const keysOf = (m) => [...new Set([...Object.keys(m?.planPairsByPack || {}), ...Object.keys(m?.planPairs || {}), ...Object.keys(m?.noPriceExact || {})])]

/** Куда указывает привязка после переноса: новое название (I) или null + причина. */
export function newLinkTarget(link, oldIndex) {
  if (!link.targetProduct) return { skip: 'отвязка (пусто) — не трогаем' }
  const [rest, sup] = String(link.key).split('::')
  const hits = oldIndex.get(`${rest}::${sup}::${norm(link.targetProduct)}`)
  if (!hits || !hits.length) return { skip: 'в старой матрице такой строки нет (уже на новых названиях или строка удалена)' }
  const labels = [...new Set(hits.map((h) => h.label).filter(Boolean))]
  if (labels.length === 1) return { target: labels[0] }
  if (!labels.length) return { skip: 'у строки нет названия (I) — оставляем как есть' }
  const byPack = hits.filter((h) => h.pack && h.pack === normPack(link.pack))
  const packLabels = [...new Set(byPack.map((h) => h.label).filter(Boolean))]
  if (packLabels.length === 1) return { target: packLabels[0] }
  return { ambiguous: labels }
}

function migrateOrg(org) {
  const orgId = org.id
  const settings = getSettings(orgId)
  const rep = { org: org.name, id: orgId, matrices: 0, keysBefore: 0, keysAfter: 0, collisions: [], noLabel: 0, links: { total: 0, moved: 0, kept: 0, ambiguous: [] }, status: 'ok' }
  if (settings.matrixKeysV2) { rep.status = 'уже перенесено'; return rep }
  if (!settings.manualLinks && !FORCE) { rep.status = 'ПРОПУЩЕНО: ручной режим связей не включён (зайдите админом в «Справочники», потом повторите; или --force)'; return rep }

  const items = []
  const main = getMatrix(orgId)
  if (main) items.push({ kind: 'main', m: main })
  for (const p of listMatrixSnapshots(orgId)) { const m = getMatrixSnapshot(orgId, p); if (m) items.push({ kind: 'snap', period: p, m }) }
  for (const t of listMatrixTabSnapshots(orgId)) { const f = getMatrixTabSnapshot(orgId, t.tab, t.period); if (f?.slice) items.push({ kind: 'tab', tab: t.tab, period: t.period, m: f.slice }) }

  // индекс для привязок: «ресторан::поставщик::название E» -> какие названия I и фасовки у этих строк
  const oldIndex = new Map()
  for (const it of items) for (const key of keysOf(it.m)) {
    const parts = key.split('::')
    const k = parts.slice(0, 3).join('::')
    if (!oldIndex.has(k)) oldIndex.set(k, [])
    oldIndex.get(k).push({ label: it.m.productLabels?.[key] ? String(it.m.productLabels[key]) : '', pack: parts[3] || '' })
  }

  const collisionSeen = new Set()
  for (const it of items) {
    const before = keysOf(it.m).length
    const r = remapMatchingToV2(it.m)
    it.out = r.matching
    rep.matrices++; rep.keysBefore += before; rep.keysAfter += keysOf(r.matching).length; rep.noLabel += r.noLabel
    for (const c of r.collisions) if (!collisionSeen.has(c.key)) { collisionSeen.add(c.key); rep.collisions.push(c) }
  }

  const links = editsDb.listProductLinksRaw(orgId)
  rep.links.total = links.length
  const changes = []
  for (const l of links) {
    const r = newLinkTarget(l, oldIndex)
    if (r.target && r.target !== l.targetProduct) { changes.push({ key: l.key, target: r.target }); rep.links.moved++ }
    else if (r.ambiguous) rep.links.ambiguous.push({ key: l.key, variants: r.ambiguous })
    else rep.links.kept++
  }

  if (APPLY) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = join(DATA_DIR, `_backup-keys-${ts}`)
    mkdirSync(backup, { recursive: true })
    cpSync(join(DATA_DIR, 'orgs', orgId), join(backup, 'orgs', orgId), { recursive: true })
    editsDb.backupDbTo(join(backup, 'edits.db'))
    rep.backup = backup
    for (const it of items) {
      if (it.kind === 'main') saveMatrix(orgId, it.out)
      else if (it.kind === 'snap') saveMatrixSnapshot(orgId, it.period, it.out)
      else saveMatrixTabSnapshot(orgId, it.tab, it.period, it.out)
    }
    editsDb.runInTransaction(() => { for (const c of changes) editsDb.updateProductLinkTarget(orgId, c.key, c.target) })
    saveSettings(orgId, { matrixKeysV2: true })
  }
  return rep
}

const orgs = listOrgs().filter((o) => !ONLY || o.id === ONLY)
console.log(APPLY ? '=== ПЕРЕНОС (--apply) ===' : '=== ПРОБНЫЙ ПРОГОН (ничего не меняется; для переноса добавьте --apply) ===')
for (const org of orgs) {
  const r = migrateOrg(org)
  console.log(`\nОрганизация «${r.org}» (${r.id}): ${r.status}`)
  if (r.matrices) {
    console.log(`  матриц (общая + снимки + рестораны): ${r.matrices}; строк было ${r.keysBefore}, стало ${r.keysAfter}; без названия (I): ${r.noLabel}`)
    console.log(`  привязок товаров: всего ${r.links.total}, будут перенесены ${r.links.moved}, не трогаем ${r.links.kept}, неоднозначных ${r.links.ambiguous.length}`)
    if (r.collisions.length) console.log(`  СЛИЯНИЕ строк с одинаковым названием (I) у одного поставщика: ${r.collisions.length} (цены останутся вариантами):\n` + r.collisions.slice(0, 20).map((c) => `    ${c.key}  ×${c.rows}  цены: ${c.prices.join(', ')}`).join('\n'))
    if (r.links.ambiguous.length) console.log('  Неоднозначные привязки (останутся как есть — привяжите вручную в Справочниках):\n' + r.links.ambiguous.slice(0, 20).map((a) => `    ${a.key} → ${a.variants.join(' | ')}`).join('\n'))
    if (r.backup) console.log(`  Копия данных до переноса: ${r.backup}`)
  }
}
