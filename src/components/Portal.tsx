import { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Renders children straight into document.body — modals stay immune to any ancestor's stacking/overflow quirks. */
export default function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
