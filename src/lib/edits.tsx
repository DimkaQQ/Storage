import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react'
import { BUNDLED, BUNDLED_PERIODS, bundledDataset, bundledMatching, MatchingTable, EMPTY_MATCHING, Edits, EMPTY_EDITS, Parsed, Row, RowColor, SupplierAgg, ProductAgg, VenueMeta, VenuePatch, PackAlias, ProductLink, SupplierAliasOverride, computeRows, parseDataset, applyVenueOverrides, withNewVenues, DEFAULT_RESTAURANT_SCOPE, setRestaurantScope } from './data'
import { fetchDataset, fetchPeriods, fetchStatus, fetchEdits, saveEdits, applyEditOp, triggerSync, fetchVenues, enableVenue, disableVenue, fetchMatching, Venues, SyncStatus, PeriodMeta } from './api'

const KEY = 'pricecheck-edits-v2'
// Локальный флаг устройства (не серверный) — «тестовый режим без матрицы».
// Специально не в edits/на сервере: это не правка данных, а просто способ
// временно посмотреть на интерфейс так, будто матрицу ещё не загружали.
const NO_MATRIX_KEY = 'pricecheck-no-matrix-test'

function normalize(p: any): Edits {
  return {
    productRenames: p?.productRenames ?? {},
    supplierRenames: p?.supplierRenames ?? {},
    acknowledgedSuppliers: p?.acknowledgedSuppliers ?? {},
    productPackOverride: p?.productPackOverride ?? {},
    packAliases: p?.packAliases ?? {},
    productLinks: p?.productLinks ?? {},
    planOverrides: p?.planOverrides ?? {},
    venueOverrides: p?.venueOverrides ?? {},
    newVenues: p?.newVenues ?? {},
    rowComments: p?.rowComments ?? {},
    rowColors: p?.rowColors ?? {},
    supplierAliasOverrides: p?.supplierAliasOverrides ?? {},
  }
}

function load(): Edits {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? normalize(JSON.parse(raw)) : EMPTY_EDITS
  } catch {
    return EMPTY_EDITS
  }
}

/**
 * Локальный кэш правок (localStorage) специально не привязан к организации —
 * это просто offline-first слепок того, что уже подтверждено сервером,
 * чтобы не мигать пустым экраном при перезагрузке. Но именно поэтому его
 * обязательно чистить при выходе: EditsProvider монтируется заново при
 * каждом входе (см. AppRoot — он живёт только пока есть user), и без этого
 * на общем компьютере смена аккаунта на ДРУГУЮ организацию первое время (а
 * если запрос /api/edits не пройдёт — то и постоянно) показывала бы чужие
 * переименования/плановые цены из прошлой сессии поверх данных новой
 * организации. Вызывается из auth.tsx при logout.
 */
export function clearLocalEditsCache() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

function diffKeys<T>(current: Record<string, T>, target: Record<string, T>): string[] {
  return [...new Set([...Object.keys(current), ...Object.keys(target)])].filter(
    (k) => JSON.stringify(current[k]) !== JSON.stringify(target[k]),
  )
}

/**
 * Undo reverts local state instantly, but the server only knows individual
 * operations (no whole-blob overwrite) — so undo has to be pushed back to
 * the server the same way: as the specific corrective ops for whatever
 * categories actually changed between `current` and `target`.
 */
/**
 * Возвращает true, только если реально ВСЕ операции подтвердились сервером —
 * раньше результат applyEditOp тут просто не читался: если бэкенд отклонял
 * или сеть рвалась, undo откатывал локальное состояние (и localStorage), а
 * сервер остался бы с прежними значениями молча, без единого признака для
 * пользователя, что "отменённое" на самом деле не отменилось на сервере.
 */
