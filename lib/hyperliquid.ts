'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { AssetInfo } from './assets'

const HL_PROXY = '/api/hl'

export interface LivelinePoint {
  time: number   // unix seconds
  value: number
}

export type Timeframe = '1D' | '4H' | '7D' | '1M' | '3M' | '6M' | 'ALL'

const TIMEFRAME_CONFIG: Record<Timeframe, { interval: string; windowMs: number | null }> = {
  '1D':  { interval: '15m', windowMs:  1 * 24 * 60 * 60 * 1000 },
  '4H':  { interval: '5m',  windowMs:  4 * 60 * 60 * 1000 },
  '7D':  { interval: '1h',  windowMs:  7 * 24 * 60 * 60 * 1000 },
  '1M':  { interval: '4h',  windowMs: 30 * 24 * 60 * 60 * 1000 },
  '3M':  { interval: '1d',  windowMs: 90 * 24 * 60 * 60 * 1000 },
  '6M':  { interval: '1d',  windowMs: 180 * 24 * 60 * 60 * 1000 },
  'ALL': { interval: '1w',  windowMs: null },
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

// Returns the current UTC offset for America/New_York in whole hours (e.g. 4 for EDT, 5 for EST).
function getETOffsetHours(): number {
  const now = new Date()
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return (utc.getTime() - et.getTime()) / 3_600_000
}

// Returns 'AFTER HRS', 'PRE-MKT', or null (market open).
// Works in America/New_York time so EDT/EST is handled automatically.
export function getNYSESessionLabel(): 'AFTER HRS' | 'PRE-MKT' | null {
  const now   = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour:    'numeric',
    minute:  '2-digit',
    hour12:  false,
  }).formatToParts(now)

  const weekday = parts.find(p => p.type === 'weekday')!.value
  if (weekday === 'Sat' || weekday === 'Sun') return 'AFTER HRS'

  const hour   = parseInt(parts.find(p => p.type === 'hour')!.value) % 24
  const minute = parseInt(parts.find(p => p.type === 'minute')!.value)
  const mins   = hour * 60 + minute

  if (mins >= 570 && mins < 960) return null        // 9:30 AM – 4:00 PM ET: market open
  if (mins >= 240 && mins < 570) return 'PRE-MKT'  // 4:00 AM – 9:30 AM ET
  return 'AFTER HRS'
}

// Finds a recent NYSE close time (4:00 PM ET). skip=0 → most recent, skip=1 → one before that.
function getLastNYSECloseUTC(skip = 0): number | null {
  const closeHourUTC = 16 + getETOffsetHours()
  const now = Math.floor(Date.now() / 1000)
  let found = 0
  for (let i = 0; i < 14; i++) {
    const d   = new Date((now - i * 86400) * 1000)
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) continue
    const closeUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), closeHourUTC, 0, 0) / 1000
    if (closeUTC > now) continue
    if (found === skip) return closeUTC
    found++
  }
  return null
}

export async function fetchNYSEClosePrice(coin: string): Promise<number | null> {
  return fetchNYSEClosePriceAt(coin, 0)
}

export async function fetchNYSEPrevClosePrice(coin: string): Promise<number | null> {
  return fetchNYSEClosePriceAt(coin, 1)
}

async function fetchNYSEClosePriceAt(coin: string, skip: number): Promise<number | null> {
  const closeTime = getLastNYSECloseUTC(skip)
  if (closeTime === null) return null

  const candles = await hlPost<Array<{ t: number; c: string }>>({
    type: 'candleSnapshot',
    req: { coin, interval: '15m', startTime: (closeTime - 1800) * 1000, endTime: (closeTime + 1800) * 1000 },
  })

  if (!Array.isArray(candles) || candles.length === 0) return null
  const best = candles.reduce((a, b) =>
    Math.abs(a.t / 1000 - closeTime) <= Math.abs(b.t / 1000 - closeTime) ? a : b
  )
  const price = parseFloat(best.c)
  return isNaN(price) ? null : price
}


