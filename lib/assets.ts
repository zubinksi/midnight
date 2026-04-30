export type AssetCategory = 'stock' | 'index' | 'commodity'

export interface AssetInfo {
  ticker: string        // display name, e.g. "NVDA"
  coin: string          // Hyperliquid coin ID, e.g. "xyz:NVDA" — use for all API calls
  volume24h: number
  price: number         // mark price at last fetch
  prevDayPx: number     // UTC-midnight open, for 24hr change
  openInterest: number
  funding: number
  szDecimals: number
  category?: AssetCategory
}

// Infer display decimal places from price magnitude.
export function priceDecimals(price: number): number {
  if (price >= 10000) return 2
  if (price >= 1000)  return 2
  if (price >= 100)   return 2
  if (price >= 10)    return 2
  if (price >= 1)     return 3
  if (price >= 0.1)   return 4
  return 5
}
