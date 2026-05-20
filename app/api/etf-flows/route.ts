import { NextRequest, NextResponse } from 'next/server'

// 21Shares THYP valuation history APIs (discovered via hyperliquidnews.xyz)
const THYP_API_URLS = [
  'https://21sharesprimary.paradox-coworking.com/api/product_valuation_history/thyp',
  'https://21sharessecondary.paradox-coworking.com/api/product_valuation_history/thyp',
]

// BHYP counterpart attempts — Bitwise equivalent of the 21Shares API
const BHYP_API_URLS = [
  'https://bitwiseprimary.paradox-coworking.com/api/product_valuation_history/bhyp',
  'https://bitwisesecondary.paradox-coworking.com/api/product_valuation_history/bhyp',
  'https://bhypprimary.paradox-coworking.com/api/product_valuation_history/bhyp',
]

export interface ETFHistoryPoint {
  time: number        // unix seconds (midnight UTC of valuation date)
  usd: number         // total AUM (total_nav)
  hype: number        // HYPE quantity
  units: number       // shares outstanding (for true inflow calc)
  navPerShare: number // NAV per share (for true inflow calc)
}

export interface ETFTodayEstimate {
  aum: number       // Yahoo Finance totalAssets (live AUM)
  nav: number       // Yahoo Finance navPrice (live NAV/share)
  shares: number    // current shares outstanding
  inflowUsd: number | null // null when no historical baseline available
  ts: number        // timestamp ms
}

export interface ETFFlowsData {
  bhyp: {
    current: number
    prevClose: number
    prevAsOf: string
    history: ETFHistoryPoint[]
    today: ETFTodayEstimate | null
  }
  thyp: {
    current: number
    prevClose: number
    prevAsOf: string
    history: ETFHistoryPoint[]
    today: ETFTodayEstimate | null
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function entryToPoint(entry: Record<string, any>): ETFHistoryPoint | null {
  const dateStr = entry.valuation_date ?? entry.date ?? ''
  if (!dateStr) return null
  const time = Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 1000)
  if (isNaN(time)) return null
  const usd        = parseFloat(entry.total_nav ?? 0)
  const price      = parseFloat(entry.underlying?.HYPE ?? entry.index ?? 1)
  const hype       = price > 0 ? usd / price : 0
  const navPerShare= parseFloat(entry.nav_per_share ?? 0)
  const units      = parseFloat(entry.total_units_outstanding ?? 0) || (navPerShare > 0 ? usd / navPerShare : 0)
  return { time, usd, hype, units, navPerShare }
}

async function fetchValuationHistory(urls: string[]): Promise<{
  current: number; prevClose: number; prevAsOf: string
  history: ETFHistoryPoint[]
}> {
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, next: { revalidate: 0 } })
      if (!res.ok) continue
      const json = await res.json()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let entries: Record<string, any>[] = []
      if (Array.isArray(json))              entries = json
      else if (Array.isArray(json?.data))   entries = json.data
      else if (Array.isArray(json?.history))entries = json.history
      else if (Array.isArray(json?.results))entries = json.results
      if (entries.length === 0) continue

      // Sort descending to get latest first
      entries.sort((a, b) =>
        String(b.valuation_date ?? b.date ?? '').localeCompare(String(a.valuation_date ?? a.date ?? ''))
      )

      const points = entries.map(entryToPoint).filter((p): p is ETFHistoryPoint => p !== null)
      // history in ascending order for charting
      const history = [...points].reverse()

      return {
        current:   points[0]?.hype  ?? 0,
        prevClose: points[1]?.hype  ?? 0,
        prevAsOf:  String(entries[1]?.valuation_date ?? entries[1]?.date ?? ''),
        history,
      }
    } catch { continue }
  }
  return { current: 0, prevClose: 0, prevAsOf: '', history: [] }
}

