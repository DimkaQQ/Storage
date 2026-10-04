import { createHash } from 'node:crypto'
import { getSeedPeriods, getSeedPeriod } from './store.js'

const sha1 = (s) => createHash('sha1').update(s).digest('hex')

const withTimeout = async (url, opts = {}, ms = 20000) => {
  const ctrl = new AbortController()
  let timedOut = false
  const t = setTimeout(() => { timedOut = true; ctrl.abort() }, ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } catch (e) {
    // Голый "fetch failed"/AbortError ничего не говорит о причине — сервер
    // недоступен, DNS не резолвится, таймаут истёк, или реально порвалось
    // соединение. e.cause (undici) обычно несёт настоящую причину
    // (ECONNREFUSED/ENOTFOUND/UND_ERR_CONNECT_TIMEOUT и т.п.), но раньше это
    // просто отбрасывалось в catch (e) выше по стеку.
    if (timedOut) throw new Error(`Истёк тайм-аут запроса (${ms / 1000} сек) — iikoServer не ответил вовремя`)
    const cause = e?.cause?.message || e?.cause?.code
    throw new Error(cause ? `${e.message}: ${cause}` : String(e.message || e))
  } finally {
    clearTimeout(t)
  }
}

const normStoreKey = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * iikoServer группирует закупки не по ресторану, а по СКЛАДУ/подразделению
 * внутри ресторана (Store) — у одной точки их несколько: Кухня, Бар,
 * Инвентарь, Кальян, Витрина, Посуда, Хоз.товары, Упаковка, и т.д., причём
 * одно и то же слово пишется по-разному от склада к складу ("Хоз товары"/
 * "Хоз. товары"/"Хоз.товары"/"Хоз тов" — то же самое). Без склейки
 * buildDataset считал бы каждый склад отдельной "точкой" — одна Олово 2
 * превратилась бы в несколько фантомных точек вместо одной реальной со
 * всеми закупками вместе. При этом приложение считает только еду/продукты
 * (подтверждено человеком) — закупки из НЕ кухонных складов (бар, кальян,
 * инвентарь, посуда, хозтовары, упаковка, витрина) не просто откладываются
 * в сторону, а полностью исключаются из фактов (см. resolveStoreRestaurant
 * ниже и фильтр в конце iikoServerFacts).
 *
 * Перечислять каждую комбинацию "отдел + бренд" отдельной строкой не
 * тянется — отделов и вариантов написания слишком много, и они
 * продолжают всплывать. Вместо этого отрезаем с начала и с конца строки
 * распознанные слова-отделы (руками сверенные списки ниже, не
 * угадываются) и ищем middle-остаток ТОЧНЫМ совпадением в
 * BRAND_CODE_TO_RESTAURANT — тот же принцип точного сопоставления, что у
 * SHEET_TO_RESTAURANT в sheets.js, просто написание отдела вокруг кода
 * бренда не обязано совпадать по буквам. Код бренда, которого нет в
 * таблице, НЕ возвращается наугад — функция отдаёт исходную строку как
 * есть, склад просто остаётся "обнаруженным, но не показанным" в
 * Настройках iiko (туда не нажимать "Добавить" — это склад, не точка,
 * сперва узнать, какому ресторану принадлежит и кухонный ли он, и
 * дописать сюда).
 */
// "Кухня" — единственный отдел, который реально считается едой/продуктами
// (подтверждено человеком, повторно подтверждено: бар/склад/хозтовары/
// посуда "вообще не нужны", а не просто второстепенны). Поэтому правило
// строгое: включаем закупку, ТОЛЬКО если среди снятых слов-отделов есть
// явное "кухня"/"цех" (в том числе в комбинации вида "Кухня склад" — там
// "кухня" тоже будет снято). Если указан любой другой отдел без кухни
// (просто "Склад", "Бар", "Хоз товары", "Посуда" и т.п.) — исключаем:
// "склад" раньше считался нейтральным и пропускал закупку, из-за чего бар/
// склад/хозтовары/посуда всё равно утекали в датасет. Если в названии
// склада вообще нет распознанного слова-отдела — оставляем как раньше
// (не на чем основывать исключение).
// Длиннее — вперёд: иначе "посуда" срежется раньше "одноразовая посуда" и
// от неё останется бессмысленный хвост "одноразовая".
const KITCHEN_WORDS = ['кухня', 'цех']
const NON_KITCHEN_WORDS = [
  'одноразовая посуда', 'заготовочный', 'инвентарь', 'упаковка',
  'кальян', 'витрина', 'посуда', 'товары', 'товар', 'тов', 'общая', 'зал', 'хоз', 'бар', 'склад',
]
const DEPT_WORDS = [...KITCHEN_WORDS, ...NON_KITCHEN_WORDS].sort((a, b) => b.length - a.length)

