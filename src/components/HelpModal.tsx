import { useEffect } from 'react'
import Portal from './Portal'
import { IClose, IScale, IGauge, IDatabase, ISpark } from './icons'

const STATUSES: { label: string; dot: string; text: string }[] = [
  { label: 'Переплата', dot: 'bg-bad', text: 'купили дороже плановой цены — здесь теряем деньги' },
  { label: 'Экономия', dot: 'bg-good', text: 'купили дешевле плановой цены — здесь выигрываем' },
  { label: 'В норме', dot: 'bg-slate-400', text: 'цена совпадает с планом (отклонение до 2%)' },
  { label: 'Не тот поставщик', dot: 'bg-warn', text: 'товар есть в матрице, но купили не у назначенного поставщика — по этой позиции нет смысла сравнивать цену' },
  { label: 'Нет в матрице', dot: 'bg-purple-400', text: 'такого товара нет в плановой матрице ни у одного поставщика для этой точки' },
]

const TERMS: { term: string; def: string }[] = [
  { term: 'План', def: 'целевая (договорная) цена за единицу товара — берётся из вашей матрицы, отдельно для каждой точки.' },
  { term: 'Факт', def: 'реальная цена, по которой закупили — из отчёта iiko (сумма ÷ количество).' },
  { term: 'Δ%', def: 'на сколько процентов факт отличается от плана. Плюс — дороже, минус — дешевле.' },
  { term: 'Справочник', def: 'сопоставление названий компаний между iiko и матрицей — одна и та же компания может называться по-разному.' },
]

const SECTIONS: { icon: (p: any) => JSX.Element; name: string; text: string }[] = [
  { icon: IGauge, name: 'Обзор', text: 'общая картина за месяц: сколько потратили, где переплатили, где сэкономили.' },
  { icon: IScale, name: 'Проверка цен', text: 'главная таблица: план против факта по каждому товару, ресторану и поставщику. Поиск, фильтры, выгрузка в Excel.' },
  { icon: IDatabase, name: 'Справочники', text: 'компании (и их сопоставление с матрицей), товары, точки продаж.' },
]

export default function HelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="animate-fade-in absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-scale-in relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 shadow-card">
        {/* header */}
        <div className="flex items-center justify-between border-b border-ink-700/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500 text-white"><ISpark width={22} height={22} /></span>
            <div>
              <h2 className="text-base font-bold text-white">Как читать этот отчёт</h2>
              <p className="text-xs text-slate-500">Короткая инструкция — за 1 минуту</p>
            </div>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-ink-800 hover:text-white">
            <IClose width={18} height={18} />
          </button>
        </div>

        {/* body */}
        <div className="space-y-6 overflow-y-auto px-6 py-5">
          <div className="rounded-xl border border-brand-500/25 bg-brand-500/10 p-4">
            <p className="text-sm text-slate-200">
              Приложение сравнивает <b className="text-white">плановую цену</b> (сколько товар должен стоить по договору — из вашей матрицы)
              с <b className="text-white">фактической</b> (сколько реально заплатили — из iiko) и показывает,
              где ресторан <span className="text-bad">переплачивает</span>, где <span className="text-good">экономит</span>,
              и где закупили не у того поставщика, что назначен в матрице.
            </p>
          </div>

          <div>
            <h3 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wider text-slate-400">Что означают статусы</h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {STATUSES.map((s) => (
                <div key={s.label} className="flex items-start gap-3 rounded-xl bg-ink-900/50 px-3.5 py-3">
                  <span className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full ${s.dot}`} />
                  <div className="text-sm leading-relaxed"><span className="font-semibold text-slate-100">{s.label}</span><span className="text-slate-400"> — {s.text}</span></div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wider text-slate-400">Основные термины</h3>
            <dl className="space-y-2.5">
              {TERMS.map((t) => (
                <div key={t.term} className="rounded-xl bg-ink-900/50 px-3.5 py-3">
                  <dt className="text-sm font-semibold text-slate-100">{t.term}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-slate-400">{t.def}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h3 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wider text-slate-400">Разделы приложения</h3>
            <div className="space-y-2.5">
              {SECTIONS.map((s) => (
                <div key={s.name} className="flex items-start gap-3 rounded-xl bg-ink-900/50 px-3.5 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-500/12 text-brand-300"><s.icon width={20} height={20} /></span>
                  <div className="pt-0.5 text-sm leading-relaxed"><span className="font-semibold text-slate-100">{s.name}</span><span className="text-slate-400"> — {s.text}</span></div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-ink-700/60 bg-ink-900/40 p-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Что сейчас в данных</h3>
            <p className="text-sm text-slate-400">
              Реальные данные за <b className="text-slate-200">май 2026</b>, город <b className="text-slate-200">Алматы</b> (15 точек),
              взяты напрямую из вашей матрицы и отчётов iiko. Автоматическая подгрузка из iiko подключится, когда будут готовы доступы —
              пока обновление данных ручное.
            </p>
          </div>
        </div>

        {/* footer */}
        <div className="border-t border-ink-700/60 px-6 py-3 text-right">
          <button onClick={onClose} className="btn bg-brand-500 text-white hover:bg-brand-600">Понятно</button>
        </div>
      </div>
    </div>
    </Portal>
  )
}
