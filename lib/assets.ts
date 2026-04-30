export type AssetCategory = 'stock' | 'index' | 'commodity'

export interface Asset {
  ticker: string
  name: string
  category: AssetCategory
  decimals: number
  seedPrice: number
}

export const ASSETS: Asset[] = [
  // Stocks
  { ticker: 'NVDA',   name: 'NVIDIA',   category: 'stock',     decimals: 2, seedPrice: 112.40 },
  { ticker: 'TSLA',   name: 'TESLA',    category: 'stock',     decimals: 2, seedPrice: 284.60 },
  { ticker: 'AAPL',   name: 'APPLE',    category: 'stock',     decimals: 2, seedPrice: 206.10 },
  { ticker: 'AMZN',   name: 'AMAZON',   category: 'stock',     decimals: 2, seedPrice: 193.80 },
  { ticker: 'META',   name: 'META',     category: 'stock',     decimals: 2, seedPrice: 548.20 },
  { ticker: 'MSFT',   name: 'MICROSOF', category: 'stock',     decimals: 2, seedPrice: 416.50 },
  // Indices
  { ticker: 'SPX',    name: 'S&P 500',  category: 'index',     decimals: 2, seedPrice: 5612.80 },
  { ticker: 'NDX',    name: 'NASDAQ',   category: 'index',     decimals: 2, seedPrice: 19840.40 },
  { ticker: 'DJI',    name: 'DOW',      category: 'index',     decimals: 0, seedPrice: 40820 },
  { ticker: 'VIX',    name: 'VIX',      category: 'index',     decimals: 2, seedPrice: 21.40 },
  // Commodities
  { ticker: 'GOLD',   name: 'GOLD',     category: 'commodity', decimals: 2, seedPrice: 3418.50 },
  { ticker: 'SILVER', name: 'SILVER',   category: 'commodity', decimals: 2, seedPrice: 33.82 },
  { ticker: 'WTI',    name: 'WTI CRUDE',category: 'commodity', decimals: 2, seedPrice: 59.40 },
  { ticker: 'COPPER', name: 'COPPER',   category: 'commodity', decimals: 3, seedPrice: 4.680 },
]

export const ASSET_MAP = new Map<string, Asset>(ASSETS.map(a => [a.ticker, a]))

export function getAsset(ticker: string): Asset | undefined {
  return ASSET_MAP.get(ticker.toUpperCase())
}
