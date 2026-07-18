import { useMemo, useRef, useState } from 'react'
import { money, moneyShort, fmt, plural, byRestaurant, MATCH_KIND_META, MatchKind } from '../lib/data'
import { useEdits } from '../lib/edits'
import { Section, InfoTip } from '../components/ui'
import { EditableText, EditablePlan } from '../components/EditableCell'
import MatchModal from '../components/MatchModal'
import SupplierMergeModal from '../components/SupplierMergeModal'
import { ISearch, IDownload, IUpload, IReset, IStore, IDatabase, IPin, ILink, IPlus, ITrash, ICheck } from '../components/icons'

type Tab = 'suppliers' | 'products' | 'venues'
type ProductFilter = 'all' | 'none' | 'product' | 'manual' | 'excluded'
type SupplierFilter = 'all' | 'new'

export default function DataEditor() {
  const {
    edits, editCount, renameSupplier, renameProduct, setPlan, setExcluded, setVenue, reset, replaceAll,
    addSupplier, addProduct, addVenue, removeSupplier, removeProduct, removeVenue,
    mergeSupplier, unmergeSupplier,
    suppliers: suppliersBase, products: productsBase, restaurants, rows,
  } = useEdits()
  const [tab, setTab] = useState<Tab>('products')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(60)
  const [pFilter, setPFilter] = useState<ProductFilter>('all')
  const [sFilter, setSFilter] = useState<SupplierFilter>('all')
  const [matchFor, setMatchFor] = useState<{ product0: string; product: string } | null>(null)
  const [mergeFor, setMergeFor] = useState<{ name: string } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPlan, setNewPlan] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newBrand, setNewBrand] = useState('')
  const [newEntity, setNewEntity] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const needle = q.trim().toLowerCase()

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

  const resetAddForm = () => { setNewName(''); setNewPlan(''); setNewCity(''); setNewBrand(''); setNewEntity(''); setAddOpen(false) }
  const submitAdd = () => {
    const name = newName.trim()
    if (!name) return
    if (tab === 'suppliers') addSupplier(name)
    else if (tab === 'products') addProduct(name, newPlan.trim() ? parseFloat(newPlan.replace(',', '.')) : null)
    else addVenue(name, { city: newCity.trim() || undefined, brand: newBrand.trim() || undefined, entity: newEntity.trim() || undefined })
    resetAddForm()
  }

  // Итоговый статус позиции: чем сопоставлен план (пара/только товар),
  // задан ли он вручную, или отмечена как «разные товары».
  const productStatus = (name: string): MatchKind | 'excluded' => {
    if (edits.excludedProducts[name]) return 'excluded'
    if (edits.planOverrides[name] != null) return 'manual'
    const p = productsBase.find((x) => x.name === name)
    return p?.planKind ?? null
  }

  const products = useMemo(() => {
    let list = needle
      ? productsBase.filter((p) => p.name.toLowerCase().includes(needle) || (edits.productRenames[p.name] ?? '').toLowerCase().includes(needle))
      : productsBase
    if (pFilter !== 'all') list = list.filter((p) => productStatus(p.name) === (pFilter === 'none' ? null : pFilter))
    return list
  }, [needle, edits.productRenames, edits.planOverrides, edits.excludedProducts, pFilter, productsBase])

  const productCounts = useMemo(() => {
    const c: Record<ProductFilter, number> = { all: productsBase.length, none: 0, product: 0, manual: 0, excluded: 0 }
    for (const p of productsBase) {
      const st = productStatus(p.name)
      if (st === null) c.none++
      else if (st === 'product') c.product++
      else if (st === 'manual') c.manual++
      else if (st === 'excluded') c.excluded++
    }
    return c
  }, [productsBase, edits.planOverrides, edits.excludedProducts])

  const venueSpend = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of byRestaurant(rows)) m.set(g.name, g.summary.spend)
    return m
  }, [rows])
  const venues = useMemo(
    () => (needle ? restaurants.filter((r) => r.name.toLowerCase().includes(needle) || r.city.toLowerCase().includes(needle)) : restaurants),
    [needle, restaurants],
  )

  const shown = tab === 'suppliers' ? suppliers.slice(0, limit) : tab === 'products' ? products.slice(0, limit) : venues.slice(0, limit)
  const total = tab === 'suppliers' ? suppliers.length : tab === 'products' ? products.length : venues.length

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
              Справочники и плановые цены
              <InfoTip text="Здесь можно вести проект без Excel: переименовывать компании и товары, задавать плановые цены. Правки применяются ко всем отчётам сразу." />
            </div>
            <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
              Правки сохраняются в этом браузере и сразу применяются на всех экранах. Чтобы перенести их на другой
              компьютер или сделать резервную копию — используйте «Экспорт».
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editCount > 0 && <span className="chip border-brand-500/40 bg-brand-500/10 text-brand-300">{fmt(editCount)} {plural(editCount, 'правка', 'правки', 'правок')}</span>}
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importEdits(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} className="btn border border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750"><IUpload width={16} height={16} /> Импорт</button>
          <button onClick={exportEdits} className="btn border border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750"><IDownload width={16} height={16} /> Экспорт</button>
          {editCount > 0 && (
            <button
              onClick={() => { if (confirm('Сбросить все правки? Названия и плановые цены вернутся к исходным из выгрузки.')) reset() }}
              className="btn border border-bad/30 bg-bad/10 text-bad hover:bg-bad/20"
            ><IReset width={16} height={16} /> Сбросить</button>
          )}
        </div>
      </div>

      <Section
        title={undefined}
        right={undefined}
      >
        {/* tabs + search */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-ink-800/70 p-1">
            <button onClick={() => { setTab('products'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'products' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Товары ({fmt(productsBase.length)})</button>
            <button onClick={() => { setTab('suppliers'); setLimit(60) }} className={`btn px-3 py-1.5 text-xs ${tab === 'suppliers' ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>Компании ({fmt(suppliersBase.length)})</button>
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
          <button
            onClick={() => setAddOpen((v) => !v)}
            className={`btn border px-3 py-2 text-xs ${addOpen ? 'border-brand-500/50 bg-brand-500/10 text-brand-300' : 'border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750'}`}
          >
            <IPlus width={14} height={14} /> {tab === 'products' ? 'Добавить товар' : tab === 'suppliers' ? 'Добавить компанию' : 'Добавить точку'}
          </button>
        </div>

        {addOpen && (
          <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-brand-500/30 bg-brand-500/[0.04] p-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-[11px] text-slate-500">{tab === 'products' ? 'Название товара' : tab === 'suppliers' ? 'Название компании' : 'Название точки'}</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none" />
            </div>
            {tab === 'products' && (
              <div className="w-32">
                <label className="mb-1 block text-[11px] text-slate-500">План, ₸ (необязательно)</label>
                <input value={newPlan} onChange={(e) => setNewPlan(e.target.value)} inputMode="decimal"
                  className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-right text-sm tabnum text-slate-100 focus:border-brand-500 focus:outline-none" />
              </div>
            )}
            {tab === 'venues' && (
              <>
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
              </>
            )}
            <button onClick={submitAdd} disabled={!newName.trim()} className="btn border border-brand-500/50 bg-brand-500/15 px-3 py-1.5 text-xs text-brand-200 hover:bg-brand-500/25 disabled:opacity-40">
              <ICheck width={14} height={14} /> Добавить
            </button>
            <button onClick={resetAddForm} className="btn px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300">Отмена</button>
          </div>
        )}

        {tab === 'venues' && (
          <p className="mb-3 text-xs text-slate-500">
            Если город, бренд или юрлицо определились неверно — поправьте здесь. Изменение сразу применится
            ко всем отчётам и графикам по этой точке.
          </p>
        )}

        {tab === 'products' && (
          <div className="mb-3 flex flex-wrap gap-2">
            {([
              ['all', `Все (${fmt(productCounts.all)})`],
              ['none', `Нет в матрице (${fmt(productCounts.none)})`],
              ['product', `Низкая уверенность (${fmt(productCounts.product)})`],
              ['manual', `Заданы вручную (${fmt(productCounts.manual)})`],
              ['excluded', `Разные товары (${fmt(productCounts.excluded)})`],
            ] as [ProductFilter, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => { setPFilter(id); setLimit(60) }}
                className={`chip transition-colors ${pFilter === id ? 'border-brand-400 bg-brand-500/10 text-brand-300' : 'border-ink-600 text-slate-400 hover:text-slate-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === 'suppliers' && (
          <div className="mb-3 flex flex-wrap gap-2">
            {([
              ['all', `Все (${fmt(supplierCounts.all)})`],
              ['new', `Новые, нет в справочнике (${fmt(supplierCounts.new)})`],
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

        <div className="rounded-xl border border-ink-700/50">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-ink-850">
              {tab === 'suppliers' ? (
                <tr>
                  <th className="th w-8"></th>
                  <th className="th">Исходное название (iiko)</th>
                  <th className="th">Отображаемое имя</th>
                  <th className="th">Статус <InfoTip text="«Новый» — компании нет в справочнике-алиасов клиента, поэтому её позиции пока сопоставляются только по названию товара, без учёта поставщика." /></th>
                  <th className="th text-right">Позиций</th>
                  <th className="th text-right">Закупка</th>
                  <th className="th text-center">Действие</th>
                </tr>
              ) : tab === 'products' ? (
                <tr>
                  <th className="th w-8"></th>
                  <th className="th">Исходное название (iiko)</th>
                  <th className="th">Отображаемое имя</th>
                  <th className="th text-right">Плановая цена, ₸ <InfoTip text="Целевая цена за единицу. Задайте её, чтобы сравнивать факт с планом — в том числе для позиций «нет в матрице»." /></th>
                  <th className="th">Статус <InfoTip text="Как найден план: по паре поставщик+товар (надёжно), только по товару (стоит проверить), вручную, или позиция отмечена как «разные товары»." /></th>
                  <th className="th text-right">Ресторанов</th>
                  <th className="th text-right">Закупка</th>
                  <th className="th text-center">Действие</th>
                </tr>
              ) : (
                <tr>
                  <th className="th w-8"></th>
                  <th className="th">Точка</th>
                  <th className="th">Город</th>
                  <th className="th">Бренд</th>
                  <th className="th">Юрлицо</th>
                  <th className="th text-right">Закупка</th>
                  <th className="th text-center">Действие</th>
                </tr>
              )}
            </thead>
            <tbody>
              {tab === 'suppliers'
                ? (shown as typeof suppliersBase).map((s) => {
                    const changed = !!edits.supplierRenames[s.name]
                    const manual = edits.newSuppliers[s.name] === true
                    const mergedTo = edits.supplierMerges[s.name]
                    return (
                      <tr key={s.name} className="row-hover hover:bg-ink-800/40">
                        <td className="td text-center">{changed ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-400" title="изменено" /> : null}</td>
                        <td className="td text-slate-400"><span className="inline-flex items-center gap-2"><IStore width={14} height={14} className="text-slate-600" />{s.name}</span></td>
                        <td className="td"><EditableText value={edits.supplierRenames[s.name] ?? s.name} onCommit={(v) => renameSupplier(s.name, v)} /></td>
                        <td className="td">
                          {mergedTo
                            ? <span className="chip border-transparent bg-brand-500/10 text-[11px] text-brand-300" title={`Цены и отчёты теперь считаются как для «${mergedTo}»`}>→ объединено с «{mergedTo}»</span>
                            : manual
                            ? <span className="chip border-transparent bg-brand-500/10 text-[11px] text-brand-300">добавлена вручную</span>
                            : s.isNew
                            ? <span className="chip border-transparent bg-warn/10 text-[11px] text-warn">новая, нет в справочнике</span>
                            : null}
                        </td>
                        <td className="td text-right tabnum text-slate-400">{fmt(s.count)}</td>
                        <td className="td text-right tabnum text-slate-300">{money(s.sum)}</td>
                        <td className="td text-center">
                          {mergedTo ? (
                            <button onClick={() => unmergeSupplier(s.name)} className="btn mx-auto px-2 py-1 text-xs text-slate-500 hover:text-white" title="Отменить объединение">
                              <IReset width={13} height={13} />
                            </button>
                          ) : manual ? (
                            <button onClick={() => removeSupplier(s.name)} className="btn mx-auto px-2 py-1 text-xs text-slate-500 hover:text-bad" title="Удалить добавленную вручную компанию">
                              <ITrash width={13} height={13} />
                            </button>
                          ) : s.isNew ? (
                            <button onClick={() => setMergeFor({ name: s.name })} className="btn mx-auto border border-ink-600 bg-ink-800/70 px-2 py-1 text-xs text-brand-300 hover:border-brand-500/50 hover:text-brand-200" title="Это тот же поставщик, что и уже известный?">
                              <ILink width={12} height={12} /> Объединить
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })
                : tab === 'products'
                ? (shown as typeof productsBase).map((p) => {
                    const renamed = !!edits.productRenames[p.name]
                    const planOv = edits.planOverrides[p.name]
                    const excluded = edits.excludedProducts[p.name] === true
                    const changed = renamed || planOv != null || excluded
                    const planVal = planOv != null ? String(planOv) : p.basePlan != null ? String(p.basePlan) : ''
                    const st = productStatus(p.name)
                    const displayName = edits.productRenames[p.name] ?? p.name
                    const manual = edits.newProducts[p.name] === true
                    return (
                      <tr key={p.name} className="row-hover hover:bg-ink-800/40">
                        <td className="td text-center">{changed ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-400" title="изменено" /> : null}</td>
                        <td className="td text-slate-400">{p.name}</td>
                        <td className="td"><EditableText value={displayName} onCommit={(v) => renameProduct(p.name, v)} /></td>
                        <td className="td text-right"><EditablePlan value={planVal} placeholder="нет" onCommit={(v) => setPlan(p.name, v)} highlighted={planOv != null} /></td>
                        <td className="td">
                          {st === 'excluded'
                            ? <span className="chip border-transparent bg-ink-750 text-[11px] text-slate-400">разные товары</span>
                            : <span className={`text-xs ${MATCH_KIND_META[st ?? 'none'].color}`} title={MATCH_KIND_META[st ?? 'none'].hint}>{MATCH_KIND_META[st ?? 'none'].label}</span>}
                        </td>
                        <td className="td text-right tabnum text-slate-400">{fmt(p.restaurantCount)}</td>
                        <td className="td text-right tabnum text-slate-300">{moneyShort(p.sum)}</td>
                        <td className="td">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setMatchFor({ product0: p.name, product: displayName })}
                              className="btn border border-ink-600 bg-ink-800/70 px-2 py-1 text-xs text-brand-300 hover:border-brand-500/50 hover:text-brand-200"
                              title="Сопоставить с плановым товаром из матрицы вручную"
                            >
                              <ILink width={12} height={12} /> Сопоставить
                            </button>
                            {excluded ? (
                              <button
                                onClick={() => setExcluded(p.name, false)}
                                className="btn border border-ink-600 bg-ink-800/70 px-2 py-1 text-xs text-slate-300 hover:text-white"
                                title="Вернуть в сравнение"
                              ><IReset width={12} height={12} /></button>
                            ) : (
                              <button
                                onClick={() => setExcluded(p.name, true)}
                                className="btn border border-ink-600 bg-ink-800/70 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-white"
                                title="Отметить как разные товары под одним названием — исключить из сравнения"
                              >разные</button>
                            )}
                            {manual && (
                              <button onClick={() => removeProduct(p.name)} className="btn px-2 py-1 text-xs text-slate-500 hover:text-bad" title="Удалить добавленный вручную товар">
                                <ITrash width={12} height={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                : (shown as typeof venues).map((r) => {
                    const changed = !!edits.venueOverrides[r.name]
                    const manual = edits.newVenues[r.name] === true
                    return (
                      <tr key={r.name} className="row-hover hover:bg-ink-800/40">
                        <td className="td text-center">{changed ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-400" title="изменено" /> : null}</td>
                        <td className="td text-slate-100">
                          <span className="inline-flex items-center gap-2">
                            <IPin width={14} height={14} className="text-slate-600" />{r.name}
                            {manual && <span className="chip border-transparent bg-brand-500/10 text-[10px] text-brand-300">вручную</span>}
                          </span>
                        </td>
                        <td className="td"><EditableText value={r.city} onCommit={(v) => setVenue(r.name, { city: v })} className="max-w-[160px]" /></td>
                        <td className="td"><EditableText value={r.brand} onCommit={(v) => setVenue(r.name, { brand: v })} className="max-w-[180px]" /></td>
                        <td className="td"><EditableText value={r.entity} onCommit={(v) => setVenue(r.name, { entity: v })} className="max-w-[200px]" /></td>
                        <td className="td text-right tabnum text-slate-300">{moneyShort(venueSpend.get(r.name) ?? 0)}</td>
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

      {matchFor && (
        <MatchModal
          target={matchFor}
          products={productsBase}
          onClose={() => setMatchFor(null)}
          onPick={(plan) => { setPlan(matchFor.product0, plan); setMatchFor(null) }}
        />
      )}

      {mergeFor && (
        <SupplierMergeModal
          target={mergeFor}
          suppliers={suppliersBase.filter((s) => !s.isNew)}
          onClose={() => setMergeFor(null)}
          onPick={(canonicalName) => { mergeSupplier(mergeFor.name, canonicalName); setMergeFor(null) }}
        />
      )}
    </div>
  )
}
