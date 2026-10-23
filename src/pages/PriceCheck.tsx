import { MouseEvent as ReactMouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Row, ROW_COLORS, Status, STATUS_META, AmbiguousVariant, money, pct, fmt, summarize, norm, capitalize } from '../lib/data'
import { useEdits } from '../lib/edits'
import { StatusBadge, InfoTip } from '../components/ui'
import HoverName from '../components/HoverName'
import MultiSelectFilter, { FilterOption } from '../components/MultiSelectFilter'
import { ISearch, ISort, IDownload, IArrowUp, IArrowDown, IEdit, IClose } from '../components/icons'

type SortKey = 'product' | 'restaurant' | 'supplier' | 'plan' | 'sum' | 'diff'

// Что показываем в колонках План/Факт/Δ — два режима, переключатель
// "Деньги / ₸ за кг" в тулбаре (временно, для показа заказчику обеих
// версий сразу). "За кг" — старое поведение: цена за единицу матрицы, на
// мелких фасовках (банка 16г за 2000₸) даёт пугающие "125 000₸/кг", хотя
// реально заплатили 2000₸. "Деньги" — новое: Факт — сколько реально
// заплатили за эту закупку (qty*цена), План — сколько ожидали заплатить за
// ТО ЖЕ количество (план-цена*qty). Если позицию вообще не покупали
// (r.unit === null, строка из матрицы "не закупали") — в обоих режимах
// показываем план-цену за единицу как есть, умножать её не на что.
function factMoneyOf(r: Row): number | null { return r.unit != null ? r.qty * r.unit : null }
function planMoneyOf(r: Row): number | null {
  if (r.plan == null) return null
  return r.unit != null ? r.plan * r.qty : r.plan
}
// Δ = План − Факт (попросили явно развернуть знак): положительная разница —
// заплатили МЕНЬШЕ плана (экономия), отрицательная — БОЛЬШЕ плана (переплата).
function diffMoneyOf(r: Row): number | null {
  const f = factMoneyOf(r), p = planMoneyOf(r)
  return f != null && p != null ? p - f : null
}
function factUnitOf(r: Row): number | null { return r.unit }
function planUnitOf(r: Row): number | null { return r.plan }
function diffUnitOf(r: Row): number | null {
  return r.unit != null && r.plan != null ? r.plan - r.unit : null
}

const STATUS_FILTERS: { id: Status; label: string }[] = [
  { id: 'ok', label: 'По матрице' },
  { id: 'wrongSupplier', label: 'Заказ не по матрице' },
  { id: 'nomatrix', label: 'Нет в матрице' },
  { id: 'notPurchased', label: 'Не закупали' },
]

