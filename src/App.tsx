import { lazy, Suspense, useMemo, useState } from 'react'
import { summarize } from './lib/data'
import { useEdits } from './lib/edits'
import { IGauge, IScale, IStore, ILayers, IAlert, ISpark, IHelp, IDatabase, ISync, IChart } from './components/icons'
import HelpModal from './components/HelpModal'
import ScopePicker from './components/ScopePicker'

// Pages are code-split: only the open page's code is downloaded.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const PriceCheck = lazy(() => import('./pages/PriceCheck'))
const Restaurants = lazy(() => import('./pages/Restaurants'))
const Analytics = lazy(() => import('./pages/Analytics'))
const ABC = lazy(() => import('./pages/ABC'))
const Reconcile = lazy(() => import('./pages/Reconcile'))
const DataEditor = lazy(() => import('./pages/DataEditor'))
const IikoSettings = lazy(() => import('./pages/IikoSettings'))

type PageId = 'dashboard' | 'pricecheck' | 'restaurants' | 'analytics' | 'abc' | 'reconcile' | 'data' | 'iiko'

const NAV: { id: PageId; label: string; icon: (p: any) => JSX.Element; hint: string }[] = [
  { id: 'dashboard', label: 'Обзор', icon: IGauge, hint: 'Ключевые показатели' },
  { id: 'pricecheck', label: 'Проверка цен', icon: IScale, hint: 'План против факта' },
  { id: 'restaurants', label: 'Рестораны', icon: IStore, hint: 'По точкам и консолид.' },
  { id: 'analytics', label: 'Аналитика', icon: IChart, hint: 'Города, бренды, поставщики' },
  { id: 'abc', label: 'ABC-анализ', icon: ILayers, hint: 'Структура закупок' },
  { id: 'reconcile', label: 'Сверка', icon: IAlert, hint: 'Несостыковки и правки' },
  { id: 'data', label: 'Данные', icon: IDatabase, hint: 'Справочники и цены' },
  { id: 'iiko', label: 'Обновление', icon: ISync, hint: 'Загрузка из iiko' },
]

