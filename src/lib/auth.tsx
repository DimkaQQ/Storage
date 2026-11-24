import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import { clearLocalEditsCache } from './edits'
import { DEFAULT_RESTAURANT_SCOPE, setRestaurantScope } from './data'

const TOKEN_KEY = 'pricecheck-token'
const DEV_KEY = 'pricecheck-dev-token'
export const hasDeveloperToken = () => { try { return !!localStorage.getItem(DEV_KEY) } catch { return false } }

export interface AuthUser { id: string; email: string; orgId: string; role: 'admin' | 'employee'; developer?: boolean }

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
export const authHeaders = (): Record<string, string> => {
  const t = getToken()
  let d: string | null = null
  try { d = localStorage.getItem(DEV_KEY) } catch { /* без хранилища режим разработчика не переживёт перезагрузку */ }
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(d ? { 'X-Developer-Token': d } : {}) }
}

interface Ctx {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>
  logout: () => void
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }>
  // «секретная кнопка»: ключ разработчика → режим разработчика на 12 часов
  unlockDeveloper: (key: string) => Promise<{ ok: boolean; message?: string }>
  lockDeveloper: () => Promise<void>
}

const AuthContext = createContext<Ctx | null>(null)

// Правки (localStorage) держатся отдельным ключом, общим для браузера, а не
// по организации/пользователю — EditsProvider монтируется заново при каждом
// входе, так что без явной очистки на общем компьютере смена аккаунта на
// другую организацию первое время (а при сбое /api/edits — и дольше)
// показывала бы чужие правки поверх данных новой организации. Чистим и при
// явном logout(), и здесь — когда сохранённый токен оказался невалиден/
// истёк (та же смена личности, просто без клика «Выйти»).
//
// RESTAURANT_SCOPE — та же ловушка, но с другой стороны: это модульная
// переменная в lib/data.ts (не React state), выставленная предыдущим
// loadVenues() ДО logout — сама она не сбрасывается ни при перемонтировании
// EditsProvider, ни от очистки localStorage выше. Без сброса здесь новая
// EditsProvider короткое время (до своего loadVenues()) считала бы список
// точек ПРЕЖНЕЙ организации — сбрасываем на дефолт, чтобы в этот момент
// показывался нейтральный дефолтный список, а не чужой.
function clearLocalSession() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(DEV_KEY) } catch { /* ignore */ }
  clearLocalEditsCache()
  setRestaurantScope(DEFAULT_RESTAURANT_SCOPE)
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
      // Отдельный try — сервер уже принял логин (r.ok/data.ok выше), и его
      // не нужно превращать в "Сервер недоступен", если именно запись в
      // localStorage бросит (приватный режим браузера, запрещённое хранение
      // и т.п.): без токена сессия просто не переживёт перезагрузку
      // страницы, но вход в ЭТОТ раз всё равно должен пройти — раньше это
      // исключение ловилось общим catch ниже и выдавало ложную ошибку
      // сервера при реально успешном логине.
      try { localStorage.setItem(TOKEN_KEY, data.token) } catch { /* сессия не переживёт перезагрузку страницы, не более */ }
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

  const refreshMe = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { headers: authHeaders() })
      if (r.ok) setUser(await r.json())
    } catch { /* оставляем прежнего пользователя */ }
  }, [])

  const unlockDeveloper = useCallback(async (key: string) => {
    try {
      const r = await fetch('/api/auth/developer', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ key }) })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.ok) return { ok: false, message: data.message || 'Не получилось' }
      try { localStorage.setItem(DEV_KEY, data.token) } catch { /* до перезагрузки страницы режим всё равно не сохранится */ }
      await refreshMe()
      return { ok: true }
    } catch { return { ok: false, message: 'Сервер недоступен' } }
  }, [refreshMe])

  const lockDeveloper = useCallback(async () => {
    try { localStorage.removeItem(DEV_KEY) } catch { /* ignore */ }
    await refreshMe()
  }, [refreshMe])

  // когда срок токена разработчика истёк — режим выключается сам (иначе разделы остались бы видимыми, а сервер отвечал бы 403)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const tok = localStorage.getItem(DEV_KEY)
      const exp = tok ? JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp : 0
      if (exp) timer = setTimeout(() => { void lockDeveloper() }, Math.max(0, exp * 1000 - Date.now()) + 500)
    } catch { /* нечитаемый токен — сервер всё равно его не примет */ }
    return () => { if (timer) clearTimeout(timer) }
  }, [user, lockDeveloper])

  return <AuthContext.Provider value={{ user, loading, login, logout, changePassword, unlockDeveloper, lockDeveloper }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const c = useContext(AuthContext)
  if (!c) throw new Error('useAuth must be used within AuthProvider')
  return c
}
