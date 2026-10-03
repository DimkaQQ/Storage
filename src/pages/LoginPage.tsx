import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { ISpark } from '../components/icons'

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true)
    setError(null)
    const res = await login(email.trim(), password)
    setBusy(false)
    if (!res.ok) setError(res.message || 'Не удалось войти')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-6">
      <div className="animate-fade-up w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand-500 shadow-[0_8px_24px_-6px_rgb(var(--brand-500)/0.55)]">
            <ISpark className="text-white" />
          </div>
          <div>
            <div className="text-lg font-bold text-white">Проверка цен</div>
            <div className="text-xs text-slate-500">Мониторинг закупок</div>
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Почта</label>
            <input
              type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.kz"
              className="w-full rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Пароль</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          {error && <p className="text-xs text-bad">{error}</p>}
          <button type="submit" disabled={busy} className="btn w-full justify-center bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}
