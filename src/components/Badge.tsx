type BadgeProps = {
  variant: 'pending' | 'ordered' | 'received' | 'cancelled' | 'low' | 'ok' | 'warning' | 'empty' | string
  children: React.ReactNode
  className?: string
}

const labels: Record<string, string> = {
  pending: 'Ожидает',
  ordered: 'Заказан',
  received: 'Получен',
  cancelled: 'Отменён',
  ok: 'Норма',
  warning: 'Мало',
  low: 'Критично',
  empty: 'Пусто',
}

export default function Badge({ variant, children, className = '' }: BadgeProps) {
  return (
    <span className={`badge badge-${variant} ${className}`}>
      {children}
    </span>
  )
}

export { labels }