async function fetchYahooQuotes(symbols: string[]): Promise<Record<string, { aum: number; nav: number; shares: number }>> {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}&fields=navPrice,totalAssets,sharesOutstanding`
  try {
    const res = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        'Accept': 'application/json',
      },
      next: { revalidate: 0 },
    })
    if (!res.ok) return {}
    const json = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: Record<string, any>[] = json?.quoteResponse?.result ?? []
    const out: Record<string, { aum: number; nav: number; shares: number }> = {}
    for (const q of results) {
      // ETFs may use navPrice or regularMarketPrice; impliedSharesOutstanding is ETF-specific
      const nav = parseFloat(q.navPrice ?? q.regularMarketPrice ?? 0)
      const aum = parseFloat(q.totalAssets ?? 0)
      const sharesRaw = parseFloat(q.impliedSharesOutstanding ?? q.sharesOutstanding ?? 0)
      const shares = sharesRaw > 0 ? sharesRaw : (nav > 0 ? aum / nav : 0)
      if (aum > 0 && shares > 0) out[String(q.symbol)] = { aum, nav: nav > 0 ? nav : aum / shares, shares }
    }
    return out
  } catch { return {} }
}

async function scrapeBHYP(): Promise<{ hype: number; asOf: string }> {
  try {
    const res = await fetch('https://bhypetf.com/', { headers: BROWSER_HEADERS, next: { revalidate: 0 } })
    if (!res.ok) return { hype: 0, asOf: '' }
    const html = await res.text()
    const holdingsMatch = html.match(/Hy+perliquid in Trust[\s\S]{0,300}?([\d,]+\.\d+)/i)
    const dateMatch     = html.match(/Data as of[^"<]*?(\d{2}\/\d{2}\/\d{4})/i)
      ?? html.match(/"holdingsDate"\s*:\s*"([^"]+)"/i)
    return {
      hype: holdingsMatch ? parseFloat(holdingsMatch[1].replace(/,/g, '')) : 0,
      asOf: dateMatch ? dateMatch[1] : '',
    }
  } catch { return { hype: 0, asOf: '' } }
}

export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.has('debug')) {
    const [bhypApi, thyp, bhypScrape, yahoo] = await Promise.allSettled([
      fetchValuationHistory(BHYP_API_URLS),
      fetchValuationHistory(THYP_API_URLS),
      scrapeBHYP(),
      fetchYahooQuotes(['BHYP', 'THYP']),
    ])
    return NextResponse.json({
      bhypApi:    bhypApi.status    === 'fulfilled' ? bhypApi.value    : { error: String((bhypApi    as PromiseRejectedResult).reason) },
      thypApi:    thyp.status       === 'fulfilled' ? thyp.value       : { error: String((thyp       as PromiseRejectedResult).reason) },
      bhypScrape: bhypScrape.status === 'fulfilled' ? bhypScrape.value : { error: String((bhypScrape as PromiseRejectedResult).reason) },
      yahoo:      yahoo.status      === 'fulfilled' ? yahoo.value      : { error: String((yahoo      as PromiseRejectedResult).reason) },
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (cache && Date.now() - cache.ts < CACHE_TTL) return NextResponse.json(cache.data)

  const [bhypApiRes, thypRes, bhypScrapeRes, yahooRes] = await Promise.allSettled([
    fetchValuationHistory(BHYP_API_URLS),
    fetchValuationHistory(THYP_API_URLS),
    scrapeBHYP(),
    fetchYahooQuotes(['BHYP', 'THYP']),
  ])

  const bhypApi   = bhypApiRes.status   === 'fulfilled' ? bhypApiRes.value   : null
  const thyp      = thypRes.status      === 'fulfilled' ? thypRes.value      : null
  const bhypScrape= bhypScrapeRes.status=== 'fulfilled' ? bhypScrapeRes.value: { hype: 0, asOf: '' }
  const yahoo     = yahooRes.status     === 'fulfilled' ? yahooRes.value     : {}

  // Prefer API history; fall back to scrape as single current point
  const bhypCurrent  = bhypApi?.current  || bhypScrape.hype
  const bhypHistory  = bhypApi?.history.length ? bhypApi.history : []

  const now = Date.now()

  // Yahoo Finance live estimates for today
  // Create today estimate whenever Yahoo has data; inflowUsd requires a historical baseline
  const bhypYahoo = yahoo['BHYP']
  const bhypYestShares = bhypHistory.at(-1)?.units ?? 0
  const bhypToday: ETFTodayEstimate | null = bhypYahoo
    ? {
        aum:       bhypYahoo.aum,
        nav:       bhypYahoo.nav,
        shares:    bhypYahoo.shares,
        inflowUsd: bhypYestShares > 0 ? (bhypYahoo.shares - bhypYestShares) * bhypYahoo.nav : null,
        ts:        now,
      }
    : null

  const thypYahoo = yahoo['THYP']
  const thypYestShares = thyp?.history.at(-1)?.units ?? 0
  const thypToday: ETFTodayEstimate | null = thypYahoo
    ? {
        aum:       thypYahoo.aum,
        nav:       thypYahoo.nav,
        shares:    thypYahoo.shares,
        inflowUsd: thypYestShares > 0 ? (thypYahoo.shares - thypYestShares) * thypYahoo.nav : null,
        ts:        now,
      }
    : null

  const data: ETFFlowsData = {
    bhyp: {
      current:   bhypCurrent,
      prevClose: bhypApi?.prevClose ?? 0,
      prevAsOf:  bhypApi?.prevAsOf  ?? bhypScrape.asOf,
      history:   bhypHistory,
      today:     bhypToday,
    },
    thyp: thyp && (thyp.current > 0 || thyp.history.length > 0) ? {
      current:   thyp.current,
      prevClose: thyp.prevClose,
      prevAsOf:  thyp.prevAsOf,
      history:   thyp.history,
      today:     thypToday,
    } : null,
    ts: now,
  }

  cache = { data, ts: Date.now() }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
