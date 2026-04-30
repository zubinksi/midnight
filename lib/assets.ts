// Asset types — the live list is fetched from /api/assets at runtime.
// Categories are not yet known for all assets; that's handled separately.

export type AssetCategory = 'stock' | 'index' | 'commodity'

export interface AssetInfo {
  ticker: string
  volume24h: number
  price: number       // mark price at fetch time
  prevDayPx: number   // UTC-midnight open, for 24hr change
  openInterest: number
  funding: number
  szDecimals: number
  category?: AssetCategory
}

// Infer display decimals from price magnitude.
export function priceDecimals(price: number): number {
  if (price >= 1000)  return 2
  if (price >= 100)   return 2
  if (price >= 10)    return 2
  if (price >= 1)     return 3
  if (price >= 0.1)   return 4
  return 5
}
