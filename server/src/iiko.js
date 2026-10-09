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
// Та же нормализация, что и в sheets.js/lib/data.ts — своя копия здесь,
// этот файл их не импортирует. Использовалась (без объявления — баг)
// ниже, в fetchAssortmentIndex/fetchAssortmentFacts: там нужно сравнивать
// названия товаров без учёта регистра/лишних пробелов, не ключи складов.
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()

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
      //
      // Диагностика TransactionSide (временно добавлялась сюда) показала:
      // TransactionSide у закупок всегда CREDIT без исключений — не дебет/
      // кредит дублирование, убрано.
      //
      // Document — пробовали добавить в группировку (не диагностика, а
      // постоянно), думая, что их отчёт идёт по накладным — ОШИБКА,
      // ОТКАЧЕНО: у "Рибай стейк"/ИП "Иманбай" в их отчёте РОВНО ОДНА
      // строка (120 шт, 318060₸) за июнь, а с Document наш фетч развёл её
      // на 3 (3 реальные накладные за месяц, которые их отчёт сам
      // схлопывает). Document — не та ось: их отчёт разводит строки не по
      // накладной, а, похоже, по какому-то более детальному полю фасовки/
      // упаковки, которого в Product.MeasureUnit нет (у "Картофель фри
      // с/м." это поле даёт только "кг" что для фасовки "пач. 2.5кг.", что
      // для "пач. 2.250кг." — отсюда их разные строки в отчёте, а у нас
      // одна).
      //
      // РАЗГАДАНО (не Comment — живой тест показал его всегда пустым):
      // фасовка у товаров-ассортиментов (напр. "Ягода с/м в асс") — это
      // containerId строки накладной, который резолвится в текст ("малина",
      // "брусника"...) через список containers в карточке самого товара
      // (api/products). OLAP ни разу не выдаёт containerId ни в одном
      // поле — его просто нет в списке полей отчёта. Поэтому для таких
      // товаров OLAP в принципе не может сказать больше, чем голое "кг";
      // расклад по факту делает fetchAssortmentFacts ниже, отдельным
      // запросом прямо по накладным, только для товаров "...в асс" — см.
      // её собственный комментарий.
      //
      // Диагностика TransactionType (временно убирали фильтр и добавляли
      // поле в groupByRowFields, чтобы понять, почему фетч видит только 69
      // из реальных 110 шт Рибай стейк/ИП Кабаева у Сирены за август) —
      // ОТКАЧЕНО: без фильтра в запрос попадают ВСЕ типы транзакций (не
      // только приходные накладные) — продажи, списания, перемещения и
      // т.п. Для текущего (малонаполненного) месяца это было незаметно, но
      // для полного прошлого месяца объём резко вырастал, и OLAP-запрос
      // валился по таймауту — это и ломало "Загрузить этот период" для
      // всех месяцев, кроме текущего. Причина расхождения по Рибай стейк
      // всё ещё не найдена, искать нужно иначе (не через расфильтровку всех
      // типов транзакций сразу).
      groupByRowFields: ['Store', 'Product.Name', 'Counteragent.Name', 'Product.MeasureUnit'],
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
    // через IF(R="",Y_prev,R). Один ответ содержит строки ВСЕХ складов
    // вперемешку (не только текущего ресторана), так что форвард-филл
    // сбрасывается на каждой смене склада — иначе пустая строка на границе
    // между двумя точками наследовала бы товар/поставщика от ПРЕДЫДУЩЕГО,
    // совсем другого ресторана. (Проверено: это не объясняло фантомный
    // "Ананас"/завышенные "Анчоусы" у Сирены — та загадка оказалась в
    // другом, см. TransactionSide/Document выше — но сама защита верная
    // и остаётся.)
    let lastStore = null, lastProduct = '', lastSupplier = ''
    const rawRows = data.data || []
    const mapped = rawRows.map((row) => {
      if (row['Store'] !== lastStore) { lastStore = row['Store']; lastProduct = ''; lastSupplier = '' }
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
    let facts = mapped.filter((f) => f.product && f.qty > 0 && f.restaurant !== null)
    const stats = { rawCount: rawRows.length, droppedNoData, droppedDept, kept: facts.length }

    // Товары-ассортименты ("Ягода с/м в асс", "Пюре в асс" и т.п.) — у них
    // OLAP-агрегат не просто без фасовки, а ВРЕДЕН: раз containerId нигде в
    // OLAP не фигурирует (см. комментарий выше), разные вкусы одного и того
    // же поставщика/товара/единицы схлопываются в ОДНУ строку с суммарным
    // количеством — сами разные закупки теряются, не только их фасовка.
    // Полностью заменяем такие строки раскладом по факту из самих накладных
    // (см. fetchAssortmentFacts). Если это не удалось (сеть, неожиданный
    // формат у этой версии сервера) — тихо остаёмся на OLAP-версии как
    // раньше: голое "кг" без фасовки лучше, чем сломанный синк целиком.
    try {
      const assortment = await fetchAssortmentFacts(settings, period)
      if (assortment.facts.length) {
        facts = facts.filter((f) => !assortment.names.has(norm(f.product)))
        facts.push(...assortment.facts)
        stats.assortmentFacts = assortment.facts.length
      }
    } catch (e) {
      stats.assortmentError = String(e.message || e)
    }

    facts.fetchStats = stats
    return facts
  } finally {
    await iikoServerLogout(base, token)
  }
}

