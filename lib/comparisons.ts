export interface SavedComparison {
  id: string       // tickers.join('_') — used as the URL slug too
  tickers: string[]
}

const KEY = 'neue-comparisons'

const DEFAULT_COMPARISONS: SavedComparison[] = [
  { id: 'AAPL_AMZN_GOOG_META', tickers: ['AAPL', 'AMZN', 'GOOG', 'META'] },
]

export function loadComparisons(): SavedComparison[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return DEFAULT_COMPARISONS
    return JSON.parse(raw) as SavedComparison[]
  } catch { return DEFAULT_COMPARISONS }
}

export function saveComparisons(list: SavedComparison[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {}
}
