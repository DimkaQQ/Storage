import { useEffect, useState } from 'react'
import { useEdits } from '../lib/edits'
import { fetchSettings, saveSettings, testConnection, fetchOlapColumns, fetchOlapSample, fetchOlapTypes, fetchInvoiceSample, fetchProductSample, fetchStoresSample, fetchAssortmentDebug, AssortmentDebugItem, fetchDatasetDebug, DatasetDebugItem, fetchProductCategorySample, ProductCategoryItem, fetchExcludedCategoryList, testMatrixConnection, syncMatrix, fetchOrgDataExport, resetOrgData, IikoSettings as Settings } from '../lib/api'
import { Section, InfoTip, Checkbox } from '../components/ui'
import { ISync, IPlug, ICheck, IClose, IStore, IPlus, IInfo, IChevron, ITrash } from '../components/icons'

/** Принимает и полную ссылку на таблицу, и просто ID — вытаскивает ID из ссылки вида .../d/<ID>/edit. */
function extractSheetId(input: string): string {
  const m = input.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : input.trim()
}

const PROVIDERS: { id: Settings['provider']; label: string; note: string }[] = [
  { id: 'iikoserver', label: 'iikoOffice / RMS', note: 'Сервер iiko (resto API) — отсюда «Отчёт о закупках по складам»' },
]
const INTERVALS: { id: Settings['interval']; label: string }[] = [
  { id: 'hourly', label: 'Каждый час' },
  { id: 'daily', label: 'Раз в день' },
  { id: 'weekly', label: 'Раз в неделю' },
  { id: 'monthly', label: 'Раз в месяц' },
]
// Свои select'ы вместо <input type="month"> — у него нативный календарь
// всегда на языке браузера/ОС (не странице), игнорирует lang на инпуте, и
// на тёмном фоне иконка календаря практически не видна — проще и надёжнее
// не зависеть от нативного виджета совсем.
const RU_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

