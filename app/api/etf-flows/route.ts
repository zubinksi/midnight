import { NextRequest, NextResponse } from 'next/server'

// 21Shares THYP valuation history APIs (discovered via hyperliquidnews.xyz)
const THYP_API_URLS = [
  'https://21sharesprimary.paradox-coworking.com/api/product_valuation_history/thyp',
  'https://21sharessecondary.paradox-coworking.com/api/product_valuation_history/thyp',
]

export interface ETFFlowsData {
  bhyp: {
    current: number    // real-time HYPE from chain (spot + staked)
    prevClose: number  // previous day official figure from ETF website
    prevAsOf: string   // "MM/DD/YYYY"
  }
  thyp: {
    current: number
    prevClose: number
    prevAsOf: string
  } | null
  ts: number
}

let cache: { data: ETFFlowsData; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
}



// Calculate total HYPE held from a 21Shares valuation history entry.
// The API doesn't include coin_entitlement directly; derive it from
// total_nav / underlying.HYPE (the HYPE spot price used for NAV).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractHypeFromEntry(entry: Record<string, any>): number {
  // Preferred: total_nav divided by HYPE price gives total coins held
  const nav   = parseFloat(entry.total_nav ?? 0)
  const price = parseFloat(entry.underlying?.HYPE ?? entry.index ?? 0)
  if (nav > 0 && price > 0) return nav / price

  // Fallback: direct coin quantity fields (other 21Shares products)
  for (const key of ['coin_entitlement', 'coinEntitlement', 'quantity', 'coin_amount']) {
    const v = entry[key]
    if (v != null) { const n = parseFloat(String(v)); if (!isNaN(n) && n > 0) return n }
  }
  return 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractDateFromEntry(entry: Record<string, any>): string {
  const v = entry.date ?? entry.valuation_date ?? entry.as_of ?? entry.timestamp ?? ''
  return String(v)
}

async function fetchTHYP(): Promise<{ current: number; prevClose: number; prevAsOf: string; raw: unknown }> {
  for (const url of THYP_API_URLS) {
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, next: { revalidate: 0 } })
      if (!res.ok) continue
      const json = await res.json()
      const raw = json

      // Response may be an array directly or wrapped: { data: [...] } / { history: [...] }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let entries: Record<string, any>[] = []
      if (Array.isArray(json)) entries = json
      else if (Array.isArray(json?.data))    entries = json.data
      else if (Array.isArray(json?.history)) entries = json.history
      else if (Array.isArray(json?.results)) entries = json.results

      if (entries.length === 0) return { current: 0, prevClose: 0, prevAsOf: '', raw }

      // Sort descending by date to get most recent first
      entries.sort((a, b) => String(b.date ?? b.valuation_date ?? '').localeCompare(
        String(a.date ?? a.valuation_date ?? '')
      ))

      const latest   = entries[0]
      const previous = entries[1]

      return {
        current:   extractHypeFromEntry(latest),
        prevClose: previous ? extractHypeFromEntry(previous) : 0,
        prevAsOf:  previous ? extractDateFromEntry(previous) : '',
        raw:       { latest, previous },
      }
    } catch {
      continue
    }
  }
  return { current: 0, prevClose: 0, prevAsOf: '', raw: 'all endpoints failed' }
}

async function scrapeBHYP(): Promise<{ hype: number; asOf: string; rawHtml: string }> {
  try {
    const res = await fetch('https://bhypetf.com/', { headers: BROWSER_HEADERS, next: { revalidate: 0 } })
    if (!res.ok) return { hype: 0, asOf: '', rawHtml: `HTTP ${res.status}` }
    const html = await res.text()
    const holdingsMatch = html.match(/Hy+perliquid in Trust[\s\S]{0,300}?([\d,]+\.\d+)/i)
    // Date appears deep in the rendered JSON/HTML — search the whole document
    const dateMatch = html.match(/Data as of[^"<]*?(\d{2}\/\d{2}\/\d{4})/i)
      ?? html.match(/"holdingsDate"\s*:\s*"([^"]+)"/i)
      ?? html.match(/as_of[^"<]*?(\d{4}-\d{2}-\d{2})/i)
    return {
      hype:    holdingsMatch ? parseFloat(holdingsMatch[1].replace(/,/g, '')) : 0,
      asOf:    dateMatch ? dateMatch[1] : '',
      rawHtml: html.slice(0, 3000),
    }
  } catch (e) {
    return { hype: 0, asOf: '', rawHtml: String(e) }
  }
}

export async function GET(req: NextRequest) {
  // ?debug — returns raw API responses to diagnose data issues
  if (new URL(req.url).searchParams.has('debug')) {
    const [bhyp, thyp] = await Promise.allSettled([scrapeBHYP(), fetchTHYP()])
    return NextResponse.json({
      bhypScrape: bhyp.status === 'fulfilled' ? bhyp.value : { error: String((bhyp as PromiseRejectedResult).reason) },
      thypApi:    thyp.status === 'fulfilled' ? thyp.value : { error: String((thyp as PromiseRejectedResult).reason) },
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  const [bhypScrape, thypData] = await Promise.allSettled([
    scrapeBHYP(),
    fetchTHYP(),
  ])

  // bhypetf.com publishes official holdings (previous trading day).
  // Wallet on-chain queries return 0 — ETF likely custodies off Hyperliquid spot.
  const { hype: bhypCurrent, asOf: bhypAsOf } =
    bhypScrape.status === 'fulfilled' ? bhypScrape.value : { hype: 0, asOf: '' }

  const thyp = thypData.status === 'fulfilled' ? thypData.value : null

  const data: ETFFlowsData = {
    bhyp: { current: bhypCurrent, prevClose: 0, prevAsOf: bhypAsOf },
    thyp: thyp && thyp.current > 0
      ? { current: thyp.current, prevClose: thyp.prevClose, prevAsOf: thyp.prevAsOf }
      : null,
    ts: Date.now(),
  }

  cache = { data, ts: Date.now() }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
