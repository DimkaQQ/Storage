import { useMemo, useState } from 'react'
import { Row, ROW_COLORS, Status, STATUS_META, money, pct, fmt, summarize, isPrecisePack, norm } from '../lib/data'
import { useEdits } from '../lib/edits'
import { StatusBadge, InfoTip } from '../components/ui'
import HoverName from '../components/HoverName'
import { ISearch, ISort, IDownload, IArrowUp, IArrowDown, IEdit, IClose } from '../components/icons'

type SortKey = 'product' | 'restaurant' | 'supplier' | 'plan' | 'unit' | 'diffPct' | 'sum'

/**
 * По умолчанию строки идут "как iiko загрузил" — по накладной (см.
 * groupByRowFields в server/src/iiko.js, Document) — один товар+поставщик
 * у одного ресторана может быть несколькими строками, если за период было
 * несколько накладных. Эта функция — ручной переключатель "Группировка":
 * схлопывает такие строки в одну (сумма/кол-во складываются), план и статус
 * у них и так совпадают (сопоставление теперь не зависит от фасовки, см.
 * resolveRowPlan), поэтому берём их у первой строки группы. Строки "не
 * закупали" (unit === null, это не реальная покупка, а позиция из матрицы)
 * в сложение не участвуют и остаются отдельно как есть.
 */
function groupByProduct(rows: Row[]): Row[] {
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const key = `${norm(r.restaurant)}::${norm(r.supplier)}::${norm(r.product)}`
    const arr = groups.get(key)
    if (arr) arr.push(r)
    else groups.set(key, [r])
  }
  const out: Row[] = []
  for (const group of groups.values()) {
    const purchased = group.filter((g) => g.unit != null)
    const notPurchased = group.filter((g) => g.unit == null)
    if (purchased.length <= 1) { out.push(...group); continue }
    const qty = purchased.reduce((s, g) => s + g.qty, 0)
    const sum = purchased.reduce((s, g) => s + g.qty * (g.unit as number), 0)
    const unit = qty > 0 ? sum / qty : null
    const first = purchased[0]
    const packs = new Set(purchased.map((g) => g.pack).filter(Boolean))
    out.push({
      ...first,
      id: `grp-${first.id}`,
      rowKey: `grp::${norm(first.restaurant)}::${norm(first.supplier)}::${norm(first.product)}`,
      qty, unit,
      pack: packs.size === 1 ? first.pack : packs.size > 1 ? `${packs.size} фасовки` : '',
      diffPct: first.plan != null && unit != null ? (unit - first.plan) / first.plan : null,
      userComment: null, rowColor: null,
    })
    out.push(...notPurchased)
  }
  return out
}

const STATUS_FILTERS: { id: Status; label: string }[] = [
  { id: 'ok', label: 'По матрице' },
  { id: 'wrongSupplier', label: 'Заказ не по матрице' },
  { id: 'nomatrix', label: 'Нет в матрице' },
  { id: 'notPurchased', label: 'Не закупали' },
]

