import { useEffect, useState } from 'react'
import { useEdits } from '../lib/edits'
import { MATRIX_SNAPSHOTS } from '../lib/features'
import { fetchSettings, saveSettings, testConnection, fetchMatrixSnapshots, testMatrixConnection, syncMatrix, fetchFullExport, IikoSettings as Settings } from '../lib/api'
import { Section, InfoTip, Checkbox } from '../components/ui'
import { ISync, IPlug, ICheck, IClose, IStore, IPlus, IChevron, ITrash } from '../components/icons'

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
  const { backendOnline, status, syncing, refresh, syncHistoricalPeriod, reloadStatus, venues, enableVenueByName, disableVenueByName, refreshMatrix, periodKey, restaurants } = useEdits()
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
  // Месяц, ЗА КОТОРЫЙ фиксируем цены матрицы (снимок; функция выключена — см. features.ts)
  const [matrixPeriod, setMatrixPeriod] = useState('')
  const [matrixPeriodTouched, setMatrixPeriodTouched] = useState(false)
  useEffect(() => { if (!matrixPeriodTouched && periodKey) setMatrixPeriod(periodKey) }, [periodKey, matrixPeriodTouched])
  const nextMonth = (() => { const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth() + 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()
  const [snapshots, setSnapshots] = useState<{ period: string; periodLabel: string }[]>([])
  const loadSnapshots = () => { if (!MATRIX_SNAPSHOTS) return; fetchMatrixSnapshots().then((r) => r && setSnapshots(r.periods)) }
  useEffect(() => { if (MATRIX_SNAPSHOTS) loadSnapshots() }, [])
  type SyncRes = { ok: boolean; message?: string; period?: string | null; conflicts?: string[]; catalogOverlay?: boolean; catalogUnmatched?: number; catalogRows?: number }
  const [matrixSyncResult, setMatrixSyncResult] = useState<SyncRes | null>(null)
  // Астана — отдельная таблица, свои test/sync, тот же сервисный аккаунт.
  // Название склада так, как его прислал iiko (из загруженных закупок); пока для точки нет — показываем её название
  const iikoName = (name: string) => restaurants.find((r) => r.name === name)?.stores?.join('; ') || name
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
    const r = await saveSettings(form)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
  }
  const test = async () => {
    if (!form) return
    setTesting(true); setTestResult(null)
    // «Проверить» = «Сохранить и проверить»: введённое не пропадает, если уйти со страницы
    const r = await saveSettings(form)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
    setTestResult(await testConnection(form))
    setTesting(false)
  }
  const testMatrix = async () => {
    if (!form) return
    setMatrixTesting(true); setMatrixTestResult(null); setAstanaTesting(true); setAstanaTestResult(null)
    const r = await saveSettings(form)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
    setMatrixTestResult(await testMatrixConnection(form))
    setMatrixTesting(false)
    setAstanaTestResult(await testMatrixConnection(form, 'astana'))
    setAstanaTesting(false)
  }
  const doSyncMatrix = async () => {
    if (!form) return
    setMatrixSyncing(true); setMatrixSyncResult(null)
    // Сохраняем перед синком: иначе синк ушёл бы со старым ID/ключом, а не с только что вписанным
    const r0 = await saveSettings(form)
    if (r0) { setForm(r0); setSaved(true); reloadStatus() }
    const r = await syncMatrix(undefined, MATRIX_SNAPSHOTS ? matrixPeriod || undefined : undefined)
    setMatrixSyncResult(r)
    if (r.ok) { await refreshMatrix(); loadSnapshots() }
    setMatrixSyncing(false)
  }
  const doSyncAstana = async () => {
    if (!form) return
    setAstanaSyncing(true); setAstanaSyncResult(null)
    const r0 = await saveSettings(form)
    if (r0) { setForm(r0); setSaved(true); reloadStatus() }
    const r = await syncMatrix('astana', MATRIX_SNAPSHOTS ? matrixPeriod || undefined : undefined)
    setAstanaSyncResult(r)
    if (r.ok) { await refreshMatrix(); loadSnapshots() }
    setAstanaSyncing(false)
  }

  // Резервная копия: ВСЁ, что есть в программе (закупки, матрицы, связи, пользователи, доступы к iiko и Google), одним файлом
  // restore.tar. Его кладут рядом с установленной программой — она сама разворачивает данные при первом запуске.
  const downloadBackup = async () => {
    setExporting(true); setExportResult(null)
    const r = await fetchFullExport()
    setExporting(false)
    if (!r.ok) { setExportResult(r); return }
    const url = URL.createObjectURL(r.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'restore.tar'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    setExportResult({ ok: true })
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

  const summary = 'cursor-pointer select-none text-sm font-medium text-fg-300 hover:text-fg-100'
  const checkChip = (r: { ok: boolean; message: string } | null) => r && (
    <span className={`chip ${r.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
      {r.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}{r.message}
    </span>
  )

  return (
    <div className="space-y-5">
      {/* iiko: загрузка закупок — одна зона */}
      <div className="card space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className={`grid h-11 w-11 place-items-center rounded-xl ${status?.lastResult === 'error' ? 'bg-bad/10 text-bad' : 'bg-good/10 text-good'}`}><ISync width={20} height={20} /></span>
            <div>
              <div className="text-sm font-semibold text-fg-50">Данные из iiko</div>
              <div className="text-xs text-fg-500">
                Обновлено: <span className="text-fg-300">{ago(status?.lastSync ?? null)}</span>
                {status?.positions ? <> · {status.positions} позиций</> : null}
                {status?.lastResult === 'error' && <span className="text-bad"> · ошибка: {status.message}</span>}
              </div>
            </div>
          </div>
          <button
            onClick={async () => {
              // Сохраняем форму перед загрузкой: иначе уйдёт со старыми, уже сохранёнными настройками
              if (form) { const r = await saveSettings(form); if (r) { setForm(r); setSaved(true) } }
              await refresh()
            }}
            disabled={syncing}
            className="btn bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60"
          >
            <ISync width={16} height={16} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Загружаю…' : 'Загрузить текущий месяц'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-ink-700/60 pt-4">
          <div className="text-sm text-fg-300">Загрузить за другой месяц</div>
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
            <ISync width={16} height={16} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Загружаю…' : 'Загрузить'}
          </button>
          {historicalResult && (
            <span className={`chip ${historicalResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
              {historicalResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}
              {historicalResult.ok ? 'Загружено — переключил на этот месяц' : historicalResult.message}
            </span>
          )}
        </div>

        <details className="rounded-lg border border-ink-700/60 bg-ink-900/30 p-3">
          <summary className={summary}>Доступ к iiko</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Адрес сервера iiko" hint="URL и порт resto API, напр. https://ваш-сервер:443" value={form.serverUrl} onChange={(v) => set({ serverUrl: v })} placeholder="https://host:443" full />
            <Field label="Логин" value={form.login} onChange={(v) => set({ login: v })} />
            <Field label="Пароль" type="password" value={form.password} onChange={(v) => set({ password: v })} placeholder="•••••••• (не менять — оставьте пустым)" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={test} disabled={testing} className="btn border border-ink-600 bg-ink-800/70 text-fg-200 hover:bg-ink-750 disabled:opacity-60">
              <IPlug width={16} height={16} /> {testing ? 'Сохраняю и проверяю…' : 'Сохранить и проверить'}
            </button>
            {checkChip(testResult)}
          </div>
        </details>
      </div>

      {/* матрица (план-цены из Google-таблицы) — только обновление, доступы спрятаны */}
      <div className="card space-y-4 p-5">
        <div>
          <div className="text-sm font-semibold text-fg-50">Матрица — план-цены из Google-таблицы</div>
          <div className="text-xs text-fg-500">Нажмите «Обновить», чтобы подтянуть свежие цены и названия из таблицы.</div>
        </div>
        {MATRIX_SNAPSHOTS && (
          <label className="flex items-center gap-2 text-xs text-fg-400">
            Цены за месяц
            <input type="month" value={matrixPeriod} max={nextMonth}
              onChange={(e) => { setMatrixPeriod(e.target.value); setMatrixPeriodTouched(true) }}
              className="rounded-lg border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-fg-100 focus:border-brand-500 focus:outline-none" />
            {snapshots.length > 0 && <span className="chip border-ink-600 bg-ink-800/60 text-fg-400">Зафиксировано: {snapshots.map((x) => x.periodLabel).join(', ')}</span>}
          </label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-16 text-sm text-fg-300">Алматы</span>
          <button onClick={doSyncMatrix} disabled={matrixSyncing || (MATRIX_SNAPSHOTS && !matrixPeriod)} className="btn bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60">
            <ISync width={16} height={16} className={matrixSyncing ? 'animate-spin' : ''} /> {matrixSyncing ? 'Читаю таблицу…' : 'Обновить'}
          </button>
          {matrixSyncResult && (
              <span className={`chip ${matrixSyncResult.ok && matrixSyncResult.conflicts?.length ? 'border-warn/40 bg-warn/10 text-warn' : matrixSyncResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
                {matrixSyncResult.ok && !matrixSyncResult.conflicts?.length ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}
                {matrixSyncResult.ok ? (matrixSyncResult.period ? `Цены зафиксированы за ${matrixSyncResult.period}` : 'Обновлено') + (matrixSyncResult.conflicts?.length ? ` · пропущены вкладки с занятым названием: ${matrixSyncResult.conflicts.join(', ')} — переименуйте в таблице` : '') : matrixSyncResult.message}
              </span>
            )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-16 text-sm text-fg-300">Астана</span>
          <button onClick={doSyncAstana} disabled={astanaSyncing || (MATRIX_SNAPSHOTS && !matrixPeriod)} className="btn bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60">
            <ISync width={16} height={16} className={astanaSyncing ? 'animate-spin' : ''} /> {astanaSyncing ? 'Читаю таблицу…' : 'Обновить'}
          </button>
          {astanaSyncResult && (
              <span className={`chip ${astanaSyncResult.ok && astanaSyncResult.conflicts?.length ? 'border-warn/40 bg-warn/10 text-warn' : astanaSyncResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
                {astanaSyncResult.ok && !astanaSyncResult.conflicts?.length ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}
                {astanaSyncResult.ok ? (astanaSyncResult.period ? `Цены зафиксированы за ${astanaSyncResult.period}` : 'Обновлено') + (astanaSyncResult.conflicts?.length ? ` · пропущены вкладки с занятым названием: ${astanaSyncResult.conflicts.join(', ')} — переименуйте в таблице` : '') : astanaSyncResult.message}
              </span>
            )}
        </div>
        <details className="rounded-lg border border-ink-700/60 bg-ink-900/30 p-3">
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
      </div>

      {/* venues */}
      <Section title="Точки сети" subtitle="Точки приходят из iiko вместе с закупками: найдите нужную в списке «Обнаружены в закупках» и нажмите «Добавить». Дальше в Справочниках → Точки выберите для неё вкладку матрицы (матрица читает все вкладки таблицы сама) и, при желании, своё название — после этого закупки и план тянутся по этой вкладке, без правки кода.">
        <div className="text-sm text-fg-400">Сейчас включено: <span className="text-fg-200">{venues.enabled.length}</span> точек</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {venues.enabled.map((name) => (
            <span key={name} title={name} className="chip border-ink-600 bg-ink-800/60 text-fg-300">
              <IStore width={13} height={13} />{iikoName(name)}
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

      {/* резервная копия */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <div className="text-sm font-semibold text-fg-50">Резервная копия</div>
          <div className="text-xs text-fg-500">Всё, что есть в программе, одним файлом restore.tar: закупки, матрицы, связи, пользователи и доступы. В файле пароли и ключи — не отправляйте его посторонним.</div>
        </div>
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
        </div>
      </div>
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
