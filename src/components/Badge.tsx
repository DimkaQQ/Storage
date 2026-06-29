type BadgeProps = {
  variant: 'pending' | 'ordered' | 'received' | 'cancelled' | 'low' | 'ok' | string
  children: React.ReactNode
  className?: string
}

const variants: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  ordered: 'bg-blue-100 text-blue-700 border-blue-200',
  received: 'bg-green-100 text-green-700 border-green-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
  low: 'bg-red-100 text-red-600 border-red-200',
  ok: 'bg-green-100 text-green-600 border-green-200',
}

const labels: Record<string, string> = {
  pending: 'Ожидает',
  ordered: 'Заказан',
  received: 'Получен',
  cancelled: 'Отменён',
}

export default function Badge({ variant, children, className = '' }: BadgeProps) {
  const style = variants[variant] ?? 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${style} ${className}`}>
      {children}
    </span>
  )
}

export { labels }
