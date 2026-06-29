import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Package, ShoppingCart, Truck, BarChart3 } from 'lucide-react'

const nav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Главная' },
  { to: '/inventory', icon: Package, label: 'Склад' },
  { to: '/purchases', icon: ShoppingCart, label: 'Закупки' },
  { to: '/suppliers', icon: Truck, label: 'Поставщики' },
  { to: '/analytics', icon: BarChart3, label: 'Аналитика' },
]

export default function MobileNav() {
  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-30 safe-bottom"
      style={{ background: 'var(--card)', borderTop: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-around">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className="flex flex-col items-center gap-0.5 px-3 py-2.5 flex-1 transition-colors"
            style={({ isActive }) => ({
              color: isActive ? 'var(--gold)' : 'var(--muted)',
            })}
          >
            {({ isActive }) => (
              <>
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{label}</span>
                {isActive && (
                  <span className="absolute bottom-0 h-0.5 w-6 rounded-full" style={{ background: 'var(--gold)' }} />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
