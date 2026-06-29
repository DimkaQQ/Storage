/**
 * Format a number as tenge currency: 1 250 000 ₸
 */
export function formatPrice(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
}

/**
 * Format a number with Russian space separator
 */
export function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}