const squash = (s) => s.replace(/[\s/.()]+/g, '')

const BRAND_CODE_TO_RESTAURANT = {
  'рене': 'Рене',
  'олово 2': 'Олово 2 (Достык)',
  // Голое "олово" (без "2") — раньше считалось неоднозначным (Олово 1
  // Сатпаева или общий склад), но реальный Store из отчёта iiko внутри
  // присланной клиентом таблицы ("Кухня склад Олово(Olovo1-Satpaeva)")
  // прямо называет внутренний код Olovo1-Satpaeva — это Олово 1, без
  // вариантов. Olovo 2 всегда приходит с явной "2" в названии (см. выше).
  'олово': 'Олово 1 (Сатпаева)',
  'ле дом': 'Ле Дом',
  'богенбай': 'Pasta la vista (Богенбай)',
  'гагарина': 'Pasta la vista (Гагарина)',
  'толе би': 'Pasta la vista (Толе би)',
  'акку': 'Акку',
  'сирена': 'Сирена',
  // Алматинский Tangirs — ОТДЕЛЬНАЯ точка от астанинских TNG Левый/Правый
  // (см. ниже), подтверждено внутренним кодом "Склад Кухня Танжир(TNG1)" из
  // того же отчёта. SHEET_TO_RESTAURANT в sheets.js называет её просто
  // 'Tangirs' — то же имя используем и здесь.
  'танжир': 'Tangirs',
  // Голые "Сикс"/"Six-N" были неоднозначны (Six 1/Six 2 Алматы, плюс Сикс
  // Астаны) — реальные Store из отчёта iiko развели их однозначно:
  // "Кухня Сикс(Six&Coffee1)" — кириллическое "сикс" без номера — это Six
  // 1; "Кухня/Six-3(Six&Coffee-3)" — латиницей и с цифрой "3" — это на
  // самом деле Six 2 (внутренний склад так и называется "Six-3", несмотря
  // на то что вкладка в таблице матрицы зовётся "Six 2" — видимо, из-за
  // более старой нумерации складов в самом iiko). Астанинский Сикс даёт
  // совсем другой код ("sixастана", 'six астана' выше) — не пересекается.
  'сикс': 'Six coffee&wine 1',
  'six-3': 'Six coffee&wine 2',
  // Астана — TNG Левый/Правый подтверждены человеком: Левый = Есиль
  // (Танж1 в Google-таблице матрицы), Правый = Сарыарка (Танж2) — и
  // подтверждено ещё раз кодами в реальных названиях складов из отчёта
  // iiko (TNGEC2-Astana = Есиль/Левый, TNGAT3-Astana = Сарыарка/Правый).
  'plv астана': 'Pasta la vista (Астана)',
  'six астана': 'Six coffee&wine (Астана)',
  'tng левый': 'Tangirs (Есиль, Астана)',
  'tng правый': 'Tangirs (Сарыарка, Астана)',
}
// Ключи без пробелов/разделителей — реальные Store из iiko бывают слитными
// без пробела между отделом и кодом бренда ("Кухнясклад/TNGЛевый", без
// пробела ни после "Кухня", ни внутри "TNGЛевый") — один и тот же код
// бренда должен находиться и в раздельном, и в слитном написании.
const BRAND_CODE_SQUASHED = Object.fromEntries(
  Object.entries(BRAND_CODE_TO_RESTAURANT).map(([k, v]) => [squash(k), v]),
)

