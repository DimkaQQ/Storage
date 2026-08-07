import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import { clearLocalEditsCache } from './edits'

const TOKEN_KEY = 'pricecheck-token'

export interface AuthUser { id: string; email: string; orgId: string; role: 'admin' | 'employee' }

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
export const authHeaders = (): Record<string, string> => {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

interface Ctx {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>
  logout: () => void
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }>
}

const AuthContext = createContext<Ctx | null>(null)

// Правки (localStorage) держатся отдельным ключом, общим для браузера, а не
// по организации/пользователю — EditsProvider монтируется заново при каждом
// входе, так что без явной очистки на общем компьютере смена аккаунта на
// другую организацию первое время (а при сбое /api/edits — и дольше)
// показывала бы чужие правки поверх данных новой организации. Чистим и при
// явном logout(), и здесь — когда сохранённый токен оказался невалиден/
// истёк (та же смена личности, просто без клика «Выйти»).
function clearLocalSession() {
  try { localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
  clearLocalEditsCache()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    fetch('/api/auth/me', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => { if (!u) clearLocalSession(); setUser(u) })
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await r.json()
      if (!r.ok || !data.ok) return { ok: false, message: data.message || 'Не удалось войти' }
      localStorage.setItem(TOKEN_KEY, data.token)
      setUser(data.user)
      return { ok: true }
    } catch {
      return { ok: false, message: 'Сервер недоступен' }
    }
  }, [])

  const logout = useCallback(() => {
    clearLocalSession()
    setUser(null)
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await r.json()
      return r.ok && data.ok ? { ok: true } : { ok: false, message: data.message || 'Не удалось сменить пароль' }
    } catch {
      return { ok: false, message: 'Сервер недоступен' }
    }
  }, [])

  return <AuthContext.Provider value={{ user, loading, login, logout, changePassword }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const c = useContext(AuthContext)
  if (!c) throw new Error('useAuth must be used within AuthProvider')
  return c
}
