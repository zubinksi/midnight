import { NextRequest, NextResponse } from 'next/server'
import type { ETFFlowsData } from '@/app/api/etf-flows/route'

const ASSIST_FUND_ADDR  = '0xfefefefefefefefefefefefefefefefefefefefe'
const ASSIST_FUND_START = 1735689600000 // Jan 1 2025 (ms)

// Hardcoded baseline — sourced from CoinGecko treasuries page (manually verified).
// The weekly cron may add newer entries on top of these via Upstash.
const HYPESTRAT_BASELINE: HypeStratTransaction[] = [
  { time: 1733097600, balance: 12_500_000, netChange: 12_500_000, usdValue: null,        avgCost: null },
  { time: 1739232000, balance: 17_600_000, netChange:  5_000_000, usdValue: 129_500_000, avgCost: 26  },
]

export interface HypeStratTransaction {
  time:      number        // unix seconds, midnight UTC of transaction date
  balance:   number        // cumulative HYPE after this transaction
  netChange: number        // HYPE acquired (positive = buy)
  usdValue:  number | null // USD paid (null if not reported)
  avgCost:   number | null // USD per HYPE (null if not reported)
}

export interface AssistFundDailyBuy {
  time: number // unix seconds, midnight UTC
  hype: number // HYPE bought that day
  usd:  number // USD at fill prices
}

export interface HypeFlowsData {
  summary: {
    totalHype:     number
    totalUsd:      number
    floatPct:      number
    hype30dChange: number
  }
  etf:       ETFFlowsData | null
  hypestrat: {
    totalHype:    number
    transactions: HypeStratTransaction[]
    ts:           number
  }
  assistFund: {
    totalHype: number
    dailyBuys: AssistFundDailyBuy[]
    ts:        number
  }
  hypePrice:         number
  circulatingSupply: number
  ts:                number
}

let cache: { data: HypeFlowsData; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

async function fetchEtfData(req: NextRequest): Promise<ETFFlowsData | null> {
  try {
    const url = new URL('/api/etf-flows', req.url)
    const res = await fetch(url.toString(), { next: { revalidate: 0 } })
    if (!res.ok) return null
    return res.json() as Promise<ETFFlowsData>
  } catch { return null }
}

async function fetchHypePrice(): Promise<number> {
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
      next: { revalidate: 0 },
    })
    return parseFloat((await res.json())['HYPE'] ?? 0)
  } catch { return 0 }
}

async function fetchCirculatingSupply(): Promise<number> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/hyperliquid?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false',
      { headers: { Accept: 'application/json' }, next: { revalidate: 0 } }
    )
    if (!res.ok) return 0
    return parseFloat((await res.json())?.market_data?.circulating_supply ?? 0)
  } catch { return 0 }
}

async function fetchAssistFundBalance(): Promise<number> {
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'spotClearinghouseState', user: ASSIST_FUND_ADDR }),
      next: { revalidate: 0 },
    })
    const json = await res.json()
    const bal = (json?.balances ?? []).find((b: { coin: string }) => b.coin === 'HYPE')
    return bal ? parseFloat(bal.total) : 0
  } catch { return 0 }
}

async function hlPost(body: unknown): Promise<unknown> {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    next: { revalidate: 0 },
  })
  return res.json()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isHypeSpot(coin: unknown): boolean {
  const c = String(coin ?? '').toUpperCase()
  // Hyperliquid spot fills use "@N" index notation. HYPE is spot index 107 ("@107").
  // Also accept the ticker form in case future API versions normalise it.
  return c === '@107' || c === 'HYPE' || c === '@HYPE'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dailyBuysFromFills(fills: any[]): Record<number, { hype: number; usd: number }> {
  const byDay: Record<number, { hype: number; usd: number }> = {}
  for (const f of fills) {
    if (!isHypeSpot(f.coin) || f.side !== 'B') continue
    const day = Math.floor(f.time / 1000 / 86400) * 86400
    if (!byDay[day]) byDay[day] = { hype: 0, usd: 0 }
    byDay[day].hype += parseFloat(f.sz)
    byDay[day].usd  += parseFloat(f.sz) * parseFloat(f.px)
  }
  return byDay
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dailyBuysFromLedger(updates: any[]): Record<number, { hype: number; usd: number }> {
  const byDay: Record<number, { hype: number; usd: number }> = {}
  for (const u of updates) {
    const coin   = u?.delta?.coin ?? u?.coin ?? ''
    const amount = parseFloat(u?.delta?.amount ?? u?.delta?.sz ?? u?.amount ?? 0)
    if (!isHypeSpot(coin) || amount <= 0) continue
    const day = Math.floor((u.time ?? 0) / 1000 / 86400) * 86400
    if (!day) continue
    if (!byDay[day]) byDay[day] = { hype: 0, usd: 0 }
    byDay[day].hype += amount
  }
  return byDay
}

async function fetchAssistFundDailyBuys(): Promise<AssistFundDailyBuy[]> {
  try {
    // The API returns at most 2000 fills per call. Fetch two windows in parallel:
    // one from launch (Jan 2025) and one from 90 days ago, then merge to maximise coverage.
    const now90dAgo = Date.now() - 90 * 24 * 60 * 60 * 1000
    const [oldFills, recentFills] = await Promise.all([
      hlPost({ type: 'userFillsByTime', user: ASSIST_FUND_ADDR, startTime: ASSIST_FUND_START }),
      hlPost({ type: 'userFillsByTime', user: ASSIST_FUND_ADDR, startTime: now90dAgo }),
    ])

    const merged: Record<number, { hype: number; usd: number }> = {}
    for (const fills of [oldFills, recentFills]) {
      if (!Array.isArray(fills)) continue
      for (const [day, v] of Object.entries(dailyBuysFromFills(fills))) {
        if (!merged[Number(day)]) merged[Number(day)] = { hype: 0, usd: 0 }
        // take max per day across both windows (avoids double-counting overlap)
        merged[Number(day)].hype = Math.max(merged[Number(day)].hype, v.hype)
        merged[Number(day)].usd  = Math.max(merged[Number(day)].usd,  v.usd)
      }
    }

    return Object.entries(merged)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([t, v]) => ({ time: Number(t), ...v }))
  } catch { return [] }
}

async function fetchHypeStratFromKV(): Promise<HypeStratTransaction[]> {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return []
  try {
    const res = await fetch(`${url}/get/hypestrat-transactions`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    })
    if (!res.ok) return []
    const json = await res.json()
    if (!json.result) return []
    return JSON.parse(json.result) as HypeStratTransaction[]
  } catch { return [] }
}

