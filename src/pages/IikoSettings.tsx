import { ReactNode, useEffect, useState } from 'react'
import { norm, matchRestaurant } from '../lib/data'
import { useAuth } from '../lib/auth'
import { useEdits } from '../lib/edits'
import { MATRIX_SNAPSHOTS } from '../lib/features'
import { fetchSettings, saveSettings, testConnection, fetchMatrixSnapshots, deleteMatrixSnapshot, testMatrixConnection, syncMatrix, fetchFullExport, restoreAllFromBackup, wipeAllKeepConnection, IikoSettings as Settings } from '../lib/api'
import { Section, InfoTip, Checkbox } from '../components/ui'
import DateField from '../components/DateField'
import MonthFixCard from '../components/MonthFixCard'
import { ISync, IPlug, ICheck, IClose, IStore, IPlus, ITrash } from '../components/icons'

function extractSheetId(input: string): string {
  const m = input.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : input.trim()
}

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

export default function IikoSettings() {
  const { backendOnline, status, reloadStatus, venues, enableVenueByName, disableVenueByName, refreshMatrix, periodKey, restaurants, matching, edits } = useEdits()
  const { user } = useAuth()
  // «Для разработчика» — без пароля: кнопка просто показывает администратору скрытые разделы (запоминается в браузере)
  const [devMode, setDevMode] = useState(() => { try { return localStorage.getItem('pricecheck-dev-ui') === '1' } catch { return false } })
  const toggleDev = (on: boolean) => { setDevMode(on); try { localStorage.setItem('pricecheck-dev-ui', on ? '1' : '0') } catch { /* без хранилища — до перезагрузки */ } }
  const isDev = user?.role === 'admin' && devMode
  // Разделы страницы (слева меню, справа один раздел) — запоминаем выбранный
  const ALL_SECTIONS = [
    { id: 'matrix', label: 'Фиксация месяца' },
    { id: 'venues', label: 'Точки сети' },
    { id: 'auto', label: 'Автообновление' },
    { id: 'backup', label: 'Резервная копия' },
  ] as const
  const SECTIONS = isDev ? ALL_SECTIONS : ALL_SECTIONS.filter((x) => x.id === 'matrix')
  type SectionId = typeof ALL_SECTIONS[number]['id']
  const [fullBusy, setFullBusy] = useState<'' | 'restore' | 'wipe'>('')
  const [fullResult, setFullResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [section, setSection] = useState<SectionId>(() => { try { const v = localStorage.getItem('settingsSection'); return SECTIONS.some((x) => x.id === v) ? (v as SectionId) : 'matrix' } catch { return 'matrix' } })
  const pickSection = (id: SectionId) => { setSection(id); try { localStorage.setItem('settingsSection', id) } catch { /* без запоминания */ } }
  const [form, setForm] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [addingVenue, setAddingVenue] = useState<string | null>(null)
  const [removingVenue, setRemovingVenue] = useState<string | null>(null)
  const [matrixTesting, setMatrixTesting] = useState(false)
  const [matrixTestResult, setMatrixTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [matrixSyncing, setMatrixSyncing] = useState(false)
  // Период, ЗА КОТОРЫЙ фиксируем цены матрицы (снимок): месяц или отрезок «с … по …» (день, неделя, любой отрезок)
  const [matrixFrom, setMatrixFrom] = useState('')
  const [matrixTo, setMatrixTo] = useState('')
  const [matrixPeriodTouched, setMatrixPeriodTouched] = useState(false)
  // пока даты не трогали — подставляем весь выбранный в шапке месяц (первое и последнее число)
  useEffect(() => {
    if (matrixPeriodTouched) return
    const r = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(periodKey ?? '')
    if (r) { setMatrixFrom(r[1]); setMatrixTo(r[2]); return }
    const m = /^\d{4}-\d{2}$/.test(periodKey ?? '') ? periodKey : new Date().toISOString().slice(0, 7)
    const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate()
    setMatrixFrom(`${m}-01`); setMatrixTo(`${m}-${String(last).padStart(2, '0')}`)
  }, [periodKey, matrixPeriodTouched])
  const spanDays = matrixFrom && matrixTo ? Math.round((Date.parse(matrixTo) - Date.parse(matrixFrom)) / 86400000) : 0
  const matrixPeriod = matrixFrom && matrixTo && matrixFrom <= matrixTo && spanDays <= 92 ? `${matrixFrom}..${matrixTo}` : ''
  const [snapshots, setSnapshots] = useState<{ period: string; periodLabel: string }[]>([])
  const [tabSnapshots, setTabSnapshots] = useState<{ tab: string; period: string; periodLabel: string }[]>([])
  const loadSnapshots = () => { if (!MATRIX_SNAPSHOTS) return; fetchMatrixSnapshots().then((r) => { if (r) { setSnapshots(r.periods); setTabSnapshots(r.tabs ?? []) } }) }
  // Границы периода-ключа («ГГГГ-ММ» — старые месячные снимки, или «с..по»)
  const boundsOf = (p: string) => {
    if (/^\d{4}-\d{2}$/.test(p)) { const last = new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0).getDate(); return { a: `${p}-01`, b: `${p}-${String(last).padStart(2, '0')}` } }
    const [a, b] = p.split('..'); return { a, b }
  }
  // Ранее зафиксированные периоды, которые целиком входят в новый (кроме точно такого же — он просто обновится)
  const coveredBy = async (tab?: string) => {
    if (!matrixPeriod) return []
    const fresh = await fetchMatrixSnapshots() // свежий список: его мог изменить другой админ
    const snapshots = fresh?.periods ?? [], tabSnapshots = fresh?.tabs ?? []
    const n = boundsOf(matrixPeriod)
    const inside = (p: string) => { if (p === matrixPeriod) return false; const x = boundsOf(p); return x.a >= n.a && x.b <= n.b }
    const out: { period: string; label: string; tab?: string }[] = []
    if (!tab) for (const x of snapshots) if (inside(x.period)) out.push({ period: x.period, label: x.periodLabel })
    for (const x of tabSnapshots) if (inside(x.period) && (!tab || norm(x.tab) === norm(tab))) out.push({ period: x.period, label: `${x.periodLabel} (${x.tab})`, tab: x.tab })
    return out
  }
  // Предупреждение ДО сохранения: «да» — прежние внутренние периоды удалятся после успешного сохранения, «нет» — ничего не делаем
  const askCovered = (list: { label: string }[]) =>
    !list.length || window.confirm(`Уже зафиксированы цены за периоды, которые входят в выбранный (${matrixPeriod.replace('..', ' – ')}):\n\n${list.map((x) => '• ' + x.label).join('\n')}\n\nУдалить их и сохранить новый период? Цены этих периодов пропадут (и для Алматы, и для Астаны). «Отмена» — ничего не сохраняется.`)
  const dropCovered = async (list: { period: string; tab?: string }[]) => {
    for (const x of list) if (!(await deleteMatrixSnapshot(x.period, x.tab))) window.alert(`Новые цены сохранены, но прежний период «${x.period}» удалить не удалось — удалите его вручную (×) в списке «Уже зафиксированные даты», иначе он может перекрывать новый.`)
  }
  // «Один ресторан»: наш ресторан + вкладка таблицы, по которой он сверяется (Справочники → Точки → «Вкладка матрицы»)
  const [matrixScope, setMatrixScope] = useState<'all' | 'one'>('all')
  const [oneRest, setOneRest] = useState('')
  const [oneTab, setOneTab] = useState('')
  const [oneSyncing, setOneSyncing] = useState(false)
  const [oneResult, setOneResult] = useState<{ ok: boolean; message?: string } | null>(null)
  // название листа КАК В ТАБЛИЦЕ (а не наше «красивое»): подписи вкладок запоминает синк матрицы (tabTitles)
  const realTitle = (display: string) => matching?.tabTitles?.[norm(display)] ?? display
  const sheetTabs = [
    ...(matching?.tabsByTarget?.almaty ?? []).map((tab) => ({ tab, target: 'almaty' as const, city: 'Алматы' })),
    ...(matching?.tabsByTarget?.astana ?? []).map((tab) => ({ tab, target: 'astana' as const, city: 'Астана' })),
  ]
  const pickRestaurant = (name: string) => {
    setOneRest(name); setOneResult(null)
    const mapped = norm(matchRestaurant(edits, name))
    setOneTab(sheetTabs.find((t) => norm(t.tab) === mapped)?.tab ?? '')
  }
  const oneTabInfo = sheetTabs.find((t) => t.tab === oneTab)
  const tabMatchesRestaurant = !!oneRest && !!oneTab && norm(oneTab) === norm(matchRestaurant(edits, oneRest))
  const knownTabs = [
    ...(matching?.allTabsByTarget?.almaty ?? []).map((tab) => ({ tab, city: 'Алматы' })),
    ...(matching?.allTabsByTarget?.astana ?? []).map((tab) => ({ tab, city: 'Астана' })),
  ]
  // пока синк не запоминал все листы — берём те, что уже читались (их названия приводим к настоящим), плюс выключенные
  const tabList = (knownTabs.length ? knownTabs : [
    ...(matching?.tabsByTarget?.almaty ?? []).map((tab) => ({ tab: realTitle(tab), city: 'Алматы' })),
    ...(matching?.tabsByTarget?.astana ?? []).map((tab) => ({ tab: realTitle(tab), city: 'Астана' })),
  ]).filter((x, i, arr) => arr.findIndex((y) => norm(y.tab) === norm(x.tab)) === i)
  const doSyncOne = async () => {
    if (!form || !oneTabInfo || !matrixPeriod) return
    const cov = await coveredBy(oneTab); if (!askCovered(cov)) return
    setOneSyncing(true); setOneResult(null)
    const r0 = (isDev ? await saveSettings(form) : null)
    if (r0) { setForm(r0); setSaved(true); reloadStatus() }
    const r = await syncMatrix(oneTabInfo.target, matrixPeriod, oneTab)
    setOneResult(r.ok ? { ok: true, message: `Цены «${oneRest}» зафиксированы за выбранный период (${r.rows ?? 0} позиций)` } : r)
    if (r.ok) { await dropCovered(cov); await refreshMatrix(); loadSnapshots() }
    setOneSyncing(false)
  }
  useEffect(() => { if (MATRIX_SNAPSHOTS) loadSnapshots() }, [])
  type SyncRes = { ok: boolean; message?: string; period?: string | null; conflicts?: string[]; catalogOverlay?: boolean; catalogUnmatched?: number; catalogRows?: number }
  const [matrixSyncResult, setMatrixSyncResult] = useState<SyncRes | null>(null)
  // Астана — отдельная таблица, свои test/sync, тот же сервисный аккаунт.
  // Название склада так, как его прислал iiko (из загруженных закупок); пока для точки нет — показываем её название
  // подсказка к точке: какие склады iiko в ней в выбранном периоде (САМА точка называется так, как сохранена — подпись не должна зависеть от периода)
  const storesHint = (name: string) => restaurants.find((r) => r.name === name)?.stores?.join('; ') || ''
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const [astanaTesting, setAstanaTesting] = useState(false)
  const [astanaTestResult, setAstanaTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [astanaSyncing, setAstanaSyncing] = useState(false)
  const [astanaSyncResult, setAstanaSyncResult] = useState<SyncRes | null>(null)

  useEffect(() => { fetchSettings().then((s) => s && setForm(s)) }, [])

  // Любое поле формы может относиться к iiko ИЛИ к матрице — чистим все «зелёные» результаты сразу.
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
    const r = (isDev ? await saveSettings(form) : null)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
  }
  const test = async () => {
    if (!form) return
    setTesting(true); setTestResult(null)
    // «Проверить» = «Сохранить и проверить»: введённое не пропадает, если уйти со страницы
    const r = (isDev ? await saveSettings(form) : null)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
    setTestResult(await testConnection(form))
    setTesting(false)
  }
  const testMatrix = async () => {
    if (!form) return
    setMatrixTesting(true); setMatrixTestResult(null); setAstanaTesting(true); setAstanaTestResult(null)
    const r = (isDev ? await saveSettings(form) : null)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
    setMatrixTestResult(await testMatrixConnection(form))
    setMatrixTesting(false)
    setAstanaTestResult(await testMatrixConnection(form, 'astana'))
    setAstanaTesting(false)
  }
  const doSyncMatrix = async () => {
    if (!form) return
    const cov = MATRIX_SNAPSHOTS ? await coveredBy() : []; if (!askCovered(cov)) return
    setMatrixSyncing(true); setMatrixSyncResult(null)
    // Сохраняем перед синком: иначе синк ушёл бы со старым ID/ключом, а не с только что вписанным
    const r0 = (isDev ? await saveSettings(form) : null)
    if (r0) { setForm(r0); setSaved(true); reloadStatus() }
    const r = await syncMatrix(undefined, MATRIX_SNAPSHOTS ? matrixPeriod || undefined : undefined)
    setMatrixSyncResult(r)
    if (r.ok) { await dropCovered(cov); await refreshMatrix(); loadSnapshots() }
    setMatrixSyncing(false)
  }
  const doSyncAstana = async () => {
    if (!form) return
    const cov = MATRIX_SNAPSHOTS ? await coveredBy() : []; if (!askCovered(cov)) return
    setAstanaSyncing(true); setAstanaSyncResult(null)
    const r0 = (isDev ? await saveSettings(form) : null)
    if (r0) { setForm(r0); setSaved(true); reloadStatus() }
    const r = await syncMatrix('astana', MATRIX_SNAPSHOTS ? matrixPeriod || undefined : undefined)
    setAstanaSyncResult(r)
    if (r.ok) { await dropCovered(cov); await refreshMatrix(); loadSnapshots() }
    setAstanaSyncing(false)
  }

  // Резервная копия: ВСЁ, что есть в программе (закупки, матрицы, связи, пользователи, доступы к iiko и Google), одним файлом
  // restore.tar. Его кладут рядом с установленной программой — она сама разворачивает данные при первом запуске.
  const downloadBackup = async (withSecrets = true) => {
    setExporting(true); setExportResult(null)
    const r = await fetchFullExport(withSecrets)
    setExporting(false)
    if (!r.ok) { setExportResult(r); return }
    const url = URL.createObjectURL(r.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = withSecrets ? 'restore.tar' : 'data-no-passwords.tar'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    setExportResult({ ok: true })
  }

  // Обрыв связи («Load failed» в Safari, «Failed to fetch» в Chrome) при долгом действии: сервер мог успеть выполнить его — результат неизвестен
  const cutOff = (m: string | undefined) => /^(Load failed|Failed to fetch|NetworkError)/i.test(m ?? '')
    ? `Связь с сервером оборвалась (${m}) — результат неизвестен. Обновите страницу и проверьте данные. Большие файлы надёжнее загружать с компьютера.` : null
  // «Восстановить всё из копии»: данные, матрицы, снимки, точки, настройки, правки и привязки из restore.tar
  const restoreEverything = async (file: File | undefined) => {
    if (!file) return
    if (!window.confirm('Восстановить ВСЁ из этой копии? Закупки, матрицы и цены, точки, настройки, связи и заметки будут заменены теми, что в файле. Доступы к iiko и Google-таблице тоже вернутся из копии (если они в ней есть). Пользователи из копии добавятся, нынешние пользователи и пароли останутся.')) return
    setFullBusy('restore'); setFullResult(null)
    const r = await restoreAllFromBackup(file)
    setFullBusy('')
    if (!r.ok) { setFullResult({ ok: false, message: cutOff(r.message) ?? `Восстановление из копии не удалось: ${r.message ?? 'неизвестная ошибка'}` }); return }
    setFullResult({ ok: true, message: `Восстановлено: файлов ${r.files ?? 0}, периодов ${r.periods ?? 0}${r.edits ? ', привязки и правки' : ''}${r.connection ? ', доступы' : ''}${r.users ? `, пользователей добавлено: ${r.users}` : ''}. Страница перезагрузится.` })
    setTimeout(() => window.location.reload(), 1500)
  }
  // «Стереть всё, кроме подключения»: сервер сам сохраняет копию данных у себя (папка _backup-wipe-<время>) и стирает; скачивание файла в браузере
  // в этот шаг не входит (на телефоне оно рвало запрос) — файл при желании скачивают отдельной кнопкой «Скачать бэкап» ДО стирания
  const wipeEverything = async () => {
    if (!window.confirm('Стереть ВСЁ, кроме доступов к iiko и Google-таблице? Закупки, матрицы, цены, точки, связи, заметки и настройки будут удалены. Перед стиранием сервер сохранит копию у себя. Если хотите файл — сначала нажмите «Скачать бэкап». Стереть сейчас?')) return
    setFullBusy('wipe'); setFullResult(null)
    const r = await wipeAllKeepConnection()
    setFullBusy('')
    if (!r.ok) { setFullResult({ ok: false, message: cutOff(r.message) ?? `Стирание не удалось: ${r.message ?? 'неизвестная ошибка'}` }); return }
    setFullResult({ ok: true, message: r.backup ? `Всё стёрто, кроме подключения. Копия на сервере: data/${r.backup}. Страница перезагрузится.` : 'Всё стёрто, кроме подключения. Копия на сервере НЕ создана (старая версия сервера) — выкатите обновление. Страница перезагрузится.' })
    setTimeout(() => window.location.reload(), 2500)
  }

  if (!backendOnline || !form) {
    return (
      <div className="space-y-5">
        <div className="card p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-warn/10 text-warn"><IPlug width={20} height={20} /></span>
            <div>
              <h3 className="text-base font-semibold text-fg-50">Бэкенд не подключён — демо-режим</h3>
              <p className="text-sm text-fg-400">Приложение работает на встроенных данных. Чтобы тянуть свежие данные из iiko, разверните сервис-бэкенд рядом с приложением.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const hasSheetAccess = !!(form?.googleSheetId && form?.googleServiceAccountKey)
  const dot = (id: string) => (id === 'matrix' ? (tabList.length > 0 ? 'bg-good' : hasSheetAccess ? 'bg-warn' : 'bg-fg-600') : form?.autoEnabled ? 'bg-good' : 'bg-fg-600')

  const summary = 'cursor-pointer select-none text-sm font-medium text-fg-300 hover:text-fg-100'
  const checkChip = (r: { ok: boolean; message: string } | null) => r && (
    <span className={`chip ${r.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
      {r.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}{r.message}
    </span>
  )

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">

      {SECTIONS.length > 1 && <nav className="flex shrink-0 flex-col gap-0.5 lg:w-56" aria-label="Разделы">
        {SECTIONS.map((x) => (
          <button key={x.id} onClick={() => pickSection(x.id)}
            className={`flex h-10 items-center justify-between rounded-xl px-3 text-left text-sm ${section === x.id ? 'bg-brand-500 font-medium text-white shadow-sm' : 'text-fg-300 hover:bg-ink-800/70 hover:text-fg-100'}`}>
            <span>{x.label}</span>
            {x.id === 'venues' ? <span className={`rounded-full px-2 py-0.5 text-xs ${section === x.id ? 'bg-white/25 text-white' : 'bg-ink-800 text-fg-400'}`}>{venues.enabled.length}</span> : x.id === 'backup' ? null : <i className={`h-2 w-2 rounded-full ${dot(x.id)} ${section === x.id ? 'ring-2 ring-white' : ''}`} />}
          </button>
        ))}
      </nav>}
      <div className="min-w-0 flex-1 space-y-5">
      {!isDev && user?.role === 'admin' && (
        <div className="flex justify-end">
          <button onClick={() => toggleDev(true)} title="Доступы, точки сети, автообновление, резервные копии"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-fg-500 hover:bg-ink-800/60 hover:text-fg-200">
            <IPlug width={12} height={12} /> Для разработчика
          </button>
        </div>
      )}
      {isDev && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn">
          <span>Режим разработчика</span>
          <button onClick={() => toggleDev(false)} className="font-semibold underline hover:no-underline">Выйти из режима</button>
        </div>
      )}
      {(section === 'matrix' || !isDev) && (<>
      {MATRIX_SNAPSHOTS && <MonthFixCard />}
      <div>
        <div>
          {/* Цены за отдельный отрезок / один ресторан — дополнительный инструмент, только в режиме разработчика */}
          <div className={`${isDev ? '' : 'hidden'} mx-auto w-full max-w-2xl space-y-5 rounded-2xl border border-ink-600/70 bg-ink-850 p-5`}>
            {MATRIX_SNAPSHOTS && <div className="text-sm font-semibold text-fg-200">Только цены за отрезок или один ресторан (дополнительно)</div>}
            {MATRIX_SNAPSHOTS && (
              <>
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-500">Период</div>
                  <div className="grid grid-cols-2 gap-3">
                    <DateField label="с" value={matrixFrom} max={matrixTo || undefined} onChange={(v) => { setMatrixFrom(v); setMatrixPeriodTouched(true) }} className="w-full" />
                    <DateField label="по" value={matrixTo} min={matrixFrom || undefined} onChange={(v) => { setMatrixTo(v); setMatrixPeriodTouched(true) }} className="w-full" />
                  </div>
                  {matrixFrom && matrixTo && matrixFrom > matrixTo && <div className="mt-2 text-xs text-bad">Дата «с» позже даты «по»</div>}
                  {spanDays > 92 && <div className="mt-2 text-xs text-bad">Не больше 3 месяцев (92 дня)</div>}
                </div>
                <div className="grid grid-cols-2 gap-0.5 rounded-xl border border-ink-700 bg-ink-900 p-0.5">
                  {([['all', 'Все рестораны'], ['one', 'Один ресторан']] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setMatrixScope(id)} className={`h-9 rounded-lg text-sm transition-colors ${matrixScope === id ? 'bg-brand-500/20 font-medium text-fg-50' : 'text-fg-400 hover:text-fg-100'}`}>{label}</button>
                  ))}
                </div>
            {matrixScope === 'one' && (
              <div className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-fg-400">Ресторан
                    <select value={oneRest} onChange={(e) => pickRestaurant(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-ink-600 bg-ink-900/60 px-2 text-sm text-fg-100 focus:border-brand-500 focus:outline-none">
                      <option value="">— выберите —</option>
                      {restaurants.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs text-fg-400">Вкладка таблицы
                    <select value={oneTab} onChange={(e) => { setOneTab(e.target.value); setOneResult(null) }}
                      className="mt-1 h-9 w-full rounded-lg border border-ink-600 bg-ink-900/60 px-2 text-sm text-fg-100 focus:border-brand-500 focus:outline-none">
                      <option value="">— выберите —</option>
                      {sheetTabs.map((t) => <option key={`${t.target}:${t.tab}`} value={t.tab}>{realTitle(t.tab)} · {t.city}</option>)}
                    </select>
                  </label>
                </div>
                {sheetTabs.length === 0 && <div className="text-[11px] text-warn">Список вкладок таблицы пока пуст — один раз нажмите «Обновить» в Справочниках, чтобы он загрузился.</div>}
                {oneRest && !oneTab && sheetTabs.length > 0 && <div className="text-[11px] text-warn">У этого ресторана не настроена вкладка таблицы — выберите её в Справочники → Точки → «Вкладка матрицы».</div>}
                {oneRest && oneTab && !tabMatchesRestaurant && <div className="text-[11px] text-bad">Ресторан «{oneRest}» сверяется с другой вкладкой: «{realTitle(matchRestaurant(edits, oneRest))}». Чтобы цены не попали не туда, выберите её тут или измените вкладку в Справочники → Точки.</div>}
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={doSyncOne} disabled={oneSyncing || !matrixPeriod || !tabMatchesRestaurant} className="btn bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60">
                    <ISync width={16} height={16} className={oneSyncing ? 'animate-spin' : ''} /> {oneSyncing ? 'Читаю таблицу…' : 'Зафиксировать цены ресторана'}
                  </button>
                  {oneResult && (
                    <span className={`chip ${oneResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
                      {oneResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}{oneResult.message}
                    </span>
                  )}
                </div>
              </div>
            )}
              </>
            )}
            <div className="space-y-3">
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-ink-700 bg-ink-900/40 px-4 py-3 ${MATRIX_SNAPSHOTS && matrixScope === 'one' ? 'hidden' : ''}`}>
          <span className="min-w-0 flex-1 text-[15px] font-medium text-fg-100">Алматы</span>
          <button onClick={doSyncMatrix} disabled={matrixSyncing || (MATRIX_SNAPSHOTS && !matrixPeriod)} className="btn order-2 bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60">
            <ISync width={16} height={16} className={matrixSyncing ? 'animate-spin' : ''} /> {matrixSyncing ? 'Читаю таблицу…' : 'Зафиксировать'}
          </button>
          {matrixSyncResult && (
              <span className={`chip order-3 ${matrixSyncResult.ok && matrixSyncResult.conflicts?.length ? 'border-warn/40 bg-warn/10 text-warn' : matrixSyncResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
                {matrixSyncResult.ok && !matrixSyncResult.conflicts?.length ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}
                {matrixSyncResult.ok ? (matrixSyncResult.period ? `Цены зафиксированы за ${matrixSyncResult.period}` : 'Готово') + (matrixSyncResult.conflicts?.length ? ` · пропущены вкладки с занятым названием: ${matrixSyncResult.conflicts.join(', ')} — переименуйте в таблице` : '') : matrixSyncResult.message}
              </span>
            )}
        </div>
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-ink-700 bg-ink-900/40 px-4 py-3 ${MATRIX_SNAPSHOTS && matrixScope === 'one' ? 'hidden' : ''}`}>
          <span className="min-w-0 flex-1 text-[15px] font-medium text-fg-100">Астана</span>
          <button onClick={doSyncAstana} disabled={astanaSyncing || !form?.astanaSheetId || (MATRIX_SNAPSHOTS && !matrixPeriod)} className="btn order-2 bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60">
            <ISync width={16} height={16} className={astanaSyncing ? 'animate-spin' : ''} /> {astanaSyncing ? 'Читаю таблицу…' : 'Зафиксировать'}
          </button>
          {astanaSyncResult && (
              <span className={`chip order-3 ${astanaSyncResult.ok && astanaSyncResult.conflicts?.length ? 'border-warn/40 bg-warn/10 text-warn' : astanaSyncResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
                {astanaSyncResult.ok && !astanaSyncResult.conflicts?.length ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}
                {astanaSyncResult.ok ? (astanaSyncResult.period ? `Цены зафиксированы за ${astanaSyncResult.period}` : 'Обновлено') + (astanaSyncResult.conflicts?.length ? ` · пропущены вкладки с занятым названием: ${astanaSyncResult.conflicts.join(', ')} — переименуйте в таблице` : '') : astanaSyncResult.message}
              </span>
            )}
        </div>
            </div>
            {MATRIX_SNAPSHOTS && (
              <div className="space-y-3 border-t border-ink-700/60 pt-4">
            {snapshots.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-400">
                <span className="mr-1 font-medium text-fg-300">Зафиксировано</span>
                {snapshots.map((x) => (
                  <span key={x.period} className="chip border-ink-600 bg-ink-800/60 text-fg-300">
                    {x.periodLabel}
                    <button title="Удалить эти цены (этот период начнёт брать цены более раннего периода)" className="ml-1 text-fg-500 hover:text-bad"
                      onClick={async () => { if (window.confirm(`Удалить зафиксированные цены за «${x.periodLabel}»? Этот период станет брать цены ближайшего более раннего периода.`) && await deleteMatrixSnapshot(x.period)) { loadSnapshots(); await refreshMatrix() } }}>×</button>
                  </span>
                ))}
              </div>
            ) : <div className="text-xs text-fg-500">Пока ничего не зафиксировано</div>}
            {tabSnapshots.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-400">
                <span className="mr-1 font-medium text-fg-300">Отдельно по ресторанам</span>
                {tabSnapshots.map((x) => (
                  <span key={`${x.tab}:${x.period}`} className="chip border-ink-600 bg-ink-800/60 text-fg-300">
                    {x.tab} — {x.periodLabel}
                    <button title="Удалить цены этого ресторана за период (он вернётся к ценам всех ресторанов)" className="ml-1 text-fg-500 hover:text-bad"
                      onClick={async () => { if (window.confirm(`Удалить цены «${x.tab}» за «${x.periodLabel}»? Ресторан вернётся к ценам всех ресторанов.`) && await deleteMatrixSnapshot(x.period, x.tab)) { loadSnapshots(); await refreshMatrix() } }}>×</button>
                  </span>
                ))}
              </div>
            )}
              </div>
            )}
          </div>
          {isDev && (
          <SettingsRow title="Доступы" desc="Доступ к iiko, ID таблиц и ключ сервисного аккаунта.">
        <details className="rounded-lg border border-ink-700/60 bg-ink-900/30 p-3">
          <summary className={summary}>Доступ к iiko</summary>
          {status?.lastResult && (
            <div className={`mt-3 text-xs ${status.lastResult === 'ok' ? 'text-good' : 'text-bad'}`}>
              Последняя загрузка закупок: {status.lastResult === 'ok' ? 'успешно' : 'не удалась'}
              {status.lastSync ? `, ${new Date(status.lastSync).toLocaleString('ru-RU')}` : ''}
              {status.message ? <span className="mt-1 block break-words text-fg-400">{status.message.split(' — ').join('\n')}</span> : null}
            </div>
          )}
          {form.iikoLocked ? (
            <div className="mt-3 rounded-lg border border-ink-600 bg-ink-850 p-3 text-sm text-fg-300">
              Доступ к iiko задан на сервере и зафиксирован: в программе его не изменить. Чтобы сменить пользователя, нужно поменять файл .env на сервере и запустить ./deploy.sh.
            </div>
          ) : (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Адрес сервера iiko" hint="URL и порт resto API, напр. https://ваш-сервер:443" value={form.serverUrl} onChange={(v) => set({ serverUrl: v })} placeholder="https://host:443" full />
            <Field label="Логин" value={form.login} onChange={(v) => set({ login: v })} />
            <Field label="Пароль" type="password" value={form.password} onChange={(v) => set({ password: v })} placeholder="•••••••• (не менять — оставьте пустым)" />
          </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={test} disabled={testing} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
              <IPlug width={16} height={16} /> {testing ? 'Сохраняю и проверяю…' : 'Сохранить и проверить'}
            </button>
            {checkChip(testResult)}
          </div>
        </details>
        <details>
          <summary className={summary}>Доступ к таблицам</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Таблица Алматы — ссылка или ID" hint="Можно вставить прямо ссылку из адресной строки — ID вытащится сам" value={form.googleSheetId} onChange={(v) => set({ googleSheetId: extractSheetId(v) })} placeholder="https://docs.google.com/spreadsheets/d/…/edit" full />
            <Field label="Таблица Астаны — ссылка или ID" hint="Отдельная таблица для точек Астаны. Сервисный аккаунт должен быть приглашён читателем и в неё." value={form.astanaSheetId} onChange={(v) => set({ astanaSheetId: extractSheetId(v) })} placeholder="https://docs.google.com/spreadsheets/d/…/edit" full />
            <div className="col-span-2">
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-400">
                Ключ сервисного аккаунта (JSON)
                <InfoTip text="Весь файл, который скачали в Google Cloud Console → Service Accounts → Keys → Add Key → JSON. Хранится только на сервере, один на обе таблицы." />
              </label>
              <textarea rows={3} value={form.googleServiceAccountKey} onChange={(e) => set({ googleServiceAccountKey: e.target.value })}
                placeholder='{"type": "service_account", …} (не менять — оставьте пустым, если ключ уже сохранён)'
                className="w-full rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2 font-mono text-xs text-fg-100 placeholder:text-fg-600 focus:border-brand-500 focus:outline-none" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={testMatrix} disabled={matrixTesting || astanaTesting} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
              <IPlug width={16} height={16} /> {matrixTesting || astanaTesting ? 'Сохраняю и проверяю…' : 'Сохранить и проверить'}
            </button>
            {checkChip(matrixTestResult && { ...matrixTestResult, message: 'Алматы: ' + matrixTestResult.message })}
            {checkChip(astanaTestResult && { ...astanaTestResult, message: 'Астана: ' + astanaTestResult.message })}
          </div>
        </details>
          </SettingsRow>
          )}
        </div>
      </div>
      </>)}
      {isDev && section === 'venues' && (<>
      {/* venues */}
      <Section title="Точки сети" subtitle="Точки приходят из iiko вместе с закупками: найдите нужную в списке «Обнаружены в закупках» и нажмите «Добавить». Дальше в Справочниках → Точки выберите для неё вкладку матрицы (матрица читает все вкладки таблицы сама) и, при желании, своё название — после этого закупки и план тянутся по этой вкладке, без правки кода.">
        <div className="text-sm text-fg-400">Сейчас включено: <span className="text-fg-200">{venues.enabled.length}</span> точек</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {venues.enabled.map((name) => (
            <span key={name} title={storesHint(name) ? `${name} — склады iiko: ${storesHint(name)}` : name} className="chip border-ink-600 bg-ink-800/60 text-fg-300">
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
            <div className="mb-2 flex flex-wrap items-center gap-3 text-xs font-medium text-fg-400">Обнаружены в закупках, но пока не показаны:
              <button disabled={addingVenue === '*'} onClick={async () => { setAddingVenue('*'); try { for (const n of [...venues.discovered]) await enableVenueByName(n) } finally { setAddingVenue(null) } }}
                className="chip border-brand-500/40 bg-brand-500/10 text-brand-300 hover:bg-brand-500/20 disabled:opacity-60">{addingVenue === '*' ? 'Добавляю…' : `Добавить все (${venues.discovered.length})`}</button>
            </div>
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

      </>)}
      {isDev && section === 'auto' && (<>
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

      </>)}
      {isDev && section === 'backup' && (<>
      {/* резервная копия */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <div className="text-sm font-semibold text-fg-50">Резервная копия</div>
          <div className="text-xs text-fg-500">Всё, что есть в программе, одним файлом restore.tar: закупки, матрицы и цены по периодам, точки, настройки, связи и заметки, доступы к iiko и Google, пользователи. Одной кнопкой ниже («Восстановить всё из копии») всё возвращается разом. В файле пароли и ключи — не отправляйте его посторонним.</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => downloadBackup(true)} disabled={exporting} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
            <ISync width={16} height={16} className={exporting ? 'animate-spin' : ''} /> {exporting ? 'Готовлю файл…' : 'Скачать бэкап'}
          </button>
          <button onClick={() => downloadBackup(false)} disabled={exporting} title="Те же данные, но без паролей, ключей и пользователей — такой файл можно отправлять разработчику" className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
            Скачать копию без паролей
          </button>
          {exportResult && (
            <span className={`chip ${exportResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
              {exportResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}
              {exportResult.ok ? 'Скачано' : exportResult.message}
            </span>
          )}
        </div>
      </div>
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="max-w-xl">
          <div className="text-sm font-semibold text-fg-50">Восстановить всё из копии</div>
          <div className="text-xs text-fg-500">Выберите ранее скачанный restore.tar — вернётся всё разом: закупки, матрицы и цены по периодам, точки, настройки, связи и заметки, доступы к iiko и Google-таблице, пользователи. Нынешние пользователи и пароли входа не меняются, из копии добавляются только недостающие. Если копия «без паролей», нынешние доступы остаются.</div>
        </div>
        <label className={`btn cursor-pointer border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 ${fullBusy ? 'pointer-events-none opacity-60' : ''}`}>
          <ISync width={16} height={16} className={fullBusy === 'restore' ? 'animate-spin' : ''} /> {fullBusy === 'restore' ? 'Восстанавливаю…' : 'Восстановить всё из копии'}
          <input type="file" accept=".tar,.tgz,.gz,application/x-tar" className="hidden" onChange={(e) => { restoreEverything(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>
      <div className="card flex flex-wrap items-center justify-between gap-4 border-bad/30 p-5">
        <div className="max-w-xl">
          <div className="text-sm font-semibold text-fg-50">Стереть всё, кроме подключения</div>
          <div className="text-xs text-fg-500">Удаляет закупки, матрицы, цены, точки, связи, заметки и настройки. Остаются только доступы к iiko и Google-таблице. Перед стиранием сервер сохраняет копию у себя; файл для себя скачайте заранее кнопкой «Скачать бэкап» — по нему всё возвращается кнопкой выше.</div>
        </div>
        <button onClick={wipeEverything} disabled={!!fullBusy} className="btn border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20 disabled:opacity-60">
          <ITrash width={16} height={16} /> {fullBusy === 'wipe' ? 'Стираю…' : 'Стереть всё, кроме подключения'}
        </button>
      </div>
      {fullResult && (
        <span className={`chip ${fullResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
          {fullResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}{fullResult.message}
        </span>
      )}
      </>)}
      </div>
    </div>
  )
}

/** Строка настроек: слева название и пояснение, справа панель (как в настройках приложений). */
function SettingsRow({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="grid gap-4 border-t border-ink-700/60 py-6 first:border-t-0 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-8">
      <div>
        <h3 className="text-[15px] font-semibold text-fg-50">{title}</h3>
        {desc && <p className="mt-1 text-[13px] leading-snug text-fg-500">{desc}</p>}
      </div>
      <div className="min-w-0 space-y-3 rounded-2xl border border-ink-600/70 bg-ink-850 p-4">{children}</div>
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
