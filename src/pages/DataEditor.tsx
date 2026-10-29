import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fmt, plural, norm, normPack, matchRestaurant, linkTargets, bundledMatching, bundledDataset, capitalize, scopedMatching, BUNDLED_PERIODS, parseDataset, computeRows, EMPTY_EDITS, Row, anySupplierAlias, supplierAliasFor, isExcludedPair } from '../lib/data'
import { useEdits } from '../lib/edits'
import { syncMatrix } from '../lib/api'
import { rankSimilar } from '../lib/fuzzy'
import { Section, InfoTip, Checkbox } from '../components/ui'
import { EditableText } from '../components/EditableCell'
import ProductLabelSuggest from '../components/ProductLabelSuggest'
import HoverName from '../components/HoverName'
import { ISearch, IFilter, IChevron, IReset, IUndo, IStore, IDatabase, IPin, ICheck, ISync } from '../components/icons'

type Tab = 'suppliers' | 'products' | 'venues'
type SupplierFilter = 'all' | 'new'

/**
 * Мгновенная подсказка по наведению (портал, та же механика, что у InfoTip/
 * HoverName) — вместо нативного title: тот почти наверняка ВСЕ РАВНО
 * всплывёт следом, с задержкой браузера в 1.5-2с, и будет выглядеть второй,
 * запоздавшей подсказкой поверх уже показанной (ровно так однажды и
 * спутало в Проверке цен — см. заметку к строке там же).
 */
