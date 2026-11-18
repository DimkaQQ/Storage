import { iikoProbeKit } from './iiko.js'

/**
 * «Проверить, что можно тянуть из iiko» (Обновление → Данные из iiko → тестовая кнопка).
 * ТОЛЬКО ЧТЕНИЕ: GET-запросы к справочникам/выгрузкам и OLAP-запросы на чтение. Ничего не создаёт и не меняет в iiko.
 * Результат — длинный текстовый отчёт: что ответил сервер, какие отчёты и поля есть, примеры строк, форматы дат, ошибки.
 * Токен доступа в отчёт не попадает (в адресах маскируется).
 */
const MAX_SAMPLE = 1800
const pad = (n) => String(n).padStart(2, '0')
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d }
const mask = (s) => String(s).replace(/key=[^&\s"]+/g, 'key=***')
const cut = (s, n = MAX_SAMPLE) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + `… [ещё ${t.length - n} символов]` : t }
const WORDS = /weight|вес|unit|капас|capacity|container|тара|фасов|measure|price|цен|cost|себест|date|день|day|document|doc|invoice|накладн|amount|sum|количеств|сумм/i

export async function runIikoProbe(settings, onProgress = () => {}) {
  const out = []
  const summary = []
  let token = ''
  const clean = (x) => mask(token ? String(x).split(token).join('***') : String(x)) // ни токен, ни key=… в отчёт не попадают
  const P = (...l) => out.push(...l.map(clean))
  const deadline = Date.now() + 15 * 60 * 1000 // общий предел времени проверки
  const H = (t) => P('', '='.repeat(100), t, '='.repeat(100))
  const auth = await iikoProbeKit.auth(settings)
  const base = auth.base
  token = auth.token
  const t0 = Date.now()
  const host = (() => { try { return new URL(base).host } catch { return base } })()
  P('ПРОВЕРКА ВОЗМОЖНОСТЕЙ IIKO (только чтение)', `Сформировано: ${new Date().toISOString()}`, `Сервер: ${host}`, `Провайдер: ${settings.provider}`,
    'Токен доступа в отчёт не попадает. Ничего в iiko не создавалось и не менялось.')

  /** один запрос: пишет заголовок, статус, время и образец ответа; возвращает {ok,status,text,json} */
  const call = async (title, path, { method = 'GET', body, ms = 45000, sample = true, note } = {}) => {
    onProgress(title)
    if (Date.now() > deadline) { P('', `--- ${title}`, '    ПРОПУЩЕНО: превышено общее время проверки (15 минут)'); summary.push([title, 'пропущено', 0]); return { ok: false, status: 0, text: '', json: null } }
    const url = `${base}${path}${path.includes('?') ? '&' : '?'}key=${token}`
    const t = Date.now()
    P('', `--- ${title}`, `    ${method} ${mask(base + path)}`)
    if (note) P(`    (${note})`)
    if (body) P(`    тело: ${cut(JSON.stringify(body), 700)}`)
    try {
      const res = await iikoProbeKit.fetchT(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }, ms)
      const text = await res.text()
      const dt = Date.now() - t
      let json = null
      try { json = JSON.parse(text) } catch { /* не JSON */ }
      P(`    ответ: HTTP ${res.status}, ${dt} мс, ${text.length} символов`)
      if (sample && text) P(...cut(text).split('\n').map((l) => '    | ' + l))
      summary.push([title, res.ok ? 'ОК' : `HTTP ${res.status}`, dt])
      return { ok: res.ok, status: res.status, text, json }
    } catch (e) {
      P(`    ОШИБКА: ${String(e.message || e)}`)
      summary.push([title, 'ошибка', Date.now() - t])
      return { ok: false, status: 0, text: '', json: null }
    }
  }
  const olap = (title, reportType, groupBy, aggregate, filters, ms = 90000, rowsToShow = 6) => call(title, '/resto/api/v2/reports/olap', {
    method: 'POST', ms, sample: false,
    body: { reportType, buildSummary: false, groupByRowFields: groupBy, aggregateFields: aggregate, filters },
  }).then((r) => {
    if (r.json?.data) {
      P(`    строк в ответе: ${r.json.data.length}`, '    первые строки:')
      for (const row of r.json.data.slice(0, rowsToShow)) P('    | ' + cut(JSON.stringify(row), 400))
    } else if (r.text) P(...cut(r.text, 900).split('\n').map((l) => '    | ' + l))
    return r
  })
  const range = { from: isoDay(addDays(-7)), to: isoDay(addDays(-1)) }
  const dateFilter = { 'DateTime.DateTyped': { filterType: 'DateRange', periodType: 'CUSTOM', ...range } }
  const colsOf = (j) => (Array.isArray(j) ? j.map((c) => (typeof c === 'string' ? { name: c } : c)) : j && typeof j === 'object' ? Object.entries(j).map(([k, v]) => ({ ...(typeof v === 'object' ? v : {}), name: k, label: typeof v === 'object' ? v.name : undefined })) : [])

  try {
    H('1. СЕРВЕР, ВЕРСИЯ, СПРАВОЧНИКИ')
    await call('Версия сервера', '/resto/api/version')
    await call('Подразделения (departments)', '/resto/api/corporation/departments')
    const stores = await call('Склады (stores)', '/resto/api/corporation/stores', { sample: false })
    P(`    складов: ${(stores.text.match(/<corporateItemDto>/g) || []).length}`, '    названия: ' + cut([...stores.text.matchAll(/<name>([^<]*)<\/name>/g)].map((m) => m[1]).join(' | '), 2500))
    const sup = await call('Поставщики (suppliers)', '/resto/api/suppliers', { sample: false })
    P(`    поставщиков: ${(sup.text.match(/<employee>/g) || []).length}`, '    первые: ' + cut([...sup.text.matchAll(/<name>([^<]*)<\/name>/g)].slice(0, 25).map((m) => m[1]).join(' | '), 1500))
    const prod = await call('Номенклатура (products, XML)', '/resto/api/products?includeDeleted=false', { sample: false, ms: 90000 })
    P(`    товаров (productDto): ${(prod.text.match(/<productDto>/g) || []).length}`)
    const firstDto = /<productDto>[\s\S]*?<\/productDto>/.exec(prod.text)?.[0]
    if (firstDto) P('    первый товар целиком (видно, какие поля есть — вес, единицы, фасовки):', ...cut(firstDto, 2500).split('\n').map((l) => '    | ' + l))
    const tags = new Set([...prod.text.slice(0, 400000).matchAll(/<([A-Za-z]+)>/g)].map((m) => m[1]))
    P('    все теги в карточках товаров: ' + [...tags].join(', '))
    // распределение единиц и примеры карточек с фасовками (для цены за кг у штучных товаров)
    {
      const dtos = prod.text.match(/<productDto>[\s\S]*?<\/productDto>/g) || []
      const byUnit = {}
      for (const d of dtos) { const u = /<mainUnit>([^<]*)<\/mainUnit>/.exec(d)?.[1] ?? '(нет)'; byUnit[u] = (byUnit[u] || 0) + 1 }
      P('    товаров по основной единице: ' + Object.entries(byUnit).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([u, n]) => `${u}: ${n}`).join(', '))
      const withCont = dtos.filter((d) => /<container>/.test(d) && !/<productType>(MODIFIER|DISH)<\/productType>/.test(d))
      P(`    товаров (кроме блюд/модификаторов) с фасовками: ${withCont.length}`)
      const hasWeight = (d) => [...d.matchAll(/<(?:containerWeight|fullContainerWeight|minContainerWeight|maxContainerWeight)>([^<]*)</g)].some((m) => parseFloat(String(m[1]).replace(',', '.')) > 0)
      const weightFilled = withCont.filter(hasWeight)
      P(`    из них с заполненным весом фасовки: ${weightFilled.length}`)
      P('    примеры карточек с фасовками и весом:')
      for (const d of weightFilled.slice(0, 6)) P(...cut(d, 1300).split('\n').map((l) => '    | ' + l))
      const pick = (re) => withCont.filter((d) => re.test(/<name>([^<]*)<\/name>/.exec(d)?.[1] ?? '')).slice(0, 3)
      for (const [label, re] of [['колбас', /колбас/i], ['сливки', /сливк/i], ['филе', /филе/i], ['пюре', /пюре/i]]) {
        const hit = pick(re)
        if (hit.length) { P(`    карточки «${label}» с фасовками:`); for (const d of hit) P(...cut(d, 1100).split('\n').map((l) => '    | ' + l)) }
      }
    }
    const pl = await call('Номенклатура v2 (entities/products/list, JSON)', '/resto/api/v2/entities/products/list?includeDeleted=false', { sample: false, ms: 90000 })
    if (Array.isArray(pl.json)) {
      P(`    товаров: ${pl.json.length}`)
      const keys = [...new Set(pl.json.slice(0, 200).flatMap((x) => Object.keys(x)))]
      P('    поля карточки: ' + keys.join(', '))
      const wk = keys.filter((k) => /weight|capacity|unit|container|measure/i.test(k))
      P('    поля про вес/единицы: ' + (wk.join(', ') || 'нет'))
      for (const k of wk) {
        const filled = pl.json.filter((x) => x[k] != null && x[k] !== '' && x[k] !== 0).length
        P(`      ${k}: заполнено у ${filled} из ${pl.json.length}; примеры: ${cut(JSON.stringify(pl.json.filter((x) => x[k] != null && x[k] !== 0).slice(0, 4).map((x) => ({ name: x.name, [k]: x[k] }))), 500)}`)
      }
      P('    пример карточки: ' + cut(JSON.stringify(pl.json.find((x) => x.unitWeight || x.containers?.length) ?? pl.json[0]), 1500))
    } else if (pl.text) P(...cut(pl.text, 800).split('\n').map((l) => '    | ' + l))
    await call('Единицы измерения (entities/list MeasureUnit)', '/resto/api/v2/entities/list?rootType=MeasureUnit')
    await call('Категории товаров (entities/list ProductCategory)', '/resto/api/v2/entities/list?rootType=ProductCategory')

    H('2. OLAP-ОТЧЁТЫ: КАКИЕ ТИПЫ И ПОЛЯ ЕСТЬ')
    const colsByType = {}
    for (const type of ['TRANSACTIONS', 'SALES', 'DELIVERIES']) {
      const r = await call(`Поля OLAP «${type}»`, `/resto/api/v2/reports/olap/columns?reportType=${type}`, { sample: false })
      const cols = colsOf(r.json)
      colsByType[type] = cols
      P(`    полей: ${cols.length}`)
      for (const c of cols) {
        const flags = [c.groupingAllowed ? 'группировка' : '', c.aggregationAllowed ? 'сумма' : '', c.filteringAllowed ? 'фильтр' : ''].filter(Boolean).join('/')
        P(`    · ${c.name}${c.label && c.label !== c.name ? ` «${c.label}»` : ''}${c.type ? ` (${c.type})` : ''}${flags ? ` — ${flags}` : ''}${WORDS.test(c.name + (c.label || '')) ? '  ◄ интересно' : ''}`)
      }
    }
    await call('Готовые OLAP-отчёты (presets), если есть', '/resto/api/v2/reports/olap/presets')

    H(`3. ПРИМЕРЫ OLAP-ЗАПРОСОВ ЗА ${range.from} … ${range.to}`)
    const inv = { ...dateFilter, TransactionType: { filterType: 'IncludeValues', values: ['INVOICE'] } }
    await olap('Закупки по накладным: склад × товар × поставщик × единица', 'TRANSACTIONS', ['Store', 'Product.Name', 'Counteragent.Name', 'Product.MeasureUnit'], ['Amount', 'Sum.Incoming'], inv)
    await olap('То же с датой (учётный день) в группировке — формат даты', 'TRANSACTIONS', ['Store', 'Product.Name', 'Counteragent.Name', 'Product.MeasureUnit', 'DateTime.DateTyped'], ['Amount', 'Sum.Incoming'], inv)
    await olap('Типы операций (TransactionType) за период', 'TRANSACTIONS', ['TransactionType'], ['Amount', 'Sum.Incoming'], dateFilter, 60000, 30)
    const tcols = (colsByType.TRANSACTIONS || []).filter((c) => c.groupingAllowed && /weight|capacity|unit|container|measure|price|cost/i.test(c.name) && c.name !== 'Product.MeasureUnit').slice(0, 8)
    for (const c of tcols) await olap(`Поле «${c.name}»: значения рядом с товаром`, 'TRANSACTIONS', ['Product.Name', c.name], ['Amount', 'Sum.Incoming'], inv, 60000, 6)
    const acols = (colsByType.TRANSACTIONS || []).filter((c) => c.aggregationAllowed && /price|cost|weight|capacity|incoming|outgoing/i.test(c.name) && !['Amount', 'Sum.Incoming'].includes(c.name)).slice(0, 8)
    for (const c of acols) await olap(`Показатель «${c.name}» по товарам`, 'TRANSACTIONS', ['Product.Name'], ['Amount', c.name], inv, 60000, 5)
    await olap('Продажи (SALES): блюдо × количество × сумма', 'SALES', ['DishName'], ['DishAmountInt', 'DishSumInt'], { 'OpenDate.Typed': { filterType: 'DateRange', periodType: 'CUSTOM', ...range } }, 60000)
    await olap('Расход товаров (TRANSACTIONS, списание/расход)', 'TRANSACTIONS', ['Product.Name', 'TransactionType'], ['Amount', 'Sum.Outgoing'], dateFilter, 60000)

    H('4. ВЫГРУЗКИ ДОКУМЕНТОВ (накладные)')
    const d3 = { from: isoDay(addDays(-3)), to: isoDay(addDays(-1)) }
    const inc = await call(`Приходные накладные ${d3.from} … ${d3.to}`, `/resto/api/documents/export/incomingInvoice?from=${d3.from}&to=${d3.to}`, { sample: false, ms: 90000 })
    const docs = inc.text.match(/<document>[\s\S]*?<\/document>/g) || []
    P(`    накладных: ${docs.length}`, `    статусы: ${JSON.stringify(docs.reduce((a, d) => { const s = /<status>([^<]*)<\/status>/.exec(d)?.[1] ?? '(нет)'; a[s] = (a[s] || 0) + 1; return a }, {}))}`)
    for (const d of docs.slice(0, 2)) {
      const head = d.replace(/<items>[\s\S]*<\/items>/, '<items>…</items>')
      P('    шапка накладной:', ...cut(head, 1200).split('\n').map((l) => '    | ' + l))
      const item = /<item>[\s\S]*?<\/item>/.exec(d)?.[0]
      if (item) P('    первая строка:', ...cut(item, 1200).split('\n').map((l) => '    | ' + l))
    }
    await call(`Расходные накладные ${d3.from} … ${d3.to}`, `/resto/api/documents/export/outgoingInvoice?from=${d3.from}&to=${d3.to}`, { ms: 60000 })
    await call('Остатки на складах (v2 reports/balance/stores)', `/resto/api/v2/reports/balance/stores?timestamp=${isoDay(addDays(-1))}T23:59:59`, { ms: 60000 })
    const firstSup = /<code>([^<]+)<\/code>/.exec(sup.text)?.[1]
    if (firstSup) await call(`Прайс-лист поставщика (код ${firstSup})`, `/resto/api/suppliers/${encodeURIComponent(firstSup)}/pricelist`)

    H('5. ИТОГ: ЧТО ОТВЕТИЛО')
    for (const [t, s, ms] of summary) P(`${s.padEnd(10)} ${String(ms).padStart(6)} мс  ${t}`)
    P('', `Всего запросов: ${summary.length}, время: ${Math.round((Date.now() - t0) / 1000)} с`)
  } finally {
    await iikoProbeKit.logout(base, token)
  }
  return out.join('\n')
}
