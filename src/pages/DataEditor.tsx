import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt, plural, normPack } from '../lib/data'
import { useEdits } from '../lib/edits'
import { rankSimilar } from '../lib/fuzzy'
import { Section, InfoTip } from '../components/ui'
import { EditableText } from '../components/EditableCell'
import ProductLabelSuggest from '../components/ProductLabelSuggest'
import HoverName from '../components/HoverName'
import { ISearch, IFilter, IChevron, IReset, IUndo, IStore, IDatabase, IPin, IPlus, ITrash, ICheck, IScale } from '../components/icons'

type Tab = 'suppliers' | 'products' | 'venues' | 'packs'
type SupplierFilter = 'all' | 'new'

export default function DataEditor() {
  const {
    edits, editCount, rows, renameProduct, renameSupplier, setVenue,
    addVenue, removeVenue,
    acknowledgeSupplier, unacknowledgeSupplier, setPackAlias, setPlanOverride, undo, canUndo,
    suppliers: suppliersBase, restaurants, matching,
    noMatrixTest, setNoMatrixTest,
  } = useEdits()
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

  // Фильтр Товаров (значок у строки поиска). Название (iiko и из матрицы —
  // для человека это одно и то же "как называется товар", разница только
  // техническая) — простой текстовый поиск, а не чек-лист: значений сотни,
  // чек-лист был бы бесполезен. Фасовка — чек-лист (значений немного, это
  // удобно). План — диапазон, это число, а не текст. Каждая категория —
  // раскрывающаяся секция (открыта максимум одна), а то список фасовок
  // сам по себе длинный и раздувал панель, даже когда не нужен.
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterSection, setFilterSection] = useState<'name' | 'pack' | 'plan' | null>(null)
  const [nameSearch, setNameSearch] = useState('')
  const [excludedPack, setExcludedPack] = useState<Set<string>>(new Set())
  const [planMin, setPlanMin] = useState('')
  const [planMax, setPlanMax] = useState('')
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

  // Товары — одна строка на товар+поставщика. Фасовку показываем отдельными
  // строками только там, где под одним названием в iiko на самом деле разные
  // товары (категории-ассортименты вроде "Пюре в асс" — вкус виден только в
  // фасовке, см. Row.isAssortment в data.ts); иначе фасовка — просто размер
  // упаковки одного и того же товара, разносить по строкам незачем.
  interface ProductVariant { restaurant: string; product: string; supplier: string; pack: string | null; count: number }
  const productVariants = useMemo(() => {
    const groups = new Map<string, { restaurant: string; product: string; supplier: string; isAssortment: boolean; packs: Map<string, string>; count: number }>()
    for (const r of rows) {
      if (r.unit == null) continue // не реальная закупка — позиция из матрицы, ещё не куплена в этом периоде
      const key = `${norm(r.restaurant)}::${norm(r.productRaw)}::${norm(r.supplier)}`
      let g = groups.get(key)
      if (!g) { g = { restaurant: r.restaurant, product: r.productRaw, supplier: r.supplier, isAssortment: r.isAssortment, packs: new Map(), count: 0 }; groups.set(key, g) }
      g.count++
      const rawNorm = normPack(r.pack)
      if (!g.packs.has(rawNorm)) g.packs.set(rawNorm, r.pack)
    }
    const result: ProductVariant[] = []
    for (const g of groups.values()) {
      if (g.isAssortment) {
        for (const [, rawDisplay] of g.packs) {
          result.push({ restaurant: g.restaurant, product: g.product, supplier: g.supplier, pack: rawDisplay, count: g.count })
        }
      } else {
        result.push({ restaurant: g.restaurant, product: g.product, supplier: g.supplier, pack: null, count: g.count })
      }
    }
    return result.sort((a, b) => b.count - a.count)
  }, [rows])

  // То же самое, что каждая строка Товаров считает сама себе для показа —
  // вынесено отдельно, чтобы фильтр по колонке (ниже) и сам рендер строки
  // не считали дважды и не могли разойтись.
  const productMeta = (p: ProductVariant) => {
    const restaurantNorm = norm(p.restaurant)
    const supplierCanon = norm(matching.supplierAlias[norm(p.supplier)] ?? p.supplier)
    const productNorm = norm(p.product)
    const pairKey = `${restaurantNorm}::${supplierCanon}::${productNorm}`
    const packNorm = p.pack ? normPack(p.pack) : null
    const tripleKey = packNorm ? `${pairKey}::${packNorm}` : null
    // Не ассортимент (p.pack === null) — если у пары в матрице ровно один
    // прайсованный вариант фасовки, берём его описание/план; иначе — просто
    // плоская запись без привязки к конкретной упаковке.
    const prefix = `${pairKey}::`
    const soleKey = !tripleKey
      ? (() => { const ks = Object.keys(matching.planPairsByPack).filter((k) => k.startsWith(prefix)); return ks.length === 1 ? ks[0] : null })()
      : null
    const matrixLabel = (tripleKey && matching.productLabels[tripleKey])
      ?? (soleKey && matching.productLabels[soleKey])
      ?? matching.productLabels[pairKey] ?? null
    const renameKey = tripleKey ? `${p.product}::${p.supplier}::${p.pack}` : `${p.product}::${p.supplier}`
    const planKey = tripleKey ?? pairKey
    const matrixPlan = (tripleKey && matching.planPairsByPack[tripleKey])
      ?? (soleKey && matching.planPairsByPack[soleKey])
      ?? matching.planPairs[pairKey] ?? null
    return { pairKey, matrixLabel, renameKey, planKey, matrixPlan }
  }
  const productMatrixName = (p: ProductVariant) => {
    const { matrixLabel, renameKey } = productMeta(p)
    return edits.productRenames[renameKey] ?? matrixLabel ?? p.product
  }

  // Значения для чек-листа фасовки — как в Google Sheets, список всех
  // встречающихся значений (независимо от того, что сейчас отфильтровано
  // остальным — иначе список "прыгал" бы при каждом изменении).
  const packValues = useMemo(() => [...new Set(productVariants.map((p) => p.pack ?? '—'))].sort((a, b) => a.localeCompare(b)), [productVariants])
  const nameSearchNeedle = nameSearch.trim().toLowerCase()
  const planMinNum = planMin.trim() ? Number(planMin.trim().replace(',', '.')) : null
  const planMaxNum = planMax.trim() ? Number(planMax.trim().replace(',', '.')) : null

  // Поиск бьёт и по фасовке — «Ягода в асс» ищется через конкретный вкус
  // (например «черника»), который в iiko виден только в фасовке, не в
  // названии товара. Фильтр (значок у строки поиска) — отдельно: название
  // (текстом, сразу и iiko, и матрица), фасовка (чек-лист), план (диапазон).
  const productVariantsFiltered = useMemo(() => {
    let list = productVariants
    if (needle) {
      list = list.filter((p) => p.product.toLowerCase().includes(needle) || p.supplier.toLowerCase().includes(needle) || (p.pack ?? '').toLowerCase().includes(needle))
    }
    if (nameSearchNeedle || excludedPack.size || planMinNum != null || planMaxNum != null) {
      list = list.filter((p) => {
        if (nameSearchNeedle && !p.product.toLowerCase().includes(nameSearchNeedle) && !productMatrixName(p).toLowerCase().includes(nameSearchNeedle)) return false
        if (excludedPack.has(p.pack ?? '—')) return false
        if (planMinNum != null || planMaxNum != null) {
          const { matrixPlan, planKey } = productMeta(p)
          const plan = edits.planOverrides[planKey] ?? matrixPlan
          if (plan == null) return false
          if (planMinNum != null && plan < planMinNum) return false
          if (planMaxNum != null && plan > planMaxNum) return false
        }
        return true
      })
    }
    return list
  }, [needle, productVariants, nameSearchNeedle, excludedPack, planMinNum, planMaxNum, matching, edits.productRenames, edits.planOverrides])

  const activeFilterDims = (nameSearchNeedle ? 1 : 0) + (excludedPack.size ? 1 : 0) + (planMinNum != null || planMaxNum != null ? 1 : 0)
  const resetAllFilters = () => { setNameSearch(''); setExcludedPack(new Set()); setPlanMin(''); setPlanMax('') }

  // Компании без справочника (potentially typos of an existing поставщик,
  // а не реально новый) — предупреждаем, но ничего не делаем автоматически:
  // "Объединить" убрали сознательно, тут только подсказка "проверьте matrix".
  const canonicalSupplierNames = useMemo(() => [...new Set(Object.values(matching.supplierAlias))], [matching])
  const possibleDuplicate = (name: string) => {
    const top = rankSimilar(name, canonicalSupplierNames, (x) => x, 0.45)[0]
    return top?.item ?? null
  }

  const venues = useMemo(
    () => (needle ? restaurants.filter((r) => r.name.toLowerCase().includes(needle) || r.city.toLowerCase().includes(needle)) : restaurants),
    [needle, restaurants],
  )

  // Правки фасовки — созданные прямо на строке в «Проверке цен» (кнопка
  // «Это тот же товар») или тут вручную; тут только просмотр/отмена.
  const packAliasEntries = useMemo(() => Object.entries(edits.packAliases), [edits.packAliases])
  const packAliasList = useMemo(
    () => (needle
      ? packAliasEntries.filter(([, v]) => [v.supplier, v.product, v.rawPack, v.targetPack].some((x) => x.toLowerCase().includes(needle)))
      : packAliasEntries),
    [needle, packAliasEntries],
  )

  const shown = tab === 'suppliers' ? suppliers.slice(0, limit)
    : tab === 'products' ? productVariantsFiltered.slice(0, limit)
    : tab === 'packs' ? packAliasList.slice(0, limit)
    : venues.slice(0, limit)
  const total = tab === 'suppliers' ? suppliers.length
    : tab === 'products' ? productVariantsFiltered.length
    : tab === 'packs' ? packAliasList.length
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
              <InfoTip text="Компании и товары приходят из iiko. Плановые цены обычно из вашего Excel-файла (матрицы), но их можно поправить и здесь, на вкладке «Товары»." />
            </div>
            <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
              Если компании нет в матрице — «Добавить», чтобы отметить, что это действительно новый поставщик.
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
          <InfoTip text="Показывает всё приложение так, будто только что загрузили отчёт из iiko, а матрицу (план-цены, «название из матрицы») ещё не подключали — везде пусто. Можно вписать «Название из матрицы» и «План» самому прямо в Товарах и посмотреть, как это отразится в «Проверке цен». На реальные данные не влияет — переключатель хранится только в этом браузере, выключите его, чтобы вернуть матрицу как было." />
        </div>
      </div>

      <Section title={undefined} right={undefined}>
        {/* tabs + search */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-ink-800/70 p-1">
            <button onClick={() => { setTab('suppliers'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'suppliers' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Компании ({fmt(suppliersBase.length)})</button>
            <button onClick={() => { setTab('products'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'products' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Товары ({fmt(productVariants.length)})</button>
            <button onClick={() => { setTab('venues'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'venues' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Точки ({fmt(restaurants.length)})</button>
            <button onClick={() => { setTab('packs'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'packs' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Фасовки ({fmt(packAliasEntries.length)})</button>
          </div>
          <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
            <ISearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width={16} height={16} />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setLimit(60) }}
              placeholder={tab === 'products' ? 'Поиск товара, поставщика или фасовки…' : tab === 'suppliers' ? 'Поиск компании…' : tab === 'packs' ? 'Поиск по товару, поставщику, фасовке…' : 'Поиск точки или города…'}
              className="w-full rounded-lg border border-ink-600 bg-ink-900/60 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          {tab === 'products' && (
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setFilterOpen((v) => !v)}
                title="Фильтр по названиям, фасовке и плану (как в Google Sheets)"
                className={`btn border px-3 py-2 text-xs ${filterOpen || activeFilterDims > 0 ? 'border-brand-500/50 bg-brand-500/10 text-brand-300' : 'border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750'}`}
              >
                <IFilter width={14} height={14} /> Фильтр{activeFilterDims > 0 ? ` (${activeFilterDims})` : ''}
              </button>
              {filterOpen && (
                <div className="animate-scale-in absolute right-0 z-30 mt-1 w-[320px] rounded-xl border border-ink-700 bg-ink-850 p-2 shadow-card">
                  <FilterSection
                    label="Название" active={!!nameSearchNeedle} open={filterSection === 'name'}
                    onToggle={() => setFilterSection((s) => (s === 'name' ? null : 'name'))}
                  >
                    <input
                      value={nameSearch}
                      onChange={(e) => { setNameSearch(e.target.value); setLimit(60) }}
                      autoFocus
                      placeholder="например, «аво»…"
                      className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
                    />
                  </FilterSection>
                  <FilterSection
                    label="Фасовка" active={excludedPack.size > 0} open={filterSection === 'pack'}
                    onToggle={() => setFilterSection((s) => (s === 'pack' ? null : 'pack'))}
                  >
                    <ValueChecklist values={packValues} excluded={excludedPack} onChange={(next) => { setLimit(60); setExcludedPack(next) }} />
                  </FilterSection>
                  <FilterSection
                    label="План, ₸" active={planMinNum != null || planMaxNum != null} open={filterSection === 'plan'}
                    onToggle={() => setFilterSection((s) => (s === 'plan' ? null : 'plan'))}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={planMin} onChange={(e) => { setPlanMin(e.target.value); setLimit(60) }} placeholder="От" inputMode="decimal"
                        className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
                      />
                      <span className="text-slate-500">—</span>
                      <input
                        value={planMax} onChange={(e) => { setPlanMax(e.target.value); setLimit(60) }} placeholder="До" inputMode="decimal"
                        className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
                      />
                    </div>
                  </FilterSection>
                  <div className="mt-1 flex items-center justify-between px-1 pt-2">
                    <button onClick={resetAllFilters} className="text-xs text-slate-500 hover:text-bad">Сбросить всё</button>
                    <button onClick={() => setFilterOpen(false)} className="text-xs text-brand-300 hover:text-brand-200">Готово</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {tab === 'venues' && (
            <button
              onClick={() => setAddOpen((v) => !v)}
              className={`btn border px-3 py-2 text-xs ${addOpen ? 'border-brand-500/50 bg-brand-500/10 text-brand-300' : 'border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750'}`}
            >
              <IPlus width={14} height={14} /> Добавить точку
            </button>
          )}
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
            матрице ни под каким известным написанием; «Добавить» ничего не меняет в сопоставлении, просто убирает
            позицию из списка новых, чтобы не проверять её повторно каждый раз.
          </p>
        )}

        {tab === 'products' && (
          <p className="mb-3 text-xs text-slate-500">
            Одна строка — товар у конкретного поставщика; фасовку показываем отдельными строками только там, где
            под одним названием в iiko на самом деле разные товары (пюре/ягода в ассортименте и т.п.) — для
            остального фасовка не важна и не разносится по строкам. «Название из матрицы» — как товар называют они
            сами (влияет только на подпись в «Проверке цен», не на сопоставление). «Фасовка» — просто как записана в iiko,
            без изменений. «План» — плановая цена: по умолчанию из матрицы, но можно задать или поправить прямо
            здесь — тогда эта цена побеждает.
          </p>
        )}

        {tab === 'packs' && (
          <p className="mb-3 text-xs text-slate-500">
            Список правок вида «эта фасовка из iiko на самом деле вот эта фасовка из матрицы» — реально влияют на
            сопоставление с планом, а не только на подпись. Здесь можно посмотреть и отменить; удаление возвращает
            автоматику как было.
          </p>
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
                  <th className="th w-[28%]">Название из матрицы <InfoTip text="Название компании, обычно как в матрице — можно поправить вручную, например переименовать ИП. Влияет только на подпись, не на сопоставление. «Нет в справочнике» — этой компании нет в матрице ни под каким известным написанием; если это действительно новый поставщик — нажмите «Добавить»." /></th>
                  <th className="th w-[12%] text-right">Позиций</th>
                  <th className="th w-[18%] text-center">Действие</th>
                </tr>
              ) : tab === 'products' ? (
                <tr>
                  <th className="th w-[26%]">Название (iiko)</th>
                  <th className="th w-[26%]">Название из матрицы <InfoTip text="Как этот товар называют они сами (столбец I матрицы) для этой позиции — можно поправить. Название из iiko при этом не трогается, остаётся якорем." /></th>
                  <th className="th w-[24%]">Фасовка <InfoTip text="Ровно как записана фасовка в отчёте iiko, без изменений." /></th>
                  <th className="th w-[24%] text-right">План <InfoTip text="Плановая цена. По умолчанию — из матрицы; можно задать или поправить прямо здесь, тогда эта цена побеждает при сопоставлении с фактом." align="right" /></th>
                </tr>
              ) : tab === 'venues' ? (
                <tr>
                  <th className="th w-[25%]">Точка</th>
                  <th className="th w-[14%]">Город</th>
                  <th className="th w-[16%]">Бренд</th>
                  <th className="th w-[21%]">Юрлицо</th>
                  <th className="th w-[14%]">Категория</th>
                  <th className="th w-[10%] text-center">Действие</th>
                </tr>
              ) : (
                <tr>
                  <th className="th w-[20%]">Поставщик</th>
                  <th className="th w-[26%]">Товар</th>
                  <th className="th w-[24%]">Как в iiko</th>
                  <th className="th w-[20%]">Считаем той же фасовкой из матрицы</th>
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
                            <EditableText
                              value={supplierRename ?? canon ?? ''}
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
                                    <InfoTip text="Это не точное совпадение, а похожее по написанию название, уже занесённое в справочник — возможно, это тот же поставщик, просто иначе записанный в iiko (опечатка, сокращение). Перед «Добавить» стоит свериться с матрицей." align="left" />
                                  </span>
                                )}
                              </div>
                            )
                          )}
                        </td>
                        <td className="td text-right tabnum text-slate-400">{fmt(s.count)}</td>
                        <td className="td text-center">
                          {acknowledged ? (
                            <button onClick={() => unacknowledgeSupplier(s.name)} className="btn mx-auto px-2 py-1 text-xs text-slate-500 hover:text-white" title="Отменить отметку">
                              <IReset width={13} height={13} />
                            </button>
                          ) : !canon ? (
                            <button onClick={() => acknowledgeSupplier(s.name)} className="btn mx-auto border border-ink-600 bg-ink-800/70 px-2 py-1 text-xs text-slate-300 hover:border-good/50 hover:text-good" title="Это действительно новый поставщик">
                              <IPlus width={12} height={12} /> Добавить
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })
                : tab === 'products'
                ? (shown as typeof productVariantsFiltered).map((p) => {
                    const { pairKey, matrixLabel, renameKey, planKey, matrixPlan } = productMeta(p)
                    const suggestions = matrixLabel ? [{ label: matrixLabel, supplier: p.supplier }] : []
                    const overridden = edits.planOverrides[planKey]
                    return (
                      <tr key={`${pairKey}::${p.pack ?? ''}`} className="row-hover hover:bg-ink-800/40">
                        <td className="td overflow-hidden">
                          <HoverName text={p.product} className="font-medium text-slate-100" />
                          <HoverName text={p.supplier} className="block text-[11px] font-normal text-slate-500" />
                        </td>
                        <td className="td">
                          <ProductLabelSuggest
                            value={edits.productRenames[renameKey] ?? matrixLabel ?? p.product}
                            suggestions={suggestions}
                            onCommit={(v) => renameProduct(renameKey, v)}
                          />
                        </td>
                        <td className="td overflow-hidden text-xs text-slate-400">
                          <HoverName text={p.pack || '—'} />
                        </td>
                        <td className="td">
                          <PlanPriceInput
                            value={overridden ?? matrixPlan}
                            overridden={overridden != null}
                            onCommit={(v) => setPlanOverride(planKey, v)}
                          />
                        </td>
                      </tr>
                    )
                  })
                : tab === 'venues'
                ? (shown as typeof venues).map((r) => {
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
                  })
                : (shown as typeof packAliasList).map(([key, v]) => (
                    <tr key={key} className="row-hover hover:bg-ink-800/40">
                      <td className="td overflow-hidden text-slate-400">
                        <span className="flex min-w-0 items-center gap-2"><IStore width={14} height={14} className="shrink-0 text-slate-600" /><HoverName text={v.supplier} /></span>
                      </td>
                      <td className="td overflow-hidden text-slate-100"><HoverName text={v.product} /></td>
                      <td className="td overflow-hidden">
                        <span className="flex min-w-0 items-center gap-2 text-slate-400">
                          <IScale width={13} height={13} className="shrink-0 text-slate-600" /><HoverName text={v.rawPack} />
                        </span>
                      </td>
                      <td className="td overflow-hidden text-good"><HoverName text={v.targetPack} /></td>
                      <td className="td text-center">
                        <button onClick={() => setPackAlias(key, null)} className="btn mx-auto px-2 py-1 text-xs text-slate-500 hover:text-bad" title="Отменить правку — вернуть автоматическое сопоставление">
                          <ITrash width={13} height={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
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
 * План — число, коммитится по blur/Enter, пустое поле = снять правку
 * (вернуться к автоматической цене из матрицы). Ручные правки подсвечены,
 * чтобы отличать от того, что подтянулось из матрицы само.
 */
function PlanPriceInput({ value, overridden, onCommit }: {
  value: number | null; overridden: boolean; onCommit: (v: number | null) => void
}) {
  const [v, setV] = useState(value == null ? '' : String(value))
  useEffect(() => setV(value == null ? '' : String(value)), [value])
  const commit = () => {
    const trimmed = v.trim().replace(',', '.')
    const next = trimmed ? Number(trimmed) : null
    if (next !== null && Number.isNaN(next)) return
    // Как и в остальных полях справочника — просто кликнуть и выйти не
    // должно "замораживать" текущее значение как ручную правку.
    if (next !== value) onCommit(next)
  }
  return (
    <input
      value={v}
      title={overridden ? 'Цена задана вручную — побеждает матрицу. Очистите поле, чтобы вернуться к автоматике.' : 'Цена из матрицы. Впишите своё значение, чтобы задать вручную.'}
      inputMode="decimal"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      placeholder="—"
      className={`w-full rounded-md border px-2 py-1.5 text-right text-sm tabnum transition-colors focus:outline-none ${
        overridden
          ? 'border-brand-500/40 bg-brand-500/[0.06] text-brand-200 hover:border-brand-500/60 focus:border-brand-500'
          : 'border-ink-700/50 bg-ink-900/40 text-slate-100 hover:border-ink-500 focus:border-brand-500 focus:bg-ink-900/70'
      }`}
    />
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

/** Чекбокс под общий стиль (тема/цвет акцента) — вместо базового браузерного. */
function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <span className="relative inline-flex h-4 w-4 shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <span className="pointer-events-none flex h-4 w-4 items-center justify-center rounded-[5px] border border-ink-600 bg-ink-900/60 text-transparent transition-all duration-150 peer-checked:border-brand-500 peer-checked:bg-brand-500 peer-checked:text-white peer-hover:border-ink-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40">
        <ICheck width={10} height={10} strokeWidth={3} />
      </span>
    </span>
  )
}
