import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt, plural, normPack, bundledMatching, bundledDataset, capitalize, BUNDLED_PERIODS, parseDataset, computeRows, Row } from '../lib/data'
import { useEdits } from '../lib/edits'
import { rankSimilar } from '../lib/fuzzy'
import { Section, InfoTip, Checkbox } from '../components/ui'
import { EditableText } from '../components/EditableCell'
import ProductLabelSuggest from '../components/ProductLabelSuggest'
import HoverName from '../components/HoverName'
import { ISearch, IFilter, IChevron, IReset, IUndo, IStore, IDatabase, IPin, IPlus, ITrash, ICheck } from '../components/icons'

type Tab = 'suppliers' | 'products' | 'venues'
type SupplierFilter = 'all' | 'new'

export default function DataEditor() {
  const {
    edits, editCount, rows, renameSupplier, setVenue,
    addVenue, removeVenue,
    acknowledgeSupplier, unacknowledgeSupplier, setProductLink, undo, canUndo,
    suppliers: suppliersBase, restaurants, matching, periodKey,
    noMatrixTest, setNoMatrixTest,
  } = useEdits()
  // Подсказки автопоиска (Компании/Товары) должны предлагать то, что уже
  // реально известно, даже когда включён тестовый режим "без матрицы" —
  // там `matching` подменяется на пустую специально, чтобы показать
  // приложение так, будто матрицы вообще нет, но подсказки при этом не
  // должны исчезать: печатаем "лос" — ищем среди уже известных названий
  // (настоящей матрицы), а не среди пустоты теста.
  const realMatching = useMemo(() => bundledMatching(periodKey), [periodKey])
  const [tab, setTab] = useState<Tab>('suppliers')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(60)
  const [sFilter, setSFilter] = useState<SupplierFilter>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newBrand, setNewBrand] = useState('')
  const [newEntity, setNewEntity] = useState('')
  const [newCategory, setNewCategory] = useState('')

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
  const norm = (s: string) => s.trim().toLowerCase()

  // «Нет в справочнике» — учитываем ручную правку: отметили «это новый
  // поставщик» — строка больше не считается нерешённой.
  const isUnresolved = (name: string) =>
    !matching.supplierAlias[norm(name)] && !edits.acknowledgedSuppliers[name]

  const supplierCounts = useMemo(() => ({
    all: suppliersBase.length,
    new: suppliersBase.filter((s) => isUnresolved(s.name)).length,
  }), [suppliersBase, edits.acknowledgedSuppliers, matching])

  const suppliers = useMemo(() => {
    let list = needle ? suppliersBase.filter((s) => s.name.toLowerCase().includes(needle)) : suppliersBase
    if (sFilter === 'new') list = list.filter((s) => isUnresolved(s.name))
    return list
  }, [needle, edits.acknowledgedSuppliers, sFilter, suppliersBase, matching])

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
    for (const r of restaurants) map.set(norm(r.name), r.name)
    return map
  }, [restaurants])

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
    const packBrokenDownPairKeys = new Set(
      Object.keys(matching.planPairsByPack).map((k) => k.split('::').slice(0, 3).join('::')),
    )
    const result: MatrixRow[] = []
    const push = (key: string, restaurantNorm: string, supplierNorm: string, productSegment: string, pack: string, plan: number) => {
      const restaurant = restaurantDisplayByNorm.get(restaurantNorm)
      if (!restaurant) return // ресторан вне текущего охвата приложения — не показываем
      result.push({
        key, restaurantNorm, restaurant,
        supplierNorm, supplier: supplierDisplayByNorm.get(supplierNorm) ?? supplierNorm,
        productSegment, matrixLabel: matching.productLabels[key] ?? capitalize(productSegment),
        pack, plan,
      })
    }
    for (const [key, plan] of Object.entries(matching.planPairsByPack)) {
      const [restaurantNorm, supplierNorm, productSegment, pack] = key.split('::')
      push(key, restaurantNorm, supplierNorm, productSegment, pack, plan)
    }
    for (const [key, plan] of Object.entries(matching.planPairs)) {
      if (packBrokenDownPairKeys.has(key)) continue
      const [restaurantNorm, supplierNorm, productSegment] = key.split('::')
      push(key, restaurantNorm, supplierNorm, productSegment, '', plan)
    }
    return result
  }, [matching, restaurantDisplayByNorm, supplierDisplayByNorm])

  // Варианты для назначения "нет в матрице -> товар из матрицы" — не
  // ограничиваем поставщиком: иногда закупка реально записана не за той
  // компанией (перепутали при вводе в iiko, или правда купили не у того,
  // кого назначили) — привязка сама по себе безопасна и в этом случае:
  // supplierCanon для сопоставления всегда берётся из САМОЙ закупки, не
  // из выбранной подсказки, так что если выбранный товар в матрице на
  // самом деле числится за другим поставщиком, после привязки это
  // корректно всплывёт как «заказ не по матрице», а не тихо подменится.
  // Поставщик каждой подсказки виден при наведении (ProductLabelSuggest),
  // чтобы не перепутать похожие названия у разных компаний.
  const allMatrixProductOptions = useMemo(() => {
    const seen = new Map<string, { label: string; targetProduct: string; supplier: string }>()
    for (const row of matrixRows) {
      const dedupeKey = `${row.supplierNorm}::${row.productSegment}`
      if (!seen.has(dedupeKey)) seen.set(dedupeKey, { label: row.matrixLabel, targetProduct: row.productSegment, supplier: row.supplier })
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label) || a.supplier.localeCompare(b.supplier))
  }, [matrixRows])

  // «Уже известные» названия из iiko — не только из просматриваемого
  // прямо сейчас периода, а из ВСЕХ периодов, что вообще есть в
  // приложении (май и июнь). То же самое название обычно повторяется
  // месяц к месяцу — если сейчас смотрим июнь, а купили только в мае,
  // это всё равно уже известное название, нет причин требовать покупку
  // именно в этом периоде, чтобы его подставить. matchedKey — обычный
  // текстовый ключ (ресторан+поставщик+товар, норм.), не привязан к
  // конкретному объекту matching, так что ключ из майского пересчёта
  // корректно ложится на строку матрицы, построенную из июньской.
  const historicalRows = useMemo(() => {
    const all: Row[] = []
    for (const p of BUNDLED_PERIODS) {
      if (p.period === periodKey) continue // текущий период уже в `rows` — там же живые данные с бэкенда, если он есть
      const m = bundledMatching(p.period)
      all.push(...computeRows(parseDataset(bundledDataset(p.period), m).base, edits, m))
    }
    return all
  }, [edits, periodKey])
  const allKnownRows = useMemo(() => [...rows, ...historicalRows], [rows, historicalRows])

  // Автопоиск для колонки «Название из iiko» у строки матрицы — реально
  // встреченные в закупках названия, за оба периода, без ограничения
  // поставщиком (та же логика, что и выше для «Нет в матрице» — привязка
  // сама по себе безопасна, supplierCanon для сопоставления всегда берётся
  // из закупки, а не из подсказки). Поставщик виден при наведении.
  const allIikoNameOptions = useMemo(() => {
    const seen = new Map<string, { label: string; supplier: string }>()
    for (const r of allKnownRows) {
      if (r.unit == null) continue
      const supplierNorm = norm(matching.supplierAlias[norm(r.supplier)] ?? r.supplier)
      const supplier = supplierDisplayByNorm.get(supplierNorm) ?? r.supplier
      const dedupeKey = `${r.productRaw}::${supplier}`
      if (!seen.has(dedupeKey)) seen.set(dedupeKey, { label: r.productRaw, supplier })
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label) || a.supplier.localeCompare(b.supplier))
  }, [allKnownRows, matching, supplierDisplayByNorm])

  // Уже НАЗНАЧЕННОЕ вручную название (для очистки старой привязки при
  // замене — см. commitMatrixIikoName) — обратный индекс по edits.
  // productLinks, считаем один раз, а не пересканированием на каждую
  // строку.
  const linkedRawNameByTarget = useMemo(() => {
    const map = new Map<string, string>()
    for (const link of Object.values(edits.productLinks)) {
      map.set(`${norm(link.supplier)}::${norm(link.targetProduct)}`, link.rawProduct)
    }
    return map
  }, [edits.productLinks])

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
    // замене названия рискуем не найти, что удалять.
    const targetKey = `${row.supplierNorm}::${row.productSegment}`
    const explicitLink = linkedRawNameByTarget.get(targetKey)
    if (explicitLink) setProductLink(`${row.supplierNorm}::${norm(explicitLink)}`, null)
    if (next) setProductLink(`${row.supplierNorm}::${norm(next)}`, { targetProduct: row.productSegment, supplier: row.supplier, rawProduct: next })
  }

  // «Нет в матрице» — закупки этого периода, для которых ни прямое
  // совпадение текста, ни привязка не нашли ни строки в матрице вообще
  // (см. Row.status в data.ts). Отдельная секция: это либо реально новый
  // товар (предстоит завести в самой Google-таблице), либо просто
  // разошедшееся написание — тогда достаточно привязать эту закупку к уже
  // существующему товару из матрицы прямо здесь.
  interface UnmatchedRow { restaurant: string; supplier: string; supplierNorm: string; product: string; pack: string | null; count: number }
  const unmatchedRows = useMemo(() => {
    const groups = new Map<string, UnmatchedRow>()
    for (const r of rows) {
      if (r.unit == null || r.status !== 'nomatrix') continue
      const supplierNorm = norm(matching.supplierAlias[norm(r.supplier)] ?? r.supplier)
      const key = `${norm(r.restaurant)}::${supplierNorm}::${norm(r.productRaw)}::${r.pack ? normPack(r.pack) : ''}`
      let g = groups.get(key)
      if (!g) { g = { restaurant: r.restaurant, supplier: r.supplier, supplierNorm, product: r.productRaw, pack: r.pack, count: 0 }; groups.set(key, g) }
      g.count++
    }
    return [...groups.values()]
  }, [rows, matching])

  const commitUnmatchedLink = (u: UnmatchedRow, targetProduct: string | undefined) => {
    const key = `${u.supplierNorm}::${norm(u.product)}`
    if (!targetProduct) { setProductLink(key, null); return }
    setProductLink(key, { targetProduct, supplier: u.supplier, rawProduct: u.product })
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
    return list
  }, [needle, matrixRows, excludedRestaurant, excludedName, excludedPack, matchedRawNamesByKey])

  const activeFilterDims = (excludedRestaurant.size ? 1 : 0) + (excludedName.size ? 1 : 0) + (excludedPack.size ? 1 : 0)
  const resetAllFilters = () => { setExcludedRestaurant(new Set()); setExcludedName(new Set()); setExcludedPack(new Set()) }

  // Компании без справочника (potentially typos of an existing поставщик,
  // а не реально новый) — предупреждаем, но ничего не делаем автоматически:
  // "Объединить" убрали сознательно, тут только подсказка "проверьте matrix".
  const canonicalSupplierNames = useMemo(() => [...new Set(Object.values(realMatching.supplierAlias))], [realMatching])
  const possibleDuplicate = (name: string) => {
    const top = rankSimilar(name, canonicalSupplierNames, (x) => x, 0.45)[0]
    return top?.item ?? null
  }
  // Автопоиск при переименовании — все уже известные названия (из матрицы
  // + уже введённые вручную правки), чтобы не плодить разные написания
  // одного и того же поставщика/товара: набрали "ази" — нашли "Азик Трейд",
  // даже если он уже был переименован кем-то другим, а не только в матрице.
  const supplierNameSuggestions = useMemo(
    () => [...new Set([...canonicalSupplierNames, ...Object.values(edits.supplierRenames)])].sort((a, b) => a.localeCompare(b)).map((label) => ({ label })),
    [canonicalSupplierNames, edits.supplierRenames],
  )

  const venues = useMemo(
    () => (needle ? restaurants.filter((r) => r.name.toLowerCase().includes(needle) || r.city.toLowerCase().includes(needle)) : restaurants),
    [needle, restaurants],
  )

  const shown = tab === 'suppliers' ? suppliers.slice(0, limit)
    : tab === 'products' ? matrixRowsFiltered.slice(0, limit)
    : venues.slice(0, limit)
  const total = tab === 'suppliers' ? suppliers.length
    : tab === 'products' ? matrixRowsFiltered.length
    : venues.length

  const resetAddForm = () => {
    setNewName(''); setNewCity(''); setNewBrand(''); setNewEntity(''); setNewCategory(''); setAddOpen(false)
  }
  const submitAddVenue = () => {
    const name = newName.trim()
    if (!name) return
    addVenue(name, {
      city: newCity.trim() || undefined, brand: newBrand.trim() || undefined,
      entity: newEntity.trim() || undefined, category: newCategory.trim() || undefined,
    })
    resetAddForm()
  }

  return (
    <div className="space-y-5">
      {/* intro + actions */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-300"><IDatabase width={18} height={18} /></span>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              Справочники
              <InfoTip text="Компании — из iiko. Товары теперь строятся от самой матрицы (лист «Сырьё F») — там же и плановая цена; здесь можно назначить, каким названием их называет iiko в закупках." />
            </div>
            <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
              Если компании нет в матрице — «Сохранить», чтобы отметить, что это действительно новый поставщик.
              Правки сохраняются автоматически.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editCount > 0 && <span className="chip border-brand-500/40 bg-brand-500/10 text-brand-300">{fmt(editCount)} {plural(editCount, 'правка', 'правки', 'правок')}</span>}
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Отменить последнее изменение"
            className="btn border border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750 disabled:opacity-40 disabled:hover:bg-ink-800/70"
          ><IUndo width={16} height={16} /> Отменить</button>
        </div>
      </div>

      {/* тестовый режим — матрицу подменяем на пустую, чтобы всё выглядело
          как сразу после загрузки отчёта iiko, без единого сопоставления */}
      <div className={`card flex flex-wrap items-center gap-3 p-3.5 transition-colors ${noMatrixTest ? 'border-warn/40 bg-warn/[0.06]' : ''}`}>
        <ToggleSwitch checked={noMatrixTest} onChange={setNoMatrixTest} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className={`text-sm font-medium ${noMatrixTest ? 'text-warn' : 'text-slate-300'}`}>Тестовый режим: без матрицы</span>
          <InfoTip text="Показывает всё приложение так, будто только что загрузили отчёт из iiko, а матрицу (план-цены, товары) ещё не подключали — везде пусто, список Товаров пуст, все закупки — в «Нет в матрице». На реальные данные не влияет — переключатель хранится только в этом браузере, выключите его, чтобы вернуть матрицу как было." />
        </div>
      </div>

      <Section title={undefined} right={undefined}>
        {/* tabs + search */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-ink-800/70 p-1">
            <button onClick={() => { setTab('suppliers'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'suppliers' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Компании ({fmt(suppliersBase.length)})</button>
            <button onClick={() => { setTab('products'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'products' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Товары ({fmt(matrixRows.length)})</button>
            <button onClick={() => { setTab('venues'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'venues' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Точки ({fmt(restaurants.length)})</button>
          </div>
          {/* Поиск — на любой вкладке в одном и том же месте этой группы; на
              Товарах перед ним появляется значок фильтра, слева от поиска. */}
          <div className="flex flex-1 items-center justify-end gap-2">
            {tab === 'products' && (
              <div className="relative" ref={filterRef}>
                <button
                  onClick={() => setFilterOpen((v) => !v)}
                  title="Фильтр по ресторану, названиям и фасовке (как в Google Sheets)"
                  className={`btn border px-3 py-2 text-xs ${filterOpen || activeFilterDims > 0 ? 'border-brand-500/50 bg-brand-500/10 text-brand-300' : 'border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750'}`}
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
                      <button onClick={resetAllFilters} className="text-xs text-slate-500 hover:text-bad">Сбросить всё</button>
                      <button onClick={() => setFilterOpen(false)} className="text-xs text-brand-300 hover:text-brand-200">Готово</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
              <ISearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width={16} height={16} />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setLimit(60) }}
                placeholder={tab === 'products' ? 'Поиск товара, поставщика, ресторана или фасовки…' : tab === 'suppliers' ? 'Поиск компании…' : 'Поиск точки или города…'}
                className="w-full rounded-lg border border-ink-600 bg-ink-900/60 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            {tab === 'venues' && (
              <button
                onClick={() => setAddOpen((v) => !v)}
                className={`btn border px-3 py-2 text-xs ${addOpen ? 'border-brand-500/50 bg-brand-500/10 text-brand-300' : 'border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750'}`}
              >
                <IPlus width={14} height={14} /> Добавить точку
              </button>
            )}
          </div>
        </div>

        {addOpen && tab === 'venues' && (
          <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-brand-500/30 bg-brand-500/[0.04] p-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-[11px] text-slate-500">Название точки</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none" />
            </div>
            <div className="w-36">
              <label className="mb-1 block text-[11px] text-slate-500">Город</label>
              <input value={newCity} onChange={(e) => setNewCity(e.target.value)}
                className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none" />
            </div>
            <div className="w-40">
              <label className="mb-1 block text-[11px] text-slate-500">Бренд</label>
              <input value={newBrand} onChange={(e) => setNewBrand(e.target.value)}
                className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none" />
            </div>
            <div className="w-44">
              <label className="mb-1 block text-[11px] text-slate-500">Юрлицо</label>
              <input value={newEntity} onChange={(e) => setNewEntity(e.target.value)}
                className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none" />
            </div>
            <div className="w-40">
              <label className="mb-1 block text-[11px] text-slate-500">Категория</label>
              <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="например, Кухня"
                className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none" />
            </div>
            <button onClick={submitAddVenue} disabled={!newName.trim()} className="btn border border-brand-500/50 bg-brand-500/15 px-3 py-1.5 text-xs text-brand-200 hover:bg-brand-500/25 disabled:opacity-40">
              <ICheck width={14} height={14} /> Добавить
            </button>
            <button onClick={resetAddForm} className="btn px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300">Отмена</button>
          </div>
        )}

        {tab === 'venues' && (
          <p className="mb-3 text-xs text-slate-500">
            Если город, бренд, юрлицо или категория определились неверно — поправьте здесь. Изменение сразу применится
            ко всем отчётам по этой точке.
          </p>
        )}

        {tab === 'suppliers' && (
          <p className="mb-3 text-xs text-slate-500">
            Список формируется из закупок в iiko за выбранный период. «Нет в справочнике» — этой компании нет в вашей
            матрице ни под каким известным написанием; «Сохранить» ничего не меняет в сопоставлении, просто убирает
            позицию из списка новых, чтобы не проверять её повторно каждый раз. «Вернуть» отменяет эту отметку.
          </p>
        )}

        {tab === 'products' && (
          <p className="mb-3 text-xs text-slate-500">
            Список строится из самой матрицы (лист «Сырьё F») — одна строка на ресторан+поставщика+товар (+фасовку,
            если матрица прайсует её отдельно). «Название из матрицы» — как в самой матрице, здесь не редактируется:
            поправить описание (и план-цену — её теперь тут вообще нет) можно только в самой Google-таблице.
            «Название из iiko» — что реально подтягивается к этой строке (за оба периода, что есть в приложении,
            не только просматриваемый сейчас) — можно вписать/поправить и сами (одна компания может привезти два
            разных товара под одним и тем же названием в iiko — разносить их можно только явной привязкой, не
            текстом). Значок «+N» — под этим же товаром матрицы встречаются и другие написания в iiko. Закупки,
            для которых ничего не подтянулось само и привязки ещё нет — ниже, в «Нет в матрице».
          </p>
        )}

        {tab === 'products' && unmatchedRows.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-xl border border-purple-400/30 bg-purple-400/[0.04]">
            <button
              onClick={() => setUnmatchedOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 border-b border-purple-400/20 px-3 py-2 text-left"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
              <span className="text-xs font-medium text-purple-300">Нет в матрице ({fmt(unmatchedRows.length)})</span>
              <InfoTip text="Закупки этого периода, для которых нет строки в матрице ни по прямому совпадению названия, ни по привязке. Либо это реально новый товар — его предстоит завести в самой Google-таблице («Сырьё F»); либо просто у iiko другое написание того же товара — тогда привяжите его прямо здесь, выбрав нужный товар из матрицы." align="left" />
              <IChevron width={13} height={13} className={`ml-auto shrink-0 text-purple-300/70 transition-transform duration-150 ${unmatchedOpen ? 'rotate-90' : ''}`} />
            </button>
            {unmatchedOpen && (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead className="bg-ink-850">
                  <tr>
                    <th className="th w-[14%]">Ресторан</th>
                    <th className="th w-[18%]">Поставщик</th>
                    <th className="th w-[24%]">Название (iiko)</th>
                    <th className="th w-[12%]">Фасовка</th>
                    <th className="th w-[8%] text-right">Раз</th>
                    <th className="th w-[24%]">Это на самом деле…</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedRows.map((u, i) => {
                    const options = allMatrixProductOptions
                    // Обычно после успешной привязки строка сама пропадает из
                    // этого списка (статус перестаёт быть «нет в матрице») —
                    // поле стартует пустым. Но если привязка уже стоит, а
                    // статус всё равно не сошёлся (например, разошлась ещё и
                    // фасовка) — не молчим об этом пустым полем, показываем,
                    // что уже назначено.
                    const currentLink = edits.productLinks[`${u.supplierNorm}::${norm(u.product)}`]
                    const currentLabel = currentLink
                      ? (options.find((o) => o.targetProduct === norm(currentLink.targetProduct))?.label ?? currentLink.targetProduct)
                      : ''
                    return (
                      <tr key={i} className="row-hover hover:bg-ink-800/40">
                        <td className="td overflow-hidden text-xs text-slate-400"><HoverName text={u.restaurant} /></td>
                        <td className="td overflow-hidden text-xs text-slate-400"><HoverName text={u.supplier} /></td>
                        <td className="td overflow-hidden text-slate-100"><HoverName text={u.product} /></td>
                        <td className="td overflow-hidden text-xs text-slate-400"><HoverName text={u.pack || '—'} /></td>
                        <td className="td text-right tabnum text-slate-500">{fmt(u.count)}</td>
                        <td className="td">
                          <ProductLabelSuggest
                            value={currentLabel}
                            suggestions={options}
                            onCommit={(v) => {
                              const picked = options.find((o) => o.label === v)
                              commitUnmatchedLink(u, picked?.targetProduct)
                            }}
                          />
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

        {tab === 'suppliers' && (
          <div className="mb-3 flex flex-wrap gap-2">
            {([
              ['all', `Все (${fmt(supplierCounts.all)})`],
              ['new', `Нет в справочнике (${fmt(supplierCounts.new)})`],
            ] as [SupplierFilter, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => { setSFilter(id); setLimit(60) }}
                className={`chip transition-colors ${sFilter === id ? 'border-brand-400 bg-brand-500/10 text-brand-300' : 'border-ink-600 text-slate-400 hover:text-slate-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-ink-700/50">
          <table className="w-full table-fixed">
            <thead className="sticky top-0 z-10 bg-ink-850">
              {tab === 'suppliers' ? (
                <tr>
                  <th className="th w-[42%]">Название (iiko)</th>
                  <th className="th w-[28%]">Название из матрицы <InfoTip text="Название компании, обычно как в матрице — можно поправить вручную, например переименовать ИП. Влияет только на подпись, не на сопоставление. «Нет в справочнике» — этой компании нет в матрице ни под каким известным написанием; если это действительно новый поставщик — нажмите «Сохранить»." /></th>
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
                  <th className="th w-[25%]">Точка</th>
                  <th className="th w-[14%]">Город</th>
                  <th className="th w-[16%]">Бренд</th>
                  <th className="th w-[21%]">Юрлицо</th>
                  <th className="th w-[14%]">Категория</th>
                  <th className="th w-[10%] text-center">Действие</th>
                </tr>
              )}
            </thead>
            <tbody>
              {tab === 'suppliers'
                ? (shown as typeof suppliersBase).map((s) => {
                    const canon = matching.supplierAlias[norm(s.name)]
                    const acknowledged = edits.acknowledgedSuppliers[s.name] === true
                    const supplierRename = edits.supplierRenames[s.name]
                    return (
                      <tr key={s.name} className="row-hover hover:bg-ink-800/40">
                        <td className="td overflow-hidden text-slate-400">
                          <span className="flex min-w-0 items-center gap-2"><IStore width={14} height={14} className="shrink-0 text-slate-600" /><HoverName text={s.name} /></span>
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
                              <span className="chip mt-1 w-fit border-transparent bg-ink-700 text-[11px] text-slate-400">новый поставщик</span>
                            ) : (
                              <div className="mt-1 flex min-w-0 flex-col gap-0.5">
                                <span className="chip w-fit border-transparent bg-warn/10 text-[11px] text-warn">нет в справочнике</span>
                                {possibleDuplicate(s.name) && (
                                  <span className="flex items-center gap-1 text-[11px] text-slate-500">
                                    похоже на «{possibleDuplicate(s.name)}»?
                                    <InfoTip text="Это не точное совпадение, а похожее по написанию название, уже занесённое в справочник — возможно, это тот же поставщик, просто иначе записанный в iiko (опечатка, сокращение). Перед «Сохранить» стоит свериться с матрицей." align="left" />
                                  </span>
                                )}
                              </div>
                            )
                          )}
                        </td>
                        <td className="td text-right tabnum text-slate-400">{fmt(s.count)}</td>
                        <td className="td text-center">
                          {acknowledged ? (
                            <button onClick={() => unacknowledgeSupplier(s.name)} className="btn mx-auto border border-bad/40 bg-bad/10 px-2 py-1 text-xs text-bad hover:bg-bad/20" title="Вернуть — снова считать нерешённым, показывать в «Нет в справочнике»">
                              <IReset width={13} height={13} /> Вернуть
                            </button>
                          ) : !canon ? (
                            <button onClick={() => acknowledgeSupplier(s.name)} className="btn mx-auto border border-ink-600 bg-ink-800/70 px-2 py-1 text-xs text-slate-300 hover:border-good/50 hover:text-good" title="Сохранить — это действительно новый поставщик">
                              <ICheck width={12} height={12} /> Сохранить
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })
                : tab === 'products'
                ? (shown as typeof matrixRowsFiltered).map((row) => {
                    const targetKey = `${row.supplierNorm}::${row.productSegment}`
                    const explicitLink = linkedRawNameByTarget.get(targetKey)
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
                        <td className="td overflow-hidden text-xs text-slate-400">
                          <span className="flex min-w-0 items-center gap-1.5"><IPin width={12} height={12} className="shrink-0 text-slate-600" /><HoverName text={row.restaurant} /></span>
                        </td>
                        <td className="td overflow-hidden text-xs text-slate-400"><HoverName text={row.supplier} /></td>
                        <td className="td overflow-hidden"><HoverName text={row.matrixLabel} className="font-medium text-slate-100" /></td>
                        <td className="td overflow-hidden text-xs text-slate-400"><HoverName text={row.pack || '—'} /></td>
                        <td className="td">
                          <div className="flex items-center gap-1.5">
                            <ProductLabelSuggest
                              value={primary}
                              suggestions={allIikoNameOptions}
                              onCommit={(v) => commitMatrixIikoName(row, primary, v)}
                            />
                            {extra.length > 0 && (
                              <span
                                className="chip shrink-0 border-transparent bg-ink-700 text-[10px] text-slate-400"
                                title={`Ещё встречается под другим написанием: ${extra.join(', ')}`}
                              >
                                +{extra.length}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                : (shown as typeof venues).map((r) => {
                    const manual = edits.newVenues[r.name] === true
                    return (
                      <tr key={r.name} className="row-hover hover:bg-ink-800/40">
                        <td className="td overflow-hidden text-slate-100">
                          <span className="flex min-w-0 items-center gap-2">
                            <IPin width={14} height={14} className="shrink-0 text-slate-600" /><HoverName text={r.name} className="min-w-0 flex-1" />
                            {manual && <span className="chip shrink-0 border-transparent bg-brand-500/10 text-[10px] text-brand-300">вручную</span>}
                          </span>
                        </td>
                        <td className="td"><EditableText value={r.city} onCommit={(v) => setVenue(r.name, { city: v })} className="max-w-[140px]" /></td>
                        <td className="td"><EditableText value={r.brand} onCommit={(v) => setVenue(r.name, { brand: v })} className="max-w-[160px]" /></td>
                        <td className="td"><EditableText value={r.entity} onCommit={(v) => setVenue(r.name, { entity: v })} className="max-w-[180px]" /></td>
                        <td className="td"><EditableText value={r.category} onCommit={(v) => setVenue(r.name, { category: v })} className="max-w-[140px]" /></td>
                        <td className="td text-center">
                          {manual && (
                            <button onClick={() => removeVenue(r.name)} className="btn mx-auto px-2 py-1 text-xs text-slate-500 hover:text-bad" title="Удалить добавленную вручную точку">
                              <ITrash width={13} height={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
          {shown.length === 0 && <div className="py-12 text-center text-sm text-slate-500">Ничего не найдено.</div>}
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
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-2 text-left text-xs font-medium text-slate-300 transition-colors hover:text-white">
        <span className="flex items-center gap-1.5">
          {label}
          {active && <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />}
        </span>
        <IChevron width={13} height={13} className={`text-slate-500 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
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
        className="mb-1.5 w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
      />
      <div className="mb-1.5 flex gap-3 text-[11px]">
        <button onClick={selectAll} className="text-brand-300 hover:text-brand-200">Выбрать все</button>
        <button onClick={clearAll} className="text-slate-500 hover:text-slate-300">Очистить</button>
      </div>
      <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
        {filtered.length === 0 && <div className="py-4 text-center text-xs text-slate-600">Ничего не найдено</div>}
        {filtered.map((v) => (
          <label key={v} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-slate-200 hover:bg-ink-800">
            <Checkbox checked={!excluded.has(v)} onChange={() => toggle(v)} />
            <span className="truncate">{v || '—'}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

/** Переключатель-пилюля под общий стиль — для настроек уровня "вкл/выкл всё". */
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${checked ? 'bg-warn' : 'bg-ink-700'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-[18px]' : 'translate-x-1'}`} />
    </button>
  )
}
