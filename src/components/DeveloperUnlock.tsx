import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/auth'

/** Окно ввода ключа разработчика («секретная кнопка»: несколько быстрых нажатий на подвал страницы). */
export default function DeveloperUnlock({ onClose }: { onClose: () => void }) {
  const { unlockDeveloper } = useAuth()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const submit = async () => {
    if (!key.trim() || busy) return
    setBusy(true); setMsg('')
    const r = await unlockDeveloper(key)
    setBusy(false)
    if (r.ok) onClose(); else setMsg(r.message ?? 'Не получилось')
  }
  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4" onMouseDown={onClose}>
      <div className="card w-full max-w-sm space-y-3 p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold text-fg-50">Режим разработчика</div>
        <input type="password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') onClose() }}
          placeholder="Ключ" className="h-10 w-full rounded-lg border border-ink-600 bg-ink-900/60 px-3 text-sm text-fg-100 focus:border-brand-500 focus:outline-none" />
        {msg && <div className="text-xs text-bad">{msg}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn border border-ink-600 bg-ink-800/70 text-fg-300 hover:bg-ink-750">Отмена</button>
          <button onClick={() => void submit()} disabled={busy || !key.trim()} className="btn bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60">{busy ? 'Проверяю…' : 'Войти'}</button>
        </div>
      </div>
    </div>, document.body)
}