export default function App() {
  const [page, setPage] = useState<PageId>('dashboard')
  const [scope, setScope] = useState<Set<string>>(new Set()) // empty = all (consolidated)
  const [cityFilter, setCityFilter] = useState<string | null>(null) // null = all cities
  const [help, setHelp] = useState(false)
  const { rows: allRows, editCount, period, category, restaurants } = useEdits()

  const cities = useMemo(() => [...new Set(restaurants.map((r) => r.city))].sort(), [restaurants])
  const venuesInCity = useMemo(
    () => (cityFilter ? restaurants.filter((r) => r.city === cityFilter) : restaurants),
    [restaurants, cityFilter],
  )

  const rows = useMemo(() => {
    let r = allRows
    if (cityFilter) r = r.filter((x) => x.city === cityFilter)
    if (scope.size > 0) r = r.filter((x) => scope.has(x.restaurant))
    return r
  }, [allRows, cityFilter, scope])
  const openIssues = useMemo(() => summarize(allRows).openIssues, [allRows])

  const pickCity = (c: string | null) => { setCityFilter(c); setScope(new Set()) }

  return (
    <>
      <div className="hidden min-[1100px]:flex min-h-screen">
        {/* Sidebar */}
        <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-ink-700/50 bg-ink-900">
          <div className="flex items-center gap-3 px-5 py-5">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500 shadow-[0_8px_24px_-6px_rgba(61,107,255,0.7)]">
              <ISpark className="text-white" />
            </div>
            <div>
              <div className="text-[15px] font-bold leading-tight text-white">Проверка цен</div>
              <div className="text-[11px] text-slate-500">Мониторинг закупок</div>
            </div>
          </div>

          <nav className="mt-2 flex-1 space-y-1 px-3">
            {NAV.map((n) => {
              const active = page === n.id
              return (
                <button
                  key={n.id}
                  onClick={() => setPage(n.id)}
                  className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 ${
                    active ? 'bg-brand-500/15 text-white' : 'text-slate-400 hover:translate-x-0.5 hover:bg-ink-800/70 hover:text-slate-200'
                  }`}
                >
                  <span className={`transition-transform duration-200 group-hover:scale-110 ${active ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300'}`}>
                    <n.icon />
                  </span>
                  <span className="flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {n.label}
                      {n.id === 'data' && editCount > 0 && (
                        <span className="rounded-full bg-brand-500/20 px-1.5 text-[10px] font-semibold text-brand-300">{editCount}</span>
                      )}
                      {n.id === 'reconcile' && openIssues > 0 && (
                        <span className="rounded-full bg-warn/20 px-1.5 text-[10px] font-semibold text-warn">{openIssues}</span>
                      )}
                    </span>
                    <span className="block text-[11px] text-slate-500">{n.hint}</span>
                  </span>
                  <span className={`absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-brand-400 transition-all duration-300 ${active ? 'opacity-100' : 'opacity-0'}`} />
                </button>
              )
            })}
          </nav>

          <div className="border-t border-ink-700/50 px-5 py-4 text-[11px] text-slate-500">
            <div className="flex items-center justify-between">
              <span>Данные iiko × Матрица</span>
            </div>
            <div className="mt-1 text-slate-600">{restaurants.length} точек · {category}</div>
          </div>
        </aside>

        {/* Main */}
        <div className="ml-64 flex-1">
          <header className="sticky top-0 z-10 border-b border-ink-700/50 bg-ink-950">
            <div className="flex items-center justify-between gap-4 px-8 py-4">
              <div>
                <h1 className="text-lg font-bold text-white">{NAV.find((n) => n.id === page)!.label}</h1>
                <p className="text-xs text-slate-500">
                  Период: <span className="text-slate-300">{period}</span> · Город:{' '}
                  <span className="text-slate-300">{cityFilter ?? 'все'}</span> · Категория:{' '}
                  <span className="text-slate-300">{category}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                {page !== 'data' && page !== 'iiko' && cities.length > 1 && (
                  <div className="flex items-center rounded-lg border border-ink-600 bg-ink-800/80 p-0.5">
                    <CityBtn label="Все" active={cityFilter === null} onClick={() => pickCity(null)} />
                    {cities.map((c) => (
                      <CityBtn key={c} label={c} active={cityFilter === c} onClick={() => pickCity(c)} />
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setHelp(true)}
                  className="btn border border-ink-600 bg-ink-800/80 text-slate-300 hover:border-brand-500/50 hover:text-white"
                  title="Как читать этот отчёт"
                >
                  <IHelp width={16} height={16} className="text-brand-300" />
                  Справка
                </button>
                {page !== 'data' && page !== 'iiko' && (
                  <ScopePicker
                    options={venuesInCity.map((r) => r.name)}
                    selected={scope}
                    onChange={setScope}
                  />
                )}
              </div>
            </div>
          </header>

          <main className="px-8 py-6">
            <Suspense fallback={<PageLoading />}>
              <div key={page} className="animate-fade-in">
                {page === 'dashboard' && <Dashboard rows={rows} onNav={(p) => setPage(p as PageId)} />}
                {page === 'pricecheck' && <PriceCheck rows={rows} />}
                {page === 'restaurants' && <Restaurants rows={rows} scope={scope} onScope={setScope} onNav={() => setPage('pricecheck')} />}
                {page === 'analytics' && <Analytics rows={rows} />}
                {page === 'abc' && <ABC rows={rows} />}
                {page === 'reconcile' && <Reconcile rows={rows} />}
                {page === 'data' && <DataEditor />}
                {page === 'iiko' && <IikoSettings />}
              </div>
            </Suspense>
          </main>

          <footer className="px-8 pb-8 pt-2 text-center text-[11px] text-slate-600">
            Проверка закупочных цен · план (матрица) против факта (iiko) · {period}
          </footer>
        </div>

        {help && <HelpModal onClose={() => setHelp(false)} />}
      </div>

      {/* Desktop-only guard */}
      <div className="flex min-h-screen items-center justify-center px-6 text-center min-[1100px]:hidden">
        <div className="card max-w-sm p-8">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-brand-500">
            <ISpark className="text-white" />
          </div>
          <h2 className="text-base font-semibold text-white">Только для десктопа</h2>
          <p className="mt-2 text-sm text-slate-400">
            Дашборд «Проверка цен» рассчитан на большой экран. Откройте приложение на компьютере
            с шириной окна не менее 1100&nbsp;px.
          </p>
        </div>
      </div>
    </>
  )
}

function PageLoading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-600 border-t-brand-400" />
    </div>
  )
}

function CityBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
    >
      {label}
    </button>
  )
}
