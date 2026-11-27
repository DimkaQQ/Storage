// Возвращает цвета, заметки и выбор варианта строк «Проверки цен» после повторной загрузки закупок из iiko.
// Почему слетают: ключ строки (rowKey) = период::ресторан::поставщик::товар::фасовка::КОЛ-ВО::СУММА. Если месяц загрузили заново,
// а в iiko тем временем поправили накладные, кол-во/сумма у позиции стали другими — ключ другой, и цвет «висит» на старом ключе.
// Скрипт находит такие «потерянные» отметки и переносит их на ту же позицию (период + ресторан + поставщик + товар + фасовка)
// в текущей загрузке, если она там ровно одна и у неё ещё нет своей отметки. Ничего не удаляет.
//   Пробный прогон (ничего не меняет):  docker exec -i pricecheck-prod-api node - < tools/remap-row-marks.mjs
//   Применить (сначала копия edits.db):  docker exec -i pricecheck-prod-api node - --apply < tools/remap-row-marks.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const APPLY = process.argv.includes('--apply')
const DATA = process.env.DATA_DIR || '/app/data'
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const normPack = (s) => norm(s).replace(/(?<=\d),(?=\d)/g, '.').replace(/\.$/, '')
// так же, как buildRowKey в src/lib/data.ts
const keyOf = (period, r, it) => [period, norm(r), norm(it.s), norm(it.p), normPack(it.k), it.q, it.m].join('::')
const baseOf = (key) => key.split('::').slice(0, 5).join('::')

const db = new DatabaseSync(join(DATA, 'edits.db'))
const TABLES = [['row_colors', 'цвет'], ['row_comments', 'заметка'], ['ambiguous_choices', 'выбор варианта']]
if (APPLY) {
  const bak = join(DATA, `edits-before-remap-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`)
  console.log('Копия базы правок:', bak)
}
const datasets = new Map() // org/period -> { keys:Set, byBase:Map }
const load = (org, period) => {
  const id = `${org}/${period}`
  if (datasets.has(id)) return datasets.get(id)
  const f = join(DATA, 'orgs', org, `dataset-${period}.json`)
  let v = null
  if (existsSync(f)) {
    const d = JSON.parse(readFileSync(f, 'utf8')); const keys = new Set(), byBase = new Map()
    for (const r of d.restaurants || []) for (const it of r.items || []) {
      if (!(it.m > 0) || !(it.q > 0)) continue
      const k = keyOf(period, r.name, it); keys.add(k)
      const b = baseOf(k); byBase.set(b, [...(byBase.get(b) || []), k])
    }
    v = { keys, byBase }
  }
  datasets.set(id, v); return v
}
let moved = 0, lost = 0
const lostBy = new Map()
for (const [table, what] of TABLES) {
  const rows = db.prepare(`SELECT org_id, key FROM ${table}`).all()
  const has = new Set(rows.map((r) => `${r.org_id}\u0001${r.key}`))
  for (const { org_id: org, key } of rows) {
    if (key.startsWith('np::')) continue // «Не закупали» — ключ по матрице, от загрузки не зависит
    const period = key.split('::')[0]
    const ds = load(org, period)
    if (!ds || ds.keys.has(key)) continue // загрузки нет или ключ и так живой
    const cand = ds.byBase.get(baseOf(key)) || []
    if (cand.length === 1 && !has.has(`${org}\u0001${cand[0]}`)) {
      moved++
      console.log(`  ${what}: ${key.split('::').slice(0, 4).join(' · ')} — было ${key.split('::').slice(5).join(' / ')}, стало ${cand[0].split('::').slice(5).join(' / ')}`)
      if (APPLY) db.prepare(`UPDATE ${table} SET key=? WHERE org_id=? AND key=?`).run(cand[0], org, key)
      has.add(`${org}\u0001${cand[0]}`)
    } else {
      lost++
      const g = `${period} · ${key.split('::')[1]}`; lostBy.set(g, (lostBy.get(g) || 0) + 1)
    }
  }
}
console.log(`\n${APPLY ? 'Перенесено' : 'Будет перенесено'}: ${moved}. Не найдено позиции (закупки больше нет или неоднозначно): ${lost}`)
for (const [g, n] of [...lostBy].sort()) console.log(`  не найдено — ${g}: ${n}`)
if (!APPLY && moved) console.log('\nЧтобы применить: тот же запуск с --apply')
