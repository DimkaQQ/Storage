import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  Tag,
  BarChart3,
  ChefHat,
} from 'lucide-react'

const nav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Дашборд' },
  { to: '/inventory', icon: Package, label: 'Склад' },
  { to: '/purchases', icon: ShoppingCart, label: 'Закупки' },
  { to: '/suppliers', icon: Truck, label: 'Поставщики' },
  { to: '/categories', icon: Tag, label: 'Категории' },
  { to: '/analytics', icon: BarChart3, label: 'Аналитика' },
]

export default function Sidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-60 min-h-screen fixed left-0 top-0 z-30" style={{ background: 'var(--card)', borderRight: '1px solid var(--border)' }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(200,168,75,0.15)', border: '1px solid rgba(200,168,75,0.3)' }}>
          <ChefHat className="w-5 h-5" style={{ color: 'var(--gold)' }} />
        </div>
        <div>
          <p className="font-bold text-sm leading-tight" style={{ fontFamily: "'Instrument Serif', serif", color: 'var(--white)', fontSize: '1rem' }}>Склад</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Ресторан</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ to, icon: Icon, label }) => (
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

      {/* Footer */}
      <div className="px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>v1.0.0 • PWA</p>
      </div>
    </aside>
  )
}