/** Читает ответ ПОЛНОСТЬЮ потоково, но с жёстким лимитом — для заведомо небольших справочников (поставщики, склады, отфильтрованная номенклатура), где ответ целиком разумно держать в памяти, в отличие от огромных отчётов/накладных. */
async function readTextCapped(res, maxBytes = 5_000_000) {
  const reader = res.body?.getReader?.()
  if (!reader) return await res.text()
  const decoder = new TextDecoder('utf-8')
  let total = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new Error(`Ответ сервера слишком большой (>${(maxBytes / 1e6).toFixed(0)}МБ)`)
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return text
}

/**
 * Раскодирует XML-сущности в текстовом содержимом тега — &quot; на месте
 * настоящей кавычки критично: названия контрагентов почти всегда
 * ТОО "Так-то"/ИП "Эдак-то", и сравнение с матрицей (resolveRowPlan,
 * lib/data.ts) идёт по точному тексту после норм() — "тоо &quot;x&quot;"
 * и 'тоо "x"' для него просто разные строки, алиас не находится, закупка
 * выглядит как "от другого поставщика" (включая самоссылку на себя же).
 */
function unescapeXml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Простой скрейпер плоских corporateItemDto-подобных списков (поставщики,
 * склады) — не знаем точного имени оборачивающего элемента для этой версии
 * сервера, поэтому ищем пары <id>GUID</id>...<name>ТЕКСТ</name>, не
 * заходя за границу следующего <id> (чтобы имя не "утекло" от одной
 * записи к другой).
 */
function extractIdNameMap(xml) {
  const map = new Map()
  const re = /<id>([^<]+)<\/id>(?:(?!<id>)[\s\S])*?<name>([^<]*)<\/name>/g
  let m
  while ((m = re.exec(xml))) map.set(m[1], unescapeXml(m[2]))
  return map
}

/**
 * Находит в ответе каждый блок openTag...closeTag и отдаёт его целиком в
 * onBlock — ПОТОКОВО, документ/товар за раз: в памяти держится только
 * текущий (недописанный) буфер, а не всё тело ответа, так что не зависит
 * от общего размера выгрузки (полная номенклатура или накладные за месяц
 * по всей сети — не угадаешь заранее, насколько это много).
 */
