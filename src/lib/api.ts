// Talks to the backend (same origin; nginx proxies /api → api service).
// Every call fails soft: if the backend is absent, the app keeps working on
// the bundled snapshot.

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
    const r = await fetch(path)
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

export const fetchDataset = () => get<any>('/api/data')
export const fetchStatus = () => get<SyncStatus>('/api/status')
export const fetchSettings = () => get<IikoSettings>('/api/settings')

export async function saveSettings(s: Partial<IikoSettings>): Promise<IikoSettings | null> {
  try {
    const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
    return r.ok ? await r.json() : null
  } catch { return null }
}

export async function testConnection(s: Partial<IikoSettings>): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await fetch('/api/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
    if (!r.ok) return { ok: false, message: `Ошибка сервера (HTTP ${r.status})` }
    return await r.json()
  } catch { return { ok: false, message: 'Бэкенд недоступен' } }
}

export async function triggerSync(): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await fetch('/api/sync', { method: 'POST' })
    return await r.json()
  } catch { return { ok: false, message: 'Бэкенд недоступен' } }
}
