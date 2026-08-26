import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { summarize } from './lib/data'
import { useEdits } from './lib/edits'
import { useAuth } from './lib/auth'
import { IGauge, IScale, ISpark, IDatabase, ISync, IUser, ILogout, IPin, ILayers } from './components/icons'
import ScopePicker from './components/ScopePicker'
import ThemePicker from './components/ThemePicker'
import FilterDropdown from './components/FilterDropdown'
import PeriodPicker from './components/PeriodPicker'

// Pages are code-split: only the open page's code is downloaded.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const PriceCheck = lazy(() => import('./pages/PriceCheck'))
const DataEditor = lazy(() => import('./pages/DataEditor'))
const IikoSettings = lazy(() => import('./pages/IikoSettings'))
const UsersAdmin = lazy(() => import('./pages/UsersAdmin'))

type PageId = 'dashboard' | 'pricecheck' | 'data' | 'iiko' | 'users'

const NAV: { id: PageId; label: string; icon: (p: any) => JSX.Element; hint: string; adminOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Обзор', icon: IGauge, hint: 'Ключевые показатели' },
  { id: 'pricecheck', label: 'Проверка цен', icon: IScale, hint: 'План против факта' },
  { id: 'data', label: 'Справочники', icon: IDatabase, hint: 'Компании, товары, точки' },
  { id: 'iiko', label: 'Обновление', icon: ISync, hint: 'Загрузка из iiko' },
  { id: 'users', label: 'Команда', icon: IUser, hint: 'Пользователи вашей сети', adminOnly: true },
]