export default function PriceCheck({ rows }: { rows: Row[] }) {
  const { setRowComment, setRowColor } = useEdits()
  const [q, setQ] = useState('')
  const [active, setActive] = useState<Set<Status>>(new Set())
  // По умолчанию — сумма закупки по убыванию, как в их собственном "Отчёте
  // о закупках по складам" из iiko (крупнейшие позиции сверху), а не
  // алфавит по ресторану/товару.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'sum', dir: -1 })
  // По умолчанию выключено — строки идут раздельно, по одной на каждую
  // накладную, как iiko их прислал (подтверждено человеком явно). Включение
  // складывает повторы одного товара+поставщика в одну строку (см.
  // groupByProduct выше).
  const [grouped, setGrouped] = useState(false)
  const [limit, setLimit] = useState(60)
  // Открытый попап "заметка/цвет" — по rowKey строки, не по id (id меняется
  // между парсингами, а попап открыт как раз пока пользователь печатает).
  const [openNoteFor, setOpenNoteFor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let r = rows
    if (active.size) r = r.filter((x) => active.has(x.status))
    if (needle) {
      r = r.filter((x) =>
        x.product.toLowerCase().includes(needle) || x.supplier.toLowerCase().includes(needle) ||
        x.restaurant.toLowerCase().includes(needle) || x.pack.toLowerCase().includes(needle) ||
        // ...и по "их" названиям из матрицы — можно искать "Тамаки" даже
        // когда основное поле показывает общее iiko-название "Соус ореховый".
        (x.productLabel ?? '').toLowerCase().includes(needle) || (x.supplierLabel ?? '').toLowerCase().includes(needle),
      )
    }
    if (grouped) r = groupByProduct(r)
    const dir = sort.dir
    const key = sort.key
    // "Сумма" — не поле Row (там только цена за единицу, qty отдельно), как
    // в их отчёте считаем на лету: qty * факт.
    const sumOf = (x: Row) => x.qty * (x.unit ?? 0)
    return [...r].sort((a, b) => {
      if (key === 'sum') return (sumOf(a) - sumOf(b)) * dir
      let av: any = a[key], bv: any = b[key]
      if (av == null) av = key === 'plan' || key === 'diffPct' || key === 'unit' ? -Infinity : ''
      if (bv == null) bv = key === 'plan' || key === 'diffPct' || key === 'unit' ? -Infinity : ''
      if (typeof av === 'string') return av.localeCompare(bv) * dir
      return (av - bv) * dir
    })
  }, [rows, q, active, sort, grouped])

  const s = useMemo(() => summarize(filtered), [filtered])
  const shown = filtered.slice(0, limit)

  const toggle = (st: Status) => {
    const n = new Set(active)
    n.has(st) ? n.delete(st) : n.add(st)
    setActive(n)
    setLimit(60)
  }
  const setSortKey = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }))

  // xlsx — тяжёлая библиотека (основной вес чанка этой страницы), а нужна
  // только по клику на "Excel" — грузим её именно в этот момент, а не сразу
  // при заходе на Проверку цен, чтобы сама страница открывалась быстро.
  const exportExcel = async () => {
    const XLSX = await import('xlsx')
    const head = ['Ресторан', 'Поставщик', 'Товар', 'Фасовка', 'Количество', 'Сумма', 'План цена', 'Факт цена', 'Δ', 'Статус', 'Должны у', 'Заметка']
    const lines = filtered.map((r) => [
      r.restaurant, r.supplier, r.product, r.pack,
      r.qty, r.qty * (r.unit ?? 0),
      r.plan ?? '', r.unit ?? '', r.plan != null && r.unit != null ? r.unit - r.plan : '',
      STATUS_META[r.status].label, r.designatedSuppliers.join(', '), r.userComment ?? '',
    ])
    const ws = XLSX.utils.aoa_to_sheet([head, ...lines])
    ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 24 }, { wch: 28 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Проверка цен')
    XLSX.writeFile(wb, 'proverka-cen.xlsx')
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
          <div className="relative flex-1 min-w-[240px]">
            <ISearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width={16} height={16} />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setLimit(60) }}
              placeholder="Поиск: товар, поставщик, ресторан…"
              className="w-full rounded-lg border border-ink-600 bg-ink-900/60 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <button
            onClick={() => { setGrouped((g) => !g); setLimit(60) }}
            title="Складывать несколько накладных одного товара и поставщика в одну строку"
            className={`btn border transition-colors ${grouped ? 'border-brand-500 bg-brand-500/15 text-brand-300' : 'border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750'}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${grouped ? 'bg-brand-400' : 'bg-slate-600'}`} />
            Группировка
          </button>
          <button onClick={exportExcel} className="btn border border-ink-600 bg-ink-800/70 text-slate-300 hover:bg-ink-750">
            <IDownload width={16} height={16} /> Excel
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
                className={`chip transition-colors ${on ? `${m.color} border-current bg-ink-750` : 'border-ink-600 text-slate-400 hover:text-slate-200'}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                {f.label}
              </button>
            )
          })}
          {active.size > 0 && (
            <button onClick={() => setActive(new Set())} className="chip border-ink-600 text-slate-500 hover:text-slate-300">
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
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full max-w-[1060px] table-fixed">
            <thead className="sticky top-0 z-10 bg-ink-850">
              <tr>
                <Th onClick={() => setSortKey('restaurant')} sort={sort} k="restaurant" width="w-[11%]" tight>Ресторан</Th>
                <Th onClick={() => setSortKey('supplier')} sort={sort} k="supplier" width="w-[16%]" tight>Поставщик</Th>
                <Th onClick={() => setSortKey('product')} sort={sort} k="product" width="w-[19%]" tight>Товар</Th>
                <Th onClick={() => setSortKey('plan')} sort={sort} k="plan" right width="w-[9%]">План</Th>
                <Th onClick={() => setSortKey('unit')} sort={sort} k="unit" right width="w-[13%]">Факт</Th>
                <Th onClick={() => setSortKey('diffPct')} sort={sort} k="diffPct" right width="w-[10%]">Δ</Th>
                <th className="th w-[11%]">Статус</th>
                <th className="th w-[8%]">Заметка</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`row-hover hover:bg-ink-800/40 ${r.isTotalRow ? 'opacity-50 hover:opacity-100' : ''} ${r.rowColor ? ROW_COLORS.find((c) => c.id === r.rowColor)?.rowBg ?? '' : ''}`}>
                  <td className="td overflow-hidden px-2 text-slate-400"><HoverName text={r.restaurant} /></td>
                  <td className="td overflow-hidden px-2 font-medium text-slate-100">
                    {/* Крупным — название из матрицы (если есть), мелким под ним —
                        как называется в iiko. Тот же порядок, что и у товара ниже. */}
                    <HoverName text={r.supplierLabel ?? r.supplier} />
                    {r.supplierLabel && <HoverName text={r.supplier} className="block text-[11px] font-normal text-slate-500" />}
                  </td>
                  <td className="td overflow-hidden px-2 font-medium text-slate-100">
                    {r.unit == null ? (
                      // Позиция из матрицы, ещё не купленная в этом периоде — тут
                      // r.product уже и есть их название, отдельного iiko-имени
                      // нет вовсе (не покупали), под ним просто фасовка.
                      <>
                        <HoverName text={r.product} />
                        {(isPrecisePack(r.pack) || r.isAssortment) && r.pack && <HoverName text={r.pack} className="block text-[11px] font-normal text-slate-500" />}
                      </>
                    ) : r.productLabel || r.product !== r.productRaw ? (
                      // Крупным — название из матрицы, если товар с ней совпал,
                      // либо ручное переименование (Справочники → Товары), если
                      // совпадения нет, но название всё равно поправили руками —
                      // до этой правки тут ошибочно не показывалось вообще
                      // ничего, кроме самого переименования, без исходного
                      // iiko-имени под ним. Под названием мелким — как называется
                      // в iiko, и через тире фасовка (та же логика, что и в двух
                      // других ветках ниже: голая единица "кг"/"шт" ничего не
                      // уточняет, не показываем её отдельно; для ассортимента —
                      // всегда, там сама фасовка и есть разница между товарами).
                      <>
                        <HoverName text={r.productLabel ?? r.product} />
                        <HoverName
                          text={(isPrecisePack(r.pack) || r.isAssortment) && r.pack ? `${r.productRaw} - ${r.pack}` : r.productRaw}
                          className="block text-[11px] font-normal text-slate-500"
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
                        <HoverName text={r.product} />
                        {(isPrecisePack(r.pack) || r.isAssortment) && r.pack && <HoverName text={r.pack} className="block text-[11px] font-normal text-slate-500" />}
                      </>
                    )}
                  </td>
                  <td className="td text-right tabnum text-slate-400">{r.plan != null ? money(r.plan) : '—'}</td>
                  <td className="td text-right tabnum text-slate-200">{r.unit != null ? money(r.unit) : <span className="text-slate-600">—</span>}</td>
                  <td className="td text-right tabnum font-semibold text-slate-300">
                    {r.plan != null && r.unit != null ? (r.unit - r.plan >= 0 ? '+' : '') + money(r.unit - r.plan) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="td overflow-hidden">
                    <StatusBadge status={r.status} />
                    {r.status === 'wrongSupplier' && r.designatedSuppliers.length > 0 && (
                      <HoverName text={`должны: ${r.designatedSuppliers.join(', ')}`} className="mt-0.5 block text-[11px] text-slate-500" />
                    )}
                    {r.note && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                        <InfoTip text={r.note} align="left" />
                        <span>комментарий</span>
                      </div>
                    )}
                  </td>
                  <td className="td relative overflow-visible px-2 text-center">
                    <button
                      onClick={() => { setOpenNoteFor(openNoteFor === r.rowKey ? null : r.rowKey); setDraft(r.userComment ?? '') }}
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-ink-750 ${r.userComment || r.rowColor ? 'text-brand-300' : 'text-slate-500'}`}
                      title={r.userComment ?? 'Добавить заметку'}
                    >
                      {r.rowColor && <span className={`h-2 w-2 rounded-full ${ROW_COLORS.find((c) => c.id === r.rowColor)?.dot}`} />}
                      <IEdit width={13} height={13} />
                    </button>
                    {openNoteFor === r.rowKey && (
                      <div className="absolute right-2 top-full z-20 mt-1 w-64 rounded-xl border border-ink-600 bg-ink-800 p-3 text-left shadow-card">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-300">Заметка к строке</span>
                          <button onClick={() => setOpenNoteFor(null)} className="text-slate-500 hover:text-slate-300"><IClose width={14} height={14} /></button>
                        </div>
                        <textarea
                          autoFocus
                          rows={3}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder="Свой комментарий к этой закупке…"
                          className="w-full rounded-lg border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
                        />
                        <div className="mt-2 flex items-center gap-1.5">
                          {ROW_COLORS.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => setRowColor(r.rowKey, r.rowColor === c.id ? null : c.id)}
                              title={c.label}
                              className={`h-5 w-5 rounded-full ${c.dot} ${r.rowColor === c.id ? 'ring-2 ring-white/70' : 'opacity-70 hover:opacity-100'}`}
                            />
                          ))}
                          {r.rowColor && (
                            <button onClick={() => setRowColor(r.rowKey, null)} className="ml-1 text-[11px] text-slate-500 hover:text-slate-300">убрать</button>
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
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="py-12 text-center text-sm text-slate-500">Ничего не найдено по заданным фильтрам.</div>}
        </div>
        {filtered.length > shown.length && (
          <div className="border-t border-ink-700/50 p-3 text-center">
            <button onClick={() => setLimit((l) => l + 100)} className="btn text-brand-300 hover:text-brand-200">
              Показать ещё ({fmt(filtered.length - shown.length)})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value, tone, delay = 0 }: { label: string; value: string; tone: 'slate' | 'bad' | 'good'; delay?: number }) {
  const cls = tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-white'
  return (
    <div className="card card-hover animate-fade-up px-4 py-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabnum ${cls}`}>{value}</div>
    </div>
  )
}

function Th({ children, onClick, sort, k, right, width, tight }: { children: React.ReactNode; onClick: () => void; sort: { key: string; dir: number }; k: string; right?: boolean; width?: string; tight?: boolean }) {
  const on = sort.key === k
  return (
    <th className={`th hover:text-slate-300 ${right ? 'text-right' : ''} ${tight ? 'px-2' : ''} ${width ?? ''}`}>
      <span className={`inline-flex cursor-pointer items-center gap-1 ${right ? 'flex-row-reverse' : ''}`} onClick={onClick}>
        {children}
        {on ? (sort.dir === 1 ? <IArrowUp width={12} height={12} className="text-brand-300" /> : <IArrowDown width={12} height={12} className="text-brand-300" />) : <ISort width={12} height={12} className="text-slate-600" />}
      </span>
    </th>
  )
}
