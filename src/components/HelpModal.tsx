import { useEffect } from 'react'
import { IClose, IScale, IStore, ILayers, IAlert, IGauge, ISpark } from './icons'

const STATUSES: { label: string; dot: string; text: string }[] = [
  { label: 'Переплата', dot: 'bg-bad', text: 'купили дороже плановой цены — здесь теряем деньги' },
  { label: 'Экономия', dot: 'bg-good', text: 'купили дешевле плановой цены — здесь выигрываем' },
  { label: 'В норме', dot: 'bg-slate-400', text: 'цена совпадает с планом (отклонение до 2%)' },
  { label: 'Нет в матрице', dot: 'bg-warn', text: 'такого товара нет в плановой матрице — не с чем сравнивать' },
  { label: 'Аномалия', dot: 'bg-purple-400', text: 'цена отличается от плана в разы — скорее всего перепутаны единицы (шт/кг), нужно проверить' },
]

const TERMS: { term: string; def: string }[] = [
  { term: 'План', def: 'целевая (договорная) цена за единицу товара — берётся из матрицы сырья.' },
  { term: 'Факт', def: 'реальная цена, по которой закупили — из отчёта iiko (сумма ÷ количество).' },
  { term: 'Эффект мониторинга', def: 'сколько денег сэкономили (+) или переплатили (−) относительно плана. Считается как (план − факт) × количество.' },
  { term: 'Отдельно / консолидировано', def: 'можно смотреть одну точку или все рестораны вместе — переключатель в правом верхнем углу.' },
  { term: 'ABC-анализ', def: 'разделение товаров по доле в затратах. Группа A — товары, на которые уходит 80% денег; за их ценами следим в первую очередь.' },
]

const SECTIONS: { icon: (p: any) => JSX.Element; name: string; text: string }[] = [
  { icon: IGauge, name: 'Обзор', text: 'общая картина за месяц: сколько потратили, где переплатили, где сэкономили.' },
  { icon: IScale, name: 'Проверка цен', text: 'главная таблица: план против факта по каждому товару. Можно искать, фильтровать и выгрузить в Excel (CSV).' },
  { icon: IStore, name: 'Рестораны', text: 'сравнение точек между собой; нажмите на карточку, чтобы открыть одну точку.' },
  { icon: ILayers, name: 'ABC-анализ', text: 'на какие товары уходит основная часть денег.' },
  { icon: IAlert, name: 'Аномалии', text: 'товары, которые нужно проверить вручную: нет в матрице или странная цена.' },
]

export default function HelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="animate-fade-in absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-scale-in relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 shadow-card">
        {/* header */}
        <div className="flex items-center justify-between border-b border-ink-700/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500 text-white"><ISpark width={16} height={16} /></span>
            <div>
              <h2 className="text-sm font-bold text-white">Как читать этот отчёт</h2>
              <p className="text-[11px] text-slate-500">Короткая инструкция — за 1 минуту</p>
            </div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-ink-800 hover:text-white">
            <IClose width={16} height={16} />
          </button>
        </div>

        {/* body */}
        <div className="space-y-6 overflow-y-auto px-6 py-5">
          <div className="rounded-xl border border-brand-500/25 bg-brand-500/10 p-4">
            <p className="text-sm text-slate-200">
              Приложение сравнивает <b className="text-white">плановую цену</b> (сколько товар должен стоить по договору — из матрицы)
              с <b className="text-white">фактической</b> (сколько реально заплатили — из iiko) и показывает,
              где ресторан <span className="text-bad">переплачивает</span> или <span className="text-good">экономит</span>.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Что означают цвета и статусы</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {STATUSES.map((s) => (
                <div key={s.label} className="flex items-start gap-2.5 rounded-lg bg-ink-900/50 px-3 py-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                  <div><span className="text-sm font-medium text-slate-100">{s.label}</span><span className="text-sm text-slate-400"> — {s.text}</span></div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Основные термины</h3>
            <dl className="space-y-2">
              {TERMS.map((t) => (
                <div key={t.term} className="rounded-lg bg-ink-900/50 px-3 py-2">
                  <dt className="text-sm font-semibold text-slate-100">{t.term}</dt>
                  <dd className="text-sm text-slate-400">{t.def}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Разделы приложения</h3>
            <div className="space-y-2">
              {SECTIONS.map((s) => (
                <div key={s.name} className="flex items-start gap-3 rounded-lg bg-ink-900/50 px-3 py-2">
                  <span className="mt-0.5 text-brand-300"><s.icon width={16} height={16} /></span>
                  <div><span className="text-sm font-medium text-slate-100">{s.name}</span><span className="text-sm text-slate-400"> — {s.text}</span></div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-ink-700/60 bg-ink-900/40 p-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Что сейчас в данных</h3>
            <p className="text-sm text-slate-400">
              Загружены данные за <b className="text-slate-200">май 2026</b>, категория <b className="text-slate-200">Кухня</b>, город <b className="text-slate-200">Алматы</b> (13 точек).
              Сравнение периодов (месяц/квартал/год), категории «алкоголь / безалкоголь / ERO» и город Астана
              появятся автоматически, когда будут загружены соответствующие выгрузки из iiko.
            </p>
          </div>
        </div>

        {/* footer */}
        <div className="border-t border-ink-700/60 px-6 py-3 text-right">
          <button onClick={onClose} className="btn bg-brand-500 text-white hover:bg-brand-600">Понятно</button>
        </div>
      </div>
    </div>
  )
}
