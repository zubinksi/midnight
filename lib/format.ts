import { ASSET_MAP } from './assets'

export function formatPrice(ticker: string, price: number): string {
  const asset = ASSET_MAP.get(ticker)
  const decimals = asset?.decimals ?? 2
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatChange(diff: number, pct: number, decimals = 2): { diffStr: string; pctStr: string } {
  const sign = diff >= 0 ? '+' : ''
  const diffStr = `${sign}$${Math.abs(diff).toFixed(decimals)}`
  const pctStr = `${sign}${pct.toFixed(2)}%`
  return { diffStr, pctStr }
}

export function formatVolume(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

export function formatDate(): string {
  const now = new Date()
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const day = days[now.getDay()]
  const month = months[now.getMonth()]
  const date = now.getDate()
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  return `${day}, ${month} ${date}  ${h}:${m}`
}