// Склады известных брендов, которые сами пока не нужны приложению —
// подтверждено человеком явно (не "неизвестно", а "не нужно вообще").
// Молча исключаются, как и некухонные отделы — не просто откладываются в
// список "обнаружено, но не показано". French bar — тоже явно "не нужно
// вообще", а не просто "за пределами RESTAURANT_SCOPE" на фронте: раньше
// его закупки всё равно долетали бы до датасета (под именем 'French bar'),
// просто не показывались — теперь не долетают вовсе. Камчатка — закрыта
// (подтверждено человеком): её вкладка в таблице матрицы скрыта, как и у
// French bar, и без живого отчёта iiko внутри, в отличие от всех активных
// точек — то же самое "не нужно вообще", не просто неопознанный бренд.
const IGNORED_BRAND_CODES = new Set(['g63', 'пекатория', 'променад', squash('french 42'), squash('french bar'), 'камчатка'])

/** Снимает С ОБЕИХ концов строки распознанные слова-отделы, по одному, пока снимается — работает и когда отдел слит с кодом бренда без пробела, и когда через пробел/слэш/точку/скобки. words — какой список слов-отделов снимать (по умолчанию все, DEPT_WORDS). */
function peelDeptWords(s, words = DEPT_WORDS) {
  const found = []
  let changed = true
  while (changed && s.length > 0) {
    changed = false
    for (const w of words) {
      if (s.startsWith(w)) {
        const rest = s.slice(w.length).replace(/^[\s/.()]+/, '')
        if (rest !== s) { found.push(w); s = rest; changed = true; break }
      }
    }
  }
  changed = true
  while (changed && s.length > 0) {
    changed = false
    for (const w of words) {
      if (s.endsWith(w)) {
        const rest = s.slice(0, s.length - w.length).replace(/[\s/.()]+$/, '')
        if (rest !== s) { found.push(w); s = rest; changed = true; break }
      }
    }
  }
  return { rest: s, deptWords: found }
}

// ЦФК — частный случай: её реальный Store содержит "ЦехПроменад" слитно
// (без разделителя между "Цех" и "Променад"). При обычном снятии слов-
// отделов "Цех" (кухонное слово) снимается точно так же, как "Кухня", и
// результат неотличим от голого "Променад" — кода склада, который решили
// не включать вовсе (IGNORED_BRAND_CODES). Это РАЗНЫЕ рестораны: ЦФК —
// действующая, ценник ведётся (видно по отдельной активной вкладке в
// таблице матрицы), просто располагается по адресу/в здании "Променад".
// Проверяем этот слитный код явно, сняв только родовые слова-обёртки
// ("Кухня"/"Склад"), но НЕ "Цех" — если получили именно "ЦехПроменад", это
// точно ЦФК, а не исключённый бренд.
const WRAPPER_WORDS_ONLY = ['кухня', 'склад']
const TSFK_CODE = squash('цехпроменад')

/**
 * Возвращает название ресторана, или null — закупка, которую решили
 * полностью исключить: либо точно НЕ кухонный склад (бар/кальян/инвентарь/
 * посуда/хозтовары/упаковка/витрина/склад) — ЭТО проверяется ДО попытки
 * опознать бренд, поэтому действует и для ещё неопознанных/неоднозначных
 * названий (бренд неизвестен, но отдел уже прямо написан — "Бар Сикс",
 * "Посуда/Six-3" — не кухня, можно исключать сразу, не дожидаясь, пока
 * человек опознает, какой именно это Сикс); либо склад известного-но-
 * ненужного бренда (IGNORED_BRAND_CODES). Неизвестный бренд, если отдел
 * кухонный или вообще не указан (ещё не в BRAND_CODE_TO_RESTAURANT и не в
 * IGNORED_BRAND_CODES), проходит как сырое имя склада — решать, чей это
 * ресторан, пока нечем, пусть будет видно в "обнаружено, но не показано",
 * а не тихо потеряется.
 */