function mergeHypeStrat(kv: HypeStratTransaction[]): HypeStratTransaction[] {
  const map = new Map(HYPESTRAT_BASELINE.map(t => [t.time, t]))
  for (const t of kv) map.set(t.time, t) // KV overrides / extends baseline
  return [...map.values()].sort((a, b) => a.time - b.time)
}

export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.has('debug')) {
    const [fills, ledger, balance] = await Promise.allSettled([
      hlPost({ type: 'userFillsByTime', user: ASSIST_FUND_ADDR, startTime: ASSIST_FUND_START }),
      hlPost({ type: 'userNonFundingLedgerUpdates', user: ASSIST_FUND_ADDR, startTime: ASSIST_FUND_START }),
      hlPost({ type: 'spotClearinghouseState', user: ASSIST_FUND_ADDR }),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fillSample = fills.status === 'fulfilled' && Array.isArray(fills.value) ? (fills.value as any[]).slice(0, 3) : fills
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ledgerSample = ledger.status === 'fulfilled' && Array.isArray(ledger.value) ? (ledger.value as any[]).slice(0, 3) : ledger
    return NextResponse.json({
      fillCount:    fills.status   === 'fulfilled' && Array.isArray(fills.value)   ? (fills.value as unknown[]).length   : 'error',
      ledgerCount:  ledger.status  === 'fulfilled' && Array.isArray(ledger.value)  ? (ledger.value as unknown[]).length  : 'error',
      fillSample,
      ledgerSample,
      balance: balance.status === 'fulfilled' ? balance.value : 'error',
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (cache && Date.now() - cache.ts < CACHE_TTL) return NextResponse.json(cache.data)

  const [etfRes, hypePriceRes, supplyRes, assistBalRes, assistBuysRes, hypeStratKvRes] =
    await Promise.allSettled([
      fetchEtfData(req),
      fetchHypePrice(),
      fetchCirculatingSupply(),
      fetchAssistFundBalance(),
      fetchAssistFundDailyBuys(),
      fetchHypeStratFromKV(),
    ])

  const etf             = etfRes.status         === 'fulfilled' ? etfRes.value         : null
  const hypePrice       = hypePriceRes.status   === 'fulfilled' ? hypePriceRes.value   : 0
  const circSupply      = supplyRes.status       === 'fulfilled' ? supplyRes.value      : 0
  const assistBalance   = assistBalRes.status   === 'fulfilled' ? assistBalRes.value   : 0
  const assistDailyBuys = assistBuysRes.status  === 'fulfilled' ? assistBuysRes.value  : []
  const hypeStratKv     = hypeStratKvRes.status === 'fulfilled' ? hypeStratKvRes.value : []

  const hypeStratTxns  = mergeHypeStrat(hypeStratKv)
  const hypeStratTotal = hypeStratTxns.at(-1)?.balance ?? 0
  const etfHype        = etf ? (etf.bhyp.current + (etf.thyp?.current ?? 0)) : 0

  const totalHype = etfHype + hypeStratTotal + assistBalance
  const totalUsd  = totalHype * hypePrice
  const floatPct  = circSupply > 0 ? totalHype / circSupply * 100 : 0

  const now30dAgo     = Math.floor(Date.now() / 1000) - 30 * 86400
  const etfHype30d    = etf
    ? [...(etf.bhyp.inflowHistory ?? []), ...(etf.thyp?.inflowHistory ?? [])]
        .filter(r => r.time >= now30dAgo)
        .reduce((s, r) => s + (hypePrice > 0 ? r.usd / hypePrice : 0), 0)
    : 0
  const hypeStrat30d  = hypeStratTxns
    .filter(t => t.time >= now30dAgo)
    .reduce((s, t) => s + t.netChange, 0)
  const assistFund30d = assistDailyBuys
    .filter(d => d.time >= now30dAgo)
    .reduce((s, d) => s + d.hype, 0)

  const data: HypeFlowsData = {
    summary: {
      totalHype,
      totalUsd,
      floatPct,
      hype30dChange: etfHype30d + hypeStrat30d + assistFund30d,
    },
    etf,
    hypestrat:  { totalHype: hypeStratTotal, transactions: hypeStratTxns, ts: Date.now() },
    assistFund: { totalHype: assistBalance,  dailyBuys: assistDailyBuys,  ts: Date.now() },
    hypePrice,
    circulatingSupply: circSupply,
    ts: Date.now(),
  }

  cache = { data, ts: Date.now() }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