async function streamExtractBlocks(res, openTag, closeTag, onBlock) {
  const reader = res.body?.getReader?.()
  if (!reader) {
    const text = await res.text()
    let idx = 0
    for (;;) {
      const start = text.indexOf(openTag, idx)
      if (start === -1) break
      const end = text.indexOf(closeTag, start)
      if (end === -1) break
      onBlock(text.slice(start, end + closeTag.length))
      idx = end + closeTag.length
    }
    return
  }
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (!done) buf += decoder.decode(value, { stream: true })
      for (;;) {
        const start = buf.indexOf(openTag)
        if (start === -1) { buf = ''; break }
        const end = buf.indexOf(closeTag, start)
        if (end === -1) break // блок пока не дочитан целиком — ждём следующий кусок
        onBlock(buf.slice(start, end + closeTag.length))
        buf = buf.slice(end + closeTag.length)
      }
      if (done) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/**
 * Карточки товаров, у которых в самой номенклатуре реально заведено хотя
 * бы одна тара/фасовка (containers) — не только "...в асс" (Ягода/Пюре),
 * ровно так же устроены и другие категории (живой кейс: "Специи дешевые
 * (вегета,кориандр,ГБ)" — под ней "Vegeta 1кг"/"Галина Бланка" такие же
 * contaner-варианты). Критерий — не слово в названии (ненадёжно, слов
 * может быть сколько угодно и без "асс" тоже), а сам факт, что у товара
 * ЕСТЬ сконфигурированные контейнеры: это объективное свойство в
 * iiko, не угадывание по тексту.
 *
 * Фильтр — НЕ на сервере (не доверяем, что products/search/ там
 * настоящий regex, а не SQL LIKE): тащим ту же полную выгрузку, что уже
 * доказанно работает (см. iikoServerProductByNum), и фильтруем сами,
 * потоково, без буферизации всего ответа целиком.
 */
export async function fetchAssortmentIndex(settings) {
  const { base, token } = await iikoServerAuth(settings)
  try {
    const res = await withTimeout(`${base}/resto/api/products?key=${token}&includeDeleted=false`, {}, 60000)
    if (!res.ok) throw new Error(`Номенклатура недоступна (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`)
    const byId = new Map()
    const byName = new Map()
    await streamExtractBlocks(res, '<productDto>', '</productDto>', (seg) => {
      const containers = new Map()
      const containerRe = /<container>([\s\S]*?)<\/container>/g
      let cm
      while ((cm = containerRe.exec(seg))) {
        const cseg = cm[1]
        const cid = /<id>([^<]*)<\/id>/.exec(cseg)?.[1]
        const cname = /<name>([^<]*)<\/name>/.exec(cseg)?.[1]
        if (cid && cname) containers.set(cid, unescapeXml(cname))
      }
      if (!containers.size) return // обычный товар без тар — не наш случай вовсе
      const rawName = /<name>([^<]*)<\/name>/.exec(seg)?.[1]
      if (!rawName) return
      const name = unescapeXml(rawName)
      const id = /<id>([^<]*)<\/id>/.exec(seg)?.[1]
      if (!id) return
      const mainUnit = unescapeXml(/<mainUnit>([^<]*)<\/mainUnit>/.exec(seg)?.[1] || '')
      byId.set(id, { name, mainUnit, containers })
      const key = norm(name)
      const arr = byName.get(key) ?? []
      arr.push(id)
      byName.set(key, arr)
    })
    return { byId, byName }
  } finally {
    await iikoServerLogout(base, token)
  }
}

/** Разбирает строки накладных ПОТОКОВО, документ за документом (см. streamExtractBlocks). onDocument получает сырой XML одного <document>...</document> целиком. */
async function streamInvoiceDocuments(res, onDocument) {
  return streamExtractBlocks(res, '<document>', '</document>', onDocument)
}

/** Разбирает <item>...</item> внутри одного документа, оставляя только строки с товаром из assortmentIds. */
function extractAssortmentItems(docXml, assortmentIds) {
  const supplierId = /<supplier>([^<]*)<\/supplier>/.exec(docXml)?.[1] || ''
  const out = []
  const itemRe = /<item>([\s\S]*?)<\/item>/g
  let m
  while ((m = itemRe.exec(docXml))) {
    const seg = m[1]
    const productId = /<product>([^<]*)<\/product>/.exec(seg)?.[1]
    if (!productId || !assortmentIds.has(productId)) continue
    const containerId = /<containerId>([^<]*)<\/containerId>/.exec(seg)?.[1] || null
    const amount = Number(/<amount>([^<]*)<\/amount>/.exec(seg)?.[1] || 0)
    const sum = Number(/<sum>([^<]*)<\/sum>/.exec(seg)?.[1] || 0)
    const storeId = /<store>([^<]*)<\/store>/.exec(seg)?.[1] || ''
    out.push({ supplierId, productId, containerId, amount, sum, storeId })
  }
  return out
}

/**
 * Факты по товарам с тарами/фасовками прямо из накладных (не из OLAP —
 * он не знает про containerId вовсе, см. комментарий в iikoServerFacts
 * выше). Пусто, если в номенклатуре нет вообще ни одного такого товара
 * (fetchAssortmentIndex вернула пустой список) — тогда накладные даже не
 * запрашиваем.
 */
async function fetchAssortmentFacts(settings, period) {
  const index = await fetchAssortmentIndex(settings)
  if (!index.byId.size) return { facts: [], names: new Set() }
  const { base, token } = await iikoServerAuth(settings)
  try {
    const [suppliersXml, storesXml] = await Promise.all([
      withTimeout(`${base}/resto/api/suppliers?key=${token}`, {}, 30000).then((r) => {
        if (!r.ok) throw new Error(`Поставщики недоступны (HTTP ${r.status})`)
        return readTextCapped(r)
      }),
      withTimeout(`${base}/resto/api/corporation/stores?key=${token}`, {}, 30000).then((r) => {
        if (!r.ok) throw new Error(`Склады недоступны (HTTP ${r.status})`)
        return readTextCapped(r)
      }),
    ])
    const supplierNames = extractIdNameMap(suppliersXml)
    const storeNames = extractIdNameMap(storesXml)
    const { from, to } = periodRange(period)
    const res = await withTimeout(`${base}/resto/api/documents/export/incomingInvoice?key=${token}&from=${from}&to=${to}`, {}, 120000)
    if (!res.ok) throw new Error(`Накладные недоступны (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`)
    // Схлопываем по (ресторан, поставщик, товар, фасовка) — так же, как
    // OLAP сам суммирует все закупки этого товара за период в одну строку
    // (groupByRowFields). Без этого при двух накладных за месяц с одной и
    // той же фасовкой (обычное дело — два отдельных завоза) получались бы
    // две строки на одну и ту же позицию вместо одной с суммарным
    // количеством, расходясь с тем, как показаны все остальные товары.
    const byKey = new Map()
    const names = new Set()
    await streamInvoiceDocuments(res, (docXml) => {
      for (const it of extractAssortmentItems(docXml, index.byId)) {
        if (!(it.amount > 0)) continue
        const info = index.byId.get(it.productId)
        const storeName = storeNames.get(it.storeId) || it.storeId
        const restaurant = resolveStoreRestaurant(storeName)
        if (!restaurant) continue
        const supplierName = supplierNames.get(it.supplierId) || it.supplierId
        const pack = (it.containerId && info.containers.get(it.containerId)) || info.mainUnit || ''
        const key = `${norm(restaurant)}::${norm(supplierName)}::${norm(info.name)}::${norm(pack)}`
        const prev = byKey.get(key)
        if (prev) { prev.qty += it.amount; prev.sum += it.sum }
        else byKey.set(key, { restaurant, supplier: supplierName, product: info.name, pack, qty: it.amount, sum: it.sum })
        names.add(norm(info.name))
      }
    })
    return { facts: [...byKey.values()], names }
  } finally {
    await iikoServerLogout(base, token)
  }
}

/**
 * Диагностика: Анчоусы на Олово 1 насчитались в разы больше, чем в их
 * отчёте (125000 вместо 2000) — извлечённые по отдельности имена складов
 * оказались верными (da83e720 = "Кухня склад Олово", b2a1493a =
 * "Кухня/Сирена" — другой ресторан, не Олово), так что гадать по одному
 * GUID дальше бессмысленно. Прогоняем ТУ ЖЕ логику, что и настоящий
 * fetchAssortmentFacts, но для товара по текстовому фильтру (не по
 * заранее известному id) и возвращаем КАЖДУЮ отдельную строку до
 * схлопывания — чтобы увидеть ВСЕ вклады в сумму разом, а не по 5 окон
 * за раз руками.
 */
export async function iikoServerAssortmentDebug(settings, period, productFilter) {
  const index = await fetchAssortmentIndex(settings)
  const needle = productFilter.trim().toLowerCase()
  const matchedIds = new Map()
  for (const [id, info] of index.byId) if (norm(info.name).includes(needle)) matchedIds.set(id, info)
  if (!matchedIds.size) return { ok: true, matchedProducts: [], items: [] }
  const { base, token } = await iikoServerAuth(settings)
  try {
    const [suppliersXml, storesXml] = await Promise.all([
      withTimeout(`${base}/resto/api/suppliers?key=${token}`, {}, 30000).then((r) => readTextCapped(r)),
      withTimeout(`${base}/resto/api/corporation/stores?key=${token}`, {}, 30000).then((r) => readTextCapped(r)),
    ])
    const supplierNames = extractIdNameMap(suppliersXml)
    const storeNames = extractIdNameMap(storesXml)
    const { from, to } = periodRange(period)
    const res = await withTimeout(`${base}/resto/api/documents/export/incomingInvoice?key=${token}&from=${from}&to=${to}`, {}, 120000)
    if (!res.ok) throw new Error(`Накладные недоступны (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`)
    const items = []
    await streamInvoiceDocuments(res, (docXml) => {
      for (const it of extractAssortmentItems(docXml, matchedIds)) {
        if (!(it.amount > 0)) continue
        const info = matchedIds.get(it.productId)
        const storeName = storeNames.get(it.storeId) || it.storeId
        const restaurant = resolveStoreRestaurant(storeName)
        const supplierName = supplierNames.get(it.supplierId) || it.supplierId
        const pack = (it.containerId && info.containers.get(it.containerId)) || info.mainUnit || ''
        items.push({ product: info.name, storeId: it.storeId, storeName, restaurant, supplier: supplierName, pack, containerId: it.containerId, qty: it.amount, sum: it.sum })
      }
    })
    return { ok: true, matchedProducts: [...matchedIds.values()].map((i) => i.name), items }
  } finally {
    await iikoServerLogout(base, token)
  }
}

/**
 * Диагностика: Comment не оказался тем полем, где лежит "брусника"/
 * "малина" у товаров-ассортиментов (живьём, после деплоя — не совпало).
 * Пользователь утверждает, что фасовку проставляют ПРЯМО В iiko
 * (намеренно, при оформлении накладной) — значит, текст реально лежит в
 * каком-то OLAP-поле отчёта TRANSACTIONS, просто не угадан. Вместо того
 * чтобы перебирать поля по одному через деплой, тащим РАСШИРЕННЫЙ набор
 * полей сразу и возвращаем только строки, похожие на искомый товар —
 * сравниваем значения глазами одним запросом. Не используется в обычном
 * синке (fetchFacts) — только через /api/iiko/olap-sample (кнопка в
 * Настройках iiko).
 */
export async function iikoServerOlapSample(settings, period, { search = '', extraFields = [], allTypes = false } = {}) {
  const { base, token } = await iikoServerAuth(settings)
  try {
    const { from, to } = periodRange(period)
    // allTypes — диагностика "пропавшей накладной" (см. комментарий у
    // iikoServerFacts про TransactionType=INVOICE): без этого фильтра не
    // увидели бы приходы, проведённые как другой тип транзакции (например,
    // внутреннее перемещение/акт вместо обычной накладной) — добавляем
    // TransactionType в сами колонки, чтобы увидеть тип каждой строки глазами.
    const fields = ['Store', 'Product.Name', 'Counteragent.Name', 'Product.MeasureUnit', 'Comment', ...(allTypes ? ['TransactionType'] : []), ...extraFields]
    const body = {
      reportType: 'TRANSACTIONS',
      buildSummary: false,
      groupByRowFields: fields,
      aggregateFields: ['Amount', 'Sum.Incoming'],
      filters: {
        'DateTime.DateTyped': { filterType: 'DateRange', periodType: 'CUSTOM', from, to },
        ...(allTypes ? {} : { TransactionType: { filterType: 'IncludeValues', values: ['INVOICE'] } }),
      },
    }
    const res = await withTimeout(`${base}/resto/api/v2/reports/olap?key=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, 60000)
    if (!res.ok) throw new Error(`Отчёт недоступен (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`)
    const data = await res.json()
    const rows = data.data || []
    const needle = search.trim().toLowerCase()
    const filtered = needle
      ? rows.filter((r) => fields.some((f) => String(r[f] || '').toLowerCase().includes(needle)))
      : rows
    return filtered.slice(0, 50)
  } finally {
    await iikoServerLogout(base, token)
  }
}

/**
 * Диагностика (продолжение): ни один OLAP-кандидат не оказался нужным
 * полем (живой тест — все кандидаты пустые кроме Document). Фасовка —
 * это, по документации iiko ("фасовки — дополнительные единицы
 * измерения для приёма в разных упаковках"), выбор, который делают ПРИ
 * ВВОДЕ самой накладной — OLAP всегда агрегирует в базовую единицу
 * (отсюда голое "кг" в Product.MeasureUnit), так что этот выбор просто
 * не долетает до отчёта по проводкам. Он должен быть только в самой
 * накладной — тащим её напрямую через documents/export/incomingInvoice
 * (отдельный, не-OLAP эндпоинт iikoServer) и возвращаем кусок сырого XML
 * вокруг искомого товара/поставщика — чтобы увидеть реальные имена
 * полей глазами, а не гадать ещё раз.
 */
export async function iikoServerInvoiceSample(settings, period, search = '') {
  const { base, token } = await iikoServerAuth(settings)
  try {
    const { from, to } = periodRange(period)
    const res = await withTimeout(`${base}/resto/api/documents/export/incomingInvoice?key=${token}&from=${from}&to=${to}`, {}, 60000)
    if (!res.ok) throw new Error(`Накладные недоступны (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`)
    const xml = await res.text()
    const needle = search.trim().toLowerCase()
    if (!needle) return xml.slice(0, 4000)
    const lower = xml.toLowerCase()
    const windows = []
    let idx = lower.indexOf(needle)
    while (idx !== -1 && windows.length < 5) {
      const start = Math.max(0, idx - 800)
      const end = Math.min(xml.length, idx + 800)
      windows.push(xml.slice(start, end))
      idx = lower.indexOf(needle, end)
    }
    return windows.length ? windows.join('\n\n--- --- ---\n\n') : `(«${search}» не нашлось в выгрузке накладных за ${period})`
  } finally {
    await iikoServerLogout(base, token)
  }
}

/**
 * Ищет подстроку в ответе ПОТОКОВО, без буферизации всего тела в памяти —
 * предыдущая защита (v2 entities/products, ниже была убрана) просто
 * обрывалась с ошибкой при большом ответе вместо того, чтобы реально
 * решить проблему; этот помощник работает корректно при ЛЮБОМ размере
 * ответа, потому что никогда не держит в памяти больше, чем маленькое
 * окно вокруг найденного совпадения (плюс короткий "хвост" на границе
 * кусков, пока совпадение не найдено). maxScan — страховка от
 * бесконечного чтения, если искомого там всё-таки нет вовсе.
 */
async function streamFindWindow(res, needle, { before = 500, after = 2500, maxScan = 60_000_000 } = {}) {
  const reader = res.body?.getReader?.()
  const needleLower = needle.toLowerCase()
  if (!reader) {
    const text = await res.text()
    const idx = text.toLowerCase().indexOf(needleLower)
    return idx === -1 ? null : text.slice(Math.max(0, idx - before), idx + needle.length + after)
  }
  const decoder = new TextDecoder('utf-8')
  let carry = ''
  let scanned = 0
  let found = null // { buf, idx } — buf держим только ПОСЛЕ того, как нашли совпадение
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      scanned += value.length
      const piece = carry + decoder.decode(value, { stream: true })
      if (!found) {
        const idx = piece.toLowerCase().indexOf(needleLower)
        if (idx === -1) {
          // Хвост с запасом под needle — иначе совпадение, разорванное ровно
          // на границе двух кусков, никогда не будет найдено.
          carry = piece.slice(-Math.max(needle.length * 4, 200))
          if (scanned > maxScan) return null
          continue
        }
        found = { buf: piece, idx }
      } else {
        found.buf += piece
      }
      if (found.buf.length - found.idx >= needle.length + after) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  if (!found) return null
  const start = Math.max(0, found.idx - before)
  return found.buf.slice(start, found.idx + needle.length + after)
}

/**
 * Диагностика (ещё шаг): сама строка накладной (см. iikoServerInvoiceSample)
 * несёт <amountUnit> (есть всегда) и <containerId> (есть не у всех строк —
 * похоже на опциональный выбор тары/фасовки, а не обязательную единицу).
 * Оба — просто GUID без текста.
 *
 * Первая попытка (v2 entities/products/list с фильтром по num/id) не
 * удалась живьём — не разобрались, дало ли это обрезанный/невалидный
 * ответ или фильтр просто не сработал, но гадать дальше смысла нет.
 * Вместо нового JSON-эндпоинта берём СТАРЫЙ, простой — тот же механизм,
 * что уже работает в iikoServerInvoiceSample (полная выгрузка + потоковый
 * поиск окна текста, без буферизации целиком) — он не падает независимо
 * от размера ответа, так что либо сразу увидим реальные поля, либо
 * получим честное "не нашлось", а не повторный крэш.
 */
export async function iikoServerProductByNum(settings, value) {
  const { base, token } = await iikoServerAuth(settings)
  try {
    const res = await withTimeout(`${base}/resto/api/products?key=${token}`, {}, 60000)
    if (!res.ok) throw new Error(`Номенклатура недоступна (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`)
    const window = await streamFindWindow(res, value.trim())
    return window ?? `(«${value}» не нашлось в выгрузке номенклатуры)`
  } finally {
    await iikoServerLogout(base, token)
  }
}

/**
 * Диагностика: Анчоусы/Олово 1 суммировались в разы больше, чем в их же
 * отчёте (125000 вместо 2000) — подозрение на extractIdNameMap: склады
 * (api/corporation/stores) отдаются как ИЕРАРХИЯ (corporateItemDto,
 * вложенные подразделения), а не плоский список, как у поставщиков —
 * простой скан "следующий <id> + следующий <name>" может перепутать
 * родителя с ребёнком и разным складам присвоить одно и то же имя.
 * Ищем конкретный GUID склада и смотрим его РЕАЛЬНОЕ окружение в XML,
 * не угадывая по regex ещё раз.
 */
export async function iikoServerStoresSample(settings, search) {
  const { base, token } = await iikoServerAuth(settings)
  try {
    const res = await withTimeout(`${base}/resto/api/corporation/stores?key=${token}`, {}, 30000)
    if (!res.ok) throw new Error(`Склады недоступны (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`)
    const window = await streamFindWindow(res, search.trim(), { before: 1500, after: 1500 })
    return window ?? `(«${search}» не нашлось в выгрузке складов)`
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
