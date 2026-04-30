'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { AssetInfo } from './assets'

const HL_PROXY = '/api/hl'

export interface LivelinePoint {
  time: number   // unix seconds
  value: number
}

export type Timeframe = '1H' | '4H' | '1D' | '7D' | '1M'

const TIMEFRAME_CONFIG: Record<Timeframe, { interval: string; windowMs: number }> = {
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

// Polls allMids every pollMs ms. allMids keys are full coin IDs like "xyz:NVDA".
// coinToTicker maps coin → display ticker so we can key the returned map by ticker.
export function useLivePrices(
  coins: string[],
  seedPrices: Record<string, number>,  // keyed by ticker (display name)
  coinToTicker: Record<string, string>,
  pollMs = 800,
): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>(seedPrices)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const coinsRef   = useRef(coins)
  const mapRef     = useRef(coinToTicker)

  useEffect(() => { coinsRef.current = coins }, [coins])
  useEffect(() => { mapRef.current   = coinToTicker }, [coinToTicker])

  // Merge seed prices when asset list loads
  useEffect(() => {
    setPrices(prev => ({ ...seedPrices, ...prev }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(seedPrices)])

  const poll = useCallback(async () => {
    try {
      const raw = await hlPost<Record<string, string>>({ type: 'allMids' })
      setPrices(prev => {
        const next = { ...prev }
        for (const coin of coinsRef.current) {
          const v = raw[coin]
          if (v !== undefined) {
            const ticker = mapRef.current[coin] ?? coin
            const n = parseFloat(v)
            if (!isNaN(n)) next[ticker] = n
          }
        }
        return next
      })
    } catch { /* keep previous */ }
    timerRef.current = setTimeout(poll, pollMs)
  }, [pollMs])

  useEffect(() => {
    if (coins.length === 0) return
    poll()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [poll, coins.length])

  return prices
}

// Single-asset price poll for the chart detail page.
// coin = full Hyperliquid identifier, e.g. "xyz:NVDA"
export function useAssetPrice(coin: string, pollMs = 800): number | null {
  const [price, setPrice] = useState<number | null>(null)
  const timerRef          = useRef<ReturnType<typeof setTimeout> | null>(null)

  const poll = useCallback(async () => {
    try {
      const raw = await hlPost<Record<string, string>>({ type: 'allMids' })
      const v = raw[coin]
      if (v !== undefined) {
        const n = parseFloat(v)
        if (!isNaN(n)) setPrice(n)
      }
    } catch { /* keep previous */ }
    timerRef.current = setTimeout(poll, pollMs)
  }, [coin, pollMs])

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