function resolveStoreRestaurant(storeRaw) {
  const normalized = normStoreKey(storeRaw)
  // Хвостовую скобку отбрасываем из основной строки перед разбором —
  // встречается два вида содержимого: либо код склада ("Кухнясклад/
  // TNGЛевый(TNGEC2-Astana)" — код ничего не говорит ни про бренд, ни про
  // отдел, только путает squash()), либо слова-отделы ("Танжирс (Склад
  // Кальян)"). Отличаем так: если содержимое скобки само целиком
  // раскладывается на слова-отделы — это второй случай, учитываем их;
  // иначе это код, просто отбрасываем как раньше.
  const parenMatch = normalized.match(/\(([^)]*)\)\s*$/)
  const key = normalized.replace(/\([^)]*\)\s*$/, '').trim()
  // Проверка на ЦФК — раньше обычного снятия слов-отделов, иначе "Цех"
  // снимется как кухонное слово и останется голый "Променад" (см. комментарий
  // у TSFK_CODE выше).
  if (squash(peelDeptWords(key, WRAPPER_WORDS_ONLY).rest) === TSFK_CODE) return 'ЦФК'
  let parenDeptWords = []
  if (parenMatch) {
    const { rest: parenRest, deptWords: innerWords } = peelDeptWords(parenMatch[1].trim())
    if (parenRest === '') parenDeptWords = innerWords
  }
  const { rest, deptWords: keyDeptWords } = peelDeptWords(key)
  const deptWords = [...keyDeptWords, ...parenDeptWords]
  const hasKitchen = deptWords.some((w) => KITCHEN_WORDS.includes(w))
  if (deptWords.length > 0 && !hasKitchen) return null // указан какой-то отдел (бар/склад/хозтовары/посуда/...) без кухни — исключить, бренд не важен
  const code = squash(rest)
  if (IGNORED_BRAND_CODES.has(code)) return null
  const restaurant = BRAND_CODE_SQUASHED[code]
  if (!restaurant) return storeRaw // неизвестный бренд, но отдел кухонный или не указан — сырое имя как раньше, для ручного опознания
  return restaurant
}

/* ------------------------------------------------------------------ *
 * Providers return a flat list of purchase facts:
 *   { restaurant, supplier, product, pack, qty, sum }
 * ------------------------------------------------------------------ */

/** Demo provider — returns the bundled snapshot for one period, so the whole loop works without iiko. */
function mockFacts(period) {
  const seed = getSeedPeriod(period) ?? getSeedPeriods().at(-1) ?? { restaurants: [] }
  const facts = []
  for (const r of seed.restaurants || [])
    for (const it of r.items || [])
      facts.push({ restaurant: r.name, supplier: it.s, product: it.p, pack: it.k, qty: it.q, sum: it.m, comment: it.c })
  return facts
}

/* --- iikoOffice / RMS (resto API) --- */
async function iikoServerAuth({ serverUrl, login, password }) {
  const base = serverUrl.replace(/\/+$/, '')
  const res = await withTimeout(`${base}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${sha1(password)}`)
  if (!res.ok) throw new Error(`Авторизация iikoServer не удалась (HTTP ${res.status})`)
  const token = (await res.text()).trim()
  if (!token || token.length < 8) throw new Error('iikoServer вернул пустой токен — проверьте логин/пароль')
  return { base, token }
}
async function iikoServerLogout(base, token) {
  try { await withTimeout(`${base}/resto/api/logout?key=${token}`) } catch { /* ignore */ }
}

/**
 * Спрашивает у самого iikoServer, какие поля реально доступны для этого
 * типа отчёта — вместо того чтобы гадать по одному полю за раз через
 * "Unknown OLAP field". Дёргается и напрямую (кнопка «Показать доступные
 * поля отчёта» в Настройках iiko), и как подсказка внутри iikoServerFacts,
 * если запрос отчёта упал именно с этой ошибкой.
 */
export async function fetchOlapColumns(settings, reportType = 'TRANSACTIONS') {
  const { base, token } = await iikoServerAuth(settings)
  try {
    const res = await withTimeout(`${base}/resto/api/v2/reports/olap/columns?key=${token}&reportType=${encodeURIComponent(reportType)}`)
    if (!res.ok) throw new Error(`Список полей недоступен (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`)
    return await res.json()
  } finally {
    await iikoServerLogout(base, token)
  }
}

/**
 * Pulls the supply/purchase report via the OLAP endpoint.
 * NOTE: точный набор полей отчёта уточняется на реальном сервере —
 * маппинг колонок вынесен в один блок ниже.
 */
