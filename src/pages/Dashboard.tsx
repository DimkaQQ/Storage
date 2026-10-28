import { useMemo, useState } from 'react'
import { PieChart, Pie, ResponsiveContainer, Tooltip, Cell } from 'recharts'
import { Row, summarize, byRestaurant, fmt, money, signedMoney, pct, norm, STATUS_META, Status } from '../lib/data'
import StatCard from '../components/StatCard'
import { Section } from '../components/ui'
import { ChartTip, C, Legend } from '../components/charts'
import { IScale, ICheck, IStore, IChevron, IDownload } from '../components/icons'

interface WrongSupplierItem {
  supplier: string
  product: string
  pack: string
  qty: number
  unit: number      // факт за единицу (кг/шт/л — как в матрице) — то, что показываем построчно
  planUnit: number  // план за единицу, назначенный поставщик — то, что показываем построчно
  fact: number      // qty * unit — сумма по этой строке, как и в присланном образце таблицы
  plan: number      // qty * planUnit — сумма по этой строке
  delta: number     // План − Факт (та же развёрнутая нотация, что и в Проверке цен и в присланном образце) — отрицательное число = переплата, положительное = сэкономили
  designatedSuppliers: string[]
  star: number | null  // отличить одинаковый товар+поставщик, пришедший разной фасовкой (см. perRest ниже) — "Фасоль 400гр банка" и "Фасоль 250гр банка" у одного и того же поставщика выглядели бы как задвоенная строка без этого
}

