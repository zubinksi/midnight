'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { ASSETS } from './assets'

// All Hyperliquid calls go through our proxy to avoid CORS issues and allow
// server-side inspection.
const HL_PROXY = '/api/hl'

export interface LivelinePoint {
  time: number  // unix seconds
  value: number
}

export interface PriceMap {
  [ticker: string]: number
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

async function fetchAllMids(): Promise<PriceMap> {
  const raw = await hlPost<Record<string, string>>({ type: 'allMids' })
  const map: PriceMap = {}
  for (const [k, v] of Object.entries(raw)) {
    const n = parseFloat(v)
    if (!isNaN(n)) map[k] = n
  }
  return map
}

export async function fetchCandles(ticker: string, timeframe: Timeframe): Promise<LivelinePoint[]> {
  const { interval, windowMs } = TIMEFRAME_CONFIG[timeframe]
  const endTime = Date.now()
  const startTime = endTime - windowMs

  const candles = await hlPost<Array<{ t: number; c: string }>>({
    type: 'candleSnapshot',
    req: { coin: ticker, interval, startTime, endTime },
  })

  if (!Array.isArray(candles)) return []
  return candles
    .filter(c => c && c.t != null && c.c != null)
    .map(c => ({ time: Math.floor(c.t / 1000), value: parseFloat(c.c) }))
    .filter(p => !isNaN(p.value))
}

// Fetches a single candle to get the 24-hr open price for a ticker.
export async function fetch24hOpen(ticker: string): Promise<number | null> {
  const pts = await fetchCandles(ticker, '1D')
  return pts.length > 0 ? pts[0].value : null
}

// ─── hooks ────────────────────────────────────────────────────────────────────

export function useAllPrices(pollMs = 800): PriceMap {
  const [prices, setPrices] = useState<PriceMap>(() => {
    const seed: PriceMap = {}
    for (const a of ASSETS) seed[a.ticker] = a.seedPrice
    return seed
  })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const poll = useCallback(async () => {
    try {
      const map = await fetchAllMids()
      if (Object.keys(map).length > 0) {
        setPrices(prev => {
          const next = { ...prev }
          for (const a of ASSETS) {
            if (map[a.ticker] !== undefined) next[a.ticker] = map[a.ticker]
          }
          return next
        })
      }
    } catch {
      // keep previous prices on failure — silent
    }
    timerRef.current = setTimeout(poll, pollMs)
  }, [pollMs])

  useEffect(() => {
    poll()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [poll])

  return prices
}

export function useAssetPrice(ticker: string, pollMs = 800): number | null {
  const [price, setPrice] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const poll = useCallback(async () => {
    try {
      const map = await fetchAllMids()
      if (map[ticker] !== undefined) setPrice(map[ticker])
    } catch {
      // keep previous
    }
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
  const [data, setData] = useState<LivelinePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [openPrice, setOpenPrice] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchCandles(ticker, timeframe)
      .then(points => {
        if (cancelled) return
        setData(points)
        setOpenPrice(points.length > 0 ? points[0].value : null)
      })
      .catch(() => {
        if (cancelled) return
        setData([])
        setOpenPrice(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [ticker, timeframe])

  return { data, loading, openPrice }
}

// Returns 24h open prices for all assets (keyed by ticker).
export function useDay24hOpens(): Record<string, number> {
  const [opens, setOpens] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    Promise.allSettled(
      ASSETS.map(async a => {
        const open = await fetch24hOpen(a.ticker)
        return { ticker: a.ticker, open }
      })
    ).then(results => {
      if (cancelled) return
      const map: Record<string, number> = {}
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.open !== null) {
          map[r.value.ticker] = r.value.open
        }
      }
      setOpens(map)
    })
    return () => { cancelled = true }
  }, [])

  return opens
}