async function iikoServerFacts(settings, period) {
  const { base, token } = await iikoServerAuth(settings)
  try {
    const { from, to } = periodRange(period)
    const body = {
      reportType: 'TRANSACTIONS',
      buildSummary: false,
      // "Supplier.Name" не существует как поле OLAP (сервер прямо ответил
      // "Unknown OLAP field 'Supplier.Name'") — контрагент по приходной
      // накладной в iikoServer называется Counteragent, не Supplier.
      // TransactionType добавлен временно, для диагностики — почему в
      // отчёте появляются позиции (и неверные суммы по существующим), которых
      // нет в ручном "Отчёте о закупках по складам" самого iiko, хотя фильтр
      // TransactionType=IncludeValues(['INVOICE']) ниже как будто должен
      // пускать только приходные накладные. Значение попадает в comment
      // каждого факта (см. ниже) — видно прямо в "Заметке" в Проверке цен,
      // без отдельного похода в JSON. Убрать после того, как разберёмся.
      groupByRowFields: ['Store', 'Product.Name', 'Counteragent.Name', 'Product.MeasureUnit', 'TransactionType'],
      aggregateFields: ['Amount', 'Sum.Incoming'],
      filters: {
        // Голый "DateTime" сервер отклоняет (HTTP 409): "не найден ни один
        // из необходимых фильтров: Учетный день (DateTime.DateTyped), Дата
        // и время (DateTime.Typed)" — та же история, что раньше была с
        // Supplier.Name/Counteragent.Name, только теперь про фильтр, не
        // группировку. DateTyped — фильтр по дню (без времени), что и
        // нужно для месячного диапазона from/to.
        'DateTime.DateTyped': { filterType: 'DateRange', periodType: 'CUSTOM', from, to },
        TransactionType: { filterType: 'IncludeValues', values: ['INVOICE'] },
      },
    }
    // Таймаут больше дефолтного — за целый прошлый месяц (а не текущий,
    // который на момент синка обычно наполовину пустой) iikoServer агрегирует
    // заметно больше строк и может отвечать на OLAP-отчёт дольше 20 секунд.
    const res = await withTimeout(`${base}/resto/api/v2/reports/olap?key=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, 60000)
    if (!res.ok) {
      // iikoServer обычно объясняет ПОЧЕМУ отклонил тело запроса (неверное
      // поле в groupByRowFields/aggregateFields/filters для этой версии) —
      // раньше это отбрасывалось, оставался только код ответа, разобраться
      // было нечем.
      const errBody = await res.text()
      // Если снова "неизвестное поле" — сразу тащим у сервера реальный
      // список полей для TRANSACTIONS, чтобы не гадать по одному полю за
      // раз (сервер сам знает, что у него есть).
      let columnsHint = ''
      if (res.status === 400 && /Unknown OLAP field/i.test(errBody)) {
        try {
          const colsRes = await withTimeout(`${base}/resto/api/v2/reports/olap/columns?key=${token}&reportType=TRANSACTIONS`)
          if (colsRes.ok) columnsHint = ` | доступные поля: ${(await colsRes.text()).slice(0, 1500)}`
        } catch { /* необязательная подсказка — если сама не получится, не мешаем основной ошибке */ }
      }
      throw new Error(`Отчёт iikoServer недоступен (HTTP ${res.status}): ${errBody.slice(0, 500)}${columnsHint}`)
    }
    const data = await res.json()
    // --- маппинг колонок отчёта -> факты ---
    // Forward-fill защищает от пустых Товар/Поставщик в сгруппированных
    // строках отчёта — та же проблема, что клиент решает в своих формулах
    // через IF(R="",Y_prev,R). OLAP обычно отдаёт заполненные строки, но
    // это дёшево и не помешает на реальных выгрузках.
    let lastProduct = '', lastSupplier = ''
    const rawRows = data.data || []
    const mapped = rawRows.map((row) => {
      const product = row['Product.Name'] || lastProduct
      const supplier = row['Counteragent.Name'] || lastSupplier
      lastProduct = product
      lastSupplier = supplier
      return {
        restaurant: resolveStoreRestaurant(row['Store']),
        supplier,
        product,
        pack: row['Product.MeasureUnit'] || '',
        qty: Number(row['Amount']) || 0,
        sum: Number(row['Sum.Incoming']) || 0,
        // Временно — см. комментарий у groupByRowFields выше.
        comment: `[диагностика] TransactionType: ${row['TransactionType']}`,
      }
      // restaurant === null — известный бренд, но точно не кухонный склад
      // (бар/кальян/инвентарь/посуда/хозтовары/упаковка/витрина) — такую
      // закупку отбрасываем целиком, в приложении считаем только еду.
    })
    // Диагностика прямо в статусе синка — без нужды гадать или дёргать
    // отдельную кнопку: сколько строк реально вернул iikoServer на этот
    // запрос (до любой нашей фильтрации), и сколько отсеялось и почему. Если
    // rawCount сам по себе маленький (намного меньше, чем видно глазами в
    // реальном отчёте iiko за тот же период) — значит, теряем уже на самом
    // OLAP-запросе (не тот TransactionType/дата/лимит ответа), а не в нашей
    // логике ниже.
    const droppedNoData = mapped.filter((f) => !(f.product && f.qty > 0)).length
    const droppedDept = mapped.filter((f) => f.product && f.qty > 0 && f.restaurant === null).length
    const facts = mapped.filter((f) => f.product && f.qty > 0 && f.restaurant !== null)
    facts.fetchStats = { rawCount: rawRows.length, droppedNoData, droppedDept, kept: facts.length }
    return facts
  } finally {
    await iikoServerLogout(base, token)
  }
}

/* --- iikoCloud (api-ru.iiko.services) --- */
async function iikoCloudToken({ apiLogin }) {
  const res = await withTimeout('https://api-ru.iiko.services/api/1/access_token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiLogin }),
  })
  if (!res.ok) throw new Error(`iikoCloud: не удалось получить токен (HTTP ${res.status})`)
  const { token } = await res.json()
  if (!token) throw new Error('iikoCloud: пустой токен — проверьте apiLogin')
  return token
}

/* ------------------------------------------------------------------ */

export async function fetchFacts(settings, period) {
  switch (settings.provider) {
    case 'mock': return mockFacts(period)
    case 'iikoserver': return iikoServerFacts(settings, period)
    case 'iikocloud':
      // Отчёты о закупках по складам берутся из iikoServer; iikoCloud (transport)
      // ориентирован на доставку и не отдаёт складские приходы.
      await iikoCloudToken(settings)
      throw new Error('iikoCloud подключён, но отчёт о закупках доступен только через iikoServer. Укажите доступ к серверу iiko.')
    default: throw new Error(`Неизвестный провайдер: ${settings.provider}`)
  }
}

export async function testConnection(settings) {
  try {
    if (settings.provider === 'mock') return { ok: true, message: 'Демо-режим: данные из встроенного набора.' }
    if (settings.provider === 'iikoserver') {
      const { base, token } = await iikoServerAuth(settings)
      await iikoServerLogout(base, token)
      return { ok: true, message: 'Подключение к iikoServer успешно.' }
    }
    if (settings.provider === 'iikocloud') {
      await iikoCloudToken(settings)
      return { ok: true, message: 'Токен iikoCloud получен. Для отчёта о закупках нужен iikoServer.' }
    }
    return { ok: false, message: 'Неизвестный провайдер.' }
  } catch (e) {
    return { ok: false, message: String(e.message || e) }
  }
}

/**
 * period — тот же резолвленный ключ "YYYY-MM", что и everywhere else
 * (resolveLivePeriod в dataset.js, mockFacts выше), а не сырое значение
 * settings.period ('current-month'/'prev-month'). Раньше сюда передавали
 * именно сырое settings.period — работало только потому, что периодов
 * ровно два ('current-month'/иначе), и разбор совпадал по смыслу; но
 * аргумент period, который реально приходит в fetchFacts извне (тот же
 * резолвленный ключ, что уходит в saveDataset), при этом тихо игнорировался.
 */
function periodRange(period) {
  const [y, m] = period.split('-').map(Number)
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const from = new Date(y, m - 1, 1)
  const to = new Date(y, m, 0) // последний день месяца
  return { from: fmt(from), to: fmt(to) }
}