export async function fetchCandles(coin: string, timeframe: Timeframe): Promise<LivelinePoint[]> {
  const { interval, windowMs } = TIMEFRAME_CONFIG[timeframe]
  const endTime   = Date.now()
  const startTime = windowMs != null ? endTime - windowMs : 0

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

export async function fetchFundingHistory(
  coin: string,
  timeframe: Timeframe,
): Promise<Array<{ time: number; rate: number }>> {
  const { windowMs } = TIMEFRAME_CONFIG[timeframe]
  const endTime   = Date.now()
  const startTime = windowMs != null ? endTime - windowMs : endTime - 365 * 24 * 60 * 60 * 1000

  const history = await hlPost<Array<{ coin: string; fundingRate: string; time: number }>>(
    { type: 'fundingHistory', coin, startTime, endTime }
  )

  if (!Array.isArray(history)) return []
  return history
    .filter(h => h?.time != null && h?.fundingRate != null)
    .map(h => ({ time: Math.floor(h.time / 1000), rate: parseFloat(h.fundingRate) * 100 }))
    .filter(h => !isNaN(h.rate))
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

export interface AssetActivityItem {
  type: 'funding' | 'oi'
  ticker: string
  direction: 'up' | 'down'
  headline: string   // e.g. "longs paying shorts"
  value: string      // e.g. "+127% APR" or "OI +8.2%"
  ts: number         // when this was computed
}

// Polls /api/assets + /api/crypto every pollMs ms.
// Watchlist assets surface first; market-wide signals backfill if fewer than MIN_WATCHLIST qualify.
export function useAssetActivityFeed(
  watchlistTickers: string[] = [],
  pollMs = 120_000,
): { items: AssetActivityItem[]; loading: boolean } {
  const [items, setItems]     = useState<AssetActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const prevOI     = useRef<Record<string, number>>({})
  const prevTS     = useRef(0)
  const watchlistRef = useRef(watchlistTickers)
  watchlistRef.current = watchlistTickers

  useEffect(() => {
    let cancelled = false

    const compute = async () => {
      try {
        const [xyzRes, cryptoRes] = await Promise.all([
          fetch('/api/assets'),
          fetch('/api/crypto'),
        ])
        if (!xyzRes.ok || !cryptoRes.ok) return
        const [xyz, crypto]: [AssetInfo[], AssetInfo[]] = await Promise.all([
          xyzRes.json(),
          cryptoRes.json(),
        ])
        const all = [...xyz, ...crypto]
        const now = Date.now()
        const watchSet = new Set(watchlistRef.current)

        // Build scored candidate items for every asset
        const candidates: AssetActivityItem[] = []

        // Funding extremes — threshold 20% APR
        const FUNDING_THRESHOLD = 20
        for (const a of all) {
          const apr = a.funding * 3 * 365 * 100
          if (Math.abs(apr) <= FUNDING_THRESHOLD) continue
          const positive = apr > 0
          candidates.push({
            type: 'funding',
            ticker: a.ticker,
            direction: positive ? 'up' : 'down',
            headline: positive ? 'longs paying shorts' : 'shorts paying longs',
            value: `${positive ? '+' : ''}${apr.toFixed(0)}% APR`,
            ts: now,
          })
        }
        // Sort funding candidates by |APR| descending
        candidates.sort((a, b) => {
          const aprA = Math.abs(parseFloat(a.value))
          const aprB = Math.abs(parseFloat(b.value))
          return aprB - aprA
        })

        // OI changes — only once a previous snapshot exists (>60 s old)
        const oiItems: AssetActivityItem[] = []
        if (prevTS.current > 0 && now - prevTS.current > 60_000) {
          for (const a of all) {
            const prev = prevOI.current[a.ticker]
            if (!prev || prev === 0) continue
            const pct = (a.openInterest - prev) / prev * 100
            if (Math.abs(pct) < 3) continue
            oiItems.push({
              type: 'oi',
              ticker: a.ticker,
              direction: pct > 0 ? 'up' : 'down',
              headline: pct > 0 ? 'open interest rising' : 'open interest falling',
              value: `OI ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
              ts: now,
            })
          }
          oiItems.sort((a, b) => Math.abs(parseFloat(b.value)) - Math.abs(parseFloat(a.value)))
        }

        const allCandidates = [...candidates, ...oiItems]

        // Hybrid: watchlist items first, then backfill from market-wide
        const MIN_WATCHLIST = 4
        const watchlistItems = allCandidates.filter(i => watchSet.has(i.ticker))
        const marketItems    = allCandidates.filter(i => !watchSet.has(i.ticker))

        const seen = new Set<string>()
        const result: AssetActivityItem[] = []
        for (const item of watchlistItems) {
          if (!seen.has(item.ticker + item.type)) { seen.add(item.ticker + item.type); result.push(item) }
        }
        if (result.length < MIN_WATCHLIST) {
          for (const item of marketItems) {
            if (result.length >= MIN_WATCHLIST) break
            if (!seen.has(item.ticker + item.type)) { seen.add(item.ticker + item.type); result.push(item) }
          }
        }

        // Snapshot OI for next diff
        const oiMap: Record<string, number> = {}
        for (const a of all) oiMap[a.ticker] = a.openInterest
        prevOI.current = oiMap
        prevTS.current = now

        if (!cancelled) {
          setItems(result.slice(0, 12))
          setLoading(false)
        }
      } catch { if (!cancelled) setLoading(false) }
    }

    compute()
    const id = setInterval(compute, pollMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [pollMs])

  return { items, loading }
}

export interface TelegramPost {
  channel: string
  text: string
  time: number   // unix ms
  url: string
}

export function useTelegramFeed(pollMs = 5 * 60_000): { posts: TelegramPost[]; loading: boolean } {
  const [posts, setPosts]     = useState<TelegramPost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const doFetch = async () => {
      try {
        const res = await fetch('/api/telegram')
        if (res.ok && !cancelled) setPosts(await res.json())
      } catch { /* keep previous */ }
      if (!cancelled) setLoading(false)
    }
    doFetch()
    const id = setInterval(doFetch, pollMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [pollMs])

  return { posts, loading }
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
