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

// allMids with dex:"xyz" returns { mids: { "NVDA": "112.4", ... } }
// Keys are bare tickers (no xyz: prefix) when scoped to the xyz DEX.
async function fetchXyzMids(): Promise<Record<string, string>> {
  const raw = await hlPost<{ mids?: Record<string, string> } | Record<string, string>>(
    { type: 'allMids', dex: 'xyz' }
  )
  return (raw as { mids?: Record<string, string> }).mids ?? (raw as Record<string, string>)
}

// Fetch candles using the full Hyperliquid coin ID (e.g. "xyz:NVDA").
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

// Polls xyz DEX allMids every pollMs ms.
// With dex:"xyz", response keys are bare tickers ("NVDA"), not coin IDs.
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

// Single-asset price poll for the chart detail page.
// coin = full Hyperliquid identifier e.g. "xyz:NVDA"; ticker key in mids is "NVDA".
export function useAssetPrice(coin: string, pollMs = 800): number | null {
  const [price, setPrice] = useState<number | null>(null)
  const timerRef          = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ticker            = coin.startsWith('xyz:') ? coin.slice(4) : coin

  const poll = useCallback(async () => {
    try {
      const mids = await fetchXyzMids()
      const v = mids[ticker]
      if (v !== undefined) {
        const n = parseFloat(v)
        if (!isNaN(n)) setPrice(n)
      }
    } catch { /* keep previous */ }
    timerRef.current = setTimeout(poll, pollMs)
  }, [ticker, pollMs])

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