export default function App() {
  const [page, setPage] = useState<PageId>('dashboard')
  // Страницы монтируются один раз, при первом заходе, и дальше просто
  // скрываются/показываются (display:none), а не размонтируются — иначе
  // переключение вкладок туда-обратно каждый раз заново гоняло все эффекты
  // загрузки/пересчёта и сбрасывало несохранённое состояние страницы
  // (ровно так один раз потерялась форма в «Настройки iiko» — вкладка
  // размонтировалась, эффект перезапросил настройки с сервера, а то, что
  // было введено, но не сохранено, пропало).
  const [visited, setVisited] = useState<PageId[]>(['dashboard'])
  const mainRef = useRef<HTMLElement>(null)
  const scrollPositions = useRef<Map<PageId, number>>(new Map())
  const goTo = (p: PageId) => {
    if (mainRef.current) scrollPositions.current.set(page, mainRef.current.scrollTop)
    setPage(p)
    setVisited((v) => (v.includes(p) ? v : [...v, p]))
  }
  // Восстанавливаем прокрутку страницы, на которую перешли — свою для
  // каждой вкладки, а не общую (иначе скролл с одной страницы протекал бы
  // на другую, т.к. <main> у них один и тот же контейнер).
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = scrollPositions.current.get(page) ?? 0
  }, [page])
  const [scope, setScope] = useState<Set<string>>(new Set()) // empty = all (consolidated)
  const [cityFilter, setCityFilter] = useState<string | null>(null) // null = all cities
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null) // null = all categories
  const { rows: allRows, period, periodKey, periods, setPeriod, restaurants, noMatrixTest, matchingIsStale, matchingPeriodLabel } = useEdits()
  const { user, logout } = useAuth()
  const nav = NAV.filter((n) => !n.adminOnly || user?.role === 'admin')

  const cities = useMemo(() => [...new Set(restaurants.map((r) => r.city))].sort(), [restaurants])
  const categories = useMemo(() => [...new Set(allRows.map((r) => r.category))].sort(), [allRows])
  const venuesInCity = useMemo(
    () => (cityFilter ? restaurants.filter((r) => r.city === cityFilter) : restaurants),
    [restaurants, cityFilter],
  )

  const rows = useMemo(() => {
    let r = allRows
    if (categoryFilter) r = r.filter((x) => x.category === categoryFilter)
    if (cityFilter) r = r.filter((x) => x.city === cityFilter)
    if (scope.size > 0) r = r.filter((x) => scope.has(x.restaurant))
    return r
  }, [allRows, categoryFilter, cityFilter, scope])
  const openIssues = useMemo(() => summarize(allRows).openIssues, [allRows])

  const pickCity = (c: string | null) => { setCityFilter(c); setScope(new Set()) }
  const showFilters = page !== 'data' && page !== 'iiko' && page !== 'users'
  const showPeriodPicker = page !== 'iiko' && page !== 'users'

  return (
    <>
      <div className="hidden h-screen overflow-hidden min-[1100px]:flex">
        {/* Sidebar */}
        <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-ink-700/50 bg-ink-900">
          <div className="flex items-center gap-3 px-5 py-5">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500 shadow-[0_8px_24px_-6px_rgb(var(--brand-500)/0.55)]">
              <ISpark className="text-white" />
            </div>
            <div>
              <div className="text-[15px] font-bold leading-tight text-white">Проверка цен</div>
              <div className="text-[11px] text-slate-500">Мониторинг закупок</div>
            </div>
          </div>

          <nav className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
            {nav.map((n) => {
              const active = page === n.id
              return (
                <button
                  key={n.id}
                  onClick={() => goTo(n.id)}
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
                      {n.id === 'pricecheck' && openIssues > 0 && (
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

          <div className="border-t border-ink-700/50 px-5 py-3 text-[11px] text-slate-500">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-slate-400" title={user?.email}>{user?.email}</span>
              <button onClick={logout} className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-ink-800 hover:text-white" title="Выйти">
                <ILogout width={14} height={14} />
              </button>
            </div>
          </div>
          <div className="border-t border-ink-700/50 px-5 py-4 text-[11px] text-slate-500">
            <span>Данные iiko × Матрица</span>
            <div className="mt-1 text-slate-600">{restaurants.length} точек</div>
          </div>
        </aside>

        {/* Main — колонка на всю высоту экрана: шапка не скроллится сама
            (она просто выше скролл-области), а скроллится только <main>.
            Поэтому шапке таблицы внутри достаточно обычного sticky top-0,
            как и у самой шапки приложения — без вычисления отступов. */}
        <div className="flex h-full min-w-0 flex-1 flex-col ml-64">
          <header className="shrink-0 border-b border-ink-700/50 bg-ink-950">
            {noMatrixTest && (
              <div className="border-b border-warn/30 bg-warn/10 px-8 py-1.5 text-center text-[11px] font-medium text-warn">
                Тестовый режим: матрица отключена — везде как будто только что загружен отчёт iiko, без сопоставления. Выключить — в Справочниках.
              </div>
            )}
            {!noMatrixTest && matchingIsStale && (
              <div className="border-b border-warn/30 bg-warn/10 px-8 py-1.5 text-center text-[11px] font-medium text-warn">
                План-цены за «{period}» ещё не загружены — везде показана матрица за «{matchingPeriodLabel}». Цены реально отличаются месяц к месяцу, сверяйте с осторожностью.
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-8 py-4">
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-white">{nav.find((n) => n.id === page)!.label}</h1>
                <p className="text-xs text-slate-500">
                  Период: <span className="text-slate-300">{period}</span> · Город:{' '}
                  <span className="text-slate-300">{cityFilter ?? (cities.length > 1 ? 'все' : cities[0] ?? 'все')}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {showPeriodPicker && <PeriodPicker periods={periods} value={periodKey} onChange={setPeriod} />}
                {showFilters && categories.length > 1 && (
                  <FilterDropdown label="Категория закупок" icon={ILayers} value={categoryFilter} options={categories} onChange={setCategoryFilter} />
                )}
                {showFilters && cities.length > 1 && (
                  <FilterDropdown label="Город" icon={IPin} value={cityFilter} options={cities} onChange={pickCity} />
                )}
                <ThemePicker />
                {showFilters && (
                  <ScopePicker
                    options={venuesInCity.map((r) => r.name)}
                    selected={scope}
                    onChange={setScope}
                  />
                )}
              </div>
            </div>
          </header>

          <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            {/* Каждая посещённая страница остаётся смонтированной — просто
                прячется, пока открыта другая (см. комментарий у visited
                выше). Suspense у каждой свой, чтобы загрузка чанка ЕЩЁ не
                открытой страницы не прятала уже отрисованную текущую. */}
            {visited.map((id) => (
              <div key={id} style={{ display: page === id ? 'block' : 'none' }} className={page === id ? 'animate-fade-in' : undefined}>
                <Suspense fallback={<PageLoading />}>
                  {id === 'dashboard' && <Dashboard rows={rows} onNav={(p) => goTo(p as PageId)} />}
                  {id === 'pricecheck' && <PriceCheck rows={rows} />}
                  {id === 'data' && <DataEditor />}
                  {id === 'iiko' && <IikoSettings />}
                  {id === 'users' && <UsersAdmin />}
                </Suspense>
              </div>
            ))}

            <footer className="px-0 pb-2 pt-6 text-center text-[11px] text-slate-600">
              Проверка закупочных цен · план (матрица) против факта (iiko) · {period}
            </footer>
          </main>
        </div>
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
