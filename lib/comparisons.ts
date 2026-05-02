export interface SavedComparison {
  id: string       // tickers.join('_') — used as the URL slug too
  tickers: string[]
}

const KEY = 'neue-comparisons'

export function loadComparisons(): SavedComparison[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SavedComparison[]) : []
  } catch { return [] }
}

export function saveComparisons(list: SavedComparison[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {}
}