export default function PriceCheck({ rows }: { rows: Row[] }) {
  const { setRowComment, setRowColor, setAmbiguousChoice, period } = useEdits()
  const [q, setQ] = useState('')
  const [active, setActive] = useState<Set<Status>>(new Set())
  // «С заметкой» — строки, где уже есть свой комментарий или цветовая
  // метка (любая из них, не обе сразу) — быстро найти то, что уже
  // разбирали/помечали вручную, без поиска по тексту.
  const [onlyNoted, setOnlyNoted] = useState(false)
  // «Только расхождения» — скрыть строки, где факт==план (Δ ровно 0): их
  // объективно не нужно проверять, а по сумме они только засоряют список
  // между настоящими расхождениями (прямой запрос — "убрать 0, чтобы
  // проверять только расхождения"). Строки БЕЗ плана/факта (Δ === null —
  // "Нет в матрице", "Заказ не по матрице", "Не закупали") не трогаем —
  // это не "ноль", а отдельная, самостоятельная проблема, прятать её сюда
  // не просили.
  const [onlyDiff, setOnlyDiff] = useState(false)
  // "Скрыть пустые" — прямой запрос: отдельная, самостоятельная кнопка для
  // строк без факта вообще ("Не закупали" — ни Факта, ни Δ, сравнивать не
  // с чем) — ровно то, что "Только расхождения" сознательно НЕ трогает
  // (см. комментарий выше). Было бы и так уже возможно через чипы статуса
  // (снять "Не закупали"), но отдельная кнопка быстрее для частого случая
  // "просто сократить список до того, что реально закупили".
  const [hideEmpty, setHideEmpty] = useState(false)
  // Поставщик/Товар — отдельные фильтры с множественным выбором и поиском
  // внутри самого списка (см. MultiSelectFilter) — прямой запрос: обычный
  // <select> не позволял ни выбрать несколько значений сразу, ни набрать
  // текст, чтобы сузить длинный список. Пустое множество — фильтр не
  // применяется.
  const [supplierFilter, setSupplierFilter] = useState<Set<string>>(new Set())
  const [productFilter, setProductFilter] = useState<Set<string>>(new Set())
  // По умолчанию — по поставщику (см. key === 'supplier' в filtered ниже:
  // ресторан по алфавиту, внутри — порядок поставщиков как на вкладке
  // этого ресторана в самой матрице) — попросили явно: открывается список
  // уже сгруппированным по поставщику, а не раскиданным по сумме закупки.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'supplier', dir: 1 })
  // Переключатель двух версий расчёта Плана/Факта/Δ (см. комментарий у
  // factMoneyOf выше) — временно, чтобы показать заказчику обе сразу без
  // пересборки/переключения веток. По умолчанию — новая (деньги).
  const [moneyMode, setMoneyMode] = useState(true)
  const factOf = moneyMode ? factMoneyOf : factUnitOf
  const planOf = moneyMode ? planMoneyOf : planUnitOf
  const diffOf = moneyMode ? diffMoneyOf : diffUnitOf
  // Открытый попап "заметка/цвет" — по rowKey строки, не по id (id меняется
  // между парсингами, а попап открыт как раз пока пользователь печатает).
  const [openNoteFor, setOpenNoteFor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // Голый текст вида "1.5", "1 шт 20 гр", "0.056 сикс" — это ФАСОВКА, а не
  // название товара. Берётся из "их собственного описания" в самой матрице
  // (столбец I) — иногда туда вписан вес/тара вместо настоящего названия
  // (путаница в самой Google-таблице, не у нас), а для строк "Не закупали"
  // Row.product вообще может оказаться именно этим описанием (см.
  // addPlanOnlyRow в data.ts). Прямой запрос — "надо видеть что это за
  // товар", а не фасовку.
  const looksLikePack = (s: string) => {
    let t = s.trim().toLowerCase()
    if (!t) return false
    t = t.replace(/\d+([.,]\d+)?/g, '') // числа (целые и дробные)
    t = t.replace(/(кг|гр|г|мл|л|шт|уп|бан(?:ка)?|кор|пач|сикс)/g, '') // частые единицы/тара
    t = t.replace(/[\s*/x.,-]/g, '') // соединители
    return t.length === 0
  }
  // Настоящее название товара для ЭТОЙ строки — если то, что обычно
  // показываем (их описание или уже решённое название), на поверку просто
  // фасовка, пробуем более надёжные поля по очереди: для "Не закупали" —
  // само iiko-название из ключа матрицы (Row.matchedKey, 3-й сегмент,
  // пока ещё не подменено их описанием); для настоящих закупок — сырое
  // название из iiko (Row.productRaw), которое их описание как раз и могло
  // заслонить. Если и это не помогло — показываем как есть, хоть что-то
  // лучше пустой строки.
  const productNameFor = (r: Row): string => {
    const primary = r.unit == null ? r.product : (r.productLabel ?? r.product)
    if (!looksLikePack(primary)) return primary
    if (r.unit == null && r.matchedKey) {
      const seg = r.matchedKey.split('::')[2]
      if (seg && !looksLikePack(seg)) return capitalize(seg)
    }
    if (r.productRaw && !looksLikePack(r.productRaw)) return r.productRaw
    return primary
  }
  // Поставщик — ключ сам по себе уже однозначен (их же название). Товар —
  // НЕТ: даже настоящее название может повторяться у разных поставщиков
  // (разные компании возят один и тот же "Сыр моцарелла") — пока не видно,
  // у какого именно поставщика он встретился, не всегда понятно, тот ли
  // это товар. Поэтому ключ товара — ПАРА товар+поставщик (sublabel
  // показывает поставщика под названием в самом списке).
  const supplierKeyOf = (r: Row) => r.supplierLabel ?? r.supplier
  const productKeyOf = (r: Row) => `${productNameFor(r)}::${r.supplierLabel ?? r.supplier}`

  // Варианты для фильтров — считаем по ВСЕМ rows (не по filtered), иначе
  // список сужался бы вместе с результатом, и снять уже выбранный фильтр,
  // чтобы найти другой, было бы неочевидно.
  const supplierOptions = useMemo(() => {
    const seen = new Map<string, FilterOption>()
    for (const r of rows) { const label = supplierKeyOf(r); if (!seen.has(label)) seen.set(label, { key: label, label }) }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])
  const productOptions = useMemo(() => {
    const seen = new Map<string, FilterOption>()
    for (const r of rows) {
      const key = productKeyOf(r)
      if (!seen.has(key)) seen.set(key, { key, label: productNameFor(r), sublabel: r.supplierLabel ?? r.supplier })
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label) || a.sublabel!.localeCompare(b.sublabel!))
  }, [rows])

  // Звёздочки — тот же товар у того же поставщика в том же ресторане может
  // встретиться несколько раз под разной фасовкой (банка 400гр и банка
  // 250гр и т.п.) — без отметки такие строки выглядели бы как случайно
  // задвоенные. По всем статусам сразу (не только "Нет в матрице"/"Заказ не
  // по матрице" — попросили везде), считаем по ВСЕМ rows (не по filtered) —
  // чтобы номер звезды не прыгал при поиске/фильтрах, и по тому же
  // принципу, что и в Обзоре (см. Dashboard.tsx): номер — по алфавиту
  // фасовки, стабильно. Вынесено НАД filtered — groupStarsAdjacent ниже
  // использует эту же карту при сортировке.
  const starGroupKey = (r: Row) => `${norm(r.restaurant)}::${norm(r.supplier)}::${norm(r.productLabel ?? r.product)}`
  const starByRowKey = useMemo(() => {
    const map = new Map<string, number>()
    const groups = new Map<string, Row[]>()
    for (const r of rows) {
      const k = starGroupKey(r)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(r)
    }
    for (const group of groups.values()) {
      // Звезда — за РАЗЛИЧНУЮ фасовку, не за отдельную строку: если этот же
      // товар+поставщик+фасовку купили дважды отдельными закупками за
      // период, это не два разных "варианта", это одна и та же позиция —
      // им обеим достаётся один и тот же номер.
      const packs = [...new Set(group.map((r) => norm(r.pack)))].sort((a, b) => a.localeCompare(b))
      if (packs.length < 2) continue
      const starByPack = new Map(packs.map((p, i) => [p, i + 1]))
      for (const r of group) map.set(r.rowKey, starByPack.get(norm(r.pack))!)
    }
    return map
  }, [rows])

  // Строки одной "звёздной" группы (тот же товар+поставщик+ресторан, разные
  // фасовки — например "Табаско 60мл ★1" и "Табаско 150мл ★2") попросили
  // держать РЯДОМ друг с другом, а не вразнобой там, где их поставит
  // основная сортировка (по факту/плану/разнице — у разных фасовок обычно
  // разные суммы). Группа встаёт на место своего первого (по основной
  // сортировке) представителя, а внутри — по номеру звезды; порядок строк
  // без звезды не трогаем вообще.
  function groupStarsAdjacent(sorted: Row[]): Row[] {
    const groups = new Map<string, Row[]>()
    for (const r of sorted) {
      if (!starByRowKey.has(r.rowKey)) continue
      const k = starGroupKey(r)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(r)
    }
    for (const list of groups.values()) list.sort((a, b) => starByRowKey.get(a.rowKey)! - starByRowKey.get(b.rowKey)!)
    const placed = new Set<string>()
    const out: Row[] = []
    for (const r of sorted) {
      if (!starByRowKey.has(r.rowKey)) { out.push(r); continue }
      const k = starGroupKey(r)
      if (placed.has(k)) continue
      placed.add(k)
      out.push(...groups.get(k)!)
    }
    return out
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let r = rows
    if (active.size) r = r.filter((x) => active.has(x.status))
    if (onlyNoted) r = r.filter((x) => x.userComment || x.rowColor)
    if (onlyDiff) r = r.filter((x) => diffOf(x) !== 0)
    if (hideEmpty) r = r.filter((x) => x.status !== 'notPurchased')
    if (supplierFilter.size) r = r.filter((x) => supplierFilter.has(supplierKeyOf(x)))
    if (productFilter.size) r = r.filter((x) => productFilter.has(productKeyOf(x)))
    if (needle) {
      r = r.filter((x) =>
        x.product.toLowerCase().includes(needle) || x.supplier.toLowerCase().includes(needle) ||
        x.restaurant.toLowerCase().includes(needle) || x.pack.toLowerCase().includes(needle) ||
        // ...и по "их" названиям из матрицы — можно искать "Тамаки" даже
        // когда основное поле показывает общее iiko-название "Соус ореховый".
        (x.productLabel ?? '').toLowerCase().includes(needle) || (x.supplierLabel ?? '').toLowerCase().includes(needle),
      )
    }
    const dir = sort.dir
    const key = sort.key
    const sorted = [...r].sort((a, b) => {
      if (key === 'sum') return ((factOf(a) ?? 0) - (factOf(b) ?? 0)) * dir
      if (key === 'plan') return ((planOf(a) ?? -Infinity) - (planOf(b) ?? -Infinity)) * dir
      if (key === 'diff') return ((diffOf(a) ?? -Infinity) - (diffOf(b) ?? -Infinity)) * dir
      // Поставщик — не просто алфавит: сортируем так, чтобы все позиции
      // одного поставщика шли подряд в том же порядке, что и на вкладке
      // этого ресторана в самой матрице (Row.matrixOrder), а не вразнобой —
      // прямой запрос, упрощает ручную сверку с таблицей построчно.
      // Группировка по ресторану — всегда по алфавиту, направление (dir)
      // меняет только порядок поставщиков внутри ресторана, не сам список
      // ресторанов, иначе "перевернуть сортировку" путало бы ещё и их.
      if (key === 'supplier') {
        const rCmp = a.restaurant.localeCompare(b.restaurant)
        if (rCmp !== 0) return rCmp
        const oCmp = (a.matrixOrder - b.matrixOrder) * dir
        if (oCmp !== 0) return oCmp
        return a.supplier.localeCompare(b.supplier) * dir
      }
      const av = a[key], bv = b[key]
      return av.localeCompare(bv) * dir
    })
    return groupStarsAdjacent(sorted)
  }, [rows, q, active, sort, moneyMode, onlyNoted, onlyDiff, hideEmpty, supplierFilter, productFilter, starByRowKey])

  const s = useMemo(() => summarize(filtered), [filtered])
  // Раньше была ручная кнопка "Показать ещё" (убрана — не работала как
  // ожидалось), а рендер вообще без пагинации тормозит на ~1000+ строк —
  // подгружаем партиями АВТОМАТИЧЕСКИ по приближению к низу списка
  // (IntersectionObserver на невидимый сентинел ниже таблицы), без ручного
  // клика.
  const PAGE_SIZE = 80
  const [limit, setLimit] = useState(PAGE_SIZE)
  useEffect(() => { setLimit(PAGE_SIZE) }, [q, active, onlyNoted, onlyDiff, supplierFilter, productFilter])
  const shown = filtered.slice(0, limit)
  // root — сам скроллящийся div (см. ниже), а не окно браузера. Таблица
  // скроллится ВНУТРИ своего бокса (max-h-[70vh] overflow-auto), а не
  // страницей целиком — без явного root IntersectionObserver сравнивает
  // положение сентинела с окном браузера, а не с видимой областью этого
  // бокса, и почти никогда не "видит" его, когда скроллишь именно внутри
  // таблицы (итог — подгрузка молча не срабатывает, список выглядит
  // оборванным на PAGE_SIZE, хотя дальше есть ещё строки).
  const containerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // Сентинел рендерится только пока есть что подгружать — следим именно
  // за этим условием (а не пустым deps-массивом), иначе при его
  // размонтировании/перемонтировании (например, после смены фильтра)
  // старый наблюдатель остаётся висеть на уже отсоединённом узле, а новый
  // вообще не создаётся. useEffect (не callback-ref) — он гарантированно
  // срабатывает уже после того, как ПОЛНОСТЬЮ смонтированы оба узла,
  // включая containerRef, который иначе на момент коммита ref'а сентинела
  // мог ещё быть null.
  const hasMore = shown.length < filtered.length
  useEffect(() => {
    const el = sentinelRef.current, root = containerRef.current
    if (!hasMore || !el || !root) return
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setLimit((l) => l + PAGE_SIZE) },
      { root, rootMargin: '800px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore])

  const toggle = (st: Status) => {
    const n = new Set(active)
    n.has(st) ? n.delete(st) : n.add(st)
    setActive(n)
  }
  const setSortKey = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }))

  // xlsx — тяжёлая библиотека (основной вес чанка этой страницы), а нужна
  // только по клику на "Excel" — грузим её именно в этот момент, а не сразу
  // при заходе на Проверку цен, чтобы сама страница открывалась быстро.
  const exportExcel = async () => {
    const XLSX = await import('xlsx')
    // Период — отдельной строкой НАД заголовками (не просто в имени файла):
    // имя файла легко потерять/переименовать при скачивании нескольких
    // периодов подряд (ровно так один раз перепутали июнь/июль), а строка
    // внутри самой таблицы остаётся видна, даже если файл переименовали.
    const modeLabel = moneyMode ? 'деньги' : 'тенге за 1кг'
    const title = [`Проверка цен — ${period} (${modeLabel})`]
    const head = ['Ресторан', 'Поставщик', 'Товар', 'Фасовка', 'Количество', `План (${modeLabel})`, `Факт (${modeLabel})`, 'Δ', 'Статус', 'Должны у', 'Заметка']
    const lines = filtered.map((r) => [
      r.restaurant, r.supplier, r.product, r.pack, r.qty,
      planOf(r) ?? '', factOf(r) ?? '', diffOf(r) ?? '',
      STATUS_META[r.status].label, r.designatedSuppliers.join(', '), r.userComment ?? '',
    ])
    const ws = XLSX.utils.aoa_to_sheet([title, head, ...lines])
    ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 24 }, { wch: 28 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Проверка цен')
    // Период, режим, точка (если выбрана ровно одна — см. rows, уже
    // отфильтрованные по ScopePicker выше) и дата самой выгрузки — всё в
    // имени файла, чтобы отличать скачивания друг от друга без открытия
    // каждого (разные месяцы, деньги/₸ за кг, разные точки, повторные
    // выгрузки в один день).
    const safe = (s: string) => s.replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '')
    const restaurantNames = [...new Set(rows.map((r) => r.restaurant))]
    const restaurantPart = restaurantNames.length === 1 ? `-${safe(restaurantNames[0])}` : ''
    const todayStr = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `proverka-cen-${safe(period)}-${moneyMode ? 'money' : 'per-kg'}${restaurantPart}-${todayStr}.xlsx`)
  }

  return (
    <div className="space-y-4">
      {/* mini KPIs for current filter */}
      <div className="grid grid-cols-4 gap-4">
        <MiniStat delay={0} label="Позиций в срезе" value={fmt(filtered.length)} tone="slate" />
        <MiniStat delay={50} label="Совпадает с матрицей" value={pct(s.matchRate).replace('+', '')} tone="slate" />
        <MiniStat delay={100} label="Заказ не по матрице" value={fmt(s.wrongSupplierCount)} tone="bad" />
        <MiniStat delay={150} label="Нет в матрице" value={fmt(s.noMatrixCount)} tone="bad" />
      </div>

      {/* toolbar */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-56 shrink-0">
            <ISearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-500" width={16} height={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск: товар, поставщик, ресторан…"
              className="w-full rounded-lg border border-ink-600 bg-ink-900/60 py-2 pl-9 pr-3 text-sm text-fg-100 placeholder:text-fg-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          {/* Отдельные фильтры с множественным выбором и поиском внутри
              списка (см. MultiSelectFilter) — в отличие от общего поиска
              выше (тот ищет по подстроке сразу везде), тут выбирается один
              или несколько конкретных поставщиков/товаров из уже известных
              в этом срезе. У товара под названием — поставщик, иначе
              голый текст фасовки вместо названия (их собственное описание
              в матрице) ничего не говорит сам по себе. */}
          <MultiSelectFilter allLabel="Все поставщики" options={supplierOptions} selected={supplierFilter} onChange={setSupplierFilter} />
          <MultiSelectFilter allLabel="Все товары" options={productOptions} selected={productFilter} onChange={setProductFilter} />
          <button
            onClick={() => setMoneyMode((m) => !m)}
            title="Переключить, как считаются План/Факт/Δ: реальные деньги за закупку, или цена за единицу матрицы (кг и т.п.)"
            className={`btn border transition-colors ${moneyMode ? 'border-brand-500 bg-brand-500/15 text-brand-300' : 'border-ink-600 bg-ink-800/70 text-fg-300 hover:bg-ink-750'}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${moneyMode ? 'bg-brand-400' : 'bg-slate-600'}`} />
            {moneyMode ? 'Общ. сумма закупки' : 'тенге за 1кг'}
          </button>
          <button onClick={exportExcel} title="Скачать в Excel" className="btn !px-2.5 border border-ink-600 bg-ink-800/70 text-fg-300 hover:bg-ink-750">
            <IDownload width={16} height={16} />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => {
            const on = active.has(f.id)
            const m = STATUS_META[f.id]
            return (
              <button
                key={f.id}
                onClick={() => toggle(f.id)}
                className={`chip transition-colors ${on ? `${m.color} border-current bg-ink-750` : 'border-ink-600 text-fg-400 hover:text-fg-200'}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                {f.label}
              </button>
            )
          })}
          <button
            onClick={() => setOnlyNoted((v) => !v)}
            title="Только строки, где уже есть свой комментарий или цветовая метка"
            className={`chip transition-colors ${onlyNoted ? 'border-brand-400 bg-ink-750 text-brand-300' : 'border-ink-600 text-fg-400 hover:text-fg-200'}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            С заметкой
          </button>
          <button
            onClick={() => setOnlyDiff((v) => !v)}
            title="Скрыть строки, где факт точно совпал с планом (Δ = 0) — проверять только реальные расхождения"
            className={`chip transition-colors ${onlyDiff ? 'border-brand-400 bg-ink-750 text-brand-300' : 'border-ink-600 text-fg-400 hover:text-fg-200'}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            Только расхождения
          </button>
          <button
            onClick={() => setHideEmpty((v) => !v)}
            title="Скрыть позиции без факта вообще — «Не закупали» (сравнивать не с чем) — чтобы сократить список до того, что реально закупили"
            className={`chip transition-colors ${hideEmpty ? 'border-brand-400 bg-ink-750 text-brand-300' : 'border-ink-600 text-fg-400 hover:text-fg-200'}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            Скрыть пустые
          </button>
          {(active.size > 0 || onlyNoted || onlyDiff || hideEmpty || supplierFilter.size > 0 || productFilter.size > 0) && (
            <button
              onClick={() => { setActive(new Set()); setOnlyNoted(false); setOnlyDiff(false); setHideEmpty(false); setSupplierFilter(new Set()); setProductFilter(new Set()) }}
              className="chip border-ink-600 text-fg-500 hover:text-fg-300"
            >
              сбросить
            </button>
          )}
        </div>
      </div>

      {/* table — свой скролл-контейнер (max-h в vh, не завязан на пиксели
          шапки), чтобы шапка колонок надёжно прилипала внутри него; коробка
          занимает почти весь экран, так что внешняя страница обычно не
          скроллится сама и второго скролла на глаз не видно. */}
      <div className="card overflow-hidden p-0">
        <div ref={containerRef} className="max-h-[70vh] overflow-y-auto overflow-x-hidden">
          <table className="w-full max-w-[1060px] table-fixed">
            <thead className="sticky top-0 z-10 border-b border-brand-500/20 bg-ink-850">
              <tr>
                <Th onClick={() => setSortKey('restaurant')} sort={sort} k="restaurant" width="w-[8%]" tight center>Ресторан</Th>
                <Th onClick={() => setSortKey('supplier')} sort={sort} k="supplier" width="w-[13%]" tight center>Поставщик</Th>
                <Th onClick={() => setSortKey('product')} sort={sort} k="product" width="w-[16%]" tight center longLabel>Наименование/сырьё</Th>
                <Th onClick={() => setSortKey('plan')} sort={sort} k="plan" center width="w-[11%]" longLabel>Цена в тенге из матрицы сырья</Th>
                <Th onClick={() => setSortKey('sum')} sort={sort} k="sum" center width="w-[11%]" longLabel>Цена в тенге отчёт о закупках из iiko</Th>
                <Th onClick={() => setSortKey('diff')} sort={sort} k="diff" center width="w-[10%]">Дельта</Th>
                <th className="th w-[11%] text-center">Статус</th>
                <th className="th w-[6%] pl-[6px] pr-2 text-center">Заметка</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const planVal = planOf(r), factVal = factOf(r), diffVal = diffOf(r)
                const colorMeta = r.rowColor ? ROW_COLORS.find((c) => c.id === r.rowColor) : null
                // Цветная строка не должна терять свой цвет при наведении —
                // раньше общий hover:bg-ink-800/40 перебивал любую цветовую
                // метку (оба правила бьют в один и тот же background-color,
                // и hover почти всегда побеждал). У цветных строк на ховере
                // усиливаем тот же цвет (rowBgHover), а не нейтральный.
                return (
                <tr key={r.id} className={`row-hover ${colorMeta ? `${colorMeta.rowBg} ${colorMeta.rowBgHover}` : 'hover:bg-ink-800/40'} ${r.isTotalRow ? 'opacity-50 hover:opacity-100' : ''}`}>
                  <td className="td overflow-hidden px-2 text-fg-400"><HoverName text={r.restaurant} /></td>
                  <td className="td overflow-hidden px-2 font-medium text-fg-100">
                    {/* Крупным — название из матрицы (если есть), мелким под ним —
                        как называется в iiko. Тот же порядок, что и у товара ниже. */}
                    <HoverName text={r.supplierLabel ?? r.supplier} />
                    {r.supplierLabel && <HoverName text={r.supplier} className="mt-0.5 block text-[11px] font-normal text-fg-500" />}
                  </td>
                  <td className="td overflow-hidden px-2 font-medium text-fg-100">
                    {r.status === 'nomatrix' || r.status === 'wrongSupplier' ? (
                      // Для этих двух статусов сам статус важнее конкретного
                      // названия — крупным текстом пишем "Нет в матрице"/
                      // "Заказ не по матрице", а что именно купили —
                      // отдельной мелкой серой строкой под ним (то же
                      // название, что раньше было бы крупным).
                      <>
                        <span className={STATUS_META[r.status].color}>{STATUS_META[r.status].label}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] font-normal text-fg-500">
                          <HoverName text={r.productLabel ?? r.product} className="min-w-0 flex-1" />
                          {starByRowKey.has(r.rowKey) && <FasovkaStar n={starByRowKey.get(r.rowKey)!} pack={r.pack} />}
                        </span>
                      </>
                    ) : r.unit == null ? (
                      // Позиция из матрицы, ещё не купленная в этом периоде — тут
                      // r.product уже и есть их название, отдельного iiko-имени
                      // нет вовсе (не покупали), под ним просто фасовка.
                      <>
                        <span className="flex items-center gap-1">
                          <HoverName text={r.product} className="min-w-0 flex-1" />
                          {starByRowKey.has(r.rowKey) && <FasovkaStar n={starByRowKey.get(r.rowKey)!} pack={r.pack} />}
                        </span>
                        {r.isPackSensitive && r.pack && <HoverName text={r.pack} className="mt-0.5 block text-[11px] font-normal text-fg-500" />}
                      </>
                    ) : r.productLabel || r.product !== r.productRaw ? (
                      // Крупным — название из матрицы, если товар с ней совпал,
                      // либо ручное переименование (Справочники → Товары), если
                      // совпадения нет, но название всё равно поправили руками —
                      // до этой правки тут ошибочно не показывалось вообще
                      // ничего, кроме самого переименования, без исходного
                      // iiko-имени под ним. Под названием мелким — как называется
                      // в iiko, и через тире фасовка — только для настоящих
                      // ассортиментов (isPackSensitive, пюре/ягоды в асс), где
                      // фасовка и есть разница между вариантами; для обычных
                      // товаров (например "Бобы Эдамаме фасоль") фасовку в этой
                      // строке не показываем вовсе — она тут просто упаковка,
                      // не различающий признак, попросили явно убрать такой шум.
                      <>
                        <span className="flex items-center gap-1">
                          <HoverName text={r.productLabel ?? r.product} className="min-w-0 flex-1" />
                          {starByRowKey.has(r.rowKey) && <FasovkaStar n={starByRowKey.get(r.rowKey)!} pack={r.pack} />}
                          {r.ambiguousOptions && r.ambiguousOptions.length > 0 && (
                            <AmbiguousPicker options={r.ambiguousOptions} onPick={(v) => setAmbiguousChoice(r.rowKey, v)} />
                          )}
                        </span>
                        <HoverName
                          text={r.isPackSensitive && r.pack ? `${r.productRaw} - ${r.pack}` : r.productRaw}
                          className="mt-0.5 block text-[11px] font-normal text-fg-500"
                        />
                      </>
                    ) : (
                      // Ни совпадения с матрицей, ни ручного названия — обычно
                      // "голую" фасовку (кг/шт/л) тут не показываем, она ничего
                      // не уточняет. НО если это категория-ассортимент, голая
                      // фасовка означает, что iiko вообще не записал, какой
                      // именно вкус/вариант купили (например "Ягода в асс" —
                      // просто "кг", без ягоды) — это и есть причина, почему
                      // товар не сопоставился, так что лучше показать даже
                      // такую фасовку, чем молча скрыть саму неопределённость.
                      <>
                        <span className="flex items-center gap-1">
                          <HoverName text={r.product} className="min-w-0 flex-1" />
                          {starByRowKey.has(r.rowKey) && <FasovkaStar n={starByRowKey.get(r.rowKey)!} pack={r.pack} />}
                          {r.ambiguousOptions && r.ambiguousOptions.length > 0 && (
                            <AmbiguousPicker options={r.ambiguousOptions} onPick={(v) => setAmbiguousChoice(r.rowKey, v)} />
                          )}
                        </span>
                        {r.isPackSensitive && r.pack && <HoverName text={r.pack} className="mt-0.5 block text-[11px] font-normal text-fg-500" />}
                      </>
                    )}
                  </td>
                  <td className="td overflow-hidden whitespace-nowrap text-center text-xs tabnum text-fg-400">{planVal != null ? money(planVal) : '—'}</td>
                  <td className="td overflow-hidden whitespace-nowrap text-center text-xs tabnum text-fg-200">{factVal != null ? money(factVal) : <span className="text-fg-600">—</span>}</td>
                  <td className="td overflow-hidden whitespace-nowrap text-center text-xs tabnum font-semibold text-fg-300">
                    {diffVal != null ? (diffVal >= 0 ? '+' : '') + money(diffVal) : <span className="text-fg-600">—</span>}
                  </td>
                  {/* Статус — всегда одна строка (бейдж, без второй строки с
                      подсказкой под ним, как было раньше): высота строки
                      таблицы иначе гуляла от ряда к ряду (есть системная
                      подсказка/нет), и соседние колонки в той же строке
                      визуально "съезжали" друг с другом. Сама подсказка
                      никуда не делась — она теперь в Заметке, рядом со своей
                      же ручной заметкой, одним и тем же по смыслу значком. */}
                  <td className="td overflow-hidden text-center">
                    <StatusBadge status={r.status} className="!text-[10px] !px-2 !py-0.5" />
                  </td>
                  <td className="td relative overflow-visible px-1.5 text-center">
                    <span className="inline-flex items-center gap-1">
                      {r.note && <InfoTip text={r.note} align="left" />}
                      <NoteHoverTip text={r.userComment}>
                        <button
                          onClick={() => { setOpenNoteFor(openNoteFor === r.rowKey ? null : r.rowKey); setDraft(r.userComment ?? '') }}
                          className={`inline-flex items-center gap-1 rounded-md px-1 py-1 hover:bg-ink-750 ${r.userComment || r.rowColor ? 'text-brand-300' : 'text-fg-500'}`}
                          // Не дублируем текст заметки нативным title — его
                          // уже показывает NoteHoverTip (мгновенно, без
                          // браузерной задержки в 1.5-2с), а родной title с
                          // ТЕМ ЖЕ текстом всё равно всплывал бы следом,
                          // выглядя как вторая, "запоздавшая" подсказка.
                          title={r.userComment ? undefined : 'Добавить заметку'}
                        >
                          {colorMeta && <span className={`h-2 w-2 rounded-full ${colorMeta.dot}`} />}
                          <IEdit width={13} height={13} />
                        </button>
                      </NoteHoverTip>
                    </span>
                    {openNoteFor === r.rowKey && (
                      <div className="absolute right-2 top-full z-20 mt-1 w-64 rounded-xl border border-ink-600 bg-ink-800 p-3 text-left shadow-card">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium text-fg-300">Заметка к строке</span>
                          <button onClick={() => setOpenNoteFor(null)} className="text-fg-500 hover:text-fg-300"><IClose width={14} height={14} /></button>
                        </div>
                        <textarea
                          autoFocus
                          rows={3}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder="Свой комментарий к этой закупке…"
                          className="w-full rounded-lg border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-xs text-fg-100 placeholder:text-fg-600 focus:border-brand-500 focus:outline-none"
                        />
                        <div className="mt-2 flex items-center gap-1.5">
                          {ROW_COLORS.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => setRowColor(r.rowKey, r.rowColor === c.id ? null : c.id)}
                              title={c.label}
                              className={`h-5 w-5 rounded-full ${c.dot} ${r.rowColor === c.id ? 'ring-2 ring-offset-2 ring-offset-ink-800 ring-fg-50' : 'opacity-70 hover:opacity-100'}`}
                            />
                          ))}
                          {r.rowColor && (
                            <button onClick={() => setRowColor(r.rowKey, null)} className="ml-1 text-[11px] text-fg-500 hover:text-fg-300">убрать</button>
                          )}
                        </div>
                        <div className="mt-2.5 flex justify-end gap-2">
                          <button
                            onClick={() => { setRowComment(r.rowKey, draft); setOpenNoteFor(null) }}
                            className="btn bg-brand-500 px-2.5 py-1 text-xs text-white hover:bg-brand-600"
                          >
                            Сохранить
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
          {shown.length === 0 && <div className="py-12 text-center text-sm text-fg-500">Ничего не найдено по заданным фильтрам.</div>}
          {/* Невидимый сентинел для автоподгрузки по скроллу — рендерится, только
              пока есть что ещё подгружать, иначе IntersectionObserver продолжал
              бы наблюдать несуществующий "низ списка" без всякой нужды. */}
          {shown.length < filtered.length && <div ref={sentinelRef} className="h-px" />}
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value, tone, delay = 0 }: { label: string; value: string; tone: 'slate' | 'bad' | 'good'; delay?: number }) {
  const cls = tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-fg-50'
  return (
    <div className="card card-hover animate-fade-up px-4 py-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-[11px] text-fg-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabnum ${cls}`}>{value}</div>
    </div>
  )
}

/** ★N рядом с названием товара — тот же товар+поставщик+ресторан встретился под другой фасовкой (см. starByRowKey). */
function FasovkaStar({ n, pack }: { n: number; pack: string }) {
  return (
    <span className="shrink-0 font-semibold text-brand-300" title={`Та же позиция у этого поставщика, но другая фасовка: ${pack || '—'}`}>★{n}</span>
  )
}

/**
 * ⚠ рядом с названием товара — Google-таблица сама записала под этой парой
 * поставщик+товар[+фасовка] НЕСКОЛЬКО разных вариантов (разную цену и/или
 * название), и синк не может угадать, какой из них реально купили в этом
 * периоде (iiko не различает бренд/вариант — см. matching.ambiguous,
 * sheets.js). Клик открывает список вариантов; выбор — ИМЕННО на эту
 * закупку (setAmbiguousChoice по rowKey), не навсегда и не на всю пару:
 * та же пара в другой закупке/другом месяце показывает ⚠ заново, пока не
 * выбрана отдельно (прямое требование — решать прямо на строке, по
 * периоду, а не общим правилом в Справочниках).
 */
function AmbiguousPicker({ options, onPick }: { options: AmbiguousVariant[]; onPick: (v: AmbiguousVariant) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', close, true) }
  }, [pos])

  const toggle = (e: ReactMouseEvent) => {
    e.stopPropagation()
    if (pos) { setPos(null); return }
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const m = 10, WIDTH = 260
    const left = Math.max(m + WIDTH / 2, Math.min(window.innerWidth - m - WIDTH / 2, r.left + r.width / 2))
    setPos({ left, top: r.bottom + 6 })
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={toggle}
      title="В таблице несколько вариантов этого товара — неизвестно, какой купили. Нажмите, чтобы выбрать."
      className="shrink-0 rounded px-1 text-xs font-semibold leading-none text-amber-400 hover:bg-ink-750"
    >
      ⚠
      {pos && createPortal(
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: 260, transform: 'translateX(-50%)' }}
          className="z-[100] rounded-xl border border-ink-600 bg-ink-800 p-2 text-left shadow-xl"
        >
          <div className="mb-1.5 px-1 text-[11px] text-fg-400">В таблице несколько вариантов — какой купили?</div>
          {options.map((o, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { onPick(o); setPos(null) }}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-fg-100 hover:bg-ink-700"
            >
              {o.label ?? '(без названия)'} — {money(o.price)}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </button>
  )
}

/**
 * Показывает свою заметку по наведению (портал, та же механика, что и у
 * InfoTip) — раньше её можно было прочитать только кликом (открыть
 * редактор) или browser-тайтлом (медленный, без переносов строк). Без
 * текста — просто прозрачная обёртка, ничего не добавляет.
 */
function NoteHoverTip({ text, children }: { text: string | null; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [tip, setTip] = useState<{ left: number; top: number; below: boolean } | null>(null)
  if (!text) return <>{children}</>

  const TIP_WIDTH = 240
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

// longLabel — для заголовков-фраз в несколько слов (не просто "Товар"/
// "План", а "Цена в тенге из матрицы сырья" и т.п.): сплошные ЗАГЛАВНЫЕ +
// широкий трекинг (обычный .th) на трёх свёрнутых строках читаются плохо и
// выглядят неряшливо — попросили сделать "красивее". Для таких заголовков
// отключаем uppercase/tracking-wider и даём более плотный межстрочный
// интервал, оставляя обычным коротким подписям (Ресторан, Статус…) прежний
// вид без изменений.
function Th({ children, onClick, sort, k, right, center, width, tight, longLabel }: { children: React.ReactNode; onClick: () => void; sort: { key: string; dir: number }; k: string; right?: boolean; center?: boolean; width?: string; tight?: boolean; longLabel?: boolean }) {
  const on = sort.key === k
  return (
    <th className={`th hover:text-fg-300 ${right ? 'text-right' : center ? 'text-center' : ''} ${tight ? 'px-2' : ''} ${longLabel ? 'normal-case tracking-normal leading-snug' : ''} ${width ?? ''}`}>
      <span className={`inline-flex cursor-pointer items-start gap-1.5 ${right ? 'flex-row-reverse' : ''}`} onClick={onClick}>
        {children}
        {on ? (
          sort.dir === 1
            ? <IArrowUp width={15} height={15} className="mt-px shrink-0 text-brand-300" />
            : <IArrowDown width={15} height={15} className="mt-px shrink-0 text-brand-300" />
        ) : <ISort width={15} height={15} className="mt-px shrink-0 text-fg-400" />}
      </span>
    </th>
  )
}
