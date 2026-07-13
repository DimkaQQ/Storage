import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { BASE, Edits, EMPTY_EDITS, Row, computeRows } from './data'

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
    }
  } catch {
    return EMPTY_EDITS
  }
}

interface Ctx {
  edits: Edits
  rows: Row[]
  editCount: number
  renameSupplier: (original: string, name: string) => void
  renameProduct: (original: string, name: string) => void
  setPlan: (originalProduct: string, plan: number | null) => void
  reset: () => void
  replaceAll: (e: Edits) => void
}

const EditsContext = createContext<Ctx | null>(null)

export function EditsProvider({ children }: { children: ReactNode }) {
  const [edits, setEdits] = useState<Edits>(load)

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(edits)) } catch { /* ignore quota */ }
  }, [edits])

  const rows = useMemo(() => computeRows(BASE, edits), [edits])

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

  const reset = useCallback(() => setEdits(EMPTY_EDITS), [])
  const replaceAll = useCallback((e: Edits) => setEdits({
    supplierRenames: e.supplierRenames ?? {},
    productRenames: e.productRenames ?? {},
    planOverrides: e.planOverrides ?? {},
  }), [])

  const editCount =
    Object.keys(edits.supplierRenames).length +
    Object.keys(edits.productRenames).length +
    Object.keys(edits.planOverrides).length

  const value: Ctx = { edits, rows, editCount, renameSupplier, renameProduct, setPlan, reset, replaceAll }
  return <EditsContext.Provider value={value}>{children}</EditsContext.Provider>
}

export function useEdits() {
  const c = useContext(EditsContext)
  if (!c) throw new Error('useEdits must be used within EditsProvider')
  return c
}
