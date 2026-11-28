// Сравнение двух загрузок закупок из iiko (две «версии» одного периода): что изменилось по ресторанам.
// Запуск на сервере (из папки копии клиента), без установки чего-либо:
//   docker exec -i pricecheck-prod-api node - 2026-10 "2026-10-01..2026-10-31" Six Tangirs Сирена < tools/compare-datasets.mjs
// Оба периода должны быть сохранены на диске (файлы dataset-<период>.json); ORG=<начало id организации> ограничивает одной организацией.
// Аргументы: <старый период> <новый период> [части названий ресторанов…]. Периоды — как в именах файлов dataset-<период>.json.
// Только читает файлы данных, ничего не меняет.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [A, B, ...only] = process.argv.slice(2)
if (!A || !B) { console.error('Нужно два периода: старый и новый'); process.exit(1) }
const DATA = process.env.DATA_DIR || '/app/data'
if (!existsSync(join(DATA, 'orgs'))) { console.error(`Нет папки ${join(DATA, 'orgs')} — проверьте DATA_DIR`); process.exit(1) }
const orgs = readdirSync(join(DATA, 'orgs')).filter((o) => !process.env.ORG || o.startsWith(process.env.ORG))  // ORG=<начало id организации> — только одна
const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')
const draft = (s) => String(s).toLowerCase().includes('черновик')
const key = (it) => `${String(it.s).trim()}||${String(it.p).trim()}||${String(it.k ?? '').trim()}`

for (const org of orgs) {
  const fa = join(DATA, 'orgs', org, `dataset-${A}.json`), fb = join(DATA, 'orgs', org, `dataset-${B}.json`)
  if (!existsSync(fa) || !existsSync(fb)) { console.log(`Организация ${org.slice(0, 8)}: нет файла ${existsSync(fa) ? B : A} (есть: ${readdirSync(join(DATA, 'orgs', org)).filter((f) => f.startsWith('dataset-')).join(', ')})`); continue }
  const da = JSON.parse(readFileSync(fa, 'utf8')), db = JSON.parse(readFileSync(fb, 'utf8'))
  const byName = (d) => new Map((d.restaurants || []).map((r) => [r.name, r]))
  const ma = byName(da), mb = byName(db)
  const names = [...new Set([...ma.keys(), ...mb.keys()])].filter((n) => !only.length || only.some((o) => n.toLowerCase().includes(o.toLowerCase()))).sort()
  if (!names.length) console.log(`Нет ресторанов по фильтру. Есть: ${[...new Set([...ma.keys(), ...mb.keys()])].join('; ')}`)
  console.log(`\n=== Старая загрузка: ${A}   Новая: ${B} ===`)
  for (const n of names) {
    const agg = (r) => { const m = new Map(); for (const it of r?.items ?? []) { if (!(it.q > 0)) continue; const k = key(it); const c = m.get(k) ?? { s: it.s, p: it.p, k: it.k, q: 0, m: 0 }; c.q += it.q; c.m += it.m; m.set(k, c) } return m }
    const xa = agg(ma.get(n)), xb = agg(mb.get(n))
    const sum = (m, f = () => true) => [...m.values()].filter(f).reduce((a, c) => a + c.m, 0)
    const cnt = (m, f = () => true) => [...m.values()].filter(f).length
    const onlyA = [...xa].filter(([k]) => !xb.has(k)), onlyB = [...xb].filter(([k]) => !xa.has(k))
    const changed = [...xa].filter(([k, a]) => xb.has(k) && (Math.abs(a.q - xb.get(k).q) > 1e-9 || Math.abs(a.m - xb.get(k).m) > 0.5))
    console.log(`\n— ${n}`)
    console.log(`  всего: было ${fmt(sum(xa))} ₸ (${cnt(xa)} строк) → стало ${fmt(sum(xb))} ₸ (${cnt(xb)} строк), разница ${fmt(sum(xb) - sum(xa))} ₸`)
    console.log(`  «черновые» поставщики: было ${fmt(sum(xa, (c) => draft(c.s)))} ₸ (${cnt(xa, (c) => draft(c.s))} строк) → стало ${fmt(sum(xb, (c) => draft(c.s)))} ₸ (${cnt(xb, (c) => draft(c.s))} строк)`)
    console.log(`  строк только в старой: ${onlyA.length} на ${fmt(onlyA.reduce((a, [, c]) => a + c.m, 0))} ₸; только в новой: ${onlyB.length} на ${fmt(onlyB.reduce((a, [, c]) => a + c.m, 0))} ₸; изменились количество/сумма: ${changed.length}`)
    const diffs = [
      ...onlyA.map(([, c]) => ({ t: 'есть только в старой', c, d: -c.m })),
      ...onlyB.map(([, c]) => ({ t: 'есть только в новой', c, d: c.m })),
      ...changed.map(([k, a]) => ({ t: `изменилось (было ${a.q} / ${fmt(a.m)} ₸, стало ${xb.get(k).q} / ${fmt(xb.get(k).m)} ₸)`, c: a, d: xb.get(k).m - a.m })),
    ].sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 8)
    for (const x of diffs) console.log(`    ${x.d >= 0 ? '+' : '−'}${fmt(Math.abs(x.d))} ₸  ${x.c.p.trim()} — ${String(x.c.s).trim()} [${x.c.k ?? ''}] — ${x.t}`)
  }
}
