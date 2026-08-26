import { useEffect, useState } from 'react'
import { useEdits } from '../lib/edits'
import { fetchSettings, saveSettings, testConnection, IikoSettings as Settings } from '../lib/api'
import { Section, InfoTip, Checkbox } from '../components/ui'
import { ISync, IPlug, ICheck, IClose } from '../components/icons'

const PROVIDERS: { id: Settings['provider']; label: string; note: string }[] = [
  { id: 'iikoserver', label: 'iikoOffice / RMS', note: 'Сервер iiko (resto API) — отсюда «Отчёт о закупках по складам»' },
  { id: 'iikocloud', label: 'iikoCloud', note: 'Облачный API (api-ru.iiko.services)' },
  { id: 'mock', label: 'Демо-режим', note: 'Встроенные данные — без подключения к iiko' },
]
const INTERVALS: { id: Settings['interval']; label: string }[] = [
  { id: 'hourly', label: 'Каждый час' },
  { id: 'daily', label: 'Раз в день' },
  { id: 'weekly', label: 'Раз в неделю' },
  { id: 'monthly', label: 'Раз в месяц' },
]

function ago(iso: string | null): string {
  if (!iso) return 'ещё не обновлялось'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'только что'
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`
  return `${Math.floor(s / 86400)} дн назад`
}

export default function IikoSettings() {
  const { backendOnline, status, syncing, refresh, reloadStatus } = useEdits()
  const [form, setForm] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => { fetchSettings().then((s) => s && setForm(s)) }, [])

  const set = (patch: Partial<Settings>) => { setForm((f) => (f ? { ...f, ...patch } : f)); setSaved(false); setTestResult(null) }

  const save = async () => {
    if (!form) return
    const r = await saveSettings(form)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
  }
  const test = async () => {
    if (!form) return
    setTesting(true); setTestResult(null)
    // Сохраняем перед проверкой, а не только после — иначе легко ввести
    // адрес/логин, нажать «Проверить», увидеть «подключение есть» и уйти
    // со страницы, решив, что всё готово: тест ничего не сохранял, и
    // введённое пропадало. Теперь «Проверить» = «Сохранить и проверить»,
    // отдельно сохранять не нужно.
    const r = await saveSettings(form)
    if (r) { setForm(r); setSaved(true); reloadStatus() }
    setTestResult(await testConnection(form))
    setTesting(false)
  }

  if (!backendOnline || !form) {
    return (
      <div className="space-y-5">
        <div className="card p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-warn/10 text-warn"><IPlug width={20} height={20} /></span>
            <div>
              <h3 className="text-base font-semibold text-white">Бэкенд не подключён — демо-режим</h3>
              <p className="text-sm text-slate-400">Приложение работает на встроенных данных (май 2026). Чтобы тянуть свежие данные из iiko, разверните сервис-бэкенд рядом с приложением.</p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-ink-700/60 bg-ink-900/40 p-4 text-sm text-slate-400">
            После развёртывания бэкенда здесь появятся: подключение к iiko, кнопка «Обновить сейчас» и настройка автообновления.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* status + manual refresh */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className={`grid h-11 w-11 place-items-center rounded-xl ${status?.lastResult === 'error' ? 'bg-bad/10 text-bad' : 'bg-good/10 text-good'}`}><ISync width={20} height={20} /></span>
          <div>
            <div className="text-sm font-semibold text-white">Данные из iiko</div>
            <div className="text-xs text-slate-500">
              Обновлено: <span className="text-slate-300">{ago(status?.lastSync ?? null)}</span>
              {status?.positions ? <> · {status.positions} позиций</> : null}
              {status?.lastResult === 'error' && <span className="text-bad"> · ошибка: {status.message}</span>}
            </div>
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={syncing}
          className="btn bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60"
        >
          <ISync width={16} height={16} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Обновляю…' : 'Обновить сейчас'}
        </button>
      </div>

      {/* connection */}
      <Section title="Подключение к iiko" subtitle="Выберите источник и введите доступ. Пароль/ключ хранятся только на сервере.">
        <div className="grid grid-cols-3 gap-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => set({ provider: p.id })}
              className={`rounded-xl border p-3 text-left transition-colors ${form.provider === p.id ? 'border-brand-500 bg-brand-500/10' : 'border-ink-600 bg-ink-900/40 hover:border-ink-600/80'}`}
            >
              <div className="text-sm font-semibold text-slate-100">{p.label}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{p.note}</div>
            </button>
          ))}
        </div>

        {form.provider === 'iikoserver' && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Адрес сервера iiko" hint="URL и порт resto API, напр. https://ваш-сервер:443" value={form.serverUrl} onChange={(v) => set({ serverUrl: v })} placeholder="https://host:443" full />
            <Field label="Логин" value={form.login} onChange={(v) => set({ login: v })} />
            <Field label="Пароль" type="password" value={form.password} onChange={(v) => set({ password: v })} placeholder="•••••••• (не менять — оставьте пустым)" />
          </div>
        )}
        {form.provider === 'iikocloud' && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="apiLogin" hint="Ключ из личного кабинета iiko" value={form.apiLogin} onChange={(v) => set({ apiLogin: v })} />
            <Field label="ID организации (опц.)" value={form.organizationId} onChange={(v) => set({ organizationId: v })} />
          </div>
        )}
        {form.provider === 'mock' && (
          <p className="mt-4 rounded-lg bg-ink-900/40 px-3 py-2 text-sm text-slate-400">Демо-режим: обновление подставит встроенный набор данных. Для реальных данных выберите iikoOffice/RMS.</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={test} disabled={testing} className="btn border border-ink-600 bg-ink-800/70 text-slate-200 hover:bg-ink-750 disabled:opacity-60">
            <IPlug width={16} height={16} /> {testing ? 'Сохраняю и проверяю…' : 'Сохранить и проверить подключение'}
          </button>
          {testResult && (
            <span className={`chip ${testResult.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
              {testResult.ok ? <ICheck width={13} height={13} /> : <IClose width={13} height={13} />}{testResult.message}
            </span>
          )}
        </div>
      </Section>

      {/* schedule */}
      <Section title="Автообновление" subtitle="Приложение будет само подтягивать данные из iiko по расписанию.">
        <label className="flex cursor-pointer items-center gap-3">
          <Checkbox checked={form.autoEnabled} onChange={() => set({ autoEnabled: !form.autoEnabled })} />
          <span className="text-sm text-slate-200">Обновлять автоматически</span>
          <InfoTip text="Сервис на сервере запускает обновление по расписанию, даже когда приложение закрыто." />
        </label>
        <div className={`mt-3 flex flex-wrap gap-2 ${form.autoEnabled ? '' : 'pointer-events-none opacity-40'}`}>
          {INTERVALS.map((i) => (
            <button key={i.id} onClick={() => set({ interval: i.id })}
              className={`chip ${form.interval === i.id ? 'border-brand-500 bg-brand-500/10 text-brand-300' : 'border-ink-600 text-slate-400 hover:text-slate-200'}`}>
              {i.label}
            </button>
          ))}
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button onClick={save} className="btn bg-brand-500 text-white hover:bg-brand-600">Сохранить настройки</button>
        {saved && <span className="chip border-good/30 bg-good/10 text-good"><ICheck width={13} height={13} /> Сохранено</span>}
      </div>
    </div>
  )
}

function Field({ label, hint, value, onChange, type = 'text', placeholder, full }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; full?: boolean
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">{label}{hint && <InfoTip text={hint} />}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
      />
    </div>
  )
}