async function syncUndoToServer(current: Edits, target: Edits): Promise<boolean> {
  const results: Promise<boolean>[] = []
  for (const k of diffKeys(current.productRenames, target.productRenames))
    results.push(applyEditOp('renameProduct', { original: k, name: target.productRenames[k] ?? '' }))
  for (const k of diffKeys(current.supplierRenames, target.supplierRenames))
    results.push(applyEditOp('renameSupplier', { original: k, name: target.supplierRenames[k] ?? '' }))
  for (const k of diffKeys(current.venueOverrides, target.venueOverrides)) {
    results.push(applyEditOp('clearVenue', { restaurant: k }))
    if (target.venueOverrides[k]) results.push(applyEditOp('setVenue', { restaurant: k, patch: target.venueOverrides[k] }))
  }
  for (const k of diffKeys(current.newVenues, target.newVenues))
    results.push(applyEditOp(target.newVenues[k] ? 'addVenue' : 'removeVenue', { name: k }))
  for (const k of diffKeys(current.acknowledgedSuppliers, target.acknowledgedSuppliers))
    results.push(applyEditOp(target.acknowledgedSuppliers[k] ? 'acknowledgeSupplier' : 'unacknowledgeSupplier', { rawName: k }))
  for (const k of diffKeys(current.productPackOverride, target.productPackOverride))
    results.push(applyEditOp('setProductPackOverride', { product: k, value: target.productPackOverride[k] ?? null }))
  for (const k of diffKeys(current.packAliases, target.packAliases))
    results.push(applyEditOp('setPackAlias', { key: k, value: target.packAliases[k] ?? null }))
  for (const k of diffKeys(current.productLinks, target.productLinks))
    results.push(applyEditOp('setProductLink', { key: k, value: target.productLinks[k] ?? null }))
  for (const k of diffKeys(current.planOverrides, target.planOverrides))
    results.push(applyEditOp('setPlanOverride', { key: k, value: target.planOverrides[k] ?? null }))
  for (const k of diffKeys(current.rowComments, target.rowComments))
    results.push(applyEditOp('setRowComment', { key: k, value: target.rowComments[k] ?? null }))
  for (const k of diffKeys(current.rowColors, target.rowColors))
    results.push(applyEditOp('setRowColor', { key: k, value: target.rowColors[k] ?? null }))
  for (const k of diffKeys(current.supplierAliasOverrides, target.supplierAliasOverrides))
    results.push(applyEditOp('setSupplierAliasOverride', { key: k, value: target.supplierAliasOverrides[k] ?? null }))
  const oks = await Promise.all(results)
  return oks.every(Boolean)
}

interface Ctx {
  edits: Edits
  rows: Row[]
  editCount: number
  // dataset (bundled fallback → replaced by backend data when available)
  period: string
  periodKey: string
  periods: PeriodMeta[]
  setPeriod: (period: string) => void
  matching: MatchingTable
  // Матрица не привязана к периоду (план-цены сами по себе не "за такой-то
  // месяц", таблица живая) — true, только если с Google-таблицы вообще
  // ничего ни разу не синкали, и приложение показывает вшитую демо-матрицу.
  matchingIsStale: boolean
  city: string
  category: string
  restaurants: VenueMeta[]
  suppliers: SupplierAgg[]
  products: ProductAgg[]
  // backend sync
  backendOnline: boolean
  status: SyncStatus | null
  syncing: boolean
  refresh: () => Promise<void>
  syncHistoricalPeriod: (period: string) => Promise<{ ok: boolean; message?: string }>
  reloadStatus: () => Promise<void>
  // точки сети — какие сейчас включены/показаны, и какие видны в закупках,
  // но пока не включены (Настройки iiko → «Точки сети»)
  venues: Venues
  enableVenueByName: (name: string) => Promise<void>
  disableVenueByName: (name: string) => Promise<void>
  refreshMatrix: () => Promise<void>
  // edits
  renameProduct: (key: string, name: string) => void  // key = "товар::поставщик::фасовка" (raw, как в iiko)
  renameSupplier: (rawName: string, name: string) => void
  setVenue: (restaurant: string, patch: VenuePatch) => void
  addVenue: (name: string, patch?: VenuePatch) => void
  removeVenue: (name: string) => void
  acknowledgeSupplier: (rawName: string) => void
  unacknowledgeSupplier: (rawName: string) => void
  setProductPackOverride: (product: string, value: boolean | null) => void
  setPackAlias: (key: string, value: PackAlias | null) => void
  setProductLink: (key: string, value: ProductLink | null) => void
  setPlanOverride: (key: string, value: number | null) => void
  setRowComment: (key: string, value: string | null) => void
  setRowColor: (key: string, value: RowColor | null) => void
  setSupplierAliasOverride: (key: string, value: SupplierAliasOverride | null) => void
  reset: () => void
  replaceAll: (e: Edits) => void
  undo: () => void
  canUndo: boolean
  // тестовый режим «без матрицы» — только на этом устройстве, не на сервере
  noMatrixTest: boolean
  setNoMatrixTest: (v: boolean) => void
  // не null — последняя правка не подтвердилась сервером (см. reportOpResult)
  saveError: string | null
}

