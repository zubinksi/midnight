'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { AssetInfo } from './assets'

const HL_PROXY = '/api/hl'

export interface LivelinePoint {
  time: number   // unix seconds
  value: number
}

export type Timeframe = '1H' | '4H' | '1D' | '7D' | '1M'

interface TimeframeConfig {
  interval: string
  windowMs: number
}

const TIMEFRAME_CONFIG: Record<Timeframe, TimeframeConfig> = {
  '1H': { interval: '1m',  windowMs: 60 * 60 * 1000 },
  '4H': { interval: '5m',  windowMs: 4 * 60 * 60 * 1000 },
  '1D': { interval: '15m', windowMs: 24 * 60 * 60 * 1000 },
  '7D': { interval: '1h',  windowMs: 7 * 24 * 60 * 60 * 1000 },
  '1M': { interval: '4h',  windowMs: 30 * 24 * 60 * 60 * 1000 },
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

async function fetchAllMids(): Promise<Record<string, number>> {
  const raw = await hlPost<Record<string, string>>({ type: 'allMids' })
  const map: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    const n = parseFloat(v)
    if (!isNaN(n)) map[k] = n
  }
  return map
}

export async function fetchCandles(ticker: string, timeframe: Timeframe): Promise<LivelinePoint[]> {
  const { interval, windowMs } = TIMEFRAME_CONFIG[timeframe]
  const endTime   = Date.now()
  const startTime = endTime - windowMs

  const candles = await hlPost<Array<{ t: number; c: string }>>({
    type: 'candleSnapshot',
    req: { coin: ticker, interval, startTime, endTime },
  })

  if (!Array.isArray(candles)) return []
  return candles
    .filter(c => c?.t != null && c?.c != null)
    .map(c => ({ time: Math.floor(c.t / 1000), value: parseFloat(c.c) }))
    .filter(p => !isNaN(p.value))
}

// ─── hooks ────────────────────────────────────────────────────────────────────

// Fetches the live tradfi asset list (sorted by 24h volume) from our assets API.
export function useAssets(): { assets: AssetInfo[]; loading: boolean; error: string | null } {
  const [assets, setAssets]   = useState<AssetInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/assets')
      .then(r => {
        if (!r.ok) throw new Error(`/api/assets ${r.status}`)
        return r.json() as Promise<AssetInfo[]>
      })
      .then(data => {
        if (cancelled) return
        setAssets(data)
        setError(null)
      })
      .catch(err => {
        if (cancelled) return
        console.error('[useAssets]', err)
        setError('Failed to load assets')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { assets, loading, error }
}

// Polls allMids for the given tickers every pollMs milliseconds.
// Merges live prices into the seeded map from the initial asset list.
export function useLivePrices(
  tickers: string[],
  seedPrices: Record<string, number>,
  pollMs = 800,
): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>(seedPrices)
  const timerRef            = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickerSet           = useRef(new Set(tickers))

  // Keep the ticker set in sync if the list changes
  useEffect(() => {
    tickerSet.current = new Set(tickers)
  }, [tickers])

  // Merge new seed prices when the asset list loads
  useEffect(() => {
    setPrices(prev => ({ ...seedPrices, ...prev }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(seedPrices)])

  const poll = useCallback(async () => {
    try {
      const map = await fetchAllMids()
      setPrices(prev => {
        const next = { ...prev }
        for (const ticker of tickerSet.current) {
          if (map[ticker] !== undefined) next[ticker] = map[ticker]
        }
        return next
      })
    } catch {
      // keep previous prices on failure
    }
    timerRef.current = setTimeout(poll, pollMs)
  }, [pollMs])

  useEffect(() => {
    if (tickers.length === 0) return
    poll()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [poll, tickers.length])

  return prices
}

// Single-asset price poll (used on the chart detail page).
export function useAssetPrice(ticker: string, pollMs = 800): number | null {
  const [price, setPrice] = useState<number | null>(null)
  const timerRef          = useRef<ReturnType<typeof setTimeout> | null>(null)

  const poll = useCallback(async () => {
    try {
      const map = await fetchAllMids()
      if (map[ticker] !== undefined) setPrice(map[ticker])
    } catch { /* keep previous */ }
    timerRef.current = setTimeout(poll, pollMs)
  }, [ticker, pollMs])

  useEffect(() => {
    poll()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [poll])

  return price
}

export function usePriceHistory(ticker: string, timeframe: Timeframe): {
  data: LivelinePoint[]
  loading: boolean
  openPrice: number | null
} {
  const [data, setData]       = useState<LivelinePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [openPrice, setOpenPrice] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchCandles(ticker, timeframe)
      .then(pts => {
        if (cancelled) return
        setData(pts)
        setOpenPrice(pts.length > 0 ? pts[0].value : null)
      })
      .catch(() => { if (!cancelled) { setData([]); setOpenPrice(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ticker, timeframe])

  return { data, loading, openPrice }
}
