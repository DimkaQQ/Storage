import { useEffect, useState } from 'react'
import { fetchUsers, addUser, removeUser, TeamUser } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Section } from '../components/ui'
import { IPlus, ITrash, IUser } from '../components/icons'

export default function UsersAdmin() {
  const { user: me, changePassword } = useAuth()
  const [users, setUsers] = useState<TeamUser[] | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'employee'>('employee')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () => fetchUsers().then(setUsers)
  useEffect(() => { load() }, [])

  const submitAdd = async () => {
    if (!email.trim() || password.length < 6) { setError('Нужны почта и пароль от 6 символов'); return }
    setBusy(true)
    const res = await addUser(email.trim(), password, role)
    setBusy(false)
    if (!res.ok) { setError(res.message || 'Не удалось добавить'); return }
    setEmail(''); setPassword(''); setRole('employee'); setAddOpen(false); setError(null)
    load()
  }

  const submitRemove = async (id: string) => {
    if (!confirm('Удалить этого пользователя? Он больше не сможет войти.')) return
    if (await removeUser(id)) load()
  }

  const submitChangePassword = async () => {
    if (newPw.length < 6) { setPwMsg({ ok: false, text: 'Новый пароль — от 6 символов' }); return }
    const res = await changePassword(curPw, newPw)
    setPwMsg(res.ok ? { ok: true, text: 'Пароль изменён' } : { ok: false, text: res.message || 'Ошибка' })
    if (res.ok) { setCurPw(''); setNewPw('') }
  }

  return (
    <div className="space-y-5">
      <Section
        title="Команда"
        subtitle="Все сотрудники видят одни и те же данные и правки — это одна и та же сеть."
        right={
          <button onClick={() => setAddOpen((v) => !v)} className="btn border border-ink-600 bg-ink-800/70 px-3 py-2 text-xs text-slate-300 hover:bg-ink-750">
            <IPlus width={14} height={14} /> Добавить пользователя
          </button>
        }
      >
        {addOpen && (
          <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-brand-500/30 bg-brand-500/[0.04] p-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-[11px] text-slate-500">Почта</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus type="email"
                className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none" />
            </div>
            <div className="min-w-[160px]">
              <label className="mb-1 block text-[11px] text-slate-500">Пароль</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" placeholder="от 6 символов"
                className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-slate-500">Роль</label>
              <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'employee')}
                className="rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none">
                <option value="employee">Сотрудник</option>
                <option value="admin">Админ</option>
              </select>
            </div>
            <button onClick={submitAdd} disabled={busy} className="btn border border-brand-500/50 bg-brand-500/15 px-3 py-1.5 text-xs text-brand-200 hover:bg-brand-500/25 disabled:opacity-40">Добавить</button>
            <button onClick={() => { setAddOpen(false); setError(null) }} className="btn px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300">Отмена</button>
            {error && <p className="w-full text-xs text-bad">{error}</p>}
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-ink-700/50">
          <table className="w-full">
            <thead className="bg-ink-800/50">
              <tr>
                <th className="th">Почта</th>
                <th className="th">Роль</th>
                <th className="th text-center">Действие</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id} className="row-hover hover:bg-ink-800/40">
                  <td className="td text-slate-100">
                    <span className="inline-flex items-center gap-2"><IUser width={14} height={14} className="text-slate-600" />{u.email}{u.id === me?.id && <span className="chip border-transparent bg-brand-500/10 text-[10px] text-brand-300">это вы</span>}</span>
                  </td>
                  <td className="td text-slate-400">{u.role === 'admin' ? 'Админ' : 'Сотрудник'}</td>
                  <td className="td text-center">
                    {u.id !== me?.id && (
                      <button onClick={() => submitRemove(u.id)} className="btn mx-auto px-2 py-1 text-xs text-slate-500 hover:text-bad" title="Удалить пользователя">
                        <ITrash width={13} height={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users != null && users.length === 0 && <div className="py-10 text-center text-sm text-slate-500">Пока только вы.</div>}
        </div>
      </Section>

      <Section title="Сменить свой пароль">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px]">
            <label className="mb-1 block text-[11px] text-slate-500">Текущий пароль</label>
            <input value={curPw} onChange={(e) => setCurPw(e.target.value)} type="password"
              className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none" />
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-[11px] text-slate-500">Новый пароль</label>
            <input value={newPw} onChange={(e) => setNewPw(e.target.value)} type="password" placeholder="от 6 символов"
              className="w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none" />
          </div>
          <button onClick={submitChangePassword} className="btn border border-ink-600 bg-ink-800/70 px-3 py-1.5 text-xs text-slate-200 hover:bg-ink-750">Сохранить</button>
          {pwMsg && <p className={`text-xs ${pwMsg.ok ? 'text-good' : 'text-bad'}`}>{pwMsg.text}</p>}
        </div>
      </Section>
    </div>
  )
}