const EditsContext = createContext<Ctx | null>(null)

export function EditsProvider({ children }: { children: ReactNode }) {
  const [edits, setEdits] = useState<Edits>(load)
  const [parsed, setParsed] = useState<Parsed>(BUNDLED)
  const [periodKey, setPeriodKey] = useState<string>(BUNDLED_PERIODS[BUNDLED_PERIODS.length - 1].period)
  // enableVenueByName ниже ждёт ответ сервера (await), и если пользователь
  // успеет переключить период за это время, обычный захват periodKey по
  // замыканию в useCallback перезагрузил бы данные УЖЕ СТАРОГО периода поверх
  // только что выбранного нового — ref всегда отражает текущий period на
  // момент, когда await действительно завершился, а не на момент клика.
  const periodKeyRef = useRef(periodKey)
  useEffect(() => { periodKeyRef.current = periodKey }, [periodKey])
  const [periods, setPeriods] = useState<PeriodMeta[]>(BUNDLED_PERIODS)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [backendOnline, setBackendOnline] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [venues, setVenuesState] = useState<Venues>({ enabled: DEFAULT_RESTAURANT_SCOPE, discovered: [] })
  // Матрица (план-цены) — читается из Google-таблицы через бэкенд (см.
  // sheets.js), отдельно от закупок. null = для этого периода ещё не
  // синхронизировали — тогда matching ниже падает на вшитую bundledMatching.
  const [backendMatching, setBackendMatching] = useState<MatchingTable | null>(null)
  const history = useRef<Edits[]>([])
  const [canUndo, setCanUndo] = useState(false)
  // applyEditOp() раньше вызывался fire-and-forget — если бэкенд отклонял
  // операцию или сеть рвалась, правка оставалась только в localStorage
  // (выглядела сохранённой на этом устройстве), а на сервере и у других
  // пользователей/устройств её не было, без единого сигнала об этом.
  // saveError показывает баннер (см. App.tsx), пока не пройдёт следующая
  // операция того же рода — целиться в конкретную неудавшуюся правку не
  // пытаемся, достаточно "что-то не сохранилось, проверьте соединение".
  const [saveError, setSaveError] = useState<string | null>(null)
  const reportOpResult = useCallback((ok: boolean) => {
    setSaveError(ok ? null : 'Не удалось сохранить изменение на сервере — проверьте соединение. Локально оно применилось, но может потеряться на другом устройстве.')
  }, [])
  const [noMatrixTest, setNoMatrixTestState] = useState<boolean>(() => {
    try { return localStorage.getItem(NO_MATRIX_KEY) === '1' } catch { return false }
  })
  const setNoMatrixTest = useCallback((v: boolean) => {
    setNoMatrixTestState(v)
    try { localStorage.setItem(NO_MATRIX_KEY, v ? '1' : '0') } catch { /* ignore */ }
  }, [])

  // Every mutation goes through here instead of setEdits directly, so each
  // committed change (not every keystroke — inputs only call onCommit on
  // blur/Enter) pushes the prior state onto a small undo stack.
  const updateEdits = useCallback((updater: (e: Edits) => Edits) => {
    setEdits((e) => {
      const next = updater(e)
      if (JSON.stringify(next) !== JSON.stringify(e)) {
        history.current = [...history.current.slice(-49), e]
        setCanUndo(true)
      }
      return next
    })
  }, [])

  const undo = useCallback(() => {
    const hist = history.current
    if (hist.length === 0) return
    const prev = hist[hist.length - 1]
    history.current = hist.slice(0, -1)
    setCanUndo(history.current.length > 0)
    setEdits((current) => { syncUndoToServer(current, prev).then(reportOpResult); return prev })
  }, [reportOpResult])

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(edits)) } catch { /* ignore quota */ }
  }, [edits])

  const loadData = useCallback(async (period: string) => {
    const data = await fetchDataset(period)
    if (data && data.restaurants) { setParsed(parseDataset(data)); setBackendOnline(true) }
    else setParsed(parseDataset(bundledDataset(period)))
  }, [])
  const loadPeriods = useCallback(async () => {
    const list = await fetchPeriods()
    if (list && list.length) { setPeriods(list); setBackendOnline(true) }
    return list
  }, [])
  const reloadStatus = useCallback(async () => {
    const st = await fetchStatus()
    if (st) { setStatus(st); setBackendOnline(true) }
  }, [])
  // /api/sync теперь отвечает сразу, не дожидаясь реального синка (см.
  // комментарий у маршрута в index.js) — реальный ход/результат добираем
  // отсюда опросом /api/status, пока backend-флаг syncing не сбросится.
  // 2с * 90 — около 3 минут, этого достаточно даже полному месяцу у живого
  // iikoServer (внутренний таймаут там 60с на сам отчёт плюс авторизация).
  // null здесь — НЕ "синк завершился без результата", а "за ~3 минуты так и
  // не увидели, что синк закончился" (сам синк может быть жив и дотянуть
  // чуть позже — вызывающая сторона должна считать это неопределённостью,
  // не провалом, и не путать с содержимым st.lastResult от СОВСЕМ другого,
  // более раннего синка).
  const pollUntilSyncDone = useCallback(async (): Promise<SyncStatus | null> => {
    for (let i = 0; i < 90; i++) {
      const st = await fetchStatus()
      // st === null — разовый сетевой сбой (не "синк закончился") — раньше
      // это обрывало весь опрос и ложно трактовалось как готовый результат.
      // Пробуем ещё раз, не бросая всю трёхминутную попытку из-за одной
      // короткой заминки сети/прокси.
      if (st) {
        setStatus(st); setBackendOnline(true)
        if (!st.syncing) return st
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    return null
  }, [])
  const loadEdits = useCallback(async () => {
    const data = await fetchEdits()
    if (data) { setEdits(normalize(data)); setBackendOnline(true) }
  }, [])
  // Список включённых точек живёт на бэкенде (per-org), а не в коде — см.
  // DEFAULT_RESTAURANT_SCOPE/setRestaurantScope в lib/data.ts. Без бэкенда
  // (демо/офлайн) остаётся дефолтный список как есть, ничего не меняем.
  const loadVenues = useCallback(async () => {
    const v = await fetchVenues()
    if (v) { setRestaurantScope(v.enabled); setVenuesState(v); setBackendOnline(true) }
  }, [])
  // Матрица — свой источник, свой фетч, не завязан на loadData (закупки) и
  // не привязан к периоду (план-цены сами по себе не "за такой-то месяц").
  // null у fetchMatching означает "ещё нет синка с таблицей вообще" — это
  // НЕ ошибка бэкенда, поэтому backendOnline не трогаем.
  const loadMatching = useCallback(async () => {
    const m = await fetchMatching()
    setBackendMatching(m && m.planPairs ? (m as MatchingTable) : null)
  }, [])

  // On mount: pull the list of available periods + status + shared
  // corrections from the backend (if present), then the latest period's
  // data — defaults to the newest available period, same as before periods existed.
  // Точки грузим/применяем ДО периодов и данных — иначе parseDataset уже
  // отработает по дефолтному списку точек, и придётся ждать следующего
  // обновления, чтобы увидеть реальный (сохранённый на сервере) список.
  useEffect(() => {
    reloadStatus()
    loadEdits()
    loadVenues().then(() => {
      loadPeriods().then((list) => {
        const initial = (list && list.length ? list[list.length - 1].period : null) ?? periodKey
        setPeriodKey(initial)
        loadData(initial)
      })
    })
    loadMatching()
  }, [])

  // Пересинхронизировать матрицу вручную (кнопка в Настройки iiko, после
  // «Обновить сейчас» самой Google-таблицы) — просто перечитывает уже
  // сохранённую бэкендом (единую, без периода) матрицу.
  const refreshMatrix = useCallback(() => loadMatching(), [loadMatching])

  // Кнопка «Добавить» у обнаруженной, но пока не включённой точки
  // (Настройки iiko → «Точки сети»). Точка уже есть в данных (iiko прислал
  // закупки под этим Store, backend ничего не фильтрует) — включить это
  // просто снять фильтр по имени и пересчитать текущий период.
  const enableVenueByName = useCallback(async (name: string) => {
    const v = await enableVenue(name)
    if (!v) return
    setRestaurantScope(v.enabled)
    setVenuesState(v)
    await loadData(periodKeyRef.current)
  }, [loadData])

  // Обратное к enableVenueByName — для точек, которые когда-то включили
  // (обычно самим стартовым DEFAULT_ENABLED_RESTAURANTS), а потом оказалось,
  // что они закрыты/не нужны вообще (как French bar/Камчатка).
  const disableVenueByName = useCallback(async (name: string) => {
    const v = await disableVenue(name)
    if (!v) return
    setRestaurantScope(v.enabled)
    setVenuesState(v)
    await loadData(periodKeyRef.current)
  }, [loadData])

  const setPeriod = useCallback((period: string) => {
    setPeriodKey(period)
    loadData(period)
  }, [loadData])

  // «Обновление» держит текущий выбранный период — просто пересобирает то,
  // на что уже смотрит пользователь, плюс подтягивает список периодов
  // заново (вдруг появился новый), и список точек (вдруг синк принёс
  // закупки из точки, которой раньше не было).
  const refresh = useCallback(async () => {
    setSyncing(true)
    try {
      const started = await triggerSync()
      // started.ok === false здесь значит запрос даже не принят (не тот
      // формат периода, или синк уже идёт) — реального синка не было, ждать
      // нечего. started.ok === true — сервер только ПРИНЯЛ запуск (см.
      // комментарий у /api/sync в index.js), реальный результат добираем
      // опросом статуса.
      if (started.ok) await pollUntilSyncDone()
      else await reloadStatus()
      await loadVenues(); await loadPeriods(); await loadData(periodKey)
    } finally { setSyncing(false) }
  }, [loadData, loadPeriods, loadVenues, pollUntilSyncDone, reloadStatus, periodKey])

  // Догрузить конкретный прошлый месяц ("YYYY-MM"), а не current/prev-month
  // из настроек — Настройки iiko → «Загрузить другой период». Сразу
  // переключаемся на него, иначе непонятно, что синк вообще что-то принёс.
  const syncHistoricalPeriod = useCallback(async (period: string): Promise<{ ok: boolean; message?: string }> => {
    setSyncing(true)
    try {
      const started = await triggerSync(period)
      if (!started.ok) { await reloadStatus(); return started }
      const final = await pollUntilSyncDone()
      await loadVenues(); await loadPeriods()
      // final === null — не "провалился", а "не дождались за ~3 минуты": сам
      // синк мог остаться в работе. Не выдаём это за успех и не выдаём за
      // явную ошибку — честно говорим, что результат пока не известен,
      // вместо того чтобы молча показать чей-то более ранний lastResult.
      if (final === null) return { ok: false, message: 'Загрузка идёт дольше обычного — результат появится в «Обновление» чуть позже, попробуйте проверить там.' }
      if (final.lastResult === 'ok') { setPeriod(period); return { ok: true, message: final.message } }
      return { ok: false, message: final.message ?? 'Не удалось загрузить период' }
    } finally { setSyncing(false) }
  }, [loadPeriods, loadVenues, pollUntilSyncDone, reloadStatus, setPeriod])

  // Матрица версионирована по периодам так же, как факты — цены реально
  // отличаются месяц к месяцу, так что план всегда должен браться из
  // матрицы ТОГО ЖЕ периода, что и просматриваемые факты. В тестовом режиме
  // (noMatrixTest) матрицу подменяем на пустую везде, где она используется —
  // «Проверка цен», Справочники и т.д. видят её через этот же matching.
  // backendMatching (синк с Google-таблицей) побеждает вшитую bundledMatching,
  // когда для этого периода она реально есть.
  const matching = useMemo(
    () => (noMatrixTest ? EMPTY_MATCHING : backendMatching ?? bundledMatching(periodKey)),
    [periodKey, noMatrixTest, backendMatching],
  )
  // Матрица не привязана к периоду — реально синканная (backendMatching)
  // всегда в ходу, какой бы период ни смотрели. "Устарела" только в одном
  // смысле: с Google-таблицей вообще ещё ни разу не синкались, и показана
  // вшитая демо-матрица вместо реальной.
  const matchingIsStale = !backendMatching
  const rows = useMemo(() => computeRows(parsed.base, edits, matching, parsed.restaurants), [parsed, edits, matching])

  // key = "товар::поставщик" (composed by the caller — DataEditor). Ставит
  // значение или удаляет запись, если очистили поле.
  const renameProduct = useCallback((key: string, name: string) => {
    const v = name.trim()
    updateEdits((e) => {
      const next = { ...e.productRenames }
      if (!v) delete next[key]
      else next[key] = v
      return { ...e, productRenames: next }
    })
    applyEditOp('renameProduct', { original: key, name: v }).then(reportOpResult)
  }, [updateEdits, reportOpResult])

  // rawName = iiko-имя поставщика как есть. Только подпись — не влияет на
  // само сопоставление с матрицей (см. supplierDisplay в computeRows).
  const renameSupplier = useCallback((rawName: string, name: string) => {
    const v = name.trim()
    updateEdits((e) => {
      const next = { ...e.supplierRenames }
      if (!v) delete next[rawName]
      else next[rawName] = v
      return { ...e, supplierRenames: next }
    })
    applyEditOp('renameSupplier', { original: rawName, name: v }).then(reportOpResult)
  }, [updateEdits, reportOpResult])

  const setVenue = useCallback((restaurant: string, patch: VenuePatch) => {
    updateEdits((e) => {
      const next = { ...e.venueOverrides }
      const merged = { ...next[restaurant], ...patch }
      const cleaned: VenuePatch = {}
      if (merged.city) cleaned.city = merged.city
      if (merged.brand) cleaned.brand = merged.brand
      if (merged.entity) cleaned.entity = merged.entity
      if (merged.category) cleaned.category = merged.category
      if (Object.keys(cleaned).length === 0) delete next[restaurant]
      else next[restaurant] = cleaned
      return { ...e, venueOverrides: next }
    })
    applyEditOp('setVenue', { restaurant, patch }).then(reportOpResult)
  }, [updateEdits, reportOpResult])

  // Ручное добавление точки, у которой ещё нет закупок в iiko.
  const addVenue = useCallback((name: string, patch?: VenuePatch) => {
    const v = name.trim()
    if (!v) return
    updateEdits((e) => {
      const newVenues = e.newVenues[v] ? e.newVenues : { ...e.newVenues, [v]: true as const }
      const venueOverrides = patch ? { ...e.venueOverrides, [v]: { ...e.venueOverrides[v], ...patch } } : e.venueOverrides
      return { ...e, newVenues, venueOverrides }
    })
    applyEditOp('addVenue', { name: v, patch: patch ?? null }).then(reportOpResult)
  }, [updateEdits, reportOpResult])
  const removeVenue = useCallback((name: string) => {
    updateEdits((e) => {
      const n = { ...e.newVenues }; delete n[name]
      const vo = { ...e.venueOverrides }; delete vo[name]
      return { ...e, newVenues: n, venueOverrides: vo }
    })
    applyEditOp('removeVenue', { name }).then(reportOpResult)
  }, [updateEdits, reportOpResult])

  // «Добавить» — отмечаем, что это реально новый поставщик (не опечатка/дубликат).
  const acknowledgeSupplier = useCallback((rawName: string) => {
    updateEdits((e) => ({ ...e, acknowledgedSuppliers: { ...e.acknowledgedSuppliers, [rawName]: true } }))
    applyEditOp('acknowledgeSupplier', { rawName }).then(reportOpResult)
  }, [updateEdits, reportOpResult])
  const unacknowledgeSupplier = useCallback((rawName: string) => {
    updateEdits((e) => { const n = { ...e.acknowledgedSuppliers }; delete n[rawName]; return { ...e, acknowledgedSuppliers: n } })
    applyEditOp('unacknowledgeSupplier', { rawName }).then(reportOpResult)
  }, [updateEdits, reportOpResult])

  // Ручной override того, важна ли фасовка для сопоставления этого товара —
  // null возвращает к автоматике (см. resolveRowPlan/isPrecisePack).
  const setProductPackOverride = useCallback((product: string, value: boolean | null) => {
    updateEdits((e) => {
      const next = { ...e.productPackOverride }
      if (value === null) delete next[product]
      else next[product] = value
      return { ...e, productPackOverride: next }
    })
    applyEditOp('setProductPackOverride', { product, value }).then(reportOpResult)
  }, [updateEdits, reportOpResult])

  // "Эта фасовка из iiko на самом деле вот эта из матрицы" — key приходит
  // готовым из resolveRowPlan (Row.packFixKey) или из списка в Справочниках.
  // null — снять правку (вернуть автоматическое сопоставление как было).
  const setPackAlias = useCallback((key: string, value: PackAlias | null) => {
    updateEdits((e) => {
      const next = { ...e.packAliases }
      if (value === null) delete next[key]
      else next[key] = value
      return { ...e, packAliases: next }
    })
    applyEditOp('setPackAlias', { key, value }).then(reportOpResult)
  }, [updateEdits, reportOpResult])

  // "Это iiko-название на самом деле вот этот товар из матрицы" — key =
  // "поставщик(канон)::iiko-название" (норм.), см. Edits.productLinks и
  // resolveRowPlan. Назначается либо со стороны строки матрицы (колонка
  // «Название из iiko»), либо со стороны непривязанной закупки (секция
  // «Нет в матрице» — «это на самом деле…») — оба пути пишут в одну и ту
  // же карту. null — снять привязку.
  const setProductLink = useCallback((key: string, value: ProductLink | null) => {
    updateEdits((e) => {
      const next = { ...e.productLinks }
      if (value === null) delete next[key]
      else next[key] = value
      return { ...e, productLinks: next }
    })
    applyEditOp('setProductLink', { key, value }).then(reportOpResult)
  }, [updateEdits, reportOpResult])

  // "Для ЭТОГО ресторана iiko-алиас X на самом деле вот этот канонический
  // поставщик" — key = "ресторан::iiko-алиас" (норм.), см.
  // Edits.supplierAliasOverrides и supplierAliasFor. null — снять правку.
  const setSupplierAliasOverride = useCallback((key: string, value: SupplierAliasOverride | null) => {
    updateEdits((e) => {
      const next = { ...e.supplierAliasOverrides }
      if (value === null) delete next[key]
      else next[key] = value
      return { ...e, supplierAliasOverrides: next }
    })
    applyEditOp('setSupplierAliasOverride', { key, value }).then(reportOpResult)
  }, [updateEdits, reportOpResult])

  // Ручная плановая цена (Справочники → Товары → «План») — key в той же
  // ключевой области, что и matching.planPairsByPack/planPairs (см.
  // resolveRowPlan). null — снять правку, вернуться к цене из матрицы.
  const setPlanOverride = useCallback((key: string, value: number | null) => {
    updateEdits((e) => {
      const next = { ...e.planOverrides }
      if (value === null) delete next[key]
      else next[key] = value
      return { ...e, planOverrides: next }
    })
    applyEditOp('setPlanOverride', { key, value }).then(reportOpResult)
  }, [updateEdits, reportOpResult])

  // Свой комментарий/цвет строки (Проверка цен) — key = buildRowKey(...) из
  // lib/data.ts, не Row.id (тот меняется от парсинга к парсингу).
  const setRowComment = useCallback((key: string, value: string | null) => {
    updateEdits((e) => {
      const next = { ...e.rowComments }
      if (value === null || value === '') delete next[key]
      else next[key] = value
      return { ...e, rowComments: next }
    })
    applyEditOp('setRowComment', { key, value }).then(reportOpResult)
  }, [updateEdits, reportOpResult])
  const setRowColor = useCallback((key: string, value: RowColor | null) => {
    updateEdits((e) => {
      const next = { ...e.rowColors }
      if (value === null) delete next[key]
      else next[key] = value
      return { ...e, rowColors: next }
    })
    applyEditOp('setRowColor', { key, value }).then(reportOpResult)
  }, [updateEdits, reportOpResult])

  const reset = useCallback(() => {
    updateEdits(() => EMPTY_EDITS)
    applyEditOp('reset').then(reportOpResult)
  }, [updateEdits, reportOpResult])
  const replaceAll = useCallback((e: Edits) => {
    const next: Edits = {
      productRenames: e.productRenames ?? {},
      supplierRenames: e.supplierRenames ?? {},
      acknowledgedSuppliers: e.acknowledgedSuppliers ?? {},
      productPackOverride: e.productPackOverride ?? {},
      packAliases: e.packAliases ?? {},
      productLinks: e.productLinks ?? {},
      planOverrides: e.planOverrides ?? {},
      venueOverrides: e.venueOverrides ?? {},
      newVenues: e.newVenues ?? {},
      rowComments: e.rowComments ?? {},
      rowColors: e.rowColors ?? {},
      supplierAliasOverrides: e.supplierAliasOverrides ?? {},
    }
    updateEdits(() => next)
    saveEdits(next).then(reportOpResult) // whole-blob PUT — Импорт is an explicit, deliberate replace-everything action
  }, [updateEdits, reportOpResult])

  const editCount =
    Object.keys(edits.productRenames).length +
    Object.keys(edits.supplierRenames).length +
    Object.keys(edits.acknowledgedSuppliers).length +
    Object.keys(edits.productPackOverride).length +
    Object.keys(edits.packAliases).length +
    Object.keys(edits.productLinks).length +
    Object.keys(edits.planOverrides).length +
    Object.keys(edits.venueOverrides).length +
    Object.keys(edits.newVenues).length +
    Object.keys(edits.rowComments).length +
    Object.keys(edits.rowColors).length +
    Object.keys(edits.supplierAliasOverrides).length

  const restaurants = useMemo(
    () => withNewVenues(applyVenueOverrides(parsed.restaurants, edits.venueOverrides), edits),
    [parsed.restaurants, edits],
  )

  const value: Ctx = {
    edits, rows, editCount,
    period: parsed.period, periodKey, periods, setPeriod, matching, matchingIsStale, city: parsed.city, category: parsed.category,
    restaurants, suppliers: parsed.suppliers, products: parsed.products,
    backendOnline, status, syncing, refresh, syncHistoricalPeriod, reloadStatus,
    venues, enableVenueByName, disableVenueByName, refreshMatrix,
    renameProduct, renameSupplier, setVenue,
    addVenue, removeVenue,
    acknowledgeSupplier, unacknowledgeSupplier, setProductPackOverride, setPackAlias, setProductLink, setPlanOverride, setRowComment, setRowColor, setSupplierAliasOverride,
    reset, replaceAll, undo, canUndo,
    noMatrixTest, setNoMatrixTest,
    saveError,
  }
  return <EditsContext.Provider value={value}>{children}</EditsContext.Provider>
}

export function useEdits() {
  const c = useContext(EditsContext)
  if (!c) throw new Error('useEdits must be used within EditsProvider')
  return c
}