function HoverTip({ text, children }: { text: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [tip, setTip] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const TIP_WIDTH = 260

  const open = () => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const m = 10
    const left = Math.max(m + TIP_WIDTH / 2, Math.min(window.innerWidth - m - TIP_WIDTH / 2, r.left + r.width / 2))
    const below = r.bottom + 100 < window.innerHeight
    const top = below ? r.bottom + 8 : r.top - 8
    setTip({ left, top, below })
  }
  const close = () => setTip(null)

  return (
    <span ref={ref} className="inline-flex" onMouseEnter={open} onMouseLeave={close}>
      {children}
      {tip && createPortal(
        <div
          style={{
            position: 'fixed', left: tip.left, top: tip.top, width: TIP_WIDTH,
            transform: `translateX(-50%) ${tip.below ? '' : 'translateY(-100%)'}`,
          }}
          className="pointer-events-none z-[100] whitespace-pre-wrap rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-xs font-normal leading-relaxed text-fg-200 shadow-xl"
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  )
}

export default function DataEditor() {
  const {
    edits, rows, renameSupplier, setVenue,
    acknowledgeSupplier, unacknowledgeSupplier, setProductLink, pendingProductLinks, stageProductLink, undo, canUndo,
    suppliers: suppliersBase, restaurants, matching, periodKey, refreshMatrix,
    catalogDirty, catalogChanges, savingCatalog, saveCatalog,
  } = useEdits()
  // "N правок" — раньше было просто число без объяснений; теперь клик по
  // чипу раскрывает список, какая именно строка поменялась (см.
  // catalogChanges в lib/edits.tsx).
  const [changesOpen, setChangesOpen] = useState(false)
  const changesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!changesOpen) return
    const h = (e: MouseEvent) => { if (changesRef.current && !changesRef.current.contains(e.target as Node)) setChangesOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [changesOpen])
  // "Обновить" — перечитать матрицу прямо из Google-таблицы (например,
  // если там только что поправили название компании/товара), без захода в
  // Настройки iiko. Дёргаем оба региона сразу — Астана может быть ещё не
  // настроена (googleSheetId пуст), тогда её sync просто вернёт ok:false
  // с понятным сообщением, это не ошибка, которую нужно показывать, если
  // Алматы при этом обновилась нормально.
  const [matrixSyncing, setMatrixSyncing] = useState(false)
  const [matrixSyncMsg, setMatrixSyncMsg] = useState<string | null>(null)
  // Неоднозначности из самой Google-таблицы (одна и та же пара
  // поставщик+товар записана несколько раз под разными ценами — см.
  // matching.ambiguous в data.ts) больше не разбираются тут общим
  // списком — теперь это видно и решается прямо в Проверке цен, на
  // конкретной закупке этого периода (см. AmbiguousPicker в
  // PriceCheck.tsx), а не одним выбором "навсегда" для всей сети.
  const refreshFromMatrix = async () => {
    setMatrixSyncing(true); setMatrixSyncMsg(null)
    const [almaty, astana] = await Promise.all([syncMatrix('almaty'), syncMatrix('astana')])
    await refreshMatrix()
    setMatrixSyncing(false)
    setMatrixSyncMsg(almaty.ok || astana.ok ? 'Обновлено' : (almaty.message || astana.message || 'Не удалось обновить'))
  }
  // Подсказки автопоиска (Компании/Товары) должны предлагать то, что уже
  // реально известно, даже когда включён тестовый режим "без матрицы" —
  // там `matching` подменяется на пустую специально, чтобы показать
  // приложение так, будто матрицы вообще нет, но подсказки при этом не
  // должны исчезать: печатаем "лос" — ищем среди уже известных названий
  // (настоящей матрицы), а не среди пустоты теста.
  const realMatching = useMemo(() => bundledMatching(periodKey), [periodKey])
  const [tab, setTab] = useState<Tab>('suppliers')
  // Товары — не вкладка по умолчанию (открывается Компании), а расчёт
  // "уже известных названий за все периоды" (см. otherPeriodsRows ниже) —
  // самая дорогая часть Справочников; не считаем её, пока реально не
  // открыли Товары, чтобы заход на Справочники не платил эту цену просто
  // так. once true — остаётся true, дальше кэш живёт независимо от того,
  // переключаются ли обратно на другие вкладки.
  const [productsVisited, setProductsVisited] = useState(tab === 'products')
  useEffect(() => { if (tab === 'products') setProductsVisited(true) }, [tab])
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(60)
  const [sFilter, setSFilter] = useState<SupplierFilter>('all')
  // Выбор точки — верхнеуровневый фильтр, общий для Компаний и Товаров (в
  // т.ч. «Нет в матрице»), не только для Товаров, как было раньше. Пусто —
  // вся сеть, как и было. При выборе точки список Компаний показывает
  // только тех, кто реально привозит что-то именно в неё (со своим счётом
  // позиций), а клик по компании переключает на Товары с поиском по этой
  // же компании — так видно сразу и что она везёт в эту точку, и что из
  // этого «нет в матрице» именно здесь.
  const [editorRestaurant, setEditorRestaurant] = useState('')

  // Фильтр Товаров (значок слева от строки поиска). Название и Фасовка — оба
  // чек-лист с поиском внутри, как в Google Sheets (значений в каждом не
  // так много, чтобы это было неудобно). Каждая категория — раскрывающаяся
  // секция (открыта максимум одна), а то чек-листы сами по себе длинные и
  // раздували бы панель целиком.
  const [filterOpen, setFilterOpen] = useState(false)
  // «Нет в матрице» свёрнута по умолчанию — список может быть длинным
  // (десятки закупок), а внимания требует не постоянно, только когда
  // реально нужно кого-то привязать.
  const [unmatchedOpen, setUnmatchedOpen] = useState(false)
  // «Без названия в iiko» — тоже свёрнута по умолчанию, по тем же причинам.
  const [noIikoNameOpen, setNoIikoNameOpen] = useState(false)
  const [filterSection, setFilterSection] = useState<'restaurant' | 'name' | 'pack' | null>(null)
  const [excludedRestaurant, setExcludedRestaurant] = useState<Set<string>>(new Set())
  const [excludedName, setExcludedName] = useState<Set<string>>(new Set())
  const [excludedPack, setExcludedPack] = useState<Set<string>>(new Set())
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const needle = q.trim().toLowerCase()

  // Компании для ОДНОЙ выбранной точки (см. editorRestaurant) — suppliersBase
  // (из parseDataset) считает позиции по всей сети сразу, без разбивки по
  // ресторану; здесь считаем заново из уже готовых `rows`, у каждой из
  // которых есть свой restaurant. null — ничего не выбрано, работаем как
  // раньше, по всей сети (suppliersBase).
  const suppliersForRestaurant = useMemo(() => {
    if (!editorRestaurant) return null
    const map = new Map<string, { name: string; count: number; isNew: boolean }>()
    for (const r of rows) {
      if (r.unit == null || r.restaurant !== editorRestaurant) continue
      const s = map.get(r.supplier) ?? { name: r.supplier, count: 0, isNew: anySupplierAlias(matching, r.supplier) == null }
      s.count++
      map.set(r.supplier, s)
    }
    return [...map.values()]
  }, [rows, editorRestaurant, matching])
  const suppliersBaseEffective = suppliersForRestaurant ?? suppliersBase

  // «Нет в справочнике» — учитываем ручную правку: отметили «это новый
  // поставщик» — строка больше не считается нерешённой.
  const isUnresolved = (name: string) =>
    !anySupplierAlias(matching, name) && !edits.acknowledgedSuppliers[name]

  const supplierCounts = useMemo(() => ({
    all: suppliersBaseEffective.length,
    new: suppliersBaseEffective.filter((s) => isUnresolved(s.name)).length,
  }), [suppliersBaseEffective, edits.acknowledgedSuppliers, matching])

  const suppliers = useMemo(() => {
    let list = needle ? suppliersBaseEffective.filter((s) => s.name.toLowerCase().includes(needle)) : suppliersBaseEffective
    if (sFilter === 'new') list = list.filter((s) => isUnresolved(s.name))
    return list
  }, [needle, edits.acknowledgedSuppliers, sFilter, suppliersBaseEffective, matching])

  // norm(каноническое название поставщика) -> отображаемое написание — то же
  // сопоставление, что строит computeRows в data.ts, нужно здесь отдельно
  // для показа поставщика человеческим написанием, а не нормализованным
  // куском ключа матрицы.
  const supplierDisplayByNorm = useMemo(() => {
    const map = new Map<string, string>()
    for (const canon of Object.values(realMatching.supplierAlias)) map.set(norm(canon), canon)
    return map
  }, [realMatching])
  const restaurantDisplayByNorm = useMemo(() => {
    const map = new Map<string, string>()
    // ключ — название в МАТРИЦЕ (учитывая привязку точки к вкладке), значение — название точки в приложении
    for (const r of restaurants) map.set(norm(matchRestaurant(edits, r.name)), r.name)
    return map
  }, [restaurants, edits.venueOverrides])

  // Вкладки/рестораны матрицы, которые можно выбрать для привязки точки из
  // iiko: norm-имя -> основное название. Матрица читает ВСЕ вкладки
  // таблицы (см. syncMatrix) — новая вкладка сразу появляется в списке. У
  // ранее синканной матрицы (без restaurantNames) список собираем по ключам.
  const matrixNames = useMemo(() => {
    const out = new Map<string, string>()
    for (const [n, d] of Object.entries(realMatching.restaurantNames ?? {})) out.set(n, d)
    if (out.size === 0) {
      for (const k of [...Object.keys(realMatching.planPairs), ...Object.keys(realMatching.planPairsByPack), ...Object.keys(realMatching.noPriceExact)]) {
        const n = k.split('::')[0]
        if (!out.has(n)) out.set(n, capitalize(n))
      }
      // без restaurantNames (матрицу ещё не синкали после обновления) настоящий регистр
      // известен только у точек приложения — подставляем их написание вместо «Ле дом»/«Цфк»
      for (const r of restaurants) if (out.has(norm(r.name))) out.set(norm(r.name), r.name)
    }
    return out
  }, [realMatching, restaurants])
  // Вкладки матрицы выбранного города (Алматы — основная таблица, Астана — отдельная):
  // norm-имя -> название вкладки как на самой вкладке. Без tabsByTarget (матрицу ещё не
  // синкали после обновления) — все известные вкладки.
  const tabsOf = (city: string): Map<string, string> => {
    const list = realMatching.tabsByTarget?.[city === 'Астана' ? 'astana' : 'almaty']
    if (!list) return matrixNames
    const out = new Map<string, string>()
    for (const n of list) if (matrixNames.has(norm(n))) out.set(norm(n), matrixNames.get(norm(n)) as string)
    return out
  }

  // Товары — теперь строятся ОТ МАТРИЦЫ, а не от закупок iiko: раньше шли
  // от факта покупки и искали его в матрице по точному совпадению текста;
  // источник истины теперь сама матрица (лист «Сырьё F»), а название из
  // iiko — то, что мы САМИ назначаем конкретной строке (см. Edits.
  // productLinks в data.ts) — одна компания может привезти два разных
  // товара под одним и тем же iiko-названием, различить их по голому
  // тексту нельзя. Одна строка — restaurant+supplier+товар матрицы (+
  // фасовка, если матрица прайсует её отдельно); дедуп "с фасовкой
  // побеждает плоскую запись" — та же логика, что уже строит computeRows
  // для строк "план есть, ещё не куплено" в Проверке цен.
  interface MatrixRow {
    key: string; restaurantNorm: string; restaurant: string
    supplierNorm: string; supplier: string
    productSegment: string; matrixLabel: string
    pack: string; plan: number
  }
  const matrixRows = useMemo(() => {
    // scopedMatching — та же матрица, но обрезанная до точек в
    // RESTAURANT_SCOPE (кэшируется по ссылке на matching, см. data.ts):
    // без этого ниже шёл полный проход по ~4000 ключам всей сети ради
    // ~500 реально нужных, и push() всё равно отбрасывал остальное.
    const m = scopedMatching(matching, linkTargets(edits))
    const packBrokenDownPairKeys = new Set(
      Object.keys(m.planPairsByPack).map((k) => k.split('::').slice(0, 3).join('::')),
    )
    const result: MatrixRow[] = []
    const push = (key: string, restaurantNorm: string, supplierNorm: string, productSegment: string, pack: string, plan: number) => {
      const restaurant = restaurantDisplayByNorm.get(restaurantNorm)
      if (!restaurant) return // ресторан вне текущего охвата приложения — не показываем
      result.push({
        key, restaurantNorm, restaurant,
        supplierNorm, supplier: supplierDisplayByNorm.get(supplierNorm) ?? supplierNorm,
        productSegment, matrixLabel: m.productLabels[key] ?? capitalize(productSegment),
        pack, plan,
      })
    }
    for (const [key, plan] of Object.entries(m.planPairsByPack)) {
      const [restaurantNorm, supplierNorm, productSegment, pack] = key.split('::')
      push(key, restaurantNorm, supplierNorm, productSegment, pack, plan)
    }
    for (const [key, plan] of Object.entries(m.planPairs)) {
      if (packBrokenDownPairKeys.has(key)) continue
      const [restaurantNorm, supplierNorm, productSegment] = key.split('::')
      push(key, restaurantNorm, supplierNorm, productSegment, '', plan)
    }
    return result
  }, [matching, restaurantDisplayByNorm, supplierDisplayByNorm])

  // «Настоящие» строки матрицы — НЕ зависят от тестового режима "без
  // матрицы" (там `matching` подменяется на пустую, и основной список
  // Товаров искусственно пустеет — так и задумано). Но подсказки для
  // привязки в «Нет в матрице» должны продолжать предлагать реально
  // известные товары даже тогда — тот же принцип, что и у остальных
  // автопоисков в этом файле (см. комментарий у realMatching в начале).
  const realMatrixRows = useMemo(() => {
    if (!productsVisited) return [] // нужно только для подсказок в Товарах — не считаем, пока вкладку не открыли
    const m = scopedMatching(realMatching, linkTargets(edits))
    const packBrokenDownPairKeys = new Set(
      Object.keys(m.planPairsByPack).map((k) => k.split('::').slice(0, 3).join('::')),
    )
    const result: { restaurant: string; supplierNorm: string; supplier: string; productSegment: string; matrixLabel: string }[] = []
    const push = (key: string, restaurantNorm: string, supplierNorm: string, productSegment: string) => {
      const restaurant = restaurantDisplayByNorm.get(restaurantNorm)
      if (!restaurant) return
      result.push({
        restaurant, supplierNorm, supplier: supplierDisplayByNorm.get(supplierNorm) ?? supplierNorm,
        productSegment, matrixLabel: m.productLabels[key] ?? capitalize(productSegment),
      })
    }
    for (const key of Object.keys(m.planPairsByPack)) {
      const [restaurantNorm, supplierNorm, productSegment] = key.split('::')
      push(key, restaurantNorm, supplierNorm, productSegment)
    }
    for (const key of Object.keys(m.planPairs)) {
      if (packBrokenDownPairKeys.has(key)) continue
      const [restaurantNorm, supplierNorm, productSegment] = key.split('::')
      push(key, restaurantNorm, supplierNorm, productSegment)
    }
    return result
  }, [productsVisited, realMatching, restaurantDisplayByNorm, supplierDisplayByNorm])

  // Варианты для назначения "нет в матрице -> товар из матрицы" — не
  // ограничиваем поставщиком: иногда закупка реально записана не за той
  // компанией (перепутали при вводе в iiko, или правда купили не у того,
  // кого назначили) — привязка сама по себе безопасна и в этом случае:
  // supplierCanon для сопоставления всегда берётся из САМОЙ закупки, не
  // из выбранной подсказки, так что если выбранный товар в матрице на
  // самом деле числится за другим поставщиком, после привязки это
  // корректно всплывёт как «заказ не по матрице», а не тихо подменится.
  // Один и тот же поставщик+товар нередко прайсован сразу у нескольких
  // ресторанов (лист «Сырьё F» — общий на всех) — при наведении на
  // подсказку показываем не только поставщика, но и для каких точек он
  // прайсован, чтобы сразу было видно, найдётся ли цена именно для
  // текущего ресторана, или только у других.
  const restaurantsByTarget = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const row of realMatrixRows) {
      const key = `${row.supplierNorm}::${row.productSegment}`
      const set = map.get(key) ?? new Set<string>()
      set.add(row.restaurant)
      map.set(key, set)
    }
    return map
  }, [realMatrixRows])
  const allMatrixProductOptions = useMemo(() => {
    const seen = new Map<string, { label: string; targetProduct: string; supplierName: string }>()
    for (const row of realMatrixRows) {
      const dedupeKey = `${row.supplierNorm}::${row.productSegment}`
      if (seen.has(dedupeKey)) continue
      seen.set(dedupeKey, { label: row.matrixLabel, targetProduct: row.productSegment, supplierName: row.supplier })
    }
    // Поставщик дописывается всегда, не только когда текст товара реально
    // задвоен (подтверждено явно человеком) — он подсказывает, какая это
    // компания, даже когда названия у разных поставщиков просто ПОХОЖИ
    // (не идентичны, но легко перепутать на вид), а не только когда они
    // буквально совпадают — раньше в этом случае подсказка ничем не
    // отличалась от обычной, хотя разница ровно в поставщике.
    return [...seen.values()]
      .map((o) => ({ label: `${o.label} — ${o.supplierName}`, targetProduct: o.targetProduct }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [realMatrixRows])

  // «Уже известные» названия из iiko — не только из просматриваемого
  // прямо сейчас периода, а из ВСЕХ периодов, что вообще есть в
  // приложении (май и июнь). То же самое название обычно повторяется
  // месяц к месяцу — если сейчас смотрим июнь, а купили только в мае,
  // это всё равно уже известное название, нет причин требовать покупку
  // именно в этом периоде, чтобы его подставить.
  //
  // Считается С EMPTY_EDITS и ОДИН РАЗ (пустые deps), не на каждую правку:
  // здесь нужен только r.productRaw (сырое название из iiko), а его edits
  // не меняют вообще (правки бьют только по отображаемому product/
  // matchedKey, не по productRaw). Раньше это гоняло полный computeRows по
  // всей матрице (buildDesignatedIndex + buildKnownFlatIndex — тысячи
  // ключей) на КАЖДУЮ правку — на реальных данных замерено ~35-85мс
  // синхронной работы за раз, и это и было причиной подвисания вкладки.
  // Дубликаты с "живыми" `rows` за текущий период (см. allKnownRows ниже)
  // не страшны — productRaw у них одинаковый вне зависимости от edits, а
  // Set/Map ниже и так дедуплицируют по значению. Не считаем вовсе, пока
  // не открыли Товары (см. productsVisited) — эта нужна только там.
  const otherPeriodsRows = useMemo(() => {
    if (!productsVisited) return []
    const all: Row[] = []
    for (const p of BUNDLED_PERIODS) {
      const m = bundledMatching(p.period)
      all.push(...computeRows(parseDataset(bundledDataset(p.period), m).base, EMPTY_EDITS, m))
    }
    return all
  }, [productsVisited])
  const allKnownRows = useMemo(() => [...rows, ...otherPeriodsRows], [rows, otherPeriodsRows])

  // Автопоиск для колонки «Название из iiko» у строки матрицы — реально
  // встреченные в закупках названия, за оба периода, без ограничения
  // поставщиком (та же логика, что и выше для «Нет в матрице» — привязка
  // сама по себе безопасна, supplierCanon для сопоставления всегда берётся
  // из закупки, а не из подсказки, поставщик тут вообще ни на что не
  // влияет). Дедуп по самому тексту — список только текстов, без
  // поставщика: показывать его (даже во всплывающей табличке) только
  // захламляло список у дженериковых названий вроде "Ягода с/м в асс",
  // которые под тем же текстом привозит добрый десяток разных компаний.
  const allIikoNameOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of allKnownRows) {
      if (r.unit == null) continue
      seen.add(r.productRaw)
    }
    return [...seen].sort((a, b) => a.localeCompare(b)).map((label) => ({ label }))
  }, [allKnownRows])

  // Уже НАЗНАЧЕННОЕ вручную название (для очистки старой привязки при
  // замене — см. commitMatrixIikoName) — обратный индекс по edits.
  // productLinks, считаем один раз, а не пересканированием на каждую
  // строку. Ключ — «ресторан::поставщик(канон)::targetProduct::фасовка»;
  // ресторан/поставщик/фасовка всегда берутся из самой строки матрицы
  // (link.restaurant/link.supplier/link.pack), пользователь их не вводит
  // вручную — это просто не даёт одинаковому тексту у разных ресторанов/
  // поставщиков/разных товаров-ассортиментов "слипнуться" в одну привязку
  // (см. Edits.productLinks).
  const linkedRawNameByTarget = useMemo(() => {
    const map = new Map<string, string>()
    for (const link of Object.values(edits.productLinks)) {
      map.set(`${norm(link.restaurant)}::${norm(link.supplier)}::${norm(link.targetProduct)}::${link.pack}`, link.rawProduct)
    }
    return map
  }, [edits.productLinks])

  // Привязки той же пары "ресторан+поставщик+targetProduct", но БЕЗ
  // фасовки в ключе — нужны как запасной путь для linkedRawNameByTarget:
  // привязку для этой же строки матрицы могли завести НЕ отсюда, а через
  // «Нет в матрице» (там в ключ идёт фасовка САМОЙ ЗАКУПКИ, см.
  // stageUnmatchedLink), и эта фасовка совершенно не обязана совпадать с
  // фасовкой строки матрицы (row.pack) — живой случай: матрица прайсует
  // авокадо "за кг", а iiko пишет закупку "1 шт". Раньше из-за этого
  // привязку, заведённую через «Нет в матрице», тут было невозможно ни
  // увидеть, ни снять — точный ключ по row.pack просто не находил её.
  const linksByTargetGroup = useMemo(() => {
    const map = new Map<string, { pack: string; rawProduct: string }[]>()
    for (const link of Object.values(edits.productLinks)) {
      const key = `${norm(link.restaurant)}::${norm(link.supplier)}::${norm(link.targetProduct)}`
      const list = map.get(key) ?? []
      list.push({ pack: link.pack, rawProduct: link.rawProduct })
      map.set(key, list)
    }
    return map
  }, [edits.productLinks])

  // Сколько РАЗНЫХ фасовок матрица вообще знает под этим названием у этого
  // поставщика в этом ресторане. Больше одной — это ассортимент (разные
  // фасовки означают буквально разные товары, см. isAssortment в data.ts),
  // и тогда фасовку в ключе привязки трогать нельзя — только точный
  // запасной путь выше рискует перепутать привязку одной фасовки с другой.
  // Фасовка ровно одна — гадать не с чем, запасной путь безопасен.
  const packCountByTarget = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of matrixRows) {
      const key = `${row.restaurantNorm}::${row.supplierNorm}::${row.productSegment}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [matrixRows])

  // Явная привязка для ЭТОЙ строки матрицы — точный ключ (фасовка строки
  // матрицы) побеждает, если нашёлся; иначе, когда для этого названия в
  // матрице только одна фасовка вообще, берём единственную привязку на эту
  // пару, даже если она хранится под другим текстом фасовки (см. выше).
  // Возвращает фасовку, под которой привязка РЕАЛЬНО лежит — она нужна,
  // чтобы снять её по точно тому же ключу, не выдумывая свой.
  const resolveExplicitLink = (row: MatrixRow): { rawProduct: string; pack: string } | null => {
    const exact = linkedRawNameByTarget.get(`${row.restaurantNorm}::${row.supplierNorm}::${row.productSegment}::${row.pack}`)
    if (exact) return { rawProduct: exact, pack: row.pack }
    const groupKey = `${row.restaurantNorm}::${row.supplierNorm}::${row.productSegment}`
    if ((packCountByTarget.get(groupKey) ?? 1) <= 1) {
      const candidates = linksByTargetGroup.get(groupKey) ?? []
      if (candidates.length === 1) return candidates[0]
    }
    return null
  }

  // Что РЕАЛЬНО подтягивается к этой строке матрицы прямо сейчас — не
  // только явные привязки (linkedRawNameByTarget), но и обычное прямое
  // совпадение текста, которое работает и без всякой привязки. Строим из
  // уже посчитанных `rows`: у каждой купленной позиции есть matchedKey —
  // ключ матрицы, который она реально притянула (см. Row.matchedKey и
  // resolveRowPlan) — тот же самый ключ, что у строки матрицы здесь.
  const matchedRawNamesByKey = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const r of allKnownRows) {
      if (r.unit == null || !r.matchedKey || !r.productRaw) continue
      const set = map.get(r.matchedKey) ?? new Set<string>()
      set.add(r.productRaw)
      map.set(r.matchedKey, set)
    }
    return map
  }, [allKnownRows])

  const commitMatrixIikoName = (row: MatrixRow, displayedName: string, nextRaw: string) => {
    const next = nextRaw.trim()
    if (next === displayedName) return
    // То, что сейчас показано в поле, могло быть обычным прямым
    // совпадением текста (без всякой привязки) — тогда снимать нечего.
    // Явную старую привязку (если реально была) ищем отдельно по тому же
    // ключу строки матрицы, а не по тому, что было в поле — иначе при
    // замене названия рискуем не найти, что удалять. resolveExplicitLink
    // находит её, даже если она когда-то была заведена под другой
    // фасовкой (через «Нет в матрице») — и возвращает ИМЕННО тот ключ,
    // под которым она реально лежит, чтобы снять её точно, а не мимо.
    const explicit = resolveExplicitLink(row)
    if (explicit) setProductLink(`${row.restaurantNorm}::${row.supplierNorm}::${norm(explicit.rawProduct)}::${explicit.pack}`, null)
    if (next) {
      // Фасовка строки матрицы в ключе новой привязки нужна, только если
      // у этого названия в матрице их вообще несколько (ассортимент) — а
      // если она одна, привязка без фасовки (плоский ключ) сработает для
      // любой закупки этого названия, независимо от того, как именно iiko
      // у себя записал фасовку (см. комментарий у packCountByTarget).
      const groupKey = `${row.restaurantNorm}::${row.supplierNorm}::${row.productSegment}`
      const packMatters = (packCountByTarget.get(groupKey) ?? 1) > 1
      const linkPack = packMatters ? row.pack : ''
      setProductLink(`${row.restaurantNorm}::${row.supplierNorm}::${norm(next)}::${linkPack}`, { targetProduct: row.productSegment, supplier: row.supplier, rawProduct: next, pack: linkPack, restaurant: row.restaurant })
    }
  }

  // «Нет в матрице» — закупки этого периода, для которых ни прямое
  // совпадение текста, ни привязка не нашли ни строки в матрице вообще
  // (см. Row.status в data.ts). Отдельная секция: это либо реально новый
  // товар (предстоит завести в самой Google-таблице), либо просто
  // разошедшееся написание — тогда достаточно привязать эту закупку к уже
  // существующему товару из матрицы прямо здесь.
  interface UnmatchedRow {
    key: string; restaurant: string; supplier: string; supplierNorm: string; product: string; pack: string | null; count: number; note: string | null
  }
  // Раньше эта секция вообще не учитывала ни поиск, ни фильтр по ресторану
  // с Товаров (подтверждено человеком явно, что это мешает) — теперь оба
  // применяются: editorRestaurant (верхнеуровневый выбор точки) и needle
  // (тот же поиск, что и у Товаров) сужают список точно так же, как сами
  // Товары.
  const unmatchedRows = useMemo(() => {
    const groups = new Map<string, UnmatchedRow>()
    for (const r of rows) {
      if (r.unit == null || r.status !== 'nomatrix') continue
      if (editorRestaurant && r.restaurant !== editorRestaurant) continue
      const supplierCanon = supplierAliasFor(matching, matchRestaurant(edits, r.restaurant), r.supplier) ?? r.supplier
      // И сырое название (как в iiko), и каноническое (как в матрице) —
      // переход "Товары →" из Компаний передаёт сюда каноническое, а сам
      // человек может искать и тем и другим текстом.
      if (needle && !r.restaurant.toLowerCase().includes(needle) && !r.supplier.toLowerCase().includes(needle) &&
        !supplierCanon.toLowerCase().includes(needle) &&
        !r.productRaw.toLowerCase().includes(needle) && !(r.pack || '').toLowerCase().includes(needle)) continue
      const supplierNorm = norm(supplierCanon)
      const key = `${norm(matchRestaurant(edits, r.restaurant))}::${supplierNorm}::${norm(r.productRaw)}::${r.pack ? normPack(r.pack) : ''}`
      let g = groups.get(key)
      // note — та же подсказка, что resolveRowPlan уже готовит (у поставщика
      // есть цена по другой фасовке, но она не совпала) — объясняет, ПОЧЕМУ
      // не сошлось, а не просто "не сошлось". Раньше рядом ещё были кнопки
      // "похоже, это она" (угадывание по клику) — убрали: голая фасовка
      // ("кг" без уточнения) у товара-ассортимента ничего не говорит о
      // конкретном вкусе, и однажды подтверждённая привязка применялась бы
      // ко всем будущим закупкам с тем же текстом, даже если там на самом
      // деле другой вкус — слишком рискованно угадывать одним кликом.
      if (!g) {
        g = { key, restaurant: r.restaurant, supplier: r.supplier, supplierNorm, product: r.productRaw, pack: r.pack, count: 0, note: r.note }
        groups.set(key, g)
      }
      g.count++
    }
    return [...groups.values()]
  }, [rows, matching, editorRestaurant, needle, edits.venueOverrides])

  // Строки матрицы без названия в iiko (столбец E пуст) — попросили прямо:
  // не гадать молча (см. nameBasis в server/src/sheets.js — строка всё
  // равно подтягивается под их собственным описанием, I), а явно показать
  // "тут чего-то не хватает, впишите" — мы не можем писать обратно в саму
  // Google-таблицу (сервисный аккаунт только читает), это вправе
  // исправить только тот, кто ведёт таблицу.
  interface NoNameRow { key: string; restaurant: string; supplier: string; description: string; pack: string; price: number | null }
  const noIikoNameRows = useMemo(() => {
    const m = scopedMatching(matching, linkTargets(edits))
    if (!m.noIikoName) return []
    const out: NoNameRow[] = []
    for (const key of Object.keys(m.noIikoName)) {
      const [restaurantNorm, supplierNorm, , pack] = key.split('::')
      const restaurant = restaurantDisplayByNorm.get(restaurantNorm)
      if (!restaurant) continue
      if (editorRestaurant && restaurant !== editorRestaurant) continue
      const supplier = supplierDisplayByNorm.get(supplierNorm) ?? supplierNorm
      const description = m.productLabels[key] ?? ''
      if (isExcludedPair(supplier, description) || isExcludedPair(supplierNorm, description)) continue
      if (needle && !restaurant.toLowerCase().includes(needle) && !supplier.toLowerCase().includes(needle) &&
        !description.toLowerCase().includes(needle)) continue
      const price = m.planPairsByPack[key] ?? m.planPairs[key] ?? null
      out.push({ key, restaurant, supplier, description, pack: pack || '', price })
    }
    return out
  }, [matching, restaurantDisplayByNorm, supplierDisplayByNorm, editorRestaurant, needle])

  // Черновик, не применяется к rows сразу (см. Ctx.pendingProductLinks) —
  // строка остаётся в «Нет в матрице», пока не нажата общая «Сохранить»
  // (подтверждено явно: раньше привязка срабатывала мгновенно, строка
  // тут же пропадала из вида, и было не разобрать, то ли правда сохранилось,
  // то ли нет — теперь поле сразу показывает выбор, а список обновляется
  // только по кнопке).
  const stageUnmatchedLink = (u: UnmatchedRow, targetProduct: string | undefined) => {
    const pack = u.pack ? normPack(u.pack) : ''
    const key = u.key
    if (!targetProduct) { stageProductLink(key, null); return }
    // link.supplier — то же каноническое написание, что кладёт
    // commitMatrixIikoName (row.supplier = supplierDisplayByNorm...), не
    // сырое u.supplier (как было: iiko-поставщик "ИП Иванов..." вместо
    // канона "Ромашка") — linkedRawNameByTarget (обратный индекс для снятия
    // старой привязки при переименовании на вкладке Товары) ищет именно по
    // канону через row.supplierNorm, а норм(сырого названия) с ним не
    // совпадёт никогда — привязка, заведённая отсюда, просто не находилась
    // бы и оставалась бы висеть в edits.productLinks навсегда.
    const supplier = supplierDisplayByNorm.get(u.supplierNorm) ?? u.supplier
    stageProductLink(key, { targetProduct, supplier, rawProduct: u.product, pack, restaurant: u.restaurant })
  }

  // Значения для чек-листов «Ресторан», «Название» и «Фасовка» — как в
  // Google Sheets, список всех встречающихся значений (независимо от того,
  // что сейчас отфильтровано остальным — иначе список "прыгал" бы при
  // каждом изменении).
  const restaurantValues = useMemo(() => [...new Set(matrixRows.map((r) => r.restaurant))].sort((a, b) => a.localeCompare(b)), [matrixRows])
  const nameValues = useMemo(() => [...new Set(matrixRows.map((r) => r.matrixLabel))].sort((a, b) => a.localeCompare(b)), [matrixRows])
  const packValues = useMemo(() => [...new Set(matrixRows.map((r) => r.pack || '—'))].sort((a, b) => a.localeCompare(b)), [matrixRows])

  // Поиск бьёт и по фасовке, и по тому, что реально подтягивается из iiko
  // (см. matchedRawNamesByKey — прямое совпадение текста тоже считается,
  // не только явная привязка). Фильтр (значок слева от поиска) — ресторан
  // (чек-лист — выбрать одну точку и работать только по ней), название
  // (чек-лист), фасовка (чек-лист). «План» больше не фильтр — цена не
  // редактируется, смотреть диапазон незачем, поправить неверную цену
  // теперь можно только в самой Google-таблице.
  const matrixRowsFiltered = useMemo(() => {
    let list = matrixRows
    if (needle) {
      list = list.filter((r) => {
        const matched = [...(matchedRawNamesByKey.get(r.key) ?? [])].join(' ')
        return r.restaurant.toLowerCase().includes(needle) || r.supplier.toLowerCase().includes(needle) ||
          r.matrixLabel.toLowerCase().includes(needle) || r.pack.toLowerCase().includes(needle) || matched.toLowerCase().includes(needle)
      })
    }
    if (excludedRestaurant.size || excludedName.size || excludedPack.size) {
      list = list.filter((r) =>
        !excludedRestaurant.has(r.restaurant) && !excludedName.has(r.matrixLabel) && !excludedPack.has(r.pack || '—'))
    }
    if (editorRestaurant) list = list.filter((r) => r.restaurant === editorRestaurant)
    return list
  }, [needle, matrixRows, excludedRestaurant, excludedName, excludedPack, matchedRawNamesByKey, editorRestaurant])

  const activeFilterDims = (excludedRestaurant.size ? 1 : 0) + (excludedName.size ? 1 : 0) + (excludedPack.size ? 1 : 0)
  const resetAllFilters = () => { setExcludedRestaurant(new Set()); setExcludedName(new Set()); setExcludedPack(new Set()) }

  // Компании без справочника (potentially typos of an existing поставщик,
  // а не реально новый) — предупреждаем, но ничего не делаем автоматически:
  // "Объединить" убрали сознательно, тут только подсказка "проверьте matrix".
  const canonicalSupplierNames = useMemo(() => [...new Set(Object.values(realMatching.supplierAlias))], [realMatching])
  // Раньше это была обычная функция, вызываемая по два раза за строку (один
  // раз на проверку "есть ли подсказка", второй — чтобы её напечатать) и
  // пересчитывающая rankSimilar по всему справочнику заново при каждом
  // рендере DataEditor — даже когда ни список поставщиков, ни справочник не
  // менялись. Считаем один раз на видимую страницу и только для строк, где
  // подсказка реально показывается (нет канона, поставщик не подтверждён).
  const duplicateByName = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const s of suppliers.slice(0, limit)) {
      if (anySupplierAlias(matching, s.name)) continue
      if (edits.acknowledgedSuppliers[s.name] === true) continue
      const top = rankSimilar(s.name, canonicalSupplierNames, (x) => x, 0.45)[0]
      map.set(s.name, top?.item ?? null)
    }
    return map
  }, [suppliers, limit, matching, edits.acknowledgedSuppliers, canonicalSupplierNames])
  // Автопоиск при переименовании — все уже известные названия (из матрицы
  // + уже введённые вручную правки), чтобы не плодить разные написания
  // одного и того же поставщика/товара: набрали "ази" — нашли "Азик Трейд",
  // даже если он уже был переименован кем-то другим, а не только в матрице.
  const supplierNameSuggestions = useMemo(
    () => [...new Set([...canonicalSupplierNames, ...Object.values(edits.supplierRenames)])].sort((a, b) => a.localeCompare(b)).map((label) => ({ label })),
    [canonicalSupplierNames, edits.supplierRenames],
  )

  const venues = useMemo(
    () => (needle ? restaurants.filter((r) => r.name.toLowerCase().includes(needle) || (r.alias ?? '').toLowerCase().includes(needle) || r.city.toLowerCase().includes(needle)) : restaurants),
    [needle, restaurants],
  )

  const shown = tab === 'suppliers' ? suppliers.slice(0, limit)
    : tab === 'products' ? matrixRowsFiltered.slice(0, limit)
    : venues.slice(0, limit)
  const total = tab === 'suppliers' ? suppliers.length
    : tab === 'products' ? matrixRowsFiltered.length
    : venues.length

  return (
    <div className="space-y-5">
      {/* intro + actions */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-300"><IDatabase width={18} height={18} /></span>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-fg-50">
              Справочники
              <InfoTip text="Здесь сверяем названия компаний, товаров и точек: как они приходят из iiko — и как записаны в матрице план-цен." />
            </div>
            <p className="mt-0.5 max-w-2xl text-xs text-fg-500">
              Правки держатся только у вас в браузере, пока не нажмёте «Сохранить» — тогда они уйдут на сервер и станут видны всем.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {catalogChanges.length > 0 && (
            <div className="relative" ref={changesRef}>
              <button
                onClick={() => setChangesOpen((v) => !v)}
                title="Показать, что именно изменилось"
                className="chip border-brand-500/40 bg-brand-500/10 text-brand-300 hover:bg-brand-500/20"
              >
                {fmt(catalogChanges.length)} {plural(catalogChanges.length, 'правка', 'правки', 'правок')}
                <IChevron width={11} height={11} className={`transition-transform ${changesOpen ? 'rotate-90' : ''}`} />
              </button>
              {changesOpen && (
                <div className="animate-scale-in absolute left-0 z-30 mt-2 max-h-80 w-96 overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 p-2 text-left shadow-card">
                  <ul className="space-y-0.5">
                    {catalogChanges.map((c, i) => (
                      <li key={i} className="rounded-md px-2 py-1.5 text-xs text-fg-200">{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {catalogDirty && !savingCatalog && (
            <span className="chip border-warn/30 bg-warn/10 text-warn">Есть несохранённое</span>
          )}
          {matrixSyncMsg && (
            <span className={`chip ${matrixSyncMsg === 'Обновлено' ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>{matrixSyncMsg}</span>
          )}
          <button
            onClick={refreshFromMatrix}
            disabled={matrixSyncing}
            title="Перечитать названия и цены прямо из Google-таблицы матрицы — если там только что что-то поправили"
            className="btn border border-ink-600 bg-ink-800/70 text-fg-300 hover:bg-ink-750 disabled:opacity-60"
          ><ISync width={16} height={16} className={matrixSyncing ? 'animate-spin' : ''} /> {matrixSyncing ? 'Обновляю…' : 'Обновить'}</button>
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Отменить последнее изменение"
            className="btn border border-ink-600 bg-ink-800/70 text-fg-300 hover:bg-ink-750 disabled:opacity-40 disabled:hover:bg-ink-800/70"
          ><IUndo width={16} height={16} /> Отменить</button>
          <button
            onClick={saveCatalog}
            disabled={!catalogDirty || savingCatalog}
            title="Отправить правки компаний/точек/привязок на сервер"
            className="btn bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
          ><ICheck width={16} height={16} /> {savingCatalog ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      </div>

      <Section title={undefined} right={undefined}>
        {/* Точка — общий фильтр для Компаний и Товаров (в т.ч. «Нет в
            матрице»); выбор здесь не трогает тестовый режим "без матрицы"
            выше и не зависит от чек-листа "Ресторан" в фильтре Товаров —
            оба применяются вместе. */}
        {tab !== 'venues' && (
          <div className="mb-3 flex items-center gap-2">
            <IPin width={14} height={14} className="shrink-0 text-fg-500" />
            <div className="relative">
              <select
                value={editorRestaurant}
                onChange={(e) => { setEditorRestaurant(e.target.value); setQ(''); setLimit(60) }}
                className="appearance-none rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 pr-8 text-sm text-fg-100 focus:border-brand-500 focus:outline-none"
              >
                <option value="">Все точки</option>
                {restaurants.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
              </select>
              <IChevron width={13} height={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 text-fg-500" />
            </div>
            {editorRestaurant && tab === 'suppliers' && (
              <span className="text-xs text-fg-500">Клик по компании — её товары и «нет в матрице» именно для этой точки.</span>
            )}
          </div>
        )}
        {/* tabs + search */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-ink-800/70 p-1">
            <button onClick={() => { setTab('suppliers'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'suppliers' ? 'bg-ink-700 text-fg-50' : 'text-fg-400'}`}>Компании ({fmt(suppliersBaseEffective.length)})</button>
            <button onClick={() => { setTab('products'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'products' ? 'bg-ink-700 text-fg-50' : 'text-fg-400'}`}>Товары ({fmt(matrixRows.length)})</button>
            <button onClick={() => { setTab('venues'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'venues' ? 'bg-ink-700 text-fg-50' : 'text-fg-400'}`}>Точки ({fmt(restaurants.length)})</button>
          </div>
          {/* Поиск — на любой вкладке в одном и том же месте этой группы; на
              Товарах перед ним появляется значок фильтра, слева от поиска. */}
          <div className="flex flex-1 items-center justify-end gap-2">
            {tab === 'products' && (
              <div className="relative" ref={filterRef}>
                <button
                  onClick={() => setFilterOpen((v) => !v)}
                  title="Фильтр по ресторану, названиям и фасовке (как в Google Sheets)"
                  className={`btn border px-3 py-2 text-xs ${filterOpen || activeFilterDims > 0 ? 'border-brand-500/50 bg-brand-500/10 text-brand-300' : 'border-ink-600 bg-ink-800/70 text-fg-300 hover:bg-ink-750'}`}
                >
                  <IFilter width={14} height={14} /> Фильтр{activeFilterDims > 0 ? ` (${activeFilterDims})` : ''}
                </button>
                {filterOpen && (
                  <div className="animate-scale-in absolute left-0 z-30 mt-1 w-[320px] rounded-xl border border-ink-700 bg-ink-850 p-2 shadow-card">
                    <FilterSection
                      label="Ресторан" active={excludedRestaurant.size > 0} open={filterSection === 'restaurant'}
                      onToggle={() => setFilterSection((s) => (s === 'restaurant' ? null : 'restaurant'))}
                    >
                      <ValueChecklist values={restaurantValues} excluded={excludedRestaurant} onChange={(next) => { setLimit(60); setExcludedRestaurant(next) }} />
                    </FilterSection>
                    <FilterSection
                      label="Название" active={excludedName.size > 0} open={filterSection === 'name'}
                      onToggle={() => setFilterSection((s) => (s === 'name' ? null : 'name'))}
                    >
                      <ValueChecklist values={nameValues} excluded={excludedName} onChange={(next) => { setLimit(60); setExcludedName(next) }} />
                    </FilterSection>
                    <FilterSection
                      label="Фасовка" active={excludedPack.size > 0} open={filterSection === 'pack'}
                      onToggle={() => setFilterSection((s) => (s === 'pack' ? null : 'pack'))}
                    >
                      <ValueChecklist values={packValues} excluded={excludedPack} onChange={(next) => { setLimit(60); setExcludedPack(next) }} />
                    </FilterSection>
                    <div className="mt-1 flex items-center justify-between px-1 pt-2">
                      <button onClick={resetAllFilters} className="text-xs text-fg-500 hover:text-bad">Сбросить всё</button>
                      <button onClick={() => setFilterOpen(false)} className="text-xs text-brand-300 hover:text-brand-200">Готово</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
              <ISearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-500" width={16} height={16} />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setLimit(60) }}
                placeholder={tab === 'products' ? 'Поиск товара, поставщика, ресторана или фасовки…' : tab === 'suppliers' ? 'Поиск компании…' : 'Поиск точки или города…'}
                className="w-full rounded-lg border border-ink-600 bg-ink-900/60 py-2 pl-9 pr-3 text-sm text-fg-100 placeholder:text-fg-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>
        </div>



        {tab === 'products' && unmatchedRows.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-xl border border-purple/30 bg-purple/[0.04]">
            <button
              onClick={() => setUnmatchedOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 border-b border-purple/20 px-3 py-2 text-left"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-purple" />
              <span className="text-xs font-medium text-purple">Нет в матрице ({fmt(unmatchedRows.length)})</span>
              <InfoTip text="Закупки этого периода, для которых нет строки в матрице ни по прямому совпадению названия, ни по привязке. Либо это реально новый товар — его предстоит завести в самой Google-таблице («Сырьё F»); либо просто у iiko другое написание того же товара — тогда привяжите его прямо здесь, выбрав нужный товар из матрицы." align="left" />
              <IChevron width={13} height={13} className={`ml-auto shrink-0 text-purple/70 transition-transform duration-150 ${unmatchedOpen ? 'rotate-90' : ''}`} />
            </button>
            {unmatchedOpen && (
            <div className="max-h-[50vh] overflow-auto">
              <table className="w-full table-fixed">
                <thead className="sticky top-0 z-10 bg-ink-850">
                  <tr>
                    <th className="th w-[14%]">Ресторан</th>
                    <th className="th w-[18%]">Поставщик</th>
                    <th className="th w-[24%]">Название (iiko)</th>
                    <th className="th w-[12%]">Фасовка</th>
                    <th className="th w-[8%] text-right">Раз</th>
                    <th className="th w-[24%]">Название из матрицы</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedRows.map((u) => {
                    const options = allMatrixProductOptions
                    // Обычно после успешной привязки строка сама пропадает из
                    // этого списка (статус перестаёт быть «нет в матрице») —
                    // поле стартует пустым. Но если привязка уже стоит, а
                    // статус всё равно не сошёлся (например, разошлась ещё и
                    // фасовка) — не молчим об этом пустым полем, показываем,
                    // что уже назначено.
                    // Черновик (см. stageUnmatchedLink/pendingProductLinks)
                    // побеждает над уже применённой привязкой, если он есть —
                    // именно он показывает, что реально сейчас стоит в поле,
                    // пока не нажата «Сохранить». has() отличает "явно снят"
                    // (Map хранит null) от "вообще не трогали" (ключа нет).
                    const hasPending = pendingProductLinks.has(u.key)
                    const pendingLink = pendingProductLinks.get(u.key)
                    const currentLink = hasPending ? pendingLink : edits.productLinks[u.key]
                    const currentLabel = currentLink
                      ? (options.find((o) => o.targetProduct === norm(currentLink.targetProduct))?.label ?? currentLink.targetProduct)
                      : ''
                    // Привязали, но строка всё равно осталась тут (а не
                    // пропала из списка) — значит, для ЭТОГО ресторана в
                    // матрице всё равно нет цены на выбранный товар, хотя
                    // сам товар+поставщик в Сырьё F есть (просто прайсован
                    // для других точек). Отдельно от «этого товара вообще
                    // нет в матрице» — тут не молчим, а прямо говорим, для
                    // каких точек цена есть.
                    const pricedFor = currentLink ? restaurantsByTarget.get(`${u.supplierNorm}::${norm(currentLink.targetProduct)}`) : null
                    const notPricedHere = currentLink && !pricedFor?.has(u.restaurant)
                    return (
                      <tr key={u.key} className="row-hover hover:bg-ink-800/40">
                        <td className="td overflow-hidden text-xs text-fg-400"><HoverName text={u.restaurant} /></td>
                        <td className="td overflow-hidden text-xs text-fg-400"><HoverName text={u.supplier} /></td>
                        <td className="td overflow-hidden text-fg-100"><HoverName text={u.product} /></td>
                        <td className="td overflow-hidden text-xs text-fg-400"><HoverName text={u.pack || '—'} /></td>
                        <td className="td text-right tabnum text-fg-500">{fmt(u.count)}</td>
                        <td className="td">
                          <ProductLabelSuggest
                            value={currentLabel}
                            suggestions={options}
                            // matchOnly — тут можно только указать на
                            // существующий товар матрицы, а не вписать новый
                            // текст; см. комментарий у пропса в
                            // ProductLabelSuggest.
                            matchOnly
                            onCommit={(v) => {
                              // Пустое поле — явно снимаем привязку. Любой
                              // другой текст сюда долетает уже только как
                              // точное совпадение с подсказкой (matchOnly).
                              if (!v) { stageUnmatchedLink(u, undefined); return }
                              const picked = options.find((o) => o.label === v)
                              if (picked) stageUnmatchedLink(u, picked.targetProduct)
                            }}
                          />
                          {hasPending && (
                            <div className="mt-1 text-[11px] text-brand-300">Выбрано — нажмите «Сохранить» вверху, чтобы применить.</div>
                          )}
                          {notPricedHere && (
                            <div className="mt-1 text-[11px] text-fg-500">
                              В матрице есть у: {[...(pricedFor ?? [])].join(', ') || '—'} — но не у «{u.restaurant}».
                            </div>
                          )}
                          {!currentLink && u.note && (
                            <div className="mt-1 text-[11px] text-fg-500">{u.note}</div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        )}

        {tab === 'products' && noIikoNameRows.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/[0.04]">
            <button
              onClick={() => setNoIikoNameOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 border-b border-amber-500/20 px-3 py-2 text-left"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-medium text-amber-400">Без названия в iiko ({fmt(noIikoNameRows.length)})</span>
              <InfoTip text="В самой Google-таблице («Сырьё F») у этих строк пустая колонка «Наименования как в iiko» — мы не выдумываем название сами и не можем вписать его туда (сервисный аккаунт только читает таблицу), поэтому строка временно подтягивается под их собственным описанием товара. Поправить может только тот, кто ведёт таблицу — впишите туда реальное название из iiko." align="left" />
              <IChevron width={13} height={13} className={`ml-auto shrink-0 text-amber-500/70 transition-transform duration-150 ${noIikoNameOpen ? 'rotate-90' : ''}`} />
            </button>
            {noIikoNameOpen && (
            <div className="max-h-[50vh] overflow-auto">
              <table className="w-full table-fixed">
                <thead className="sticky top-0 z-10 bg-ink-850">
                  <tr>
                    <th className="th w-[16%]">Ресторан</th>
                    <th className="th w-[22%]">Поставщик</th>
                    <th className="th w-[40%]">Описание (из таблицы)</th>
                    <th className="th w-[12%]">Фасовка</th>
                    <th className="th w-[10%] text-right">Цена</th>
                  </tr>
                </thead>
                <tbody>
                  {noIikoNameRows.map((n) => (
                    <tr key={n.key} className="row-hover hover:bg-ink-800/40">
                      <td className="td overflow-hidden text-xs text-fg-400"><HoverName text={n.restaurant} /></td>
                      <td className="td overflow-hidden text-xs text-fg-400"><HoverName text={n.supplier} /></td>
                      <td className="td overflow-hidden text-fg-100"><HoverName text={n.description || '—'} /></td>
                      <td className="td overflow-hidden text-xs text-fg-400"><HoverName text={n.pack || '—'} /></td>
                      <td className="td text-right tabnum text-fg-500">{n.price != null ? fmt(n.price) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>
        )}

        {tab === 'suppliers' && (
          <div className="mb-3 flex flex-wrap gap-2">
            {([
              ['all', `Все (${fmt(supplierCounts.all)})`],
              ['new', `Нет в справочнике (${fmt(supplierCounts.new)})`],
            ] as [SupplierFilter, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => { setSFilter(id); setLimit(60) }}
                className={`chip transition-colors ${sFilter === id ? 'border-brand-400 bg-brand-500/10 text-brand-300' : 'border-ink-600 text-fg-400 hover:text-fg-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Собственный скролл-контейнер — прилипание шапки колонок надёжно
            работает только внутри реально скроллящегося бокса. Высота в vh
            (не привязана к пикселям шапки/тулбара) — коробка занимает почти
            весь экран, поэтому внешняя страница обычно вообще не скроллится
            сама, и ощущения "двух скроллов" не возникает. */}
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-ink-700/50">
          <table className="w-full table-fixed">
            <thead className="sticky top-0 z-10 bg-ink-850">
              {tab === 'suppliers' ? (
                <tr>
                  <th className="th w-[42%]">Название (iiko)</th>
                  <th className="th w-[28%]">Название из матрицы <InfoTip text="Название компании, обычно как в матрице — можно поправить вручную, например переименовать ИП. Влияет только на подпись, не на сопоставление. «Нет в справочнике» — этой компании нет в матрице ни под каким известным написанием; если это действительно новый поставщик — нажмите «Подтвердить»." /></th>
                  <th className="th w-[12%] text-right">Позиций</th>
                  <th className="th w-[18%] text-center">Действие</th>
                </tr>
              ) : tab === 'products' ? (
                <tr>
                  <th className="th w-[14%]">Ресторан <InfoTip text="Точка, к которой относится эта позиция — план-цена в матрице обычно своя у каждого ресторана, даже для того же товара и поставщика." /></th>
                  <th className="th w-[18%]">Поставщик</th>
                  <th className="th w-[26%]">Название из матрицы <InfoTip text="Их собственное описание товара (столбец I матрицы) — из самой Google-таблицы, здесь не редактируется." /></th>
                  <th className="th w-[14%]">Фасовка <InfoTip text="Как записана в самой матрице." /></th>
                  <th className="th w-[28%]">Название из iiko <InfoTip text="Что реально подтягивается сюда из закупок — за оба периода, что есть в приложении, не только за просматриваемый сейчас: то же название обычно повторяется месяц к месяцу. Значок «+N» — под этим же товаром матрицы встречаются и другие написания в iiko. Впишите/выберите название сами, чтобы закупки под ним точно сопоставлялись именно с этой строкой." /></th>
                </tr>
              ) : (
                <tr>
                  <th className="th w-[20%]">Основное название <InfoTip text="Название склада точки ровно как оно пришло из iiko (никакого списка названий в коде нет). По нему закупки привязаны к точке; здесь не редактируется. Дальше выберите город и вкладку матрицы этой точки." /></th>
                  <th className="th w-[20%]">Название у нас <InfoTip text="Как точка будет называться в этом приложении (Обзор, Проверка цен, выбор точек, Excel). Влияет только на подпись — закупки и матрица по-прежнему привязаны к основному названию. Пока не задано — подписью служит название выбранной вкладки матрицы (или основное название, если вкладка не выбрана)." /></th>
                  <th className="th w-[12%]">Город <InfoTip text="Алматы или Астана — в списке вкладок справа показываются вкладки таблицы этого города (Алматы — основная таблица, Астана — отдельная)." /></th>
                  <th className="th w-[22%]">Вкладка матрицы <InfoTip text="С какой вкладкой Google-таблицы сверяются закупки этой точки — названия ровно такие, как на вкладках загруженной матрицы. Если название точки совпало с названием вкладки — выбрана сама; иначе выберите вручную. Дальше закупки и план тянутся по этой вкладке, товары и поставщики проставляются во вкладке «Товары»." /></th>
                  <th className="th w-[14%]">Юрлицо</th>
                  <th className="th w-[10%]">Категория</th>
                </tr>
              )}
            </thead>
            <tbody>
              {tab === 'suppliers'
                ? (shown as typeof suppliersBase).map((s) => {
                    const canon = anySupplierAlias(matching, s.name)
                    const acknowledged = edits.acknowledgedSuppliers[s.name] === true
                    const supplierRename = edits.supplierRenames[s.name]
                    const duplicate = duplicateByName.get(s.name)
                    return (
                      <tr key={s.name} className="row-hover hover:bg-ink-800/40">
                        <td className="td overflow-hidden text-fg-400">
                          <span className="flex min-w-0 items-center gap-2">
                            <IStore width={14} height={14} className="shrink-0 text-fg-600" /><HoverName text={s.name} />
                            {editorRestaurant && (
                              <button
                                onClick={() => { setTab('products'); setQ(supplierAliasFor(matching, matchRestaurant(edits, editorRestaurant), s.name) ?? s.name); setLimit(60); setUnmatchedOpen(true) }}
                                title={`Товары и «нет в матрице» этой компании в «${editorRestaurant}»`}
                                className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-brand-300 hover:bg-brand-500/10"
                              >
                                Товары →
                              </button>
                            )}
                          </span>
                        </td>
                        <td className="td overflow-hidden">
                          <div className="flex items-center gap-1.5">
                            <ProductLabelSuggest
                              value={supplierRename ?? canon ?? ''}
                              suggestions={supplierNameSuggestions}
                              onCommit={(v) => renameSupplier(s.name, v)}
                              className={supplierRename ? undefined : canon ? 'text-good' : undefined}
                            />
                            {supplierRename && <span className="chip shrink-0 border-transparent bg-brand-500/10 text-[10px] text-brand-300">правка</span>}
                          </div>
                          {!canon && (
                            acknowledged ? (
                              <span className="chip mt-1 w-fit border-transparent bg-ink-700 text-[11px] text-fg-400">новый поставщик</span>
                            ) : (
                              <div className="mt-1 flex min-w-0 flex-col gap-0.5">
                                <span className="chip w-fit border-transparent bg-warn/10 text-[11px] text-warn">нет в справочнике</span>
                                {duplicate && (
                                  <span className="flex items-center gap-1 text-[11px] text-fg-500">
                                    похоже на «{duplicate}»?
                                    <InfoTip text="Это не точное совпадение, а похожее по написанию название, уже занесённое в справочник — возможно, это тот же поставщик, просто иначе записанный в iiko (опечатка, сокращение). Перед «Подтвердить» стоит свериться с матрицей." align="left" />
                                  </span>
                                )}
                              </div>
                            )
                          )}
                        </td>
                        <td className="td text-right tabnum text-fg-400">{fmt(s.count)}</td>
                        <td className="td text-center">
                          {acknowledged ? (
                            <button onClick={() => unacknowledgeSupplier(s.name)} className="btn mx-auto border border-bad/40 bg-bad/10 px-2 py-1 text-xs text-bad hover:bg-bad/20" title="Вернуть — снова считать нерешённым, показывать в «Нет в справочнике»">
                              <IReset width={13} height={13} /> Вернуть
                            </button>
                          ) : !canon ? (
                            <button onClick={() => acknowledgeSupplier(s.name)} className="btn mx-auto border border-ink-600 bg-ink-800/70 px-2 py-1 text-xs text-fg-300 hover:border-good/50 hover:text-good" title="Отметить — это действительно новый поставщик (саму правку ещё нужно будет сохранить общей кнопкой «Сохранить» сверху)">
                              <ICheck width={12} height={12} /> Подтвердить
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })
                : tab === 'products'
                ? (shown as typeof matrixRowsFiltered).map((row) => {
                    const explicitLink = resolveExplicitLink(row)?.rawProduct
                    // Что реально сейчас подтягивается — не только явная
                    // привязка, но и обычное прямое совпадение текста (см.
                    // matchedRawNamesByKey). Явную привязку показываем в
                    // поле первой, если она есть (это то, что назначили
                    // сами); если совпало ещё что-то (несколько разных
                    // написаний у одного и того же товара) — не молчим,
                    // считаем отдельным значком рядом.
                    const matchedNames = [...(matchedRawNamesByKey.get(row.key) ?? [])]
                    // Явная привязка побеждает; иначе — реально подтверждённое
                    // покупкой название; а если и покупки не было ни разу —
                    // всё равно есть с чем сравнивать: сама строка матрицы уже
                    // хранит iiko-название (то, из чего её когда-то собрали),
                    // просто в нормализованном виде — показываем его как есть
                    // (с заглавной буквы), это буквально то, с чем сверяется
                    // сопоставление прямо сейчас, даже без единой покупки.
                    const fromMatrixKey = capitalize(row.productSegment)
                    const primary = explicitLink && matchedNames.includes(explicitLink) ? explicitLink
                      : matchedNames[0] ?? explicitLink ?? fromMatrixKey
                    const extra = matchedNames.filter((n) => n !== primary)
                    return (
                      <tr key={row.key} className="row-hover hover:bg-ink-800/40">
                        <td className="td overflow-hidden text-xs text-fg-400">
                          <span className="flex min-w-0 items-center gap-1.5"><IPin width={12} height={12} className="shrink-0 text-fg-600" /><HoverName text={row.restaurant} /></span>
                        </td>
                        <td className="td overflow-hidden text-xs text-fg-400"><HoverName text={row.supplier} /></td>
                        <td className="td overflow-hidden"><HoverName text={row.matrixLabel} className="font-medium text-fg-100" /></td>
                        <td className="td overflow-hidden text-xs text-fg-400"><HoverName text={row.pack || '—'} /></td>
                        <td className="td">
                          <div className="flex items-center gap-1.5">
                            <ProductLabelSuggest
                              value={primary}
                              suggestions={allIikoNameOptions}
                              onCommit={(v) => commitMatrixIikoName(row, primary, v)}
                            />
                            {extra.length > 0 && (
                              <HoverTip text={`Ещё встречается под другим написанием: ${extra.join(', ')}`}>
                                <span className="chip shrink-0 border-transparent bg-ink-700 text-[10px] text-fg-400">
                                  +{extra.length}
                                </span>
                              </HoverTip>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                : (shown as typeof venues).map((r) => (
                    <tr key={r.name} className="row-hover hover:bg-ink-800/40">
                      <td className="td overflow-hidden text-fg-400">
                        <span className="flex min-w-0 items-center gap-2">
                          <IPin width={14} height={14} className="shrink-0 text-fg-600" /><HoverName text={r.name} className="min-w-0 flex-1" />
                        </span>
                      </td>
                      <td className="td"><EditableText value={r.alias ?? r.name} onCommit={(v) => {
                        const next = v.trim() === r.name ? '' : v.trim()
                        if (next === (r.alias ?? '')) return
                        // Название должно отличать точки друг от друга: не совпадать ни с iiko-названием, ни с чужим своим названием.
                        if (next && restaurants.some((o) => o.name !== r.name && [o.name, o.alias ?? ''].some((x) => norm(x) === norm(next)))) {
                          window.alert(`Название «${next}» уже занято другой точкой — выберите другое.`)
                          return
                        }
                        setVenue(r.name, { alias: next })
                      }} className="max-w-[220px]" /></td>
                      <td className="td">
                        <select
                          value={r.city === 'Астана' ? 'Астана' : 'Алматы'}
                          onChange={(e) => setVenue(r.name, { city: e.target.value, matrix: '' })}
                          className="w-full max-w-[110px] rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-fg-100 focus:border-brand-500 focus:outline-none"
                        >
                          <option value="Алматы">Алматы</option>
                          <option value="Астана">Астана</option>
                        </select>
                      </td>
                      <td className="td">
                        {(() => {
                          const auto = tabsOf(r.city).get(norm(r.name))
                          const value = r.matrix ?? auto ?? ''
                          return (
                            <select
                              value={value}
                              onChange={(e) => {
                                const v = e.target.value
                                setVenue(r.name, { matrix: !v || norm(v) === norm(r.name) ? '' : v })
                              }}
                              className={`w-full max-w-[220px] rounded-md border bg-ink-900/60 px-2 py-1.5 text-sm text-fg-100 focus:border-brand-500 focus:outline-none ${value ? 'border-ink-600' : 'border-warn/60'}`}
                              title={value ? undefined : 'Эта точка пока не привязана ни к одной вкладке матрицы — закупки будут «Нет в матрице»'}
                            >
                              {!value && <option value="">— выберите вкладку —</option>}
                              {[...new Set([...tabsOf(r.city).values(), ...(value ? [value] : [])])].sort((a, b) => a.localeCompare(b)).map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          )
                        })()}
                      </td>
                      <td className="td"><EditableText value={r.entity} onCommit={(v) => setVenue(r.name, { entity: v })} className="max-w-[180px]" /></td>
                      <td className="td"><EditableText value={r.category} onCommit={(v) => setVenue(r.name, { category: v })} className="max-w-[140px]" /></td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="py-12 text-center text-sm text-fg-500">Ничего не найдено.</div>}
        </div>

        {total > shown.length && (
          <div className="pt-3 text-center">
            <button onClick={() => setLimit((l) => l + 100)} className="btn text-brand-300 hover:text-brand-200">Показать ещё ({fmt(total - shown.length)})</button>
          </div>
        )}
      </Section>
    </div>
  )
}

/**
 * Раскрывающаяся секция фильтра — заголовок с шевроном, содержимое видно
 * только когда открыта. Открыта максимум одна (сворачивается предыдущая),
 * чтобы длинный чек-лист фасовок не раздувал панель, когда он не нужен.
 * Точка рядом с названием — там сейчас что-то отфильтровано, даже если
 * секция свёрнута и не видно содержимого.
 */
function FilterSection({ label, active, open, onToggle, children }: {
  label: string; active: boolean; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="border-b border-ink-700/50 last:border-b-0">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-2 text-left text-xs font-medium text-fg-300 transition-colors hover:text-fg-50">
        <span className="flex items-center gap-1.5">
          {label}
          {active && <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />}
        </span>
        <IChevron width={13} height={13} className={`text-fg-500 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="px-1.5 pb-2.5">{children}</div>}
    </div>
  )
}

/**
 * Список значений колонки с чекбоксами — как в фильтре Google Sheets:
 * поиск сужает видимый список (не сами данные), «Выбрать все»/«Очистить»
 * действуют на видимый (отфильтрованный поиском) список. Пусто в
 * excluded = ничего не исключено = все отмечены, как открытый фильтр.
 */
function ValueChecklist({ values, excluded, onChange }: {
  values: string[]; excluded: Set<string>; onChange: (next: Set<string>) => void
}) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const filtered = needle ? values.filter((v) => v.toLowerCase().includes(needle)) : values

  const selectAll = () => { const next = new Set(excluded); for (const v of filtered) next.delete(v); onChange(next) }
  const clearAll = () => { const next = new Set(excluded); for (const v of filtered) next.add(v); onChange(next) }
  const toggle = (v: string) => {
    const next = new Set(excluded)
    if (next.has(v)) next.delete(v); else next.add(v)
    onChange(next)
  }

  return (
    <div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
        placeholder="Поиск значений…"
        className="mb-1.5 w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-fg-100 placeholder:text-fg-600 focus:border-brand-500 focus:outline-none"
      />
      <div className="mb-1.5 flex gap-3 text-[11px]">
        <button onClick={selectAll} className="text-brand-300 hover:text-brand-200">Выбрать все</button>
        <button onClick={clearAll} className="text-fg-500 hover:text-fg-300">Очистить</button>
      </div>
      <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
        {filtered.length === 0 && <div className="py-4 text-center text-xs text-fg-600">Ничего не найдено</div>}
        {filtered.map((v) => (
          <label key={v} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-fg-200 hover:bg-ink-800">
            <Checkbox checked={!excluded.has(v)} onChange={() => toggle(v)} />
            <span className="truncate">{v || '—'}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

