import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt, plural, normPack } from '../lib/data'
import { useEdits } from '../lib/edits'
import { rankSimilar } from '../lib/fuzzy'
import { Section, InfoTip } from '../components/ui'
import { EditableText } from '../components/EditableCell'
import ProductLabelSuggest from '../components/ProductLabelSuggest'
import HoverName from '../components/HoverName'
import { ISearch, IFilter, IDownload, IUpload, IReset, IUndo, IStore, IDatabase, IPin, IPlus, ITrash, ICheck, IScale } from '../components/icons'

type Tab = 'suppliers' | 'products' | 'venues' | 'packs'
type SupplierFilter = 'all' | 'new'

export default function DataEditor() {
  const {
    edits, editCount, rows, renameProduct, renameSupplier, setVenue, reset, replaceAll,
    addVenue, removeVenue,
    acknowledgeSupplier, unacknowledgeSupplier, setPackAlias, setPlanOverride, undo, canUndo,
    suppliers: suppliersBase, restaurants, matching,
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
  const [nameFilterOpen, setNameFilterOpen] = useState(false)
  const [nameFilter, setNameFilter] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

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

  // Товары. Фасовка как отдельная строка нужна ТОЛЬКО там, где одно
  // название в iiko реально прячет разные товары (категории-ассортименты:
  // "Пюре в асс", "Ягода ... в асс" — вкус виден только в фасовке). Это не
  // жёстко зашитые названия, а проверка по матрице: если у этой пары
  // товар+поставщик матрица знает больше ОДНОГО разного описания (в разных
  // фасовках) — считаем ассортиментом и бьём по фасовке; иначе это один и
  // тот же товар (пусть даже с чуть разным весом куска между поставками) —
  // схлопываем в одну строку без фасовки вообще.
  interface ProductRow {
    id: string
    restaurant: string; product: string; supplier: string
    pack: string | null       // null = одна строка на весь товар (фасовка не важна)
    renameKey: string
    planKey: string
    matrixLabel: string | null
    matrixPlan: number | null
  }
  const productRows = useMemo(() => {
    const groups = new Map<string, { restaurant: string; product: string; supplier: string; packs: Map<string, string>; count: number }>()
    for (const r of rows) {
      if (r.unit == null) continue // не реальная закупка — позиция из матрицы, ещё не куплена в этом периоде
      const key = `${norm(r.restaurant)}::${norm(r.productRaw)}::${norm(r.supplier)}`
      let g = groups.get(key)
      if (!g) { g = { restaurant: r.restaurant, product: r.productRaw, supplier: r.supplier, packs: new Map(), count: 0 }; groups.set(key, g) }
      g.count++
      const rawNorm = normPack(r.pack)
      if (!g.packs.has(rawNorm)) g.packs.set(rawNorm, r.pack)
    }

    const result: ProductRow[] = []
    for (const g of groups.values()) {
      const restaurantNorm = norm(g.restaurant)
      const supplierCanon = norm(matching.supplierAlias[norm(g.supplier)] ?? g.supplier)
      const productNorm = norm(g.product)
      const pairKey = `${restaurantNorm}::${supplierCanon}::${productNorm}`
      const labelsSeen = new Set<string>()
      const prefix = `${pairKey}::`
      for (const [k, v] of Object.entries(matching.productLabels)) if (k.startsWith(prefix)) labelsSeen.add(v)
      const isAssortment = labelsSeen.size > 1

      if (isAssortment) {
        for (const [rawNorm, rawDisplay] of g.packs) {
          const tripleKey = `${pairKey}::${rawNorm}`
          result.push({
            id: tripleKey, restaurant: g.restaurant, product: g.product, supplier: g.supplier, pack: rawDisplay,
            renameKey: `${g.product}::${g.supplier}::${rawDisplay}`,
            planKey: tripleKey,
            matrixLabel: matching.productLabels[tripleKey] ?? matching.productLabels[pairKey] ?? null,
            matrixPlan: matching.planPairsByPack[tripleKey] ?? matching.planPairs[pairKey] ?? null,
          })
        }
      } else {
        // Один и тот же реальный товар: если у него ровно один прайсованный
        // вариант фасовки в матрице — берём его (план/описание), иначе —
        // плоскую запись без фасовки. Фасовку тут не показываем вообще.
        const packKeys = Object.keys(matching.planPairsByPack).filter((k) => k.startsWith(prefix))
        const soleKey = packKeys.length === 1 ? packKeys[0] : null
        result.push({
          id: pairKey, restaurant: g.restaurant, product: g.product, supplier: g.supplier, pack: null,
          renameKey: `${g.product}::${g.supplier}`,
          planKey: pairKey,
          matrixLabel: (soleKey ? matching.productLabels[soleKey] : undefined) ?? matching.productLabels[pairKey] ?? null,
          matrixPlan: (soleKey ? matching.planPairsByPack[soleKey] : undefined) ?? matching.planPairs[pairKey] ?? null,
        })
      }
    }
    return result.sort((a, b) => a.product.localeCompare(b.product) || a.supplier.localeCompare(b.supplier))
  }, [rows, matching])

  // Общий поиск бьёт по всему (товар/поставщик/фасовка/название из
  // матрицы); отдельный значок-фильтр у заголовка колонки — только по
  // названию (как в матрице, а если его нет — как в iiko), как фильтр по
  // столбцу в Google Sheets: набрали "аво" — вышли авокадо, масло авокадо…
  const nameNeedle = nameFilter.trim().toLowerCase()
  const productRowsFiltered = useMemo(() => {
    let list = productRows
    if (needle) {
      list = list.filter((p) =>
        p.product.toLowerCase().includes(needle) || p.supplier.toLowerCase().includes(needle) ||
        (p.pack ?? '').toLowerCase().includes(needle) || (p.matrixLabel ?? '').toLowerCase().includes(needle))
    }
    if (nameNeedle) list = list.filter((p) => (p.matrixLabel ?? p.product).toLowerCase().includes(nameNeedle))
    return list
  }, [needle, nameNeedle, productRows])

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
    : tab === 'products' ? productRowsFiltered.slice(0, limit)
    : tab === 'packs' ? packAliasList.slice(0, limit)
    : venues.slice(0, limit)
  const total = tab === 'suppliers' ? suppliers.length
    : tab === 'products' ? productRowsFiltered.length
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

  const exportEdits = () => {
    const blob = new Blob([JSON.stringify(edits, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'pricecheck-spravochnik.json'
    a.click()
  }

  const importEdits = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const p = JSON.parse(String(reader.result))
        if (p && typeof p === 'object') replaceAll(p)
      } catch { alert('Не удалось прочитать файл — ожидается JSON, экспортированный из этого приложения.') }
    }
    reader.readAsText(file)
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
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importEdits(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} className="btn border border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750"><IDownload width={16} height={16} /> Импорт</button>
          <button onClick={exportEdits} className="btn border border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750"><IUpload width={16} height={16} /> Экспорт</button>
          {editCount > 0 && (
            <button
              onClick={() => { if (confirm('Сбросить все правки?')) reset() }}
              className="btn border border-bad/30 bg-bad/10 text-bad hover:bg-bad/20"
            ><IReset width={16} height={16} /> Сбросить</button>
          )}
        </div>
      </div>

      <Section title={undefined} right={undefined}>
        {/* tabs + search */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-ink-800/70 p-1">
            <button onClick={() => { setTab('suppliers'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'suppliers' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Компании ({fmt(suppliersBase.length)})</button>
            <button onClick={() => { setTab('products'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'products' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Товары ({fmt(productRows.length)})</button>
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
            остального фасовка не важна и не показывается. «Название из матрицы» — можно поправить, влияет только
            на подпись в «Проверке цен», не на сопоставление. «План» — по умолчанию из матрицы, но можно задать
            или поправить прямо здесь — тогда эта цена побеждает.
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
                  <th className="th w-[70%]">
                    <div className="flex items-center gap-1.5">
                      <span>Название из матрицы</span>
                      <InfoTip text="Как этот товар называют они сами (столбец I матрицы) — можно поправить. Под ним — название из iiko (якорь, не трогается) и, если это категория-ассортимент, фасовка через тире." />
                      <button
                        onClick={() => setNameFilterOpen((v) => !v)}
                        title="Фильтр по названию (как в Google Sheets)"
                        className={`ml-auto rounded p-1 transition-colors ${nameFilterOpen || nameNeedle ? 'bg-brand-500/15 text-brand-300' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        <IFilter width={13} height={13} />
                      </button>
                    </div>
                    {nameFilterOpen && (
                      <div className="mt-1.5 normal-case">
                        <input
                          value={nameFilter}
                          onChange={(e) => { setNameFilter(e.target.value); setLimit(60) }}
                          autoFocus
                          placeholder="например, «аво»…"
                          className="w-full max-w-[220px] rounded-md border border-ink-600 bg-ink-900/70 px-2 py-1 text-xs font-normal normal-case tracking-normal text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
                        />
                      </div>
                    )}
                  </th>
                  <th className="th w-[30%] text-right">План <InfoTip text="Плановая цена. По умолчанию — из матрицы; можно задать или поправить прямо здесь, тогда эта цена побеждает при сопоставлении с фактом." align="right" /></th>
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
                ? (shown as typeof productRowsFiltered).map((p) => {
                    const rename = edits.productRenames[p.renameKey]
                    const suggestions = p.matrixLabel ? [{ label: p.matrixLabel, supplier: p.supplier }] : []
                    const overridden = edits.planOverrides[p.planKey]
                    const secondary = `${p.product}${p.pack ? ' - ' + p.pack : ''}`
                    return (
                      <tr key={p.id} className="row-hover hover:bg-ink-800/40">
                        <td className="td overflow-hidden">
                          <ProductLabelSuggest
                            value={rename ?? p.matrixLabel ?? p.product}
                            suggestions={suggestions}
                            onCommit={(v) => renameProduct(p.renameKey, v)}
                          />
                          <HoverName text={secondary} className="block text-[11px] font-normal text-slate-500" />
                        </td>
                        <td className="td">
                          <PlanPriceInput
                            value={overridden ?? p.matrixPlan}
                            overridden={overridden != null}
                            onCommit={(v) => setPlanOverride(p.planKey, v)}
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
