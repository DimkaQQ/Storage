import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Package, ShoppingCart, Truck, Tag, BarChart3, ChefHat, Menu, X, MapPin, Building2, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store/useStore'

const navItems = [
  { to: '/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { to: '/venues', label: 'Точки', icon: Building2 },
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
  { to: '/venues', label: 'Точки', icon: Building2 },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
]

function VenueSelector({ onSelect }: { onSelect?: () => void }) {
  const { venues, selectedVenueId, setSelectedVenue } = useStore()
  const [open, setOpen] = useState(false)
  const selected = venues.find((v) => v.id === selectedVenueId)

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      >
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: selectedVenueId ? 'var(--gold)' : 'var(--muted)' }} />
          <span className="text-sm font-medium truncate" style={{ color: selectedVenueId ? 'var(--gold)' : 'var(--white)' }}>
            {selected ? selected.name : 'Все точки'}
          </span>
        </div>
        <ChevronDown
          className="w-3.5 h-3.5 flex-shrink-0 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--muted)' }}
        />
      </button>

      {/* Dropdown list */}
      {open && (
        <div className="px-3 pb-2 space-y-0.5">
          {[{ id: null, name: 'Все точки' }, ...venues].map((v) => {
            const isActive = v.id === selectedVenueId
            return (
              <button
                key={v.id ?? 'all'}
                onClick={() => { setSelectedVenue(v.id); setOpen(false); onSelect?.() }}
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all"
                style={{
                  background: isActive ? 'var(--gold-dim)' : 'transparent',
                  color: isActive ? 'var(--gold)' : 'var(--muted)',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: isActive ? 'inset 3px 0 0 var(--gold)' : 'none',
                }}
              >
                <span className="truncate">{v.name}</span>
                {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--gold)' }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { selectedVenueId, venues } = useStore()
  const selectedVenue = venues.find((v) => v.id === selectedVenueId)

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col w-64 h-screen fixed left-0 top-0 z-30 overflow-hidden"
        style={{
          background: 'rgba(10,10,10,0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRight: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center gap-3 px-5 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--gold-dim)', border: '1px solid rgba(200,168,75,0.3)' }}>
            <ChefHat className="w-5 h-5" style={{ color: 'var(--gold)' }} />
          </div>
          <div>
            <p style={{ fontFamily: "'Instrument Serif', serif", color: 'var(--white)', fontSize: '1rem', lineHeight: 1.2, fontWeight: 600 }}>Склад</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Сеть ресторанов</p>
          </div>
        </div>

        <VenueSelector />

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
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
          <p className="text-xs" style={{ color: 'var(--muted)' }}>DimkaProjects — ADM</p>
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
            className="absolute left-0 top-0 bottom-0 w-64 flex flex-col"
            style={{
              background: 'rgba(10,10,10,0.95)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderRight: '1px solid var(--border)',
            }}
          >
            <div className="flex items-center justify-between px-5 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--gold-dim)', border: '1px solid rgba(200,168,75,0.3)' }}>
                  <ChefHat className="w-5 h-5" style={{ color: 'var(--gold)' }} />
                </div>
                <div>
                  <p style={{ fontFamily: "'Instrument Serif', serif", color: 'var(--white)', fontSize: '1rem', fontWeight: 600 }}>Склад</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Сеть ресторанов</p>
                </div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <VenueSelector onSelect={() => setMobileOpen(false)} />

            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
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
      <div className="flex-1 flex flex-col lg:ml-64 min-w-0">
        {/* Mobile header */}
        <header
          className="lg:hidden flex items-center justify-between px-4 py-3 sticky top-0 z-20"
          style={{
            background: 'rgba(10,10,10,0.9)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <button
            onClick={() => setMobileOpen(true)}
            style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem' }}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--gold-dim)', border: '1px solid rgba(200,168,75,0.3)' }}>
                <ChefHat className="w-3.5 h-3.5" style={{ color: 'var(--gold)' }} />
              </div>
              <span className="font-semibold text-sm" style={{ color: 'var(--white)' }}>Склад Ресторана</span>
            </div>
            {selectedVenue && (
              <span className="text-xs mt-0.5" style={{ color: 'var(--gold)' }}>{selectedVenue.name}</span>
            )}
          </div>
          <div className="w-7" />
        </header>

        <main className="flex-1 pb-20 lg:pb-0">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav
          className="lg:hidden fixed bottom-0 left-0 right-0 z-30"
          style={{
            background: 'rgba(10,10,10,0.9)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderTop: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center justify-around">
            {mobileNavItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className="flex flex-col items-center gap-0.5 px-3 py-2.5 flex-1 transition-colors relative"
                style={({ isActive }) => ({ color: isActive ? 'var(--gold)' : 'var(--muted)' })}
              >
                {({ isActive }) => (
                  <>
                    <Icon className="w-5 h-5" />
                    <span className="text-[10px] font-medium">{label}</span>
                    {isActive && (
                      <span
                        className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                        style={{ background: 'var(--gold)' }}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}
