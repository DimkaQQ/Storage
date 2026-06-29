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
    <aside className="hidden lg:flex flex-col w-64 bg-gray-900 min-h-screen fixed left-0 top-0 z-30">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-6 border-b border-white/10">
        <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center flex-shrink-0">
          <ChefHat className="w-6 h-6 text-white" />
        </div>
        <div>
          <p className="text-white font-bold text-base leading-tight">Склад</p>
          <p className="text-gray-400 text-xs">Ресторан</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'active' : ''}`
            }
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <p className="text-gray-500 text-xs">v1.0.0 • PWA</p>
      </div>
    </aside>
  )
}
