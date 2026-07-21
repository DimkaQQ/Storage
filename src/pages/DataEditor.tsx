import { useMemo, useRef, useState } from 'react'
import { fmt, plural, BUNDLED_MATCHING } from '../lib/data'
import { useEdits } from '../lib/edits'
import { Section, InfoTip } from '../components/ui'
import { EditableText } from '../components/EditableCell'
import SupplierMergeModal from '../components/SupplierMergeModal'
import HoverName from '../components/HoverName'
import { ISearch, IDownload, IUpload, IReset, IUndo, IStore, IDatabase, IPin, ILink, IPlus, ITrash, ICheck } from '../components/icons'

type Tab = 'suppliers' | 'products' | 'venues'
type SupplierFilter = 'all' | 'new'

export default function DataEditor() {
  const {
    edits, editCount, renameSupplier, renameProduct, setVenue, reset, replaceAll,
    addVenue, removeVenue, mergeSupplier, unmergeSupplier, undo, canUndo,
    suppliers: suppliersBase, products: productsBase, restaurants,
  } = useEdits()
  const [tab, setTab] = useState<Tab>('suppliers')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(60)
  const [sFilter, setSFilter] = useState<SupplierFilter>('all')
  const [mergeFor, setMergeFor] = useState<{ name: string } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newBrand, setNewBrand] = useState('')
  const [newEntity, setNewEntity] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const needle = q.trim().toLowerCase()
  const norm = (s: string) => s.trim().toLowerCase()

  // Canonical (matrix-side) supplier names available as merge targets, even
  // when they've never shown up as a raw iiko supplier themselves.
  const mergeCandidates = useMemo(() => {
    const byName = new Map(suppliersBase.map((s) => [s.name, s]))
    for (const canon of new Set(Object.values(BUNDLED_MATCHING.supplierAlias)))
      if (!byName.has(canon)) byName.set(canon, { name: canon, count: 0, sum: 0, isNew: false })
    return [...byName.values()]
  }, [suppliersBase])

  const supplierCounts = useMemo(() => ({
    all: suppliersBase.length,
    new: suppliersBase.filter((s) => s.isNew).length,
  }), [suppliersBase])

  const suppliers = useMemo(() => {
    let list = needle
      ? suppliersBase.filter((s) => s.name.toLowerCase().includes(needle) || (edits.supplierRenames[s.name] ?? '').toLowerCase().includes(needle))
      : suppliersBase
    if (sFilter === 'new') list = list.filter((s) => s.isNew)
    return list
  }, [needle, edits.supplierRenames, sFilter, suppliersBase])

  const products = useMemo(
    () => (needle
      ? productsBase.filter((p) => p.name.toLowerCase().includes(needle) || (edits.productRenames[p.name] ?? '').toLowerCase().includes(needle))
      : productsBase),
    [needle, edits.productRenames, productsBase],
  )

  const venues = useMemo(
    () => (needle ? restaurants.filter((r) => r.name.toLowerCase().includes(needle) || r.city.toLowerCase().includes(needle)) : restaurants),
    [needle, restaurants],
  )

  const shown = tab === 'suppliers' ? suppliers.slice(0, limit) : tab === 'products' ? products.slice(0, limit) : venues.slice(0, limit)
  const total = tab === 'suppliers' ? suppliers.length : tab === 'products' ? products.length : venues.length

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
    <>
    <div className="space-y-5">
      {/* intro + actions */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-300"><IDatabase width={18} height={18} /></span>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              Справочники
              <InfoTip text="Компании и товары приходят из iiko. Плановые цены и матрица остаются в вашем Excel-файле — здесь только сопоставление названий и список точек." />
            </div>
            <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
              Если компания в iiko называется иначе, чем в матрице — «Объединить». Правки сохраняются автоматически.
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
            <button onClick={() => { setTab('products'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'products' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Товары ({fmt(productsBase.length)})</button>
            <button onClick={() => { setTab('venues'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'venues' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Точки ({fmt(restaurants.length)})</button>
          </div>
          <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
            <ISearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width={16} height={16} />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setLimit(60) }}
              placeholder={tab === 'products' ? 'Поиск товара…' : tab === 'suppliers' ? 'Поиск компании…' : 'Поиск точки или города…'}
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
                  <th className="th w-[30%]">Название (iiko)</th>
                  <th className="th w-[28%]">Отображаемое имя</th>
                  <th className="th w-[20%]">Справочник <InfoTip text="«Нет в справочнике» — iiko называет компанию иначе, чем матрица, и её позиции не сопоставляются. Нажмите «Объединить»." /></th>
                  <th className="th w-[10%] text-right">Позиций</th>
                  <th className="th w-[12%] text-center">Действие</th>
                </tr>
              ) : tab === 'products' ? (
                <tr>
                  <th className="th w-[38%]">Название (iiko)</th>
                  <th className="th w-[38%]">Отображаемое имя</th>
                  <th className="th w-[24%] text-right">Ресторанов</th>
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
                    const mergedTo = edits.supplierMerges[s.name]
                    const canon = mergedTo ?? BUNDLED_MATCHING.supplierAlias[norm(s.name)]
                    return (
                      <tr key={s.name} className="row-hover hover:bg-ink-800/40">
                        <td className="td overflow-hidden text-slate-400">
                          <span className="flex min-w-0 items-center gap-2"><IStore width={14} height={14} className="shrink-0 text-slate-600" /><HoverName text={s.name} /></span>
                        </td>
                        <td className="td"><EditableText value={edits.supplierRenames[s.name] ?? s.name} onCommit={(v) => renameSupplier(s.name, v)} /></td>
                        <td className="td overflow-hidden">
                          {canon
                            ? <HoverName text={mergedTo ? `объединено: ${canon}` : canon} className="text-[11px] text-good" />
                            : <span className="chip border-transparent bg-warn/10 text-[11px] text-warn">нет в справочнике</span>}
                        </td>
                        <td className="td text-right tabnum text-slate-400">{fmt(s.count)}</td>
                        <td className="td text-center">
                          {mergedTo ? (
                            <button onClick={() => unmergeSupplier(s.name)} className="btn mx-auto px-2 py-1 text-xs text-slate-500 hover:text-white" title="Отменить объединение">
                              <IReset width={13} height={13} />
                            </button>
                          ) : !canon ? (
                            <button onClick={() => setMergeFor({ name: s.name })} className="btn mx-auto border border-ink-600 bg-ink-800/70 px-2 py-1 text-xs text-brand-300 hover:border-brand-500/50 hover:text-brand-200" title="Это тот же поставщик, что и...?">
                              <ILink width={12} height={12} /> Объединить
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })
                : tab === 'products'
                ? (shown as typeof productsBase).map((p) => (
                    <tr key={p.name} className="row-hover hover:bg-ink-800/40">
                      <td className="td overflow-hidden text-slate-400"><HoverName text={p.name} /></td>
                      <td className="td"><EditableText value={edits.productRenames[p.name] ?? p.name} onCommit={(v) => renameProduct(p.name, v)} /></td>
                      <td className="td text-right tabnum text-slate-400">{fmt(p.restaurantCount)}</td>
                    </tr>
                  ))
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

    {mergeFor && (
      <SupplierMergeModal
        target={mergeFor}
        suppliers={mergeCandidates}
        onClose={() => setMergeFor(null)}
        onPick={(canonicalName) => { mergeSupplier(mergeFor.name, canonicalName); setMergeFor(null) }}
      />
    )}
    </>
  )
}
