import { useMemo, useRef, useState } from 'react'
import { money, moneyShort, fmt, plural, byRestaurant } from '../lib/data'
import { useEdits } from '../lib/edits'
import { Section, InfoTip } from '../components/ui'
import { EditableText, EditablePlan } from '../components/EditableCell'
import { ISearch, IDownload, IUpload, IReset, IStore, IDatabase, ICheck, IPin } from '../components/icons'

type Tab = 'suppliers' | 'products' | 'venues'

export default function DataEditor() {
  const {
    edits, editCount, renameSupplier, renameProduct, setPlan, setVenue, reset, replaceAll,
    suppliers: suppliersBase, products: productsBase, restaurants, rows,
  } = useEdits()
  const [tab, setTab] = useState<Tab>('products')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(60)
  const fileRef = useRef<HTMLInputElement>(null)

  const needle = q.trim().toLowerCase()

  const suppliers = useMemo(() => {
    const list = needle
      ? suppliersBase.filter((s) => s.name.toLowerCase().includes(needle) || (edits.supplierRenames[s.name] ?? '').toLowerCase().includes(needle))
      : suppliersBase
    return list
  }, [needle, edits.supplierRenames])

  const products = useMemo(() => {
    const list = needle
      ? productsBase.filter((p) => p.name.toLowerCase().includes(needle) || (edits.productRenames[p.name] ?? '').toLowerCase().includes(needle))
      : productsBase
    return list
  }, [needle, edits.productRenames])

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
        </div>

        {tab === 'venues' && (
          <p className="mb-3 text-xs text-slate-500">
            Если город, бренд или юрлицо определились неверно — поправьте здесь. Изменение сразу применится
            ко всем отчётам и графикам по этой точке.
          </p>
        )}

        <div className="rounded-xl border border-ink-700/50">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-ink-850">
              {tab === 'suppliers' ? (
                <tr>
                  <th className="th w-8"></th>
                  <th className="th">Исходное название (iiko)</th>
                  <th className="th">Отображаемое имя</th>
                  <th className="th text-right">Позиций</th>
                  <th className="th text-right">Закупка</th>
                </tr>
              ) : tab === 'products' ? (
                <tr>
                  <th className="th w-8"></th>
                  <th className="th">Исходное название (iiko)</th>
                  <th className="th">Отображаемое имя</th>
                  <th className="th text-right">Плановая цена, ₸ <InfoTip text="Целевая цена за единицу. Задайте её, чтобы сравнивать факт с планом — в том числе для позиций «нет в матрице»." /></th>
                  <th className="th text-center">Матрица</th>
                  <th className="th text-right">Закупка</th>
                </tr>
              ) : (
                <tr>
                  <th className="th w-8"></th>
                  <th className="th">Точка</th>
                  <th className="th">Город</th>
                  <th className="th">Бренд</th>
                  <th className="th">Юрлицо</th>
                  <th className="th text-right">Закупка</th>
                </tr>
              )}
            </thead>
            <tbody>
              {tab === 'suppliers'
                ? (shown as typeof suppliersBase).map((s) => {
                    const changed = !!edits.supplierRenames[s.name]
                    return (
                      <tr key={s.name} className="row-hover hover:bg-ink-800/40">
                        <td className="td text-center">{changed ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-400" title="изменено" /> : null}</td>
                        <td className="td text-slate-400"><span className="inline-flex items-center gap-2"><IStore width={14} height={14} className="text-slate-600" />{s.name}</span></td>
                        <td className="td"><EditableText value={edits.supplierRenames[s.name] ?? s.name} onCommit={(v) => renameSupplier(s.name, v)} /></td>
                        <td className="td text-right tabnum text-slate-400">{fmt(s.count)}</td>
                        <td className="td text-right tabnum text-slate-300">{money(s.sum)}</td>
                      </tr>
                    )
                  })
                : tab === 'products'
                ? (shown as typeof productsBase).map((p) => {
                    const renamed = !!edits.productRenames[p.name]
                    const planOv = edits.planOverrides[p.name]
                    const changed = renamed || planOv != null
                    const planVal = planOv != null ? String(planOv) : p.basePlan != null ? String(p.basePlan) : ''
                    const hasPlan = planOv != null || p.inMatrix
                    return (
                      <tr key={p.name} className="row-hover hover:bg-ink-800/40">
                        <td className="td text-center">{changed ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-400" title="изменено" /> : null}</td>
                        <td className="td text-slate-400">{p.name}</td>
                        <td className="td"><EditableText value={edits.productRenames[p.name] ?? p.name} onCommit={(v) => renameProduct(p.name, v)} /></td>
                        <td className="td text-right"><EditablePlan value={planVal} placeholder="нет" onCommit={(v) => setPlan(p.name, v)} highlighted={planOv != null} /></td>
                        <td className="td text-center">
                          {hasPlan
                            ? <span className="inline-flex items-center gap-1 text-good"><ICheck width={14} height={14} /></span>
                            : <span className="text-warn" title="нет плановой цены">—</span>}
                        </td>
                        <td className="td text-right tabnum text-slate-300">{moneyShort(p.sum)}</td>
                      </tr>
                    )
                  })
                : (shown as typeof venues).map((r) => {
                    const changed = !!edits.venueOverrides[r.name]
                    return (
                      <tr key={r.name} className="row-hover hover:bg-ink-800/40">
                        <td className="td text-center">{changed ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-400" title="изменено" /> : null}</td>
                        <td className="td text-slate-100"><span className="inline-flex items-center gap-2"><IPin width={14} height={14} className="text-slate-600" />{r.name}</span></td>
                        <td className="td"><EditableText value={r.city} onCommit={(v) => setVenue(r.name, { city: v })} className="max-w-[160px]" /></td>
                        <td className="td"><EditableText value={r.brand} onCommit={(v) => setVenue(r.name, { brand: v })} className="max-w-[180px]" /></td>
                        <td className="td"><EditableText value={r.entity} onCommit={(v) => setVenue(r.name, { entity: v })} className="max-w-[200px]" /></td>
                        <td className="td text-right tabnum text-slate-300">{moneyShort(venueSpend.get(r.name) ?? 0)}</td>
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
