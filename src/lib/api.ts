// Talks to the backend (same origin; nginx proxies /api → api service).
// Every call fails soft: if the backend is absent, the app keeps working on
// the bundled snapshot.

import { authHeaders } from './auth'

export interface SyncStatus {
  lastSync: string | null
  lastResult: string | null
  source: string | null
  message?: string
  positions?: number
  syncing?: boolean
  schedule?: { autoEnabled: boolean; interval: string }
}

export interface IikoSettings {
  provider: 'mock' | 'iikoserver' | 'iikocloud'
  serverUrl: string
  login: string
  password: string
  apiLogin: string
  organizationId: string
  autoEnabled: boolean
  interval: 'hourly' | 'daily' | 'weekly' | 'monthly'
  period: 'current-month' | 'prev-month'
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { headers: authHeaders() })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

export interface PeriodMeta { period: string; periodLabel: string }

export const fetchDataset = (period?: string) => get<any>(period ? `/api/data?period=${encodeURIComponent(period)}` : '/api/data')
export const fetchPeriods = () => get<PeriodMeta[]>('/api/periods')
export const fetchStatus = () => get<SyncStatus>('/api/status')
export const fetchSettings = () => get<IikoSettings>('/api/settings')
export const fetchEdits = () => get<any>('/api/edits')

export async function saveSettings(s: Partial<IikoSettings>): Promise<IikoSettings | null> {
  try {
    const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(s) })
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** Full-blob restore — only for "Импорт" (explicit, deliberate replace-everything action). */
export async function saveEdits(e: unknown): Promise<boolean> {
  try {
    const r = await fetch('/api/edits', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(e) })
    return r.ok
  } catch { return false }
}

/**
 * Applies ONE targeted правка to the server's copy (e.g. "set this product's
 * plan price") instead of overwriting the whole справочник — so two people
 * editing different things at the same time never clobber each other.
 */
export async function applyEditOp(type: string, payload: Record<string, unknown> = {}): Promise<boolean> {
  try {
    const r = await fetch('/api/edits/op', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ type, ...payload }) })
    return r.ok
  } catch { return false }
}

export async function testConnection(s: Partial<IikoSettings>): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await fetch('/api/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(s) })
    if (!r.ok) return { ok: false, message: `Ошибка сервера (HTTP ${r.status})` }
    return await r.json()
  } catch { return { ok: false, message: 'Бэкенд недоступен' } }
}

export async function triggerSync(): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await fetch('/api/sync', { method: 'POST', headers: authHeaders() })
    return await r.json()
  } catch { return { ok: false, message: 'Бэкенд недоступен' } }
}

export interface TeamUser { id: string; email: string; role: 'admin' | 'employee'; createdAt: string }

export async function fetchUsers(): Promise<TeamUser[] | null> {
  return get<TeamUser[]>('/api/auth/users')
}

export async function addUser(email: string, password: string, role: 'admin' | 'employee'): Promise<{ ok: boolean; message?: string; user?: TeamUser }> {
  try {
    const r = await fetch('/api/auth/users', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ email, password, role }) })
    const data = await r.json()
    return r.ok ? { ok: true, user: data } : { ok: false, message: data.message }
  } catch { return { ok: false, message: 'Сервер недоступен' } }
}

export async function removeUser(id: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/auth/users/${id}`, { method: 'DELETE', headers: authHeaders() })
    const data = await r.json()
    return r.ok && data.ok
  } catch { return false }
}
