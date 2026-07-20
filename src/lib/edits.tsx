import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react'
import { BUNDLED, Edits, EMPTY_EDITS, Parsed, Row, SupplierAgg, ProductAgg, VenueMeta, VenuePatch, computeRows, parseDataset, applyVenueOverrides, withNewVenues } from './data'
import { fetchDataset, fetchStatus, fetchEdits, saveEdits, applyEditOp, triggerSync, SyncStatus } from './api'

const KEY = 'pricecheck-edits-v2'

function normalize(p: any): Edits {
  return {
    supplierRenames: p?.supplierRenames ?? {},
    productRenames: p?.productRenames ?? {},
    supplierMerges: p?.supplierMerges ?? {},
    venueOverrides: p?.venueOverrides ?? {},
    newVenues: p?.newVenues ?? {},
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
function syncUndoToServer(current: Edits, target: Edits) {
  for (const k of diffKeys(current.supplierRenames, target.supplierRenames))
    applyEditOp('renameSupplier', { original: k, name: target.supplierRenames[k] ?? '' })
  for (const k of diffKeys(current.productRenames, target.productRenames))
    applyEditOp('renameProduct', { original: k, name: target.productRenames[k] ?? '' })
  for (const k of diffKeys(current.venueOverrides, target.venueOverrides)) {
    applyEditOp('clearVenue', { restaurant: k })
    if (target.venueOverrides[k]) applyEditOp('setVenue', { restaurant: k, patch: target.venueOverrides[k] })
  }
  for (const k of diffKeys(current.newVenues, target.newVenues))
    applyEditOp(target.newVenues[k] ? 'addVenue' : 'removeVenue', { name: k })
  for (const k of diffKeys(current.supplierMerges, target.supplierMerges))
    target.supplierMerges[k]
      ? applyEditOp('mergeSupplier', { rawName: k, canonicalName: target.supplierMerges[k] })
      : applyEditOp('unmergeSupplier', { rawName: k })
}

interface Ctx {
  edits: Edits
  rows: Row[]
  editCount: number
  // dataset (bundled fallback → replaced by backend data when available)
  period: string
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
  reloadStatus: () => Promise<void>
  // edits
  renameSupplier: (original: string, name: string) => void
  renameProduct: (original: string, name: string) => void
  setVenue: (restaurant: string, patch: VenuePatch) => void
  addVenue: (name: string, patch?: VenuePatch) => void
  removeVenue: (name: string) => void
  mergeSupplier: (rawName: string, canonicalName: string) => void
  unmergeSupplier: (rawName: string) => void
  reset: () => void
  replaceAll: (e: Edits) => void
  undo: () => void
  canUndo: boolean
}

const EditsContext = createContext<Ctx | null>(null)

export function EditsProvider({ children }: { children: ReactNode }) {
  const [edits, setEdits] = useState<Edits>(load)
  const [parsed, setParsed] = useState<Parsed>(BUNDLED)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [backendOnline, setBackendOnline] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const history = useRef<Edits[]>([])
  const [canUndo, setCanUndo] = useState(false)

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
    setEdits((current) => { syncUndoToServer(current, prev); return prev })
  }, [])

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(edits)) } catch { /* ignore quota */ }
  }, [edits])

  const loadData = useCallback(async () => {
    const data = await fetchDataset()
    if (data && data.restaurants) { setParsed(parseDataset(data)); setBackendOnline(true) }
  }, [])
  const reloadStatus = useCallback(async () => {
    const st = await fetchStatus()
    if (st) { setStatus(st); setBackendOnline(true) }
  }, [])
  const loadEdits = useCallback(async () => {
    const data = await fetchEdits()
    if (data) { setEdits(normalize(data)); setBackendOnline(true) }
  }, [])

  // On mount: pull the live dataset + status + shared corrections from the backend (if present).
  useEffect(() => { loadData(); reloadStatus(); loadEdits() }, [loadData, reloadStatus, loadEdits])

  const refresh = useCallback(async () => {
    setSyncing(true)
    try { await triggerSync(); await loadData(); await reloadStatus() }
    finally { setSyncing(false) }
  }, [loadData, reloadStatus])

  const rows = useMemo(() => computeRows(parsed.base, edits), [parsed, edits])

  // Set a map entry, or delete it when the value clears / equals the original.
  const setMap = useCallback((field: 'supplierRenames' | 'productRenames') =>
    (original: string, name: string) => {
      const v = name.trim()
      updateEdits((e) => {
        const next = { ...e[field] }
        if (!v || v === original) delete next[original]
        else next[original] = v
        return { ...e, [field]: next }
      })
      applyEditOp(field === 'supplierRenames' ? 'renameSupplier' : 'renameProduct', { original, name: v })
    }, [updateEdits])

  const renameSupplier = useMemo(() => setMap('supplierRenames'), [setMap])
  const renameProduct = useMemo(() => setMap('productRenames'), [setMap])

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
    applyEditOp('setVenue', { restaurant, patch })
  }, [updateEdits])

  // Ручное добавление точки, у которой ещё нет закупок в iiko.
  const addVenue = useCallback((name: string, patch?: VenuePatch) => {
    const v = name.trim()
    if (!v) return
    updateEdits((e) => {
      const newVenues = e.newVenues[v] ? e.newVenues : { ...e.newVenues, [v]: true as const }
      const venueOverrides = patch ? { ...e.venueOverrides, [v]: { ...e.venueOverrides[v], ...patch } } : e.venueOverrides
      return { ...e, newVenues, venueOverrides }
    })
    applyEditOp('addVenue', { name: v, patch: patch ?? null })
  }, [updateEdits])
  const removeVenue = useCallback((name: string) => {
    updateEdits((e) => {
      const n = { ...e.newVenues }; delete n[name]
      const vo = { ...e.venueOverrides }; delete vo[name]
      return { ...e, newVenues: n, venueOverrides: vo }
    })
    applyEditOp('removeVenue', { name })
  }, [updateEdits])

  // «Это тот же поставщик, что и...» — чинит разрыв в справочнике-алиасов,
  // когда iiko называет компанию иначе, чем матрица.
  const mergeSupplier = useCallback((rawName: string, canonicalName: string) => {
    const v = canonicalName.trim()
    if (!v || v === rawName) return
    updateEdits((e) => ({ ...e, supplierMerges: { ...e.supplierMerges, [rawName]: v } }))
    applyEditOp('mergeSupplier', { rawName, canonicalName: v })
  }, [updateEdits])
  const unmergeSupplier = useCallback((rawName: string) => {
    updateEdits((e) => { const n = { ...e.supplierMerges }; delete n[rawName]; return { ...e, supplierMerges: n } })
    applyEditOp('unmergeSupplier', { rawName })
  }, [updateEdits])

  const reset = useCallback(() => {
    updateEdits(() => EMPTY_EDITS)
    applyEditOp('reset')
  }, [updateEdits])
  const replaceAll = useCallback((e: Edits) => {
    const next: Edits = {
      supplierRenames: e.supplierRenames ?? {},
      productRenames: e.productRenames ?? {},
      supplierMerges: e.supplierMerges ?? {},
      venueOverrides: e.venueOverrides ?? {},
      newVenues: e.newVenues ?? {},
    }
    updateEdits(() => next)
    saveEdits(next) // whole-blob PUT — Импорт is an explicit, deliberate replace-everything action
  }, [updateEdits])

  const editCount =
    Object.keys(edits.supplierRenames).length +
    Object.keys(edits.productRenames).length +
    Object.keys(edits.supplierMerges).length +
    Object.keys(edits.venueOverrides).length +
    Object.keys(edits.newVenues).length

  const restaurants = useMemo(
    () => withNewVenues(applyVenueOverrides(parsed.restaurants, edits.venueOverrides), edits),
    [parsed.restaurants, edits],
  )

  const value: Ctx = {
    edits, rows, editCount,
    period: parsed.period, city: parsed.city, category: parsed.category,
    restaurants, suppliers: parsed.suppliers, products: parsed.products,
    backendOnline, status, syncing, refresh, reloadStatus,
    renameSupplier, renameProduct, setVenue,
    addVenue, removeVenue,
    mergeSupplier, unmergeSupplier,
    reset, replaceAll, undo, canUndo,
  }
  return <EditsContext.Provider value={value}>{children}</EditsContext.Provider>
}

export function useEdits() {
  const c = useContext(EditsContext)
  if (!c) throw new Error('useEdits must be used within EditsProvider')
  return c
}
