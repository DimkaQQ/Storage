import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { BUNDLED, Edits, EMPTY_EDITS, Parsed, Row, SupplierAgg, ProductAgg, VenueMeta, VenuePatch, computeRows, parseDataset, applyVenueOverrides, withNewSuppliers, withNewProducts, withNewVenues } from './data'
import { fetchDataset, fetchStatus, triggerSync, SyncStatus } from './api'

const KEY = 'pricecheck-edits-v1'

function load(): Edits {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY_EDITS
    const p = JSON.parse(raw)
    return {
      supplierRenames: p.supplierRenames ?? {},
      productRenames: p.productRenames ?? {},
      planOverrides: p.planOverrides ?? {},
      excludedProducts: p.excludedProducts ?? {},
      venueOverrides: p.venueOverrides ?? {},
      newSuppliers: p.newSuppliers ?? {},
      newProducts: p.newProducts ?? {},
      newVenues: p.newVenues ?? {},
      supplierMerges: p.supplierMerges ?? {},
    }
  } catch {
    return EMPTY_EDITS
  }
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
}

const EditsContext = createContext<Ctx | null>(null)

export function EditsProvider({ children }: { children: ReactNode }) {
  const [edits, setEdits] = useState<Edits>(load)
  const [parsed, setParsed] = useState<Parsed>(BUNDLED)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [backendOnline, setBackendOnline] = useState(false)
  const [syncing, setSyncing] = useState(false)

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

  // On mount: pull the live dataset + status from the backend (if present).
  useEffect(() => { loadData(); reloadStatus() }, [loadData, reloadStatus])

  const refresh = useCallback(async () => {
    setSyncing(true)
    try { await triggerSync(); await loadData(); await reloadStatus() }
    finally { setSyncing(false) }
  }, [loadData, reloadStatus])

  const rows = useMemo(() => computeRows(parsed.base, edits), [parsed, edits])

  // Set a map entry, or delete it when the value clears / equals the original.
  const setMap = useCallback((field: 'supplierRenames' | 'productRenames') =>
    (original: string, name: string) => {
      setEdits((e) => {
        const next = { ...e[field] }
        const v = name.trim()
        if (!v || v === original) delete next[original]
        else next[original] = v
        return { ...e, [field]: next }
      })
    }, [])

  const renameSupplier = useMemo(() => setMap('supplierRenames'), [setMap])
  const renameProduct = useMemo(() => setMap('productRenames'), [setMap])

  const setPlan = useCallback((originalProduct: string, plan: number | null) => {
    setEdits((e) => {
      const next = { ...e.planOverrides }
      if (plan == null || !isFinite(plan) || plan <= 0) delete next[originalProduct]
      else next[originalProduct] = plan
      return { ...e, planOverrides: next }
    })
  }, [])

  const setExcluded = useCallback((originalProduct: string, excluded: boolean) => {
    setEdits((e) => {
      const next = { ...e.excludedProducts }
      if (excluded) next[originalProduct] = true
      else delete next[originalProduct]
      return { ...e, excludedProducts: next }
    })
  }, [])

  const setVenue = useCallback((restaurant: string, patch: VenuePatch) => {
    setEdits((e) => {
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
  }, [])

  // Ручное добавление справочных позиций, у которых ещё нет закупок в iiko —
  // например, чтобы заранее задать план для новой точки/товара/поставщика.
  const addSupplier = useCallback((name: string) => {
    const v = name.trim()
    if (!v) return
    setEdits((e) => (e.newSuppliers[v] ? e : { ...e, newSuppliers: { ...e.newSuppliers, [v]: true } }))
  }, [])
  const addProduct = useCallback((name: string, plan?: number | null) => {
    const v = name.trim()
    if (!v) return
    setEdits((e) => {
      const newProducts = e.newProducts[v] ? e.newProducts : { ...e.newProducts, [v]: true as const }
      const planOverrides = plan != null && isFinite(plan) && plan > 0 ? { ...e.planOverrides, [v]: plan } : e.planOverrides
      return { ...e, newProducts, planOverrides }
    })
  }, [])
  const addVenue = useCallback((name: string, patch?: VenuePatch) => {
    const v = name.trim()
    if (!v) return
    setEdits((e) => {
      const newVenues = e.newVenues[v] ? e.newVenues : { ...e.newVenues, [v]: true as const }
      const venueOverrides = patch ? { ...e.venueOverrides, [v]: { ...e.venueOverrides[v], ...patch } } : e.venueOverrides
      return { ...e, newVenues, venueOverrides }
    })
  }, [])
  const removeSupplier = useCallback((name: string) => {
    setEdits((e) => { const n = { ...e.newSuppliers }; delete n[name]; return { ...e, newSuppliers: n } })
  }, [])
  const removeProduct = useCallback((name: string) => {
    setEdits((e) => {
      const n = { ...e.newProducts }; delete n[name]
      const po = { ...e.planOverrides }; delete po[name]
      return { ...e, newProducts: n, planOverrides: po }
    })
  }, [])
  const removeVenue = useCallback((name: string) => {
    setEdits((e) => {
      const n = { ...e.newVenues }; delete n[name]
      const vo = { ...e.venueOverrides }; delete vo[name]
      return { ...e, newVenues: n, venueOverrides: vo }
    })
  }, [])

  // «Это тот же поставщик, что и...» — заменяет правку справочника руками:
  // дальнейшее сопоставление плана и все отчёты используют канонического
  // поставщика, на которого указали, вместо неопознанного iiko-имени.
  const mergeSupplier = useCallback((rawName: string, canonicalName: string) => {
    const v = canonicalName.trim()
    if (!v || v === rawName) return
    setEdits((e) => ({ ...e, supplierMerges: { ...e.supplierMerges, [rawName]: v } }))
  }, [])
  const unmergeSupplier = useCallback((rawName: string) => {
    setEdits((e) => { const n = { ...e.supplierMerges }; delete n[rawName]; return { ...e, supplierMerges: n } })
  }, [])

  const reset = useCallback(() => setEdits(EMPTY_EDITS), [])
  const replaceAll = useCallback((e: Edits) => setEdits({
    supplierRenames: e.supplierRenames ?? {},
    productRenames: e.productRenames ?? {},
    planOverrides: e.planOverrides ?? {},
    excludedProducts: e.excludedProducts ?? {},
    venueOverrides: e.venueOverrides ?? {},
    newSuppliers: e.newSuppliers ?? {},
    newProducts: e.newProducts ?? {},
    newVenues: e.newVenues ?? {},
    supplierMerges: e.supplierMerges ?? {},
  }), [])

  const editCount =
    Object.keys(edits.supplierRenames).length +
    Object.keys(edits.productRenames).length +
    Object.keys(edits.planOverrides).length +
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
    renameSupplier, renameProduct, setPlan, setExcluded, setVenue,
    addSupplier, addProduct, addVenue, removeSupplier, removeProduct, removeVenue,
    mergeSupplier, unmergeSupplier,
    reset, replaceAll,
  }
  return <EditsContext.Provider value={value}>{children}</EditsContext.Provider>
}

export function useEdits() {
  const c = useContext(EditsContext)
  if (!c) throw new Error('useEdits must be used within EditsProvider')
  return c
}
