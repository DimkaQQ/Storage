import jwt from 'jsonwebtoken'

/**
 * Читает план-цены (матрица "Сырьё Ф") прямо из Google-таблицы через
 * сервисный аккаунт — только чтение (scope spreadsheets.readonly). iiko
 * сюда не имеет отношения вообще: это отдельный источник, договорные цены
 * с поставщиками, которые ведёт человек в самой таблице.
 *
 * Структура листа (разобрана вручную по реальному файлу клиента, см.
 * переписку): одна вкладка на ресторан, шапка на 2-й строке, данные с 3-й.
 *   C — Название поставщика основного (канонiчeское имя — то, что видит
 *       resolveRowPlan как supplierCanon)
 *   D — Названия компаний как в iiko (алиас, supplierAlias[D] = C)
 *   E — Наименования как в iiko (товар)
 *   F — Фасовка как в iiko (пусто = "плоская" цена без фасовки)
 *   H — Цена за 1кг (план)
 *   I — Наименование товара (их собственное описание)
 * Пустая цена (H) при заполненных остальных = noPriceExact (связь есть,
 * цены просто нет — см. resolveRowPlan в lib/data.ts).
 */

const withTimeout = async (url, opts = {}, ms = 20000) => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...opts, signal: ctrl.signal }) }
  finally { clearTimeout(t) }
}

export const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
export const normPack = (s) => {
  let p = norm(s)
  p = p.replace(/(?<=\d),(?=\d)/g, '.')
  p = p.replace(/\.$/, '')
  return p
}

/**
 * Название вкладки в таблице -> название точки, как оно используется в
 * приложении (RESTAURANT_SCOPE/dataset). Ровно как у RESTAURANT_SCOPE в
 * lib/data.ts — соответствие "вкладка -> точка" пришлось сверять руками по
 * реальному файлу (сокращения на вкладках не однозначны, напр. "Pasta 1/2/3"
 * сами по себе не говорят, какой это адрес Pasta la vista). Новая точка —
 * новая строка здесь, руками.
 */
export const SHEET_TO_RESTAURANT = {
  'Сирена': 'Сирена',
  'Olovo1': 'Олово 1 (Сатпаева)',
  'Olovo2': 'Олово 2 (Достык)',
  'Renee ': 'Рене',
  'Pasta 1': 'Pasta la vista (Богенбай)',
  'Pasta 2': 'Pasta la vista (Гагарина)',
  'Pasta 3': 'Pasta la vista (Толе би)',
  'Six 1': 'Six coffee&wine 1',
  'Le Dome': 'Ле Дом',
  'Акку': 'Акку',
  'Six 2': 'Six coffee&wine 2',
  'Tangirs': 'Tangirs',
  'ЦФК': 'ЦФК',
  // Камчатка и French bar — закрыты/не нужны вообще (подтверждено
  // человеком), сюда их вкладки больше не читаем: их план-цены просто не
  // нужны, раз сами точки никогда не попадут в датасет (см.
  // IGNORED_BRAND_CODES в iiko.js).
}

/**
 * Отдельная таблица (свой googleSheetId, тот же сервисный аккаунт) для
 * точек Астаны — новый город, открылся под теми же брендами, что в Алматы
 * (Tangirs/Six coffee&wine/Pasta la vista), но под другими юрлицами и по
 * другим адресам, так что это отдельные точки, не то же самое, что
 * алматинские рестораны с этими же именами. Названия вкладок — внутренние
 * кодовые обозначения самой таблицы, не бренды; реальный бренд/адрес
 * подтверждён с человеком, а Танж1=Есиль/Танж2=Сарыарка — ещё раз
 * подтверждено реальными кодами складов из отчёта iiko (TNGEC2-Astana у
 * Танж1, TNGAT3-Astana у Танж2, см. resolveStoreRestaurant в iiko.js).
 * Вкладки один раз уже переименовали (были "ТанжEC"/"ТанжS") — если
 * таблица снова переименует вкладки, тут просто правится ключ, значение
 * (название ресторана) остаётся тем же.
 */
export const SHEET_TO_RESTAURANT_ASTANA = {
  'Танж1': 'Tangirs (Есиль, Астана)',
  'Танж2': 'Tangirs (Сарыарка, Астана)',
  'Сикс': 'Six coffee&wine (Астана)',
  'Паста': 'Pasta la vista (Астана)',
}