function ago(iso: string | null): string {
  if (!iso) return 'ещё не обновлялось'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'только что'
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`
  return `${Math.floor(s / 86400)} дн назад`
}

export default function IikoSettings() {
  const { backendOnline, status, syncing, refresh, syncHistoricalPeriod, reloadStatus, venues, enableVenueByName, disableVenueByName, refreshMatrix, rawBase, period } = useEdits()
  const [form, setForm] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [addingVenue, setAddingVenue] = useState<string | null>(null)
  const [removingVenue, setRemovingVenue] = useState<string | null>(null)
  const nowDate = new Date()
  const [historicalYear, setHistoricalYear] = useState(nowDate.getFullYear())
  const [historicalMonthNum, setHistoricalMonthNum] = useState<number | null>(null) // 1-12
  const [historicalResult, setHistoricalResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const historicalMonth = historicalMonthNum ? `${historicalYear}-${String(historicalMonthNum).padStart(2, '0')}` : ''
  const maxHistoricalMonth = historicalYear === nowDate.getFullYear() ? nowDate.getMonth() + 1 : 12
  const [matrixTesting, setMatrixTesting] = useState(false)
  const [matrixTestResult, setMatrixTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [matrixSyncing, setMatrixSyncing] = useState(false)
  const [matrixSyncResult, setMatrixSyncResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const [rawExporting, setRawExporting] = useState(false)
  const [resetArmed, setResetArmed] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetResult, setResetResult] = useState<{ ok: boolean; message?: string } | null>(null)
  // Астана — отдельная таблица, свои test/sync, тот же сервисный аккаунт выше.
  const [astanaTesting, setAstanaTesting] = useState(false)
  const [astanaTestResult, setAstanaTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [astanaSyncing, setAstanaSyncing] = useState(false)
  const [astanaSyncResult, setAstanaSyncResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const [columnsLoading, setColumnsLoading] = useState(false)
  const [columnsResult, setColumnsResult] = useState<{ ok: boolean; columns?: unknown; message?: string } | null>(null)
  const [sampleLoading, setSampleLoading] = useState(false)
  const [sampleResult, setSampleResult] = useState<{ ok: boolean; rows?: unknown[]; message?: string } | null>(null)
  const [sampleSearch, setSampleSearch] = useState('ягода')
  const [samplePeriod, setSamplePeriod] = useState('')
  const [sampleAllTypes, setSampleAllTypes] = useState(false)
  const [sampleTypes, setSampleTypes] = useState('')
  const [typesLoading, setTypesLoading] = useState(false)
  const [typesResult, setTypesResult] = useState<{ ok: boolean; rows?: unknown[]; message?: string } | null>(null)
  const [productLoading, setProductLoading] = useState(false)
  const [productResult, setProductResult] = useState<{ ok: boolean; xml?: string; message?: string; errorName?: string; errorStack?: string[] } | null>(null)
  const [storesLoading, setStoresLoading] = useState(false)
  const [storesResult, setStoresResult] = useState<{ ok: boolean; xml?: string; message?: string } | null>(null)
  const [assortmentLoading, setAssortmentLoading] = useState(false)
  const [assortmentResult, setAssortmentResult] = useState<{ ok: boolean; matchedProducts?: string[]; items?: AssortmentDebugItem[]; message?: string } | null>(null)
  const [datasetLoading, setDatasetLoading] = useState(false)
  const [datasetResult, setDatasetResult] = useState<{ ok: boolean; items?: DatasetDebugItem[]; message?: string } | null>(null)
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [invoiceResult, setInvoiceResult] = useState<{ ok: boolean; xml?: string; message?: string } | null>(null)
  const [categoryLoading, setCategoryLoading] = useState(false)
  const [categoryResult, setCategoryResult] = useState<{ ok: boolean; items?: ProductCategoryItem[]; message?: string } | null>(null)
  const [categoryListExporting, setCategoryListExporting] = useState(false)
  const [categoryListError, setCategoryListError] = useState<string | null>(null)

  useEffect(() => { fetchSettings().then((s) => s && setForm(s)) }, [])

  // Любое поле формы может относиться к подключению iiko ИЛИ к матрице
  // (Алматы/Астана) — чистим все "зелёные" результаты сразу, а не только
  // testResult: иначе, например, отредактировав googleSheetId после
  // успешной проверки матрицы, старый зелёный чип "Доступ есть" остаётся
  // висеть рядом с новым, непроверенным значением.
  const set = (patch: Partial<Settings>) => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    setSaved(false)
    setTestResult(null)
    setMatrixTestResult(null)
    setAstanaTestResult(null)
    setMatrixSyncResult(null)
    setAstanaSyncResult(null)
  }

  const save = async () => {
    if (!form) return
    const r = await saveSettings(form)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
  }
  const test = async () => {
    if (!form) return
    setTesting(true); setTestResult(null)
    // Сохраняем перед проверкой, а не только после — иначе легко ввести
    // адрес/логин, нажать «Проверить», увидеть «подключение есть» и уйти
    // со страницы, решив, что всё готово: тест ничего не сохранял, и
    // введённое пропадало. Теперь «Проверить» = «Сохранить и проверить»,
    // отдельно сохранять не нужно.
    const r = await saveSettings(form)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
    setTestResult(await testConnection(form))
    setTesting(false)
  }

  // «Показать доступные поля отчёта» — вместо того чтобы гадать по одному
  // полю за раз через "Unknown OLAP field" в переписке, сразу спрашивает
  // у iikoServer, что у него реально есть для отчёта о закупках.
  const showColumns = async () => {
    setColumnsLoading(true); setColumnsResult(null)
    setColumnsResult(await fetchOlapColumns('TRANSACTIONS'))
    setColumnsLoading(false)
  }

  // «Проверить сырые поля» — Comment не оказался тем полем, где лежит
  // вкус/фасовка у товаров-ассортиментов (живой тест не совпал). Вместо
  // того чтобы перебирать кандидатов по одному через деплой, тащим сразу
  // несколько вероятных OLAP-полей для строк отчёта, похожих на `search`,
  // и показываем сырой JSON — нужное поле видно глазами.
  const showSample = async () => {
    setSampleLoading(true); setSampleResult(null)
    setSampleResult(await fetchOlapSample(sampleSearch, samplePeriod, sampleAllTypes, sampleTypes))
    setSampleLoading(false)
  }

  // «Показать типы операций» — дешёвая разведка перед «все типы операций»
  // (тот режим гоняет всю сеть по Store×Product×Counteragent и на реальных
  // объёмах не успевает за таймаут прокси/CDN): агрегат только по одному
  // полю TransactionType, должен отвечать быстро — из результата видно,
  // какие типы вообще есть и сколько там "веса", чтобы затем прицельно
  // проверить конкретный тип через поле "типы" выше (узко и быстро).
  const showTypes = async () => {
    setTypesLoading(true); setTypesResult(null)
    setTypesResult(await fetchOlapTypes(samplePeriod))
    setTypesLoading(false)
  }

  // «Проверить накладную (XML)» — OLAP не отдал фасовку ни по одному полю
  // (кнопка выше); фасовка выбирается при вводе самой накладной, так что
  // тащим её напрямую (не через OLAP) и показываем кусок сырого XML вокруг
  // искомого товара.
  const showInvoice = async () => {
    setInvoiceLoading(true); setInvoiceResult(null)
    setInvoiceResult(await fetchInvoiceSample(sampleSearch, samplePeriod))
    setInvoiceLoading(false)
  }

  // «Проверить товар (артикул)» — строка накладной несёт <amountUnit>/
  // <containerId> голыми GUID; карточка товара по артикулу (см. поле
  // поиска — впишите туда артикул, напр. "3122") должна содержать список
  // сконфигурированных фасовок/тар с именами.
  const showProduct = async () => {
    setProductLoading(true); setProductResult(null)
    setProductResult(await fetchProductSample(sampleSearch))
    setProductLoading(false)
  }

  // «Проверить склад (GUID)» — расхождение в сумме (Анчоусы/Олово 1 в разы
  // больше, чем в их отчёте) наводит на мысль, что extractIdNameMap путает
  // склады: corporateItemDto — иерархия подразделений, а не плоский список,
  // как у поставщиков, и простой скан "id + следующий name" может отдать
  // одно и то же имя разным GUID.
  const showStores = async () => {
    setStoresLoading(true); setStoresResult(null)
    setStoresResult(await fetchStoresSample(sampleSearch))
    setStoresLoading(false)
  }

  // «Проверить категорию товара» — прямой ответ номенклатуры iiko: в какой
  // категории заведён товар. Диагностика EXCLUDED_CATEGORIES (см.
  // CLAUDE.md) — подозрение, что "Батат фри"/"Картофель фри..." заведены в
  // категории "Овощи/Зелень/Фрукты/Ягоды" и поэтому их закупки целиком не
  // доходят до Проверки цен, хотя матрица их прайсует. Не трогает сам синк
  // и ничего не пересчитывает — только читает номенклатуру.
  const showCategory = async () => {
    setCategoryLoading(true); setCategoryResult(null)
    setCategoryResult(await fetchProductCategorySample(sampleSearch))
    setCategoryLoading(false)
  }

  // «Проверить разброс по ресторанам» — та же логика, что настоящий синк
  // товаров-ассортиментов, но без схлопывания — видно разом, какие
  // рестораны/склады реально вносят вклад в итоговую сумму.
  const showAssortmentDebug = async () => {
    setAssortmentLoading(true); setAssortmentResult(null)
    setAssortmentResult(await fetchAssortmentDebug(sampleSearch, samplePeriod))
    setAssortmentLoading(false)
  }

  // «Проверить сохранённый датасет» — живая диагностика может считать
  // правильно, а то, что реально СОХРАНЕНО после синка — другое; смотрим
  // прямо в сохранённые данные, без пересчёта.
  const showDatasetDebug = async () => {
    setDatasetLoading(true); setDatasetResult(null)
    setDatasetResult(await fetchDatasetDebug(sampleSearch, samplePeriod))
    setDatasetLoading(false)
  }

  const testMatrix = async () => {
    if (!form) return
    setMatrixTesting(true); setMatrixTestResult(null)
    const r = await saveSettings(form)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
    setMatrixTestResult(await testMatrixConnection(form))
    setMatrixTesting(false)
  }
  const doSyncMatrix = async () => {
    if (!form) return
    setMatrixSyncing(true); setMatrixSyncResult(null)
    // Сохраняем перед синком, как и testMatrix — иначе синк ушёл бы со
    // старым googleSheetId/ключом, сохранённым раньше, а не с тем, что
    // только что вписали в поле: синк "успевает", но тянет не ту таблицу,
    // без единой ошибки об этом.
    const r0 = await saveSettings(form)
    if (r0) { setForm(r0); setSaved(true); reloadStatus() }
    const r = await syncMatrix()
    setMatrixSyncResult(r)
    if (r.ok) await refreshMatrix()
    setMatrixSyncing(false)
  }

  const testAstana = async () => {
    if (!form) return
    setAstanaTesting(true); setAstanaTestResult(null)
    const r = await saveSettings(form)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
    setAstanaTestResult(await testMatrixConnection(form, 'astana'))
    setAstanaTesting(false)
  }
  const doSyncAstana = async () => {
    if (!form) return
    setAstanaSyncing(true); setAstanaSyncResult(null)
    // См. doSyncMatrix — та же причина, тот же фикс, для таблицы Астаны.
    const r0 = await saveSettings(form)
    if (r0) { setForm(r0); setSaved(true); reloadStatus() }
    const r = await syncMatrix('astana')
    setAstanaSyncResult(r)
    if (r.ok) await refreshMatrix()
    setAstanaSyncing(false)
  }

  // "Сырой" отчёт — закупки ТЕКУЩЕГО периода ровно как их прислал iiko
  // (rawBase из useEdits — до computeRows, без переименований/привязок из
  // Справочники и без матчинга с матрицей вообще). Нужен, когда кому-то
  // (в т.ч. при отладке) нужны именно необработанные данные, а не то, что
  // уже показывает Проверка цен.
  const exportRawDataset = async () => {
    setRawExporting(true)
    try {
      const XLSX = await import('xlsx')
      const head = ['Ресторан', 'Бренд', 'Город', 'Юрлицо', 'Категория', 'Поставщик (iiko)', 'Товар (iiko)', 'Фасовка', 'Количество', 'Сумма', 'Цена за ед.', 'Комментарий iiko']
      const lines = rawBase.map((b) => [
        b.restaurant, b.brand, b.city, b.entity, b.category, b.supplier0, b.product0, b.pack, b.qty, b.sum, b.unit, b.comment ?? '',
      ])
      const ws = XLSX.utils.aoa_to_sheet([[`Сырой отчёт о закупках — ${period}`], head, ...lines])
      ws['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 30 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 30 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Сырой отчёт')
      const safe = (s: string) => s.replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '')
      const todayStr = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `syroy-otchet-${safe(period)}-${todayStr}.xlsx`)
    } finally {
      setRawExporting(false)
    }
  }

  // «Список исключённых категорий» — живой случай ("Батат фри" тоже был
  // заведён в категории свежих овощей/фруктов, хотя это фасованный
  // замороженный товар с договорной ценой, см. CATEGORY_EXCLUSION_OVERRIDES
  // в iiko.js) показал, что искать по одному названию за раз недостаточно —
  // нужно разобрать ВЕСЬ список товаров в этих категориях и руками решить,
  // что из него реально нужно сверять с матрицей, а что нет.
  const exportExcludedCategoryList = async () => {
    setCategoryListExporting(true); setCategoryListError(null)
    try {
      const r = await fetchExcludedCategoryList()
      if (!r.ok || !r.items) { setCategoryListError(r.message ?? 'Не удалось получить список'); return }
      const XLSX = await import('xlsx')
      const head = ['Товар', 'Категория в iiko', 'Уже сделано исключение?']
      const lines = r.items.map((it) => [it.name, it.category, it.overridden ? 'да' : ''])
      const ws = XLSX.utils.aoa_to_sheet([['Товары в исключённых из Проверки цен категориях'], head, ...lines])
      ws['!cols'] = [{ wch: 40 }, { wch: 28 }, { wch: 22 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Исключённые категории')
      const todayStr = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `isklyuchennye-kategorii-${todayStr}.xlsx`)
    } finally {
      setCategoryListExporting(false)
    }
  }

  // Бэкап/сброс — скачивание как файл, без серверного хранения: обычный
  // Blob + временная <a download> ссылка, тот же приём, что у любого
  // "экспортировать как файл" в браузере.
  const downloadBackup = async () => {
    setExporting(true); setExportResult(null)
    const r = await fetchOrgDataExport()
    setExporting(false)
    if (!r.ok) { setExportResult(r); return }
    const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `proverka-tsen-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setExportResult({ ok: true })
  }
  const doReset = async () => {
    if (!resetArmed) { setResetArmed(true); return }
    setResetting(true); setResetResult(null)
    const r = await resetOrgData()
    setResetResult(r)
    setResetting(false)
    setResetArmed(false)
    // Проще и надёжнее перезагрузить страницу целиком, чем вручную
    // дёргать все независимые источники состояния (датасет/матрица/
    // периоды/точки/правки) — сброс затрагивает буквально всё сразу.
    if (r.ok) setTimeout(() => window.location.reload(), 600)
  }

  if (!backendOnline || !form) {
    return (
      <div className="space-y-5">
        <div className="card p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-warn/10 text-warn"><IPlug width={20} height={20} /></span>
            <div>
              <h3 className="text-base font-semibold text-fg-50">Бэкенд не подключён — демо-режим</h3>
              <p className="text-sm text-fg-400">Приложение работает на встроенных данных (май 2026). Чтобы тянуть свежие данные из iiko, разверните сервис-бэкенд рядом с приложением.</p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-ink-700/60 bg-ink-900/40 p-4 text-sm text-fg-400">
            После развёртывания бэкенда здесь появятся: подключение к iiko, кнопка «Обновить сейчас» и настройка автообновления.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* status + manual refresh */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className={`grid h-11 w-11 place-items-center rounded-xl ${status?.lastResult === 'error' ? 'bg-bad/10 text-bad' : 'bg-good/10 text-good'}`}><ISync width={20} height={20} /></span>
          <div>
            <div className="text-sm font-semibold text-fg-50">Данные из iiko</div>
            <div className="text-xs text-fg-500">
              Обновлено: <span className="text-fg-300">{ago(status?.lastSync ?? null)}</span>
              {status?.positions ? <> · {status.positions} позиций</> : null}
              {status?.lastResult === 'error' && <span className="text-bad"> · ошибка: {status.message}</span>}
            </div>
            {/* Диагностика синка iikoServer (сколько строк реально вернул
                отчёт и сколько отсеялось и почему) — видна и на успехе, не
                только на ошибке, чтобы не гадать, где теряются данные. */}
            {status?.lastResult === 'ok' && status.message && status.message.includes('iikoServer вернул') && (
              <div className="mt-1 text-[11px] text-fg-600">{status.message}</div>
            )}
          </div>
        </div>
        <button
          onClick={async () => {
            // Сохраняем форму перед синком — та же причина, что у
            // doSyncMatrix: иначе правки serverUrl/login/password,
            // сделанные прямо перед нажатием, использует не этот синк
            // (уходит со старыми, уже сохранёнными настройками), а только
            // следующий.
            if (form) { const r = await saveSettings(form); if (r) { setForm(r); setSaved(true) } }
            await refresh()
          }}
          disabled={syncing}
          className="btn bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60"
        >
          <ISync width={16} height={16} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Обновляю…' : 'Обновить сейчас'}
        </button>
      </div>

      {/* historical backfill — просто факт закупок за прошлый месяц, без привязки к плану/матрице этого периода */}
      {form?.provider !== 'mock' && (
        <div className="card flex flex-wrap items-center gap-3 p-5">
          <div>
            <div className="text-sm font-semibold text-fg-50">Загрузить другой период</div>
            <div className="text-xs text-fg-500">«Обновить сейчас» всегда берёт текущий/предыдущий месяц из настроек — здесь можно разово подтянуть любой прошлый месяц: сами закупки (сумма/кол-во), даже если план-цены за него ещё не синканы.</div>
          </div>
          <div className="relative">
            <select
              value={historicalMonthNum ?? ''}
              onChange={(e) => { setHistoricalMonthNum(e.target.value ? Number(e.target.value) : null); setHistoricalResult(null) }}
              className="appearance-none rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2 pr-8 text-sm text-fg-100 focus:border-brand-500 focus:outline-none"
            >
              <option value="">Месяц…</option>
              {RU_MONTHS.map((label, i) => (
                <option key={label} value={i + 1} disabled={i + 1 > maxHistoricalMonth}>{label}</option>
              ))}
            </select>
            <IChevron width={13} height={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 text-fg-500" />
          </div>
          <div className="relative">
            <select
              value={historicalYear}
              onChange={(e) => {
                const y = Number(e.target.value)
                setHistoricalYear(y)
                const max = y === nowDate.getFullYear() ? nowDate.getMonth() + 1 : 12
                if (historicalMonthNum && historicalMonthNum > max) setHistoricalMonthNum(null)
                setHistoricalResult(null)
              }}
              className="appearance-none rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2 pr-8 text-sm text-fg-100 focus:border-brand-500 focus:outline-none"
            >
              {[nowDate.getFullYear(), nowDate.getFullYear() - 1, nowDate.getFullYear() - 2].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <IChevron width={13} height={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 text-fg-500" />
          </div>
          <button
            onClick={async () => { if (!historicalMonth) return; setHistoricalResult(null); setHistoricalResult(await syncHistoricalPeriod(historicalMonth)) }}
            disabled={syncing || !historicalMonth}
            className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60"
          >
            <ISync width={16} height={16} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Загружаю…' : 'Загрузить этот период'}
          </button>
          {historicalResult && (
            <span className={`chip ${historicalResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
              {historicalResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}
              {historicalResult.ok ? 'Загружено — переключил на этот период' : historicalResult.message}
            </span>
          )}
        </div>
      )}

      {/* connection */}
      <Section title="Подключение к iiko" subtitle="Выберите источник и введите доступ. Пароль/ключ хранятся только на сервере.">
        <div className="grid grid-cols-3 gap-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => set({ provider: p.id })}
              className={`rounded-xl border p-3 text-left transition-colors ${form.provider === p.id ? 'border-brand-500 bg-brand-500/10' : 'border-ink-600 bg-ink-900/40 hover:border-ink-600/80'}`}
            >
              <div className="text-sm font-semibold text-fg-100">{p.label}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-fg-500">{p.note}</div>
            </button>
          ))}
        </div>

        {form.provider === 'iikoserver' && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Адрес сервера iiko" hint="URL и порт resto API, напр. https://ваш-сервер:443" value={form.serverUrl} onChange={(v) => set({ serverUrl: v })} placeholder="https://host:443" full />
            <Field label="Логин" value={form.login} onChange={(v) => set({ login: v })} />
            <Field label="Пароль" type="password" value={form.password} onChange={(v) => set({ password: v })} placeholder="•••••••• (не менять — оставьте пустым)" />
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={test} disabled={testing} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
            <IPlug width={16} height={16} /> {testing ? 'Сохраняю и проверяю…' : 'Сохранить и проверить подключение'}
          </button>
          {form.provider === 'iikoserver' && (
            <button onClick={showColumns} disabled={columnsLoading} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
              <IInfo width={16} height={16} /> {columnsLoading ? 'Спрашиваю…' : 'Показать доступные поля отчёта'}
            </button>
          )}
          {form.provider === 'iikoserver' && (
            <>
              <input value={sampleSearch} onChange={(e) => setSampleSearch(e.target.value)} placeholder="ягода"
                className="w-28 rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-fg-100 focus:border-brand-500 focus:outline-none" />
              <input value={samplePeriod} onChange={(e) => setSamplePeriod(e.target.value)} placeholder="2026-08" title="Период YYYY-MM — по умолчанию текущий/прошлый месяц из настроек"
                className="w-24 rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-fg-100 focus:border-brand-500 focus:outline-none" />
              <input value={sampleTypes} onChange={(e) => setSampleTypes(e.target.value)} placeholder="типы (напр. WRITEOFF)"
                title="Конкретные типы операций через запятую вместо INVOICE — быстро, в отличие от «все типы». Сначала узнайте список типов кнопкой «Показать типы операций»"
                className="w-40 rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-fg-100 focus:border-brand-500 focus:outline-none" />
              <button onClick={showSample} disabled={sampleLoading} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
                <IInfo width={16} height={16} /> {sampleLoading ? 'Спрашиваю…' : 'Проверить сырые поля'}
              </button>
              <button onClick={showTypes} disabled={typesLoading} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
                <IInfo width={16} height={16} /> {typesLoading ? 'Спрашиваю…' : 'Показать типы операций'}
              </button>
              <label className="flex items-center gap-1.5 text-xs text-fg-400" title="Без фильтра по типу вообще — считает всю сеть за месяц, медленно и может не успеть за таймаут прокси. Сначала попробуйте «Показать типы операций» + конкретный тип в поле выше">
                <input type="checkbox" checked={sampleAllTypes} onChange={(e) => setSampleAllTypes(e.target.checked)} className="accent-brand-500" />
                все типы (медленно)
              </label>
              <button onClick={showInvoice} disabled={invoiceLoading} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
                <IInfo width={16} height={16} /> {invoiceLoading ? 'Спрашиваю…' : 'Проверить накладную (XML)'}
              </button>
              <button onClick={showProduct} disabled={productLoading} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
                <IInfo width={16} height={16} /> {productLoading ? 'Спрашиваю…' : 'Проверить товар (артикул)'}
              </button>
              <button onClick={showStores} disabled={storesLoading} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
                <IInfo width={16} height={16} /> {storesLoading ? 'Спрашиваю…' : 'Проверить склад (GUID)'}
              </button>
              <button onClick={showCategory} disabled={categoryLoading} title="В какой категории товар заведён в номенклатуре iiko — чтобы проверить, не из-за категории ли закупка выпадает из Проверки цен" className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
                <IInfo width={16} height={16} /> {categoryLoading ? 'Спрашиваю…' : 'Проверить категорию товара'}
              </button>
              <button onClick={exportExcludedCategoryList} disabled={categoryListExporting} title="Весь список товаров, которые сейчас не попадают в Проверку цен из-за категории в номенклатуре — чтобы разобрать его целиком и руками решить, что из него на самом деле нужно сверять" className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
                <ISync width={16} height={16} className={categoryListExporting ? 'animate-spin' : ''} /> {categoryListExporting ? 'Готовлю файл…' : 'Скачать список исключённых категорий'}
              </button>
              <button onClick={showAssortmentDebug} disabled={assortmentLoading} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
                <IInfo width={16} height={16} /> {assortmentLoading ? 'Спрашиваю…' : 'Проверить разброс по ресторанам'}
              </button>
              <button onClick={showDatasetDebug} disabled={datasetLoading} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
                <IInfo width={16} height={16} /> {datasetLoading ? 'Спрашиваю…' : 'Проверить сохранённый датасет'}
              </button>
            </>
          )}
          {testResult && (
            <span className={`chip ${testResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
              {testResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}{testResult.message}
            </span>
          )}
        </div>
        {columnsResult && (
          <div className="mt-3">
            {columnsResult.ok ? (
              <pre className="max-h-64 overflow-auto rounded-lg border border-ink-600 bg-ink-900/60 p-3 text-[11px] text-fg-300">
                {JSON.stringify(columnsResult.columns, null, 1)}
              </pre>
            ) : (
              <span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />{columnsResult.message}</span>
            )}
          </div>
        )}
        {sampleResult && (
          <div className="mt-3">
            {sampleResult.ok ? (
              sampleResult.rows && sampleResult.rows.length > 0 ? (
                <pre className="max-h-64 overflow-auto rounded-lg border border-ink-600 bg-ink-900/60 p-3 text-[11px] text-fg-300">
                  {JSON.stringify(sampleResult.rows, null, 1)}
                </pre>
              ) : (
                <span className="chip border-ink-600 bg-ink-800/60 text-fg-400">Ничего не нашлось по «{sampleSearch}» за текущий период</span>
              )
            ) : (
              <span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />{sampleResult.message}</span>
            )}
          </div>
        )}
        {typesResult && (
          <div className="mt-3">
            {typesResult.ok ? (
              typesResult.rows && typesResult.rows.length > 0 ? (
                <pre className="max-h-64 overflow-auto rounded-lg border border-ink-600 bg-ink-900/60 p-3 text-[11px] text-fg-300">
                  {JSON.stringify(typesResult.rows, null, 1)}
                </pre>
              ) : (
                <span className="chip border-ink-600 bg-ink-800/60 text-fg-400">Ничего не нашлось за текущий период</span>
              )
            ) : (
              <span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />{typesResult.message}</span>
            )}
          </div>
        )}
        {invoiceResult && (
          <div className="mt-3">
            {invoiceResult.ok ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-600 bg-ink-900/60 p-3 text-[11px] text-fg-300">
                {invoiceResult.xml}
              </pre>
            ) : (
              <span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />{invoiceResult.message}</span>
            )}
          </div>
        )}
        {productResult && (
          <div className="mt-3">
            {productResult.ok ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-600 bg-ink-900/60 p-3 text-[11px] text-fg-300">
                {productResult.xml}
              </pre>
            ) : (
              <>
                <span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />{productResult.errorName ? `${productResult.errorName}: ` : ''}{productResult.message}</span>
                {productResult.errorStack && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-ink-600 bg-ink-900/60 p-3 text-[11px] text-fg-400">
                    {productResult.errorStack.join('\n')}
                  </pre>
                )}
              </>
            )}
          </div>
        )}
        {storesResult && (
          <div className="mt-3">
            {storesResult.ok ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-600 bg-ink-900/60 p-3 text-[11px] text-fg-300">
                {storesResult.xml}
              </pre>
            ) : (
              <span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />{storesResult.message}</span>
            )}
          </div>
        )}
        {categoryResult && (
          <div className="mt-3">
            {categoryResult.ok ? (
              categoryResult.items && categoryResult.items.length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-fg-500">
                      <th className="px-2 py-1 font-medium">Товар</th>
                      <th className="px-2 py-1 font-medium">Категория в iiko</th>
                      <th className="px-2 py-1 font-medium">Исключена из Проверки цен?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryResult.items.map((it, i) => (
                      <tr key={i} className="border-t border-ink-700/40">
                        <td className="px-2 py-1 text-fg-200">{it.name}</td>
                        <td className="px-2 py-1 text-fg-300">{it.category || '—'}</td>
                        <td className="px-2 py-1">
                          {it.excluded
                            ? <span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />да — не дойдёт до Проверки цен</span>
                            : <span className="chip border-good/30 bg-good/10 text-good"><ICheck width={13} height={13} />нет</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <span className="chip border-ink-600 bg-ink-800/60 text-fg-400">Ничего не нашлось по «{sampleSearch}» в номенклатуре</span>
              )
            ) : (
              <span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />{categoryResult.message}</span>
            )}
          </div>
        )}
        {categoryListError && (
          <div className="mt-3">
            <span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />{categoryListError}</span>
          </div>
        )}
        {assortmentResult && (
          <div className="mt-3">
            {assortmentResult.ok ? (
              assortmentResult.items && assortmentResult.items.length > 0 ? (
                <div className="space-y-3">
                  <div className="text-xs text-fg-500">Товары: {assortmentResult.matchedProducts?.join(', ')} — всего строк: {assortmentResult.items.length}</div>
                  {Object.entries(
                    assortmentResult.items.reduce<Record<string, { items: AssortmentDebugItem[]; sum: number }>>((acc, it) => {
                      const key = it.restaurant ?? `(не определён: ${it.storeName})`
                      if (!acc[key]) acc[key] = { items: [], sum: 0 }
                      acc[key].items.push(it); acc[key].sum += it.sum
                      return acc
                    }, {}),
                  ).sort((a, b) => b[1].sum - a[1].sum).map(([restaurant, g]) => (
                    <div key={restaurant} className="rounded-lg border border-ink-600 bg-ink-900/60 p-3">
                      <div className="mb-2 text-sm font-medium text-fg-200">{restaurant} — {g.sum.toLocaleString('ru-RU')} ₸ ({g.items.length} стр.)</div>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-fg-400">
                        {g.items.map((it) => `${it.storeName} (${it.storeId}) · ${it.supplier} · ${it.pack || it.product} · qty=${it.qty} · sum=${it.sum}`).join('\n')}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="chip border-ink-600 bg-ink-800/60 text-fg-400">Совпадающих товаров не нашлось</span>
              )
            ) : (
              <span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />{assortmentResult.message}</span>
            )}
          </div>
        )}
        {datasetResult && (
          <div className="mt-3">
            {datasetResult.ok ? (
              datasetResult.items && datasetResult.items.length > 0 ? (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-600 bg-ink-900/60 p-3 text-[11px] text-fg-300">
                  {datasetResult.items.map((it) => `${it.restaurant} · ${it.supplier} · ${it.product} · ${it.pack} · qty=${it.qty} · sum=${it.sum}`).join('\n')}
                </pre>
              ) : (
                <span className="chip border-ink-600 bg-ink-800/60 text-fg-400">Ничего не нашлось в сохранённом датасете</span>
              )
            ) : (
              <span className="chip border-bad/30 bg-bad/10 text-bad"><IClose width={13} height={13} />{datasetResult.message}</span>
            )}
          </div>
        )}
      </Section>

      <Section title="Сырой отчёт" subtitle={`Закупки текущего периода (${period}) ровно как их прислал iiko — без матрицы, переименований и привязок из Справочников. Для отладки или если нужно передать исходные данные.`}>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={exportRawDataset} disabled={rawExporting || rawBase.length === 0} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
            <ISync width={16} height={16} className={rawExporting ? 'animate-spin' : ''} /> {rawExporting ? 'Готовлю файл…' : 'Скачать сырой отчёт (Excel)'}
          </button>
          <span className="text-xs text-fg-500">{rawBase.length === 0 ? 'За этот период данных ещё нет' : `${rawBase.length} строк закупок`}</span>
        </div>
      </Section>

      {/* venues */}
      <Section title="Точки сети" subtitle="Точки приходят из iiko вместе с закупками: найдите нужную в списке «Обнаружены в закупках» и нажмите «Добавить» — она появится в Справочниках → Точки (там можно задать своё название, только для этого приложения; основное название — то, под которым точка сопоставлена с матрицей) и в выборе точек на Обзоре и в Проверке цен.">
        <div className="text-sm text-fg-400">Сейчас включено: <span className="text-fg-200">{venues.enabled.length}</span> точек</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {venues.enabled.map((name) => (
            <span key={name} className="chip border-ink-600 bg-ink-800/60 text-fg-300">
              <IStore width={13} height={13} />{name}
              <button
                disabled={removingVenue === name}
                onClick={async () => { setRemovingVenue(name); await disableVenueByName(name); setRemovingVenue(null) }}
                title="Убрать точку (закрыта/не нужна вообще)"
                className="ml-1 text-fg-500 hover:text-bad disabled:opacity-60"
              >
                <ITrash width={12} height={12} />
              </button>
            </span>
          ))}
        </div>
        {venues.discovered.length > 0 ? (
          <div className="mt-3">
            <div className="mb-2 text-xs font-medium text-fg-400">Обнаружены в закупках, но пока не показаны:</div>
            <div className="flex flex-wrap gap-2">
              {venues.discovered.map((name) => (
                <button
                  key={name}
                  disabled={addingVenue === name}
                  onClick={async () => { setAddingVenue(name); await enableVenueByName(name); setAddingVenue(null) }}
                  className="chip border-brand-500/40 bg-brand-500/10 text-brand-300 hover:bg-brand-500/20 disabled:opacity-60"
                >
                  <IStore width={13} height={13} />{name}
                  <IPlus width={13} height={13} />
                  {addingVenue === name ? 'Добавляю…' : 'Добавить'}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-fg-500">Новых точек, которых ещё нет в списке, не найдено.</p>
        )}
      </Section>

      {/* matrix (plan prices from Google Sheet) */}
      <Section title="Матрица — Алматы" subtitle="Читается прямо из Google-таблицы Сырьё Ф (Алматы) через сервисный аккаунт — это отдельный источник от iiko, iiko про договорные цены ничего не знает. Без привязки к месяцу — всегда актуальная версия, хранится вместе с матрицей Астаны ниже.">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="ID или ссылка на таблицу"
            hint="Можно вставить прямо ссылку из адресной строки — ID вытащится сам"
            value={form.googleSheetId}
            onChange={(v) => set({ googleSheetId: extractSheetId(v) })}
            placeholder="https://docs.google.com/spreadsheets/d/…/edit"
            full
          />
          <div className="col-span-2">
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-400">
              Ключ сервисного аккаунта (JSON)
              <InfoTip text="Весь файл, который скачали в Google Cloud Console → Service Accounts → Keys → Add Key → JSON. Хранится только на сервере." />
            </label>
            <textarea
              rows={3}
              value={form.googleServiceAccountKey}
              onChange={(e) => set({ googleServiceAccountKey: e.target.value })}
              placeholder='{"type": "service_account", …} (не менять — оставьте пустым, если ключ уже сохранён)'
              className="w-full rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2 font-mono text-xs text-fg-100 placeholder:text-fg-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={testMatrix} disabled={matrixTesting} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
            <IPlug width={16} height={16} /> {matrixTesting ? 'Сохраняю и проверяю…' : 'Сохранить и проверить доступ'}
          </button>
          <button onClick={doSyncMatrix} disabled={matrixSyncing} className="btn bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60">
            <ISync width={16} height={16} className={matrixSyncing ? 'animate-spin' : ''} /> {matrixSyncing ? 'Читаю таблицу…' : 'Обновить'}
          </button>
          {matrixTestResult && (
            <span className={`chip ${matrixTestResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
              {matrixTestResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}{matrixTestResult.message}
            </span>
          )}
          {matrixSyncResult && (
            <span className={`chip ${matrixSyncResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
              {matrixSyncResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}
              {matrixSyncResult.ok ? 'Матрица обновлена' : matrixSyncResult.message}
            </span>
          )}
        </div>
      </Section>

      {/* matrix — Астана (отдельная таблица, тот же сервисный аккаунт) */}
      <Section title="Матрица — Астана" subtitle="Отдельная таблица для точек Астаны (свои вкладки). Ключ сервисного аккаунта — тот же, что выше; его нужно пригласить читателем и в эту таблицу.">
        <Field
          label="ID или ссылка на таблицу Астаны"
          hint="Можно вставить прямо ссылку из адресной строки — ID вытащится сам"
          value={form.astanaSheetId}
          onChange={(v) => set({ astanaSheetId: extractSheetId(v) })}
          placeholder="https://docs.google.com/spreadsheets/d/…/edit"
          full
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={testAstana} disabled={astanaTesting} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
            <IPlug width={16} height={16} /> {astanaTesting ? 'Сохраняю и проверяю…' : 'Сохранить и проверить доступ'}
          </button>
          <button onClick={doSyncAstana} disabled={astanaSyncing} className="btn bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60">
            <ISync width={16} height={16} className={astanaSyncing ? 'animate-spin' : ''} /> {astanaSyncing ? 'Читаю таблицу…' : 'Обновить'}
          </button>
          {astanaTestResult && (
            <span className={`chip ${astanaTestResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
              {astanaTestResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}{astanaTestResult.message}
            </span>
          )}
          {astanaSyncResult && (
            <span className={`chip ${astanaSyncResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
              {astanaSyncResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}
              {astanaSyncResult.ok ? 'Матрица обновлена' : astanaSyncResult.message}
            </span>
          )}
        </div>
      </Section>

      {/* schedule */}
      <Section title="Автообновление" subtitle="Приложение будет само подтягивать данные из iiko по расписанию.">
        <label className="flex cursor-pointer items-center gap-3">
          <Checkbox checked={form.autoEnabled} onChange={() => set({ autoEnabled: !form.autoEnabled })} />
          <span className="text-sm text-fg-200">Обновлять автоматически</span>
          <InfoTip text="Сервис на сервере запускает обновление по расписанию, даже когда приложение закрыто." />
        </label>
        <div className={`mt-3 flex flex-wrap gap-2 ${form.autoEnabled ? '' : 'pointer-events-none opacity-40'}`}>
          {INTERVALS.map((i) => (
            <button key={i.id} onClick={() => set({ interval: i.id })}
              className={`chip ${form.interval === i.id ? 'border-brand-500 bg-brand-500/10 text-brand-300' : 'border-ink-600 text-fg-400 hover:text-fg-200'}`}>
              {i.label}
            </button>
          ))}
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button onClick={save} className="btn bg-brand-500 text-white hover:bg-brand-600">Сохранить настройки</button>
        {saved && <span className="chip border-good/30 bg-good/10 text-good"><ICheck width={13} height={13} /> Сохранено</span>}
      </div>

      {/* danger zone — бэкап/полный сброс данных (не настроек подключения) */}
      <Section title="Опасная зона" subtitle="Факты закупок, матрицы план-цен и все ручные правки — настройки подключения к iiko/Google не трогаются.">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={downloadBackup} disabled={exporting} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
            <ISync width={16} height={16} className={exporting ? 'animate-spin' : ''} /> {exporting ? 'Готовлю файл…' : 'Скачать бэкап'}
          </button>
          {exportResult && (
            <span className={`chip ${exportResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
              {exportResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}
              {exportResult.ok ? 'Скачано' : exportResult.message}
            </span>
          )}
          <button
            onClick={doReset}
            disabled={resetting}
            className={`btn disabled:opacity-60 ${resetArmed ? 'bg-bad text-white hover:bg-bad/80' : 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20'}`}
          >
            <IClose width={16} height={16} /> {resetting ? 'Сбрасываю…' : resetArmed ? 'Точно сбросить всё? Нажмите ещё раз' : 'Сбросить все данные'}
          </button>
          {resetArmed && !resetting && (
            <button onClick={() => setResetArmed(false)} className="text-xs text-fg-500 hover:text-fg-300">отмена</button>
          )}
          {resetResult && (
            <span className={`chip ${resetResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
              {resetResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}
              {resetResult.ok ? 'Сброшено — перезагружаю страницу' : resetResult.message}
            </span>
          )}
        </div>
        <p className="mt-3 text-xs text-fg-500">Сначала скачайте бэкап — сброс необратим. После сброса список включённых точек вернётся к стартовому, периоды и матрицу нужно будет синкать заново.</p>
      </Section>
    </div>
  )
}

function Field({ label, hint, value, onChange, type = 'text', placeholder, full }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; full?: boolean
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-400">{label}{hint && <InfoTip text={hint} />}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2 text-sm text-fg-100 placeholder:text-fg-600 focus:border-brand-500 focus:outline-none"
      />
    </div>
  )
}
