import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react'
import { BUNDLED, Edits, EMPTY_EDITS, Parsed, Row, SupplierAgg, ProductAgg, VenueMeta, VenuePatch, computeRows, parseDataset, applyVenueOverrides, withNewSuppliers, withNewProducts, withNewVenues, pairKey } from './data'
import { fetchDataset, fetchStatus, fetchEdits, saveEdits, applyEditOp, triggerSync, SyncStatus } from './api'

const KEY = 'pricecheck-edits-v1'

function normalize(p: any): Edits {
  return {
    supplierRenames: p?.supplierRenames ?? {},
    productRenames: p?.productRenames ?? {},
    planOverrides: p?.planOverrides ?? {},
    planPairOverrides: p?.planPairOverrides ?? {},
    excludedProducts: p?.excludedProducts ?? {},
    venueOverrides: p?.venueOverrides ?? {},
    newSuppliers: p?.newSuppliers ?? {},
    newProducts: p?.newProducts ?? {},
    newVenues: p?.newVenues ?? {},
    supplierMerges: p?.supplierMerges ?? {},
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
  for (const k of diffKeys(current.planOverrides, target.planOverrides))
    applyEditOp('setPlan', { product: k, plan: target.planOverrides[k] ?? null })
  for (const k of diffKeys(current.planPairOverrides, target.planPairOverrides)) {
    const [supplier, product] = k.split('::')
    applyEditOp('setPairPlan', { supplier, product, plan: target.planPairOverrides[k] ?? null })
  }
  for (const k of diffKeys(current.excludedProducts, target.excludedProducts))
    applyEditOp('setExcluded', { product: k, excluded: !!target.excludedProducts[k] })
  for (const k of diffKeys(current.venueOverrides, target.venueOverrides)) {
    applyEditOp('clearVenue', { restaurant: k })
    if (target.venueOverrides[k]) applyEditOp('setVenue', { restaurant: k, patch: target.venueOverrides[k] })
  }
  for (const k of diffKeys(current.newSuppliers, target.newSuppliers))
    applyEditOp(target.newSuppliers[k] ? 'addSupplier' : 'removeSupplier', { name: k })
  for (const k of diffKeys(current.newProducts, target.newProducts))
    applyEditOp(target.newProducts[k] ? 'addProduct' : 'removeProduct', { name: k, plan: null })
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
  setPlan: (originalProduct: string, plan: number | null) => void
  setPairPlan: (supplier: string, product: string, plan: number | null) => void
  setExcluded: (originalProduct: string, excluded: boolean) => void
  setVenue: (restaurant: string, patch: VenuePatch) => void
  addSupplier: (name: string) => void
  addProduct: (name: string, plan?: number | null) => void
  addVenue: (name: string, patch?: VenuePatch) => void
  removeSupplier: (name: string) => void
  removeProduct: (name: string) => void
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

  const setPlan = useCallback((originalProduct: string, plan: number | null) => {
    updateEdits((e) => {
      const next = { ...e.planOverrides }
      if (plan == null || !isFinite(plan) || plan <= 0) delete next[originalProduct]
      else next[originalProduct] = plan
      return { ...e, planOverrides: next }
    })
    applyEditOp('setPlan', { product: originalProduct, plan })
  }, [updateEdits])

  const setPairPlan = useCallback((supplier: string, product: string, plan: number | null) => {
    const s = supplier.trim(), p = product.trim()
    if (!s || !p) return
    updateEdits((e) => {
      const next = { ...e.planPairOverrides }
      const key = pairKey(s, p)
      if (plan == null || !isFinite(plan) || plan <= 0) delete next[key]
      else next[key] = plan
      return { ...e, planPairOverrides: next }
    })
    applyEditOp('setPairPlan', { supplier: s, product: p, plan })
  }, [updateEdits])

  const setExcluded = useCallback((originalProduct: string, excluded: boolean) => {
    updateEdits((e) => {
      const next = { ...e.excludedProducts }
      if (excluded) next[originalProduct] = true
      else delete next[originalProduct]
      return { ...e, excludedProducts: next }
    })
    applyEditOp('setExcluded', { product: originalProduct, excluded })
  }, [updateEdits])

  const setVenue = useCallback((restaurant: string, patch: VenuePatch) => {
    updateEdits((e) => {
      const next = { ...e.venueOverrides }
      const merged = { ...next[restaurant], ...patch }
      const cleaned: VenuePatch = {}
      if (merged.city) cleaned.city = merged.city
      if (merged.brand) cleaned.brand = merged.brand
      if (merged.entity) cleaned.entity = merged.entity
      if (Object.keys(cleaned).length === 0) delete next[restaurant]
      else next[restaurant] = cleaned
      return { ...e, venueOverrides: next }
    })
    applyEditOp('setVenue', { restaurant, patch })
  }, [updateEdits])

  // Ручное добавление справочных позиций, у которых ещё нет закупок в iiko —
  // например, чтобы заранее задать план для новой точки/товара/поставщика.
  const addSupplier = useCallback((name: string) => {
    const v = name.trim()
    if (!v) return
    updateEdits((e) => (e.newSuppliers[v] ? e : { ...e, newSuppliers: { ...e.newSuppliers, [v]: true } }))
    applyEditOp('addSupplier', { name: v })
  }, [updateEdits])
  const addProduct = useCallback((name: string, plan?: number | null) => {
    const v = name.trim()
    if (!v) return
    updateEdits((e) => {
      const newProducts = e.newProducts[v] ? e.newProducts : { ...e.newProducts, [v]: true as const }
      const planOverrides = plan != null && isFinite(plan) && plan > 0 ? { ...e.planOverrides, [v]: plan } : e.planOverrides
      return { ...e, newProducts, planOverrides }
    })
    applyEditOp('addProduct', { name: v, plan: plan ?? null })
  }, [updateEdits])
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
  const removeSupplier = useCallback((name: string) => {
    updateEdits((e) => { const n = { ...e.newSuppliers }; delete n[name]; return { ...e, newSuppliers: n } })
    applyEditOp('removeSupplier', { name })
  }, [updateEdits])
  const removeProduct = useCallback((name: string) => {
    updateEdits((e) => {
      const n = { ...e.newProducts }; delete n[name]
      const po = { ...e.planOverrides }; delete po[name]
      const suffix = `::${name.trim().toLowerCase()}`
      const ppo = Object.fromEntries(Object.entries(e.planPairOverrides).filter(([k]) => !k.endsWith(suffix)))
      return { ...e, newProducts: n, planOverrides: po, planPairOverrides: ppo }
    })
    applyEditOp('removeProduct', { name })
  }, [updateEdits])
  const removeVenue = useCallback((name: string) => {
    updateEdits((e) => {
      const n = { ...e.newVenues }; delete n[name]
      const vo = { ...e.venueOverrides }; delete vo[name]
      return { ...e, newVenues: n, venueOverrides: vo }
    })
    applyEditOp('removeVenue', { name })
  }, [updateEdits])

  // «Это тот же поставщик, что и...» — заменяет правку справочника руками:
  // дальнейшее сопоставление плана и все отчёты используют канонического
  // поставщика, на которого указали, вместо неопознанного iiko-имени.
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
      planOverrides: e.planOverrides ?? {},
      planPairOverrides: e.planPairOverrides ?? {},
      excludedProducts: e.excludedProducts ?? {},
      venueOverrides: e.venueOverrides ?? {},
      newSuppliers: e.newSuppliers ?? {},
      newProducts: e.newProducts ?? {},
      newVenues: e.newVenues ?? {},
      supplierMerges: e.supplierMerges ?? {},
    }
    updateEdits(() => next)
    saveEdits(next) // whole-blob PUT — Импорт is an explicit, deliberate replace-everything action
  }, [updateEdits])

  const editCount =
    Object.keys(edits.supplierRenames).length +
    Object.keys(edits.productRenames).length +
    Object.keys(edits.planOverrides).length +
    Object.keys(edits.planPairOverrides).length +
    Object.keys(edits.excludedProducts).length +
    Object.keys(edits.venueOverrides).length +
    Object.keys(edits.newSuppliers).length +
    Object.keys(edits.newProducts).length +
    Object.keys(edits.newVenues).length +
    Object.keys(edits.supplierMerges).length

  const restaurants = useMemo(
    () => withNewVenues(applyVenueOverrides(parsed.restaurants, edits.venueOverrides), edits),
    [parsed.restaurants, edits],
  )
  const suppliers = useMemo(() => withNewSuppliers(parsed.suppliers, edits), [parsed.suppliers, edits])
  const products = useMemo(() => withNewProducts(parsed.products, edits), [parsed.products, edits])

  const value: Ctx = {
    edits, rows, editCount,
    period: parsed.period, city: parsed.city, category: parsed.category,
    restaurants, suppliers, products,
    backendOnline, status, syncing, refresh, reloadStatus,
    renameSupplier, renameProduct, setPlan, setPairPlan, setExcluded, setVenue,
    addSupplier, addProduct, addVenue, removeSupplier, removeProduct, removeVenue,
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