export default function Dashboard({ rows, onNav }: { rows: Row[]; onNav: (p: string) => void }) {
  const s = useMemo(() => summarize(rows), [rows])
  const [expanded, setExpanded] = useState<string | null>(null)

  // П. 2.2 Приложения №1 — факт и план по каждому ресторану, только для
  // "заказ не по матрице" ("нет в матрице" сюда специально не идёт, там
  // сравнивать не с чем, попросили не смешивать с настоящей переплатой).
  // Строим сразу и агрегат (fact/plan/delta), и построчную разбивку —
  // при раскрытии ресторана нужно видеть не только общую сумму, но и по
  // какому именно товару набежала разница (п. 2.3 — доработка дашборда).
  const perRest = useMemo(
    () => byRestaurant(rows).map((r) => {
      const rawItems = r.rows
        .filter((x) => x.unit != null && !x.isTotalRow && x.status === 'wrongSupplier' && x.designatedPlan != null)
        .map((x) => {
          const unit = x.unit as number, planUnit = x.designatedPlan as number
          const fact = x.qty * unit, plan = x.qty * planUnit
          return {
            supplier: x.supplier, product: x.productLabel ?? x.product, pack: x.pack, qty: x.qty,
            unit, planUnit, fact, plan, delta: plan - fact,
            designatedSuppliers: x.designatedSuppliers, star: null as number | null,
          }
        })
      // Звёздочки — один и тот же товар у одного и того же поставщика может
      // встретиться несколько раз под разной фасовкой (например банка 400гр
      // и банка 250гр); без отметки это выглядело бы как случайно
      // задвоенная строка. Факт/план каждой строки не трогаем — только
      // подпись. Звезда — за РАЗЛИЧНУЮ фасовку, не за отдельную строку: если
      // этот же товар+поставщик+фасовку купили дважды отдельными закупками
      // за период, это одна и та же позиция — им обеим один и тот же номер
      // (назначаем по алфавиту фасовки — стабильно, не зависит от сортировки
      // по разнице ниже).
      const groupKey = (it: typeof rawItems[number]) => `${norm(it.product)}::${norm(it.supplier)}`
      const packsByGroup = new Map<string, Set<string>>()
      for (const it of rawItems) {
        const k = groupKey(it)
        if (!packsByGroup.has(k)) packsByGroup.set(k, new Set())
        packsByGroup.get(k)!.add(norm(it.pack))
      }
      const sortedItems = rawItems
        .map((it) => {
          const packs = [...(packsByGroup.get(groupKey(it)) ?? [])].sort((a, b) => a.localeCompare(b))
          if (packs.length < 2) return it
          return { ...it, star: packs.indexOf(norm(it.pack)) + 1 }
        })
        // По возрастанию (не убыванию) — после разворота знака (см.
        // WrongSupplierItem.delta) самая большая переплата это самое
        // ОТРИЦАТЕЛЬНОЕ число, а не самое большое; "худшее — сверху" теперь
        // значит сортировать по возрастанию.
        .sort((a, b) => a.delta - b.delta)
      // Звёздную группу (тот же товар+поставщик, разные фасовки — "Табаско
      // 60мл ★1"/"Табаско 150мл ★2") попросили держать РЯДОМ друг с другом,
      // а не вразнобой там, где их поставит сортировка по разнице — у
      // разных фасовок обычно разная переплата. Группа встаёт на место
      // своего первого (по сортировке выше) представителя, внутри — по
      // номеру звезды; строки без звезды не трогаем.
      const starGroups = new Map<string, WrongSupplierItem[]>()
      for (const it of sortedItems) {
        if (it.star == null) continue
        const k = groupKey(it)
        if (!starGroups.has(k)) starGroups.set(k, [])
        starGroups.get(k)!.push(it)
      }
      for (const list of starGroups.values()) list.sort((a, b) => a.star! - b.star!)
      const placedStarGroups = new Set<string>()
      const items: WrongSupplierItem[] = []
      for (const it of sortedItems) {
        if (it.star == null) { items.push(it); continue }
        const k = groupKey(it)
        if (placedStarGroups.has(k)) continue
        placedStarGroups.add(k)
        items.push(...starGroups.get(k)!)
      }
      const fact = items.reduce((sum, it) => sum + it.fact, 0)
      const plan = items.reduce((sum, it) => sum + it.plan, 0)
      return { name: r.name, fact, plan, delta: plan - fact, items }
    })
      .filter((r) => r.fact > 0)
      .sort((a, b) => a.delta - b.delta),
    [rows],
  )

  // Та же форма, что и в присланном образце (итоговая строка сверху, потом
  // Наименование/Кол-во/План-Факт за ед./Итого план/Итого факт/Разница) —
  // плюс Поставщик и "Должны у", их в образце не было, но без них разбивку
  // не с чем сверить вручную, когда позиций много.
  const exportRestaurant = async (r: { name: string; fact: number; plan: number; delta: number; items: WrongSupplierItem[] }) => {
    const XLSX = await import('xlsx')
    const title = [`Заказ не по матрице — ${r.name}`]
    const totalsRow = ['Итого закупили не по матрице', 'Итого если бы по матрице', 'Разница']
    const totalsVals = [r.fact, r.plan, r.delta]
    const head = ['Наименование/сырьё', 'Поставщик', 'Фасовка', 'Кол-во', 'План (за ед.)', 'Факт (за ед.)', 'Итого план', 'Итого факт', 'Разница', 'Должны у']
    const lines = r.items.map((it) => [
      it.star != null ? `${it.product} ★${it.star}` : it.product, it.supplier, it.pack, it.qty,
      it.planUnit, it.unit, it.plan, it.fact, it.delta, it.designatedSuppliers.join(', '),
    ])
    const ws = XLSX.utils.aoa_to_sheet([title, [], totalsRow, totalsVals, [], head, ...lines])
    ws['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 24 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Не по матрице')
    const safe = (x: string) => x.replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '')
    const todayStr = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `ne-po-matrice-${safe(r.name)}-${todayStr}.xlsx`)
  }
  const totals = useMemo(
    () => perRest.reduce((acc, r) => ({ fact: acc.fact + r.fact, plan: acc.plan + r.plan, delta: acc.delta + r.delta }), { fact: 0, plan: 0, delta: 0 }),
    [perRest],
  )

  const statusData = useMemo(() => {
    const order: Status[] = ['ok', 'wrongSupplier', 'nomatrix']
    const counts = new Map<Status, number>()
    // Позиции без факта (в матрице есть, но не покупали) сюда не входят —
    // диаграмма про то, что реально закупили, и должна совпадать с s.positions.
    for (const r of rows) if (r.unit != null) counts.set(r.status, (counts.get(r.status) || 0) + 1)
    // notPurchased никогда реально не попадёт в counts (r.unit != null выше
    // это гарантирует) — запись здесь только чтобы Record<Status, string>
    // был полным для тайпчекера, order ниже её не использует.
    const colors: Record<Status, string> = { ok: C.good, wrongSupplier: C.warn, nomatrix: C.purple, notPurchased: C.good }
    return order.map((st) => ({ st, name: STATUS_META[st].label, value: counts.get(st) || 0, color: colors[st] }))
      .filter((d) => d.value > 0)
  }, [rows])

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard delay={0} label="Позиций проверено" info="Все закупленные позиции за период по текущему срезу (точки выбираются здесь же, независимо от вкладки «Проверка цен»)." value={fmt(s.positions)} accent="brand" icon={<IStore width={16} height={16} />} />
        <StatCard delay={60} label="По матрице" info="Доля позиций, для которых нашлась плановая цена у назначенного поставщика." value={pct(s.matchRate).replace('+', '')} sub={`${fmt(s.matched)} из ${fmt(s.positions)}`} accent="good" icon={<ICheck width={16} height={16} />} />
        <StatCard delay={120} label="Заказ не по матрице" info="Товар есть в матрице для этой точки, но куплен не у назначенного поставщика." value={fmt(s.wrongSupplierCount)} accent="warn" icon={<IScale width={16} height={16} />} />
        <StatCard delay={180} label="Нет в матрице" infoAlign="right" info="Товара нет в плановой матрице ни у одного поставщика для этой точки." value={fmt(s.noMatrixCount)} accent="warn" icon={<IScale width={16} height={16} />} />
      </div>

      {/* Разбор "Заказ не по матрице" — на всю ширину (попросили не теснить
          его круговой диаграммой рядом — её передвинули ниже, в отдельную
          узкую карточку, см. "Структура позиций"). Раскрытие ресторана
          показывает ту же структуру, что и в присланном образце таблицы:
          три итоговые ячейки сверху, затем построчно — количество, план/
          факт цена за кг и план/факт/разница УЖЕ В ТЕНГЕ (не только за
          единицу, как было раньше). */}
      <Section
        delay={240}
        title="Закупили позиции не по матрице"
        subtitle="Закупки у поставщика, которого не назначила матрица — сколько вышло и сколько должно было выйти"
      >
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-ink-900/50 px-3 py-2.5">
            <div className="text-[11px] text-fg-500">Итого в тенге всего закупили не по матрице</div>
            <div className="text-lg font-semibold text-fg-100 tabnum">{money(totals.fact)}</div>
          </div>
          <div className="rounded-lg bg-ink-900/50 px-3 py-2.5">
            <div className="text-[11px] text-fg-500">Итого в тенге всего если бы закупили по матрице</div>
            <div className="text-lg font-semibold text-fg-100 tabnum">{money(totals.plan)}</div>
          </div>
          <div className="rounded-lg bg-warn/10 px-3 py-2.5">
            <div className="text-[11px] text-fg-500">Разница в тенге</div>
            {/* Положительная дельта = сэкономили (план − факт), отрицательная = переплата */}
            <div className={`text-lg font-semibold tabnum ${totals.delta > 0 ? 'text-good' : 'text-warn'}`}>{signedMoney(totals.delta)}</div>
          </div>
        </div>

        {perRest.length === 0 ? (
          <div className="py-10 text-center text-sm text-fg-500">Переплат не найдено 🎉</div>
        ) : (
          <div className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
            {perRest.map((r) => {
              const isOpen = expanded === r.name
              return (
                <div key={r.name} className="rounded-lg border border-ink-700/60">
                  <button
                    onClick={() => setExpanded((e) => (e === r.name ? null : r.name))}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-ink-800/40"
                  >
                    <span className="flex items-center gap-2 text-sm text-fg-200">
                      <IChevron width={12} height={12} className={`text-fg-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      {r.name}
                    </span>
                    <span className={`text-sm font-semibold tabnum ${r.delta > 0 ? 'text-good' : 'text-warn'}`}>{signedMoney(r.delta)}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-ink-700/60 px-3 py-2.5">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex gap-4 text-xs">
                          <div><div className="text-fg-500">Итого закупили не по матрице</div><div className="font-medium text-fg-200 tabnum">{money(r.fact)}</div></div>
                          <div><div className="text-fg-500">Итого если бы по матрице</div><div className="font-medium text-fg-200 tabnum">{money(r.plan)}</div></div>
                          <div><div className="text-fg-500">Разница</div><div className={`font-medium tabnum ${r.delta > 0 ? 'text-good' : 'text-warn'}`}>{signedMoney(r.delta)}</div></div>
                        </div>
                        <button
                          onClick={() => exportRestaurant(r)}
                          title="Скачать разбивку по товарам этого ресторана в Excel"
                          className="btn !px-2.5 !py-1.5 border border-ink-600 bg-ink-800/70 text-fg-300 hover:bg-ink-750"
                        >
                          <IDownload width={14} height={14} /> Excel
                        </button>
                      </div>
                      <div className="max-h-96 overflow-y-auto rounded-lg border border-ink-700/40">
                        <table className="w-full table-fixed text-xs">
                          <thead className="sticky top-0 bg-ink-900/90">
                            <tr>
                              <th className="w-[20%] px-2 py-1.5 text-left font-medium text-fg-500">Наименование/сырьё</th>
                              <th className="w-[12%] px-2 py-1.5 text-center font-medium leading-tight text-fg-500">закуплено за 1 месяц, количество в кг/шт</th>
                              <th className="w-[12%] px-2 py-1.5 text-center font-medium leading-tight text-fg-500">цена за 1кг из матрицы</th>
                              <th className="w-[12%] px-2 py-1.5 text-center font-medium leading-tight text-fg-500">цена за 1кг из iiko</th>
                              <th className="w-[15%] px-2 py-1.5 text-center font-medium leading-tight text-fg-500">Итого в тенге должно быть по цене указанной в матрице</th>
                              <th className="w-[15%] px-2 py-1.5 text-center font-medium leading-tight text-fg-500">Итого в тенге по факту закупленно из отчета iiko</th>
                              <th className="w-[14%] px-2 py-1.5 text-center font-medium leading-tight text-fg-500">Разница в тенге</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.items.map((it, i) => (
                              <tr key={i} className="border-t border-ink-700/40">
                                <td className="max-w-0 px-2 py-1.5 text-fg-200">
                                  <div className="truncate">
                                    {it.product}
                                    {it.star != null && (
                                      <span className="ml-1 font-semibold text-brand-300" title={`Та же позиция у этого поставщика, но другая фасовка: ${it.pack || '—'}`}>★{it.star}</span>
                                    )}
                                  </div>
                                  <div className="truncate text-[10px] font-normal text-fg-500">{it.supplier}</div>
                                </td>
                                <td className="truncate px-2 py-1.5 text-center tabnum text-fg-400" title={fmt(it.qty)}>{fmt(it.qty)}</td>
                                <td className="truncate px-2 py-1.5 text-center tabnum text-fg-400" title={money(it.planUnit)}>{money(it.planUnit)}</td>
                                <td className="truncate px-2 py-1.5 text-center tabnum text-fg-200" title={money(it.unit)}>{money(it.unit)}</td>
                                <td className="truncate px-2 py-1.5 text-center tabnum text-fg-400" title={money(it.plan)}>{money(it.plan)}</td>
                                <td className="truncate px-2 py-1.5 text-center tabnum text-fg-200" title={money(it.fact)}>{money(it.fact)}</td>
                                <td className={`truncate px-2 py-1.5 text-center tabnum font-semibold ${it.delta > 0 ? 'text-good' : 'text-warn'}`} title={signedMoney(it.delta)}>
                                  {signedMoney(it.delta)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* Структура позиций — узкой карточкой отдельно, чтобы не теснить
          таблицу выше (прямой запрос — убрать её с дороги). */}
      <Section delay={300} title="Структура позиций" subtitle="Статус проверки цены" className="max-w-xs">
        <div className="relative h-52">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={54} outerRadius={80} paddingAngle={2} stroke="none">
                {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip content={<ChartTip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-fg-50 tabnum">{fmt(s.positions)}</span>
            <span className="text-[11px] text-fg-500">позиций</span>
          </div>
        </div>
        <div className="mt-2">
          <Legend items={statusData.map((d) => ({ label: d.name, color: d.color, value: fmt(d.value) }))} />
        </div>
      </Section>

      <div className="text-center">
        <button onClick={() => onNav('pricecheck')} className="btn text-brand-300 hover:text-brand-200">Все позиции →</button>
      </div>
    </div>
  )
}
