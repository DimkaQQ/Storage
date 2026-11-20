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
import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

let backupDir = ''
function migrateOrg(org) {
  const orgId = org.id
  const settings = getSettings(orgId)
  const rep = { org: org.name, id: orgId, matrices: 0, keysBefore: 0, keysAfter: 0, collisions: [], noLabel: 0, noLabelKeys: [], links: { total: 0, moved: 0, kept: 0, ambiguous: [] }, status: 'ok' }
  if (settings.matrixKeysV2) { rep.status = 'уже перенесено'; return rep }
  if (!settings.manualLinks && !FORCE) { rep.status = 'ПРОПУЩЕНО: ручной режим связей не включён (зайдите админом в «Справочники», потом повторите; или --force)'; return rep }

  const items = []
  const main = getMatrix(orgId)
  if (main) items.push({ kind: 'main', m: main })
  for (const p of listMatrixSnapshots(orgId)) { const m = getMatrixSnapshot(orgId, p); if (m) items.push({ kind: 'snap', period: p, m }) }
  for (const t of listMatrixTabSnapshots(orgId)) { const f = getMatrixTabSnapshot(orgId, t.tab, t.period); if (f?.slice) items.push({ kind: 'tab', tab: t.tab, period: t.period, m: f.slice }) }

  // индекс для привязок: «ресторан::поставщик::название E» -> какие названия I и фасовки у этих строк
  // Сначала смотрим в ТЕКУЩУЮ общую матрицу; в снимки прошлых периодов — только если там такой строки нет (названия I со временем меняют)
  const buildIndex = (list) => {
    const idx = new Map()
    for (const it of list) for (const key of keysOf(it.m)) {
      const parts = key.split('::')
      const k = parts.slice(0, 3).join('::')
      if (!idx.has(k)) idx.set(k, [])
      idx.get(k).push({ label: it.m.productLabels?.[key] ? String(it.m.productLabels[key]) : '', pack: parts[3] || '' })
    }
    return idx
  }
  const mainIndex = buildIndex(items.filter((i) => i.kind === 'main'))
  const allIndex = buildIndex(items)
  const oldIndex = { get: (k) => mainIndex.get(k) ?? allIndex.get(k) }

  const collisionSeen = new Set()
  for (const it of items) {
    const before = keysOf(it.m).length
    const r = remapMatchingToV2(it.m)
    it.out = r.matching
    rep.matrices++; rep.keysBefore += before; rep.keysAfter += keysOf(r.matching).length; rep.noLabel += r.noLabel
    if (it.kind === 'main') for (const k of keysOf(it.m)) if (!it.m.productLabels?.[k]) rep.noLabelKeys.push(k)
    for (const c of r.collisions) if (!collisionSeen.has(c.key)) { collisionSeen.add(c.key); rep.collisions.push(c) }
  }

  const links = editsDb.listProductLinksRaw(orgId)
  rep.links.total = links.length
  const changes = []
  const adds = [] // новые привязки «по фасовке»: в старой матрице фасовка (F) = фасовка из iiko, в v2 её в ключе больше нет
  const haveKeys = new Set(links.map((l) => l.key))
  for (const l of links) {
    const r = newLinkTarget(l, oldIndex)
    if (r.target && r.target !== l.targetProduct) { changes.push({ key: l.key, target: r.target }); rep.links.moved++ }
    else if (r.ambiguous) rep.links.ambiguous.push({ key: l.key, variants: r.ambiguous })
    else rep.links.kept++
    // Плоская привязка к названию, у которого в старой матрице несколько строк по фасовкам: добавляем привязку на каждую
    // фасовку (закупка с этой фасовкой попадает ровно в свою строку, как раньше). Плоскую оставляем как есть.
    if (l.targetProduct && !l.pack) {
      const [rest, sup, iiko] = String(l.key).split('::')
      const hits = oldIndex.get(`${rest}::${sup}::${norm(l.targetProduct)}`) ?? []
      const byPackLabel = new Map()
      for (const h of hits) if (h.pack && h.label) byPackLabel.set(h.pack, [...(byPackLabel.get(h.pack) ?? []), h.label])
      for (const [pk, labels] of byPackLabel) {
        const uniq = [...new Set(labels)]
        const nk = `${rest}::${sup}::${iiko}::${pk}`
        if (uniq.length !== 1 || haveKeys.has(nk)) continue
        haveKeys.add(nk)
        adds.push({ key: nk, value: { targetProduct: uniq[0], supplier: l.supplier, rawProduct: l.rawProduct, pack: pk, restaurant: l.restaurant } })
      }
    }
  }
  rep.links.added = adds.length

  if (APPLY) {
    try {
      // порядок важен: сначала привязки (по ним нужен СТАРЫЙ индекс), потом матрицы, флаг — последним; при сбое повтор безопасен
      editsDb.runInTransaction(() => {
        for (const c of changes) editsDb.updateProductLinkTarget(orgId, c.key, c.target)
        for (const a of adds) editsDb.setProductLink(orgId, a.key, a.value)
      })
      for (const it of items) {
        if (it.kind === 'main') saveMatrix(orgId, it.out)
        else if (it.kind === 'snap') saveMatrixSnapshot(orgId, it.period, it.out)
        else saveMatrixTabSnapshot(orgId, it.tab, it.period, it.out)
      }
      saveSettings(orgId, { matrixKeysV2: true })
    } catch (e) {
      rep.status = `ОШИБКА при переносе: ${e?.message || e}. Флаг не поставлен. Повторите команду (она безопасна) или верните данные из копии ${backupDir}`
    }
  }
  return rep
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
function main() {
const orgs = listOrgs().filter((o) => !ONLY || o.id === ONLY)
if (APPLY) {
  // одна копия на запуск, ДО любых записей: все организации, база правок и список организаций
  backupDir = join(DATA_DIR, `_backup-keys-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(backupDir, { recursive: true })
  cpSync(join(DATA_DIR, 'orgs'), join(backupDir, 'orgs'), { recursive: true })
  for (const f of ['orgs.json', 'users.json']) if (existsSync(join(DATA_DIR, f))) cpSync(join(DATA_DIR, f), join(backupDir, f))
  editsDb.backupDbTo(join(backupDir, 'edits.db'))
  console.log(`Копия данных до переноса: ${backupDir}`)
  console.log('ВАЖНО: на время переноса никто не должен нажимать «Обновить» матрицу (лучше запускать, когда в программе никого нет).')
}
console.log(APPLY ? '=== ПЕРЕНОС (--apply) ===' : '=== ПРОБНЫЙ ПРОГОН (ничего не меняется; для переноса добавьте --apply) ===')
for (const org of orgs) {
  const r = migrateOrg(org)
  console.log(`\nОрганизация «${r.org}» (${r.id}): ${r.status}`)
  if (r.matrices) {
    console.log(`  матриц (общая + снимки + рестораны): ${r.matrices}; строк было ${r.keysBefore}, стало ${r.keysAfter}; без названия (I): ${r.noLabel}`)
    console.log(`  привязок товаров: всего ${r.links.total}, будут перенесены ${r.links.moved}, не трогаем ${r.links.kept}, неоднозначных ${r.links.ambiguous.length}, добавлено по фасовкам ${r.links.added ?? 0}`)
    if (r.collisions.length) console.log(`  СЛИЯНИЕ строк с одинаковым названием (I) у одного поставщика: ${r.collisions.length} (цены останутся вариантами):\n` + r.collisions.slice(0, 20).map((c) => `    ${c.key}  ×${c.rows}  цены: ${c.prices.join(', ')}`).join('\n'))
    if (r.links.ambiguous.length) console.log('  Неоднозначные привязки (останутся как есть — привяжите вручную в Справочниках):\n' + r.links.ambiguous.slice(0, 20).map((a) => `    ${a.key} → ${a.variants.join(' | ')}`).join('\n'))
    if (r.noLabelKeys.length) console.log(`  ВНИМАНИЕ: ${r.noLabelKeys.length} строк матрицы без названия (колонка I) — их ключ пока из E. Впишите название в I в таблице, ДО удаления колонки E, иначе строки пропадут:\n` + r.noLabelKeys.slice(0, 10).map((k) => `    ${k}`).join('\n'))
  }
}
}
