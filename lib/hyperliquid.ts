'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { AssetInfo } from './assets'

const HL_PROXY = '/api/hl'

export interface LivelinePoint {
  time: number   // unix seconds
  value: number
}

export type Timeframe = '1D' | '7D' | '1M' | '3M' | '6M'

const TIMEFRAME_CONFIG: Record<Timeframe, { interval: string; windowMs: number }> = {
  '1D': { interval: '15m', windowMs:  1 * 24 * 60 * 60 * 1000 },
  '7D': { interval: '1h',  windowMs:  7 * 24 * 60 * 60 * 1000 },
  '1M': { interval: '4h',  windowMs: 30 * 24 * 60 * 60 * 1000 },
  '3M': { interval: '1d',  windowMs: 90 * 24 * 60 * 60 * 1000 },
  '6M': { interval: '1d',  windowMs: 180 * 24 * 60 * 60 * 1000 },
}

async function hlPost<T>(body: unknown): Promise<T> {
  const res = await fetch(HL_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`hl proxy ${res.status}`)
  return res.json() as Promise<T>
}

// allMids with dex:"xyz" — returns bare xyz DEX tickers ("NVDA", "AAPL", …)
async function fetchXyzMids(): Promise<Record<string, string>> {
  const raw = await hlPost<{ mids?: Record<string, string> } | Record<string, string>>(
    { type: 'allMids', dex: 'xyz' }
  )
  return (raw as { mids?: Record<string, string> }).mids ?? (raw as Record<string, string>)
}

// allMids without dex — returns Hyperliquid perp tickers ("BTC", "ETH", …)
async function fetchAllMids(): Promise<Record<string, string>> {
  const raw = await hlPost<{ mids?: Record<string, string> } | Record<string, string>>(
    { type: 'allMids' }
  )
  return (raw as { mids?: Record<string, string> }).mids ?? (raw as Record<string, string>)
}

// Fetch candles using the full Hyperliquid coin ID (e.g. "xyz:NVDA" or "BTC").
export async function fetchCandles(coin: string, timeframe: Timeframe): Promise<LivelinePoint[]> {
  const { interval, windowMs } = TIMEFRAME_CONFIG[timeframe]
  const endTime   = Date.now()
  const startTime = endTime - windowMs

  const candles = await hlPost<Array<{ t: number; o: string; c: string }>>({
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime },
  })

  if (!Array.isArray(candles)) return []
  return candles
    .filter(c => c?.t != null && c?.c != null)
    .map(c => ({ time: Math.floor(c.t / 1000), value: parseFloat(c.c) }))
    .filter(p => !isNaN(p.value))
}

// ─── hooks ────────────────────────────────────────────────────────────────────

export function useAssets(): { assets: AssetInfo[]; loading: boolean; error: string | null } {
  const [assets, setAssets]   = useState<AssetInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/assets')
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() as Promise<AssetInfo[]> })
      .then(data => { if (!cancelled) { setAssets(data); setError(null) } })
      .catch(err => { if (!cancelled) setError('Failed to load markets') ; console.error('[useAssets]', err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { assets, loading, error }
}

export function useCryptoAssets(): { assets: AssetInfo[]; loading: boolean } {
  const [assets, setAssets]   = useState<AssetInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/crypto')
      .then(r => r.json() as Promise<AssetInfo[]>)
      .then(data => { if (!cancelled) setAssets(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { assets, loading }
}

// Polls xyz DEX allMids every pollMs ms.
export function useLivePrices(
  tickers: string[],
  seedPrices: Record<string, number>,
  pollMs = 800,
): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>(seedPrices)
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickerSet   = useRef(new Set(tickers))

  useEffect(() => { tickerSet.current = new Set(tickers) }, [tickers])

  useEffect(() => {
    setPrices(prev => ({ ...seedPrices, ...prev }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(seedPrices)])

  const poll = useCallback(async () => {
    try {
      const mids = await fetchXyzMids()
      setPrices(prev => {
        const next = { ...prev }
        for (const [ticker, v] of Object.entries(mids)) {
          if (!tickerSet.current.has(ticker)) continue
          const n = parseFloat(v)
          if (!isNaN(n)) next[ticker] = n
        }
        return next
      })
    } catch { /* keep previous */ }
    timerRef.current = setTimeout(poll, pollMs)
  }, [pollMs])

  useEffect(() => {
    if (tickers.length === 0) return
    poll()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [poll, tickers.length])

  return prices
}

// Same as useLivePrices but polls the main Hyperliquid perp allMids (for crypto).
export function useCryptoLivePrices(
  tickers: string[],
  seedPrices: Record<string, number>,
  pollMs = 800,
): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>(seedPrices)
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickerSet = useRef(new Set(tickers))

  useEffect(() => { tickerSet.current = new Set(tickers) }, [tickers])

  useEffect(() => {
    setPrices(prev => ({ ...seedPrices, ...prev }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(seedPrices)])

  const poll = useCallback(async () => {
    try {
      const mids = await fetchAllMids()
      setPrices(prev => {
        const next = { ...prev }
        for (const [ticker, v] of Object.entries(mids)) {
          if (!tickerSet.current.has(ticker)) continue
          const n = parseFloat(v)
          if (!isNaN(n)) next[ticker] = n
        }
        return next
      })
    } catch { /* keep previous */ }
    timerRef.current = setTimeout(poll, pollMs)
  }, [pollMs])

  useEffect(() => {
    if (tickers.length === 0) return
    poll()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [poll, tickers.length])

  return prices
}

// Single-asset price poll for the chart detail page.
// Detects xyz assets (coin starts with "xyz:") vs crypto perps (bare ticker).
export function useAssetPrice(coin: string, pollMs = 800): number | null {
  const [price, setPrice] = useState<number | null>(null)
  const timerRef          = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isCrypto          = !coin.startsWith('xyz:')
  const ticker            = isCrypto ? coin : coin.slice(4)

  const poll = useCallback(async () => {
    try {
      const mids = isCrypto ? await fetchAllMids() : await fetchXyzMids()
      const v = mids[ticker]
      if (v !== undefined) {
        const n = parseFloat(v)
        if (!isNaN(n)) setPrice(n)
      }
    } catch { /* keep previous */ }
    timerRef.current = setTimeout(poll, pollMs)
  }, [ticker, pollMs, isCrypto])

  useEffect(() => {
    poll()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [poll])

  return price
}

export function usePriceHistory(coin: string, timeframe: Timeframe): {
  data: LivelinePoint[]
  loading: boolean
  openPrice: number | null
} {
  const [data, setData]           = useState<LivelinePoint[]>([])
  const [loading, setLoading]     = useState(true)
  const [openPrice, setOpenPrice] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchCandles(coin, timeframe)
      .then(pts => {
        if (cancelled) return
        setData(pts)
        setOpenPrice(pts.length > 0 ? pts[0].value : null)
      })
      .catch(() => { if (!cancelled) { setData([]); setOpenPrice(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [coin, timeframe])

  return { data, loading, openPrice }
}
