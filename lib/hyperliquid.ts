'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { ASSETS } from './assets'

const HL_API = 'https://api.hyperliquid.xyz/info'

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

async function fetchAllMids(): Promise<PriceMap> {
  const res = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  })
  if (!res.ok) throw new Error('allMids fetch failed')
  const raw: Record<string, string> = await res.json()
  const map: PriceMap = {}
  for (const [k, v] of Object.entries(raw)) {
    map[k] = parseFloat(v)
  }
  return map
}

export async function fetchCandles(ticker: string, timeframe: Timeframe): Promise<LivelinePoint[]> {
  const { interval, windowMs } = TIMEFRAME_CONFIG[timeframe]
  const endTime = Date.now()
  const startTime = endTime - windowMs

  const res = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: { coin: ticker, interval, startTime, endTime },
    }),
  })
  if (!res.ok) throw new Error('candleSnapshot fetch failed')
  const candles: Array<{ t: number; c: string }> = await res.json()
  return candles.map(c => ({ time: Math.floor(c.t / 1000), value: parseFloat(c.c) }))
}

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
      setPrices(prev => {
        const next = { ...prev }
        for (const a of ASSETS) {
          if (map[a.ticker] !== undefined) next[a.ticker] = map[a.ticker]
        }
        return next
      })
    } catch {
      // keep previous prices on failure
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
    setLoading(true)
    fetchCandles(ticker, timeframe)
      .then(points => {
        setData(points)
        setOpenPrice(points.length > 0 ? points[0].value : null)
      })
      .catch(() => {
        setData([])
        setOpenPrice(null)
      })
      .finally(() => setLoading(false))
  }, [ticker, timeframe])

  return { data, loading, openPrice }
}
