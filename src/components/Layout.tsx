import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Package, ShoppingCart, Truck, Tag, BarChart3, ChefHat, Menu, X } from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { to: '/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { to: '/inventory', label: 'Склад', icon: Package },
  { to: '/purchases', label: 'Закупки', icon: ShoppingCart },
  { to: '/suppliers', label: 'Поставщики', icon: Truck },
  { to: '/categories', label: 'Категории', icon: Tag },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
]

const mobileNavItems = [
  { to: '/dashboard', label: 'Главная', icon: LayoutDashboard },
  { to: '/inventory', label: 'Склад', icon: Package },
  { to: '/purchases', label: 'Закупки', icon: ShoppingCart },
  { to: '/suppliers', label: 'Поставщики', icon: Truck },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--black)' }}>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col w-60 min-h-screen fixed left-0 top-0 z-30"
        style={{ background: 'var(--card)', borderRight: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3 px-5 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(200,168,75,0.15)', border: '1px solid rgba(200,168,75,0.3)' }}>
            <ChefHat className="w-5 h-5" style={{ color: 'var(--gold)' }} />
          </div>
          <div>
            <p style={{ fontFamily: "'Instrument Serif', serif", color: 'var(--white)', fontSize: '1rem', lineHeight: 1.2, fontWeight: 600 }}>Склад</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Ресторан</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>v1.0.0 • PWA</p>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="absolute left-0 top-0 bottom-0 w-60 flex flex-col"
            style={{ background: 'var(--card)', borderRight: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between px-5 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ background: 'rgba(200,168,75,0.15)', border: '1px solid rgba(200,168,75,0.3)' }}>
                  <ChefHat className="w-5 h-5" style={{ color: 'var(--gold)' }} />
                </div>
                <div>
                  <p style={{ fontFamily: "'Instrument Serif', serif", color: 'var(--white)', fontSize: '1rem', fontWeight: 600 }}>Склад</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Ресторан</p>
                </div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-0.5">
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 flex flex-col lg:ml-60 min-w-0">
        {/* Mobile header */}
        <header
          className="lg:hidden flex items-center justify-between px-4 py-3 sticky top-0 z-20"
          style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)' }}
        >
          <button
            onClick={() => setMobileOpen(true)}
            style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem' }}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(200,168,75,0.15)', border: '1px solid rgba(200,168,75,0.3)' }}>
              <ChefHat className="w-4 h-4" style={{ color: 'var(--gold)' }} />
            </div>
            <span className="font-semibold text-sm" style={{ color: 'var(--white)' }}>Склад Ресторана</span>
          </div>
          <div className="w-7" />
        </header>

        <main className="flex-1 pb-20 lg:pb-0">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav
          className="lg:hidden fixed bottom-0 left-0 right-0 z-30"
          style={{ background: 'var(--card)', borderTop: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-around">
            {mobileNavItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className="flex flex-col items-center gap-0.5 px-3 py-2.5 flex-1 transition-colors relative"
                style={({ isActive }) => ({ color: isActive ? 'var(--gold)' : 'var(--muted)' })}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}
