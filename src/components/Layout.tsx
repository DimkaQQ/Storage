import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Package, ShoppingCart, Users, BarChart3, ChefHat, Menu, X } from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { to: '/', label: 'Главная', icon: LayoutDashboard },
  { to: '/inventory', label: 'Склад', icon: Package },
  { to: '/purchases', label: 'Закупки', icon: ShoppingCart },
  { to: '/suppliers', label: 'Поставщики', icon: Users },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  const currentPage = navItems.find((n) => n.to === location.pathname)?.label ?? 'Главная'

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-gray-900 text-white flex-shrink-0">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-700">
          <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center">
            <ChefHat size={20} />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">Склад</p>
            <p className="text-xs text-gray-400">Ресторан</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${isActive ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`
              }>
              <Icon size={18} />{label}
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-4 border-t border-gray-700">
          <p className="text-xs text-gray-500">© 2026 Restaurant WMS</p>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-gray-900 text-white flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center"><ChefHat size={20} /></div>
                <div><p className="font-semibold text-sm">Склад</p><p className="text-xs text-gray-400">Ресторан</p></div>
              </div>
              <button onClick={() => setMobileOpen(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === '/'} onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${isActive ? 'bg-orange-500 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`
                  }>
                  <Icon size={18} />{label}
                </NavLink>
              ))}
            </nav>
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 flex-shrink-0">
          <button onClick={() => setMobileOpen(true)} className="p-2 -ml-2 text-gray-600"><Menu size={22} /></button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center"><ChefHat size={16} className="text-white" /></div>
            <span className="font-semibold text-sm">{currentPage}</span>
          </div>
          <div className="w-10" />
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 max-w-7xl mx-auto pb-24 md:pb-6">{children}</div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex z-40">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors duration-150 ${isActive ? 'text-orange-500' : 'text-gray-400'}`
              }>
              <Icon size={20} />
              <span className="text-[10px] leading-none">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
