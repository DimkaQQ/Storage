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
    return { ok: true, message: `Подключение есть. Вкладок в таблице: ${titles.length}, из них узнано точек: ${known.length}.` }
  } catch (e) {
    return { ok: false, message: String(e.message || e) }
  }
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
export async function syncMatrix({ googleSheetId, googleServiceAccountKey }, sheetToRestaurant = SHEET_TO_RESTAURANT) {
  const token = await getAccessToken(googleServiceAccountKey)
  const titles = await fetchSheetTitles(token, googleSheetId)
  const sheets = titles.filter((t) => sheetToRestaurant[t])
  if (!sheets.length) throw new Error('Ни одна вкладка таблицы не узнана — проверьте названия вкладок (см. SHEET_TO_RESTAURANT в sheets.js)')

  // Без верхней границы по строке (не C3:I5000) — Sheets API читает до
  // конца реальных данных листа. Фиксированный потолок в 5000 строк рос бы
  // молча: превысила бы таблица его — часть строк матрицы тихо пропала бы
  // из синка без единой ошибки.
  const ranges = sheets.flatMap((t) => [`'${t}'!C3:I`])
  const valueRanges = await batchGetValues(token, googleSheetId, ranges)

  const supplierAlias = {}
  const planPairs = {}
  const planPairsByPack = {}
  const productLabels = {}
  const noPriceExact = {}
  let rowsSeen = 0

  sheets.forEach((title, i) => {
    const restaurant = norm(sheetToRestaurant[title])
    const rows = valueRanges[i]?.values || []
    for (const row of rows) {
      const [supplierCanonRaw, iikoCompanyRaw, iikoNameRaw, packRaw, , priceRaw, labelRaw] = row
      if (!iikoNameRaw || !supplierCanonRaw) continue
      rowsSeen++
      const supplierCanon = norm(supplierCanonRaw)
      if (iikoCompanyRaw) supplierAlias[norm(iikoCompanyRaw)] = supplierCanon
      const product = norm(iikoNameRaw)
      const pack = packRaw ? normPack(packRaw) : ''
      const flatKey = `${restaurant}::${supplierCanon}::${product}`
      const key = pack ? `${flatKey}::${pack}` : flatKey
      const hasPrice = priceRaw !== undefined && priceRaw !== null && priceRaw !== ''
      if (hasPrice) {
        const price = Number(priceRaw)
        if (Number.isFinite(price)) {
          if (pack) planPairsByPack[key] = price
          else planPairs[key] = price
          if (labelRaw) productLabels[key] = String(labelRaw)
        }
      } else {
        noPriceExact[key] = true
      }
    }
  })

  return {
    matching: { supplierAlias, planPairs, planPairsByPack, productLabels, noPriceExact },
    summary: { sheets: sheets.length, rows: rowsSeen, planPairs: Object.keys(planPairs).length, planPairsByPack: Object.keys(planPairsByPack).length },
  }
}

/**
 * Алматы и Астана — два отдельных googleSheetId, синкаются отдельными
 * кнопками/запросами, но хранятся в ОДНОМ файле единой матрицы (см.
 * getMatrix/saveMatrix в store.js) — иначе пришлось бы менять формат
 * хранения и /api/matching. Ключи внутри каждой карты уже включают имя
 * ресторана (restaurant::supplier::product[::pack]), а рестораны Алматы и
 * Астаны не пересекаются по имени, так что просто объединяем карты —
 * синк одного города не задевает уже сохранённые данные другого.
 */
export function mergeMatching(a, b) {
  if (!a) return b
  if (!b) return a
  return {
    supplierAlias: { ...a.supplierAlias, ...b.supplierAlias },
    planPairs: { ...a.planPairs, ...b.planPairs },
    planPairsByPack: { ...a.planPairsByPack, ...b.planPairsByPack },
    productLabels: { ...a.productLabels, ...b.productLabels },
    noPriceExact: { ...a.noPriceExact, ...b.noPriceExact },
  }
}