function parseKey(raw) {
  const key = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!key?.private_key || !key?.client_email) throw new Error('Ключ сервисного аккаунта неполный (нет private_key/client_email)')
  return key
}

async function getAccessToken(serviceAccountKey) {
  const key = parseKey(serviceAccountKey)
  const now = Math.floor(Date.now() / 1000)
  const assertion = jwt.sign(
    { iss: key.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: key.token_uri, iat: now, exp: now + 3600 },
    key.private_key,
    { algorithm: 'RS256' },
  )
  const res = await withTimeout(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  const data = await res.json()
  if (!res.ok || !data.access_token) throw new Error(`Google не выдал токен: ${data.error_description || data.error || res.status}`)
  return data.access_token
}

async function fetchSheetTitles(token, spreadsheetId) {
  const res = await withTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    if (res.status === 404) throw new Error('Таблица не найдена (проверьте ID) или сервисный аккаунт не приглашён в неё')
    if (res.status === 403) throw new Error('Нет доступа к таблице — приглашён ли сервисный аккаунт как читатель? Включён ли Google Sheets API в проекте?')
    throw new Error(`Google Sheets вернул ошибку (HTTP ${res.status}): ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  return (data.sheets || []).map((s) => s.properties.title)
}

async function batchGetValues(token, spreadsheetId, ranges) {
  const params = new URLSearchParams()
  for (const r of ranges) params.append('ranges', r)
  params.append('valueRenderOption', 'UNFORMATTED_VALUE')
  const res = await withTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Не удалось прочитать диапазоны (HTTP ${res.status})`)
  const data = await res.json()
  return data.valueRanges || []
}

export async function testConnection({ googleSheetId, googleServiceAccountKey }, sheetToRestaurant = SHEET_TO_RESTAURANT) {
  try {
    if (!googleSheetId) return { ok: false, message: 'Не указан ID таблицы' }
    if (!googleServiceAccountKey) return { ok: false, message: 'Не указан ключ сервисного аккаунта' }
    const token = await getAccessToken(googleServiceAccountKey)
    const titles = await fetchSheetTitles(token, googleSheetId)
    const known = titles.filter((t) => sheetToRestaurant[t])
    return { ok: true, message: `Подключение есть. Вкладок в таблице: ${titles.length}, из них с известным названием точки: ${known.length} (остальные тоже читаются под своим названием).` }
  } catch (e) {
    return { ok: false, message: String(e.message || e) }
  }
}

/**
 * Колонки матрицы ищем по ЗАГОЛОВКАМ, а не по буквам: заказчик собирается удалить из таблицы колонки
 * D/E/F (названия iiko/фасовка) и N…AF — буквы тогда съедут. Шапку ищем в первых строках (у вкладки
 * «Renee» она на 3-й строке, у остальных на 2-й). Нет заголовка «…поставщика основного» (чужая/старая
 * раскладка) — прежние фиксированные позиции C..I и данные с 3-й строки.
 * rows — значения вкладки, начиная с КОЛОНКИ C и СТРОКИ 1. Индексы колонок считаются от C; -1 — колонки нет
 * (например, E удалена). dataStart — индекс первой строки данных.
 */
export function detectColumns(rows) {
  const norms = (r) => (r || []).map((x) => String(x ?? '').replace(/\s+/g, ' ').trim().toLowerCase())
  for (let ri = 0; ri < Math.min(rows?.length ?? 0, 8); ri++) {
    const h = norms(rows[ri])
    const sup = h.findIndex((x) => x.includes('поставщика основного'))
    if (sup === -1) continue
    const find = (pred) => h.findIndex((x, i) => i > sup && pred(x))
    return {
      sup,
      alias: find((x) => x.includes('названия компаний как в iiko')),
      name: find((x) => x.includes('наименования как в iiko')),
      pack: find((x) => x.includes('фасовка как в iiko')),
      price: find((x) => x.replace(/\s+/g, '').startsWith('ценаза1кг')),
      label: find((x) => x.startsWith('наименование') && !x.includes('iiko') && !x.includes('поставщика')),
      dataStart: ri + 1,
      legacy: false,
    }
  }
  return { sup: 0, alias: 1, name: 2, pack: 3, price: 5, label: 6, dataStart: 2, legacy: true }
}

/**
 * Читает всю матрицу целиком (без привязки к периоду — таблица клиента
 * живая, отражает текущие договорные цены на момент чтения, а не цены "за
 * такой-то месяц") и возвращает объект в формате MatchingTable
 * (см. src/lib/data.ts): supplierAlias/planPairs/planPairsByPack/
 * productLabels/noPriceExact.
 *
 * sheetToRestaurant — какую книгу читаем: по умолчанию основная (Алматы,
 * "Сырьё Ф"), либо SHEET_TO_RESTAURANT_ASTANA для отдельной таблицы Астаны
 * (свой googleSheetId, тот же сервисный аккаунт) — вызывающая сторона
 * (index.js) сама решает, какой googleSheetId и какой маппинг сюда подать.
 */
export async function syncMatrix({ googleSheetId, googleServiceAccountKey }, sheetToRestaurant = SHEET_TO_RESTAURANT, reservedNames = []) {
  const token = await getAccessToken(googleServiceAccountKey)
  const titles = await fetchSheetTitles(token, googleSheetId)
  // Сканируем ВСЕ вкладки, а не только узнанные по списку: вкладка, которой
  // нет в sheetToRestaurant (новый ресторан), попадает в матрицу под своим же
  // названием — дальше в Справочниках → Точки её привязывают к ресторану из
  // iiko, без правки кода. Узнанные вкладки по-прежнему получают своё
  // "красивое" основное название из sheetToRestaurant.
  // Защита от не той таблицы: хотя бы одна вкладка должна быть узнана по
  // списку (как раньше) — иначе скорее всего указан чужой ID, и каждая его
  // вкладка стала бы "рестораном". Вкладки с "::" в названии пропускаем —
  // двоеточия в ключах матрицы зарезервированы.
  if (!titles.some((t) => sheetToRestaurant[t])) throw new Error('Ни одна вкладка таблицы не узнана — проверьте ID таблицы (ожидаются вкладки с названиями точек, см. SHEET_TO_RESTAURANT в sheets.js)')
  // Защита от одинаковых названий: ключ матрицы — norm(название), поэтому две
  // вкладки с одним названием (в разных городах или отличающиеся только
  // пробелами/регистром) слились бы в одну и затирали друг друга. Узнанные по
  // списку вкладки читаем первыми; любая вкладка, чьё название уже занято (в этой
  // же таблице или в таблице другого города — reservedNames), пропускается и
  // попадает в conflicts — переименуйте её в таблице.
  const taken = new Set(reservedNames.map(norm))
  const claimed = new Set()
  const conflicts = []
  const sheets = []
  const byKnown = [...titles].sort((a, b) => (sheetToRestaurant[b] ? 1 : 0) - (sheetToRestaurant[a] ? 1 : 0))
  for (const t of byKnown) {
    if (String(t).includes('::')) continue
    const key = norm(sheetToRestaurant[t] ?? String(t).replace(/\s+/g, ' ').trim())
    if (taken.has(key) || claimed.has(key)) { conflicts.push(String(t)); continue }
    claimed.add(key)
    sheets.push(t)
  }

  // Без верхней границы по строке (не C3:I5000) — Sheets API читает до
  // конца реальных данных листа. Фиксированный потолок в 5000 строк рос бы
  // молча: превысила бы таблица его — часть строк матрицы тихо пропала бы
  // из синка без единой ошибки.
  // C1:AF — с шапкой: колонки ищем по заголовкам, а не по номерам (см. detectColumns)
  const ranges = sheets.flatMap((t) => [`'${t.replace(/'/g, "''")}'!C1:AF`])
  const valueRanges = await batchGetValues(token, googleSheetId, ranges)

  const supplierAlias = {}
  const planPairs = {}
  const planPairsByPack = {}
  const productLabels = {}
  const noPriceExact = {}
  // "ресторан::поставщик" (норм.) -> порядковый номер, по которому этот
  // поставщик впервые встретился на вкладке ЭТОГО ресторана (сверху вниз,
  // как в самой таблице) — попросили показывать "Проверку цен" в том же
  // порядке, что и сама матрица (все позиции одного поставщика подряд, как
  // на вкладке), а не вразнобой по алфавиту. См. Row.matrixOrder в lib/data.ts.
  const supplierOrder = {}
  let rowsSeen = 0
  // Одна и та же пара поставщик+товар+фасовка иногда встречается в
  // таблице НЕСКОЛЬКО раз под одним и тем же iiko-названием — это не
  // перезапись одной и той же цены, а два по-настоящему разных товара
  // (разные бренды/сорта), которые iiko никак не различает в самой
  // закупке (живой случай: "Сыр пармезан" у Ocean Fresh — одна строка
  // "Грано Подано" по 13000, другая "Грано Моравия" по 11600, обе с
  // пустой/одинаковой фасовкой). planPairs/planPairsByPack — простые
  // объекты, при совпадении ключа вторая строка молча стирает первую —
  // какая из цен реально победит, зависит только от порядка строк в
  // таблице, никак не от того, что реально купили. Копим ВСЕ встреченные
  // варианты под ambiguous[key] (не только побеждающий) — resolveRowPlan
  // в data.ts покажет их все на КОНКРЕТНОЙ закупке этого периода, чтобы
  // человек выбрал подходящий прямо там, а не гадать за него синком.
  const ambiguousVariants = new Map()
  // Строки, где E (Наименования как в iiko) пустая — используем I как
  // временную замену, чтобы строка не пропадала вовсе (см. nameBasis
  // ниже), но это ЧУЖОЕ решение за них, не факт, что совпадёт с тем, что
  // реально пришлёт iiko. Явно помечаем такой ключ — см. MatchingTable.
  // noIikoName в lib/data.ts — Справочники показывают его отдельным
  // списком "допишите название в iiko" вместо того, чтобы делать вид,
  // что сопоставление уже надёжное.
  const noIikoName = {}
  // есть ли в таблице колонка «Наименования как в iiko» (E) хоть на одной вкладке — по ней решаем, снимать ли слепок в каталог или накладывать каталог
  let hasIikoNames = false
  // norm-имя -> основное название вкладки (только вкладки, где нашлись строки) — список для выбора в Справочниках → Точки.
  const restaurantNames = {}
  // norm-имя -> название вкладки ровно как написано в таблице (у известных вкладок основное название отличается: 'Renee' -> 'Рене') — подпись в выборе вкладки в Справочниках.
  const tabTitles = {}

  sheets.forEach((title, i) => {
    const restaurantDisplay = sheetToRestaurant[title] ?? String(title).replace(/\s+/g, ' ').trim()
    const restaurant = norm(restaurantDisplay)
    const allRows = valueRanges[i]?.values || []
    const cols = detectColumns(allRows)
    if (cols.name >= 0) hasIikoNames = true
    const rows = allRows.slice(cols.dataStart)
    // Свой счётчик на каждую вкладку/ресторан — "первый поставщик этой
    // вкладки" получает 0, следующий новый — 1, и т.д.
    let nextSupplierOrder = 0
    for (const row of rows) {
      const at = (idx) => (idx >= 0 ? row[idx] : undefined)
      const supplierCanonRaw = at(cols.sup), iikoCompanyRaw = at(cols.alias), iikoNameRaw = at(cols.name)
      const packRaw = at(cols.pack), priceRaw = at(cols.price), labelRaw = at(cols.label)
      // E (iiko-название) иногда пустая, хотя поставщик и их собственное
      // описание (I) заполнены — черновая строка, название под iiko ещё не
      // решили. Раньше такую строку целиком пропускали — она ни разу не
      // попадала в приложение, даже как "Не закупали", хотя цена (H) уже
      // может быть указана. Подтверждено прямо на реальных строках клиента
      // (Tangirs: "Бобы тонка...", "Стрипсы куриные...", "Крылья куриные
      // по домашнему...") — используем I как временную замену E, лучше
      // показать строку под их же описанием, чем молчать о ней вовсе;
      // как только E заполнят, сопоставление само переключится на него.
      const nameBasis = iikoNameRaw || labelRaw
      if (!nameBasis || !supplierCanonRaw) continue
      rowsSeen++
      restaurantNames[restaurant] = restaurantDisplay
      tabTitles[restaurant] = String(title).replace(/\s+/g, ' ').trim()
      const supplierCanon = norm(supplierCanonRaw)
      const orderKey = `${restaurant}::${supplierCanon}`
      if (!(orderKey in supplierOrder)) supplierOrder[orderKey] = nextSupplierOrder++
      // Значение — текст С КАК ОН НАПИСАН в колонке C (пробелы схлопнуты,
      // регистр не трогаем), а не supplierCanon (уже lowercase) — иначе
      // любой код, который показывает это значение человеку как "красивое"
      // каноническое имя поставщика (supplierDisplayByNorm в data.ts и
      // DataEditor.tsx, и прямой показ matching.supplierAlias[...] на
      // вкладке «Компании» в Справочниках), всегда получал бы голый нижний
      // регистр — сопоставлению (resolveRowPlan) это всё равно, там
      // результат ещё раз оборачивается в norm().
      const supplierDisplay = String(supplierCanonRaw).replace(/\s+/g, ' ').trim()
      // Ключ — С ИМЕНЕМ РЕСТОРАНА, как у planPairs и остальных карт: та же
      // D-колонка (iiko-алиас) реально писалась по-разному в разных
      // вкладках для одного и того же поставщика (живой кейс: "Berry
      // Company" — "Berry Company ТОО Берри" на одной вкладке, другое
      // написание на другой) — раньше supplierAlias был ОДНИМ общим
      // словарём на всю сеть, и застрявшая строка вкладки, обработанной
      // позже, тихо подменяла канон для ДРУГОГО ресторана: supplierCanon
      // внутри resolveRowPlan (lib/data.ts) не совпадал с тем, что
      // реально прайсовано в planPairsByPack ЭТОГО ресторана — закупка у
      // правильного поставщика выглядела как "заказ не по матрице" со
      // ссылкой на самого себя.
      if (iikoCompanyRaw) supplierAlias[`${restaurant}::${norm(iikoCompanyRaw)}`] = supplierDisplay
      // Канонических поставщиков, у которых в ЭТОЙ строке D (алиас) пуст —
      // например название в iiko совпадает с каноническим один в один —
      // supplierAlias раньше вообще не узнавал об их "красивом" написании
      // (ключ supplierCanon туда никогда не попадал). Добавляем самоссылку,
      // если её ещё нет — тот же эффект, не перетирает уже заданную.
      if (!supplierAlias[`${restaurant}::${supplierCanon}`]) supplierAlias[`${restaurant}::${supplierCanon}`] = supplierDisplay
      const product = norm(nameBasis)
      const pack = packRaw ? normPack(packRaw) : ''
      const flatKey = `${restaurant}::${supplierCanon}::${product}`
      const key = pack ? `${flatKey}::${pack}` : flatKey
      if (!iikoNameRaw) noIikoName[key] = true
      // Их собственное описание (I) — записываем независимо от того, есть
      // ли у строки цена: иначе строка без цены И без названия в iiko
      // (см. noIikoName выше) показывалась бы в Справочниках вообще без
      // единой зацепки, по какой именно строке таблицы её искать.
      if (labelRaw) productLabels[key] = String(labelRaw)
      const hasPrice = priceRaw !== undefined && priceRaw !== null && priceRaw !== ''
      if (hasPrice) {
        const price = Number(priceRaw)
        if (Number.isFinite(price)) {
          const label = labelRaw ? String(labelRaw) : null
          const variants = ambiguousVariants.get(key) ?? []
          if (!variants.some((v) => v.price === price && v.label === label)) variants.push({ price, label })
          ambiguousVariants.set(key, variants)
          if (pack) planPairsByPack[key] = price
          else planPairs[key] = price
        }
      } else {
        noPriceExact[key] = true
      }
    }
  })

  // Только реально неоднозначные ключи (>1 различимого варианта) — для
  // подавляющего большинства ключей тут ровно один вариант, незачем
  // таскать его копией дальше по matching.
  const ambiguous = {}
  for (const [key, variants] of ambiguousVariants) if (variants.length > 1) ambiguous[key] = variants

  return {
    matching: { supplierAlias, planPairs, planPairsByPack, productLabels, noPriceExact, ambiguous, supplierOrder, noIikoName, restaurantNames, tabTitles },
    summary: { conflicts, hasIikoNames, sheets: sheets.length, restaurants: Object.keys(restaurantNames).length, newTabs: Object.values(restaurantNames).filter((n) => !Object.values(sheetToRestaurant).some((k) => norm(k) === norm(n))), rows: rowsSeen, planPairs: Object.keys(planPairs).length, planPairsByPack: Object.keys(planPairsByPack).length },
  }
}

/**
 * Алматы и Астана — два отдельных googleSheetId, синкаются отдельными
 * кнопками/запросами, но хранятся в ОДНОМ файле единой матрицы (см.
 * getMatrix/saveMatrix в store.js) — иначе пришлось бы менять формат
 * хранения и /api/matching. Ключи внутри каждой карты уже включают имя
 * ресторана (restaurant::supplier::product[::pack]), а рестораны Алматы и
 * Астаны не пересекаются по имени, так что синк одного города не должен
 * задевать уже сохранённые данные другого.
 *
 * restaurantNames — рестораны ИМЕННО ТОГО города, что только что синканули
 * (b — его свежий, полный результат). Раньше merge был чисто аддитивным
 * ({...a, ...b}) — если строку/цену УДАЛИЛИ из Google-таблицы, в b её
 * просто не было, а в a она оставалась навсегда: удалённая в таблице
 * позиция продолжала бы считаться актуальной сколько угодно синков подряд.
 * Теперь из a сначала убираются ВСЕ ключи ресторанов этого города (b —
 * его полная замена), а ключи другого города (restaurantNames не
 * покрывает) остаются нетронутыми как раньше.
 *
 * supplierAlias — теперь ключи там ТОЖЕ начинаются с имени ресторана (см.
 * syncMatrix выше), так что отфильтровать по ресторанам можно точно так
 * же, как остальные карты — раньше это было явное исключение (плоский
 * словарь на весь файл), из-за которого алиас, одинаково записанный в
 * двух разных вкладках на разных поставщиков/с разным написанием,
 * молча побеждал тот, что обработан позже, независимо от ресторана.
 */
export function mergeMatching(a, b, restaurantNames) {
  if (!a) return b
  if (!b) return a
  const scope = restaurantNames ? new Set(restaurantNames.map(norm)) : null
  const replaceScoped = (prevMap, freshMap) => {
    if (!scope) return { ...prevMap, ...freshMap }
    const out = {}
    for (const [k, v] of Object.entries(prevMap)) if (!scope.has(k.split('::')[0])) out[k] = v
    return { ...out, ...freshMap }
  }
  return {
    supplierAlias: replaceScoped(a.supplierAlias, b.supplierAlias),
    planPairs: replaceScoped(a.planPairs, b.planPairs),
    planPairsByPack: replaceScoped(a.planPairsByPack, b.planPairsByPack),
    productLabels: replaceScoped(a.productLabels, b.productLabels),
    noPriceExact: replaceScoped(a.noPriceExact, b.noPriceExact),
    ambiguous: replaceScoped(a.ambiguous ?? {}, b.ambiguous ?? {}),
    supplierOrder: replaceScoped(a.supplierOrder ?? {}, b.supplierOrder ?? {}),
    noIikoName: replaceScoped(a.noIikoName ?? {}, b.noIikoName ?? {}),
    restaurantNames: replaceScoped(a.restaurantNames ?? {}, b.restaurantNames ?? {}),
    tabTitles: replaceScoped(a.tabTitles ?? {}, b.tabTitles ?? {}),
  }
}

/* ------------------------------------------------------------------ *
 * Каталог названий iiko («слепок D/E/F»).
 *
 * Заказчик удалит из Google-таблицы колонки D/E/F (названия компаний/товаров/фасовка как в iiko).
 * Поэтому, пока они есть, каждый синк запоминает их в собственном каталоге программы; после удаления
 * свежая матрица (без E/D/F: ключи строятся из описания I, фасовки нет) накладывается на каталог —
 * ключи строк возвращаются к «iiko-названию + фасовке», а цены берутся свежие из таблицы.
 * Строка опознаётся по ресторан + поставщик (C) + описание (I).
 * ------------------------------------------------------------------ */

const identityOf = (key, label) => {
  const [restaurant, supplier] = key.split('::')
  return label ? `${restaurant}::${supplier}::${norm(label)}` : null
}
const allKeysOf = (m) => [...new Set([...Object.keys(m.planPairsByPack || {}), ...Object.keys(m.planPairs || {}), ...Object.keys(m.noPriceExact || {})])]

/** Прибавляет к каталогу строки/алиасы свежей матрицы (только пока E/D заполнены); старое не стирает. */
export function mergeCatalog(prev, m) {
  const rows = { ...(prev?.rows ?? {}) }
  // строки без E не затирают уже запомненные «настоящие» с тем же описанием (смешанные/ободранные вкладки)
  const known = new Set(Object.entries(rows).filter(([, r]) => !r.noName).map(([k, r]) => identityOf(k, r.label)))
  for (const key of allKeysOf(m)) {
    if (m.noIikoName?.[key] && known.has(identityOf(key, m.productLabels?.[key]))) continue
    const label = m.productLabels?.[key] ?? ''
    const price = m.planPairsByPack?.[key] ?? m.planPairs?.[key] ?? null
    // price — только чтобы различать строки-двойники с одинаковым описанием; noName — E была пустой (ключ из описания I)
    rows[key] = { label, price, ...(m.noIikoName?.[key] ? { noName: true } : {}) }
    // у строки появилось настоящее iiko-название — старый ключ «из описания» (noName) с тем же описанием больше не нужен
    if (!m.noIikoName?.[key]) {
      const id = identityOf(key, label)
      for (const [k, r] of Object.entries(rows)) if (k !== key && r.noName && identityOf(k, r.label) === id) delete rows[k]
    }
  }
  return { savedAt: new Date().toISOString(), rows, supplierAlias: { ...(prev?.supplierAlias ?? {}), ...(m.supplierAlias ?? {}) } }
}

/** Накладывает каталог на «ободранную» матрицу: возвращает matching с прежними ключами (iiko-название + фасовка). */
export function applyCatalog(m, catalog) {
  if (!catalog?.rows) return m
  // идентичность -> очередь ключей каталога (в порядке сохранения)
  const queues = new Map()
  for (const [key, row] of Object.entries(catalog.rows)) {
    const id = identityOf(key, row.label)
    if (!id) continue
    if (!queues.has(id)) queues.set(id, [])
    queues.get(id).push(key)
  }
  const used = new Set()
  const remap = new Map()
  const keys = allKeysOf(m)
  for (const key of keys) if (!m.noIikoName?.[key]) { remap.set(key, key); used.add(key) } // строки со своим E остаются как есть (в т.ч. вернувшиеся после удаления колонок)
  for (const key of keys) {
    if (remap.has(key)) continue
    const id = identityOf(key, m.productLabels?.[key])
    const price = m.planPairsByPack?.[key] ?? m.planPairs?.[key] ?? null
    const free = id ? (queues.get(id) ?? []).filter((k) => !used.has(k)) : []
    // двойники (одно описание у одного поставщика): сперва та же цена, потом по порядку
    const cand = free.find((k) => (catalog.rows[k].price ?? null) === price) ?? free[0]
    if (cand) { remap.set(key, cand); used.add(cand) } else remap.set(key, key)
  }
  const out = { ...m, planPairs: {}, planPairsByPack: {}, productLabels: {}, noPriceExact: {}, noIikoName: {}, ambiguous: {}, supplierAlias: { ...(catalog.supplierAlias ?? {}), ...(m.supplierAlias ?? {}) } }
  const hasPack = (k) => k.split('::').length > 3
  for (const [k, price] of Object.entries(m.planPairsByPack ?? {})) { const nk = remap.get(k); (hasPack(nk) ? out.planPairsByPack : out.planPairs)[nk] = price }
  for (const [k, price] of Object.entries(m.planPairs ?? {})) { const nk = remap.get(k); (hasPack(nk) ? out.planPairsByPack : out.planPairs)[nk] = price }
  for (const k of Object.keys(m.noPriceExact ?? {})) out.noPriceExact[remap.get(k)] = true
  for (const [k, label] of Object.entries(m.productLabels ?? {})) out.productLabels[remap.get(k) ?? k] = label
  for (const k of Object.keys(m.noIikoName ?? {})) { const nk = remap.get(k) ?? k; if (nk === k || catalog.rows[nk]?.noName) out.noIikoName[nk] = true } // перепривязанные строки больше не «без названия» (кроме тех, у кого и в каталоге E была пустой)
  for (const [k, v] of Object.entries(m.ambiguous ?? {})) out.ambiguous[remap.get(k) ?? k] = v
  return out
}
