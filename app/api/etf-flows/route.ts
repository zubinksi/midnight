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
  units: number       // shares outstanding
  navPerShare: number // NAV per share
}

export interface ETFDailyFlow {
  time: number  // unix seconds, midnight UTC of the trading day
  usd: number   // net flow USD (negative = outflows)
}

export interface ETFTodayEstimate {
  aum: number           // Yahoo Finance totalAssets (live AUM)
  nav: number           // Yahoo Finance navPrice (live NAV/share)
  shares: number        // current shares outstanding
  inflowUsd: number | null
  ts: number
}

export interface ETFFlowsData {
  bhyp: {
    current: number
    prevClose: number
    prevAsOf: string
    history: ETFHistoryPoint[]
    inflowHistory: ETFDailyFlow[]
    today: ETFTodayEstimate | null
  }
  thyp: {
    current: number
    prevClose: number
    prevAsOf: string
    history: ETFHistoryPoint[]
    inflowHistory: ETFDailyFlow[]
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
      if (Array.isArray(json))               entries = json
      else if (Array.isArray(json?.data))    entries = json.data
      else if (Array.isArray(json?.history)) entries = json.history
      else if (Array.isArray(json?.results)) entries = json.results
      if (entries.length === 0) continue

      entries.sort((a, b) =>
        String(b.valuation_date ?? b.date ?? '').localeCompare(String(a.valuation_date ?? a.date ?? ''))
      )

      const points = entries.map(entryToPoint).filter((p): p is ETFHistoryPoint => p !== null)
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

async function fetchYahooQuote(symbol: string): Promise<{ aum: number; nav: number; shares: number } | null> {
  // Use v8 chart endpoint — try both query1 and query2 subdomains
  for (const host of ['query1', 'query2']) {
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`
    try {
      const res = await fetch(url, {
        headers: { ...BROWSER_HEADERS, 'Accept': 'application/json' },
        next: { revalidate: 0 },
      })
      if (!res.ok) continue
      const json = await res.json()
      const meta = json?.chart?.result?.[0]?.meta
      if (!meta) continue
      const nav = parseFloat(meta.navPrice ?? meta.regularMarketPrice ?? 0)
      const aum = parseFloat(meta.totalAssets ?? 0)
      const sharesRaw = parseFloat(meta.impliedSharesOutstanding ?? meta.sharesOutstanding ?? 0)
      const shares = sharesRaw > 0 ? sharesRaw : (nav > 0 ? aum / nav : 0)
      if (aum <= 0 || shares <= 0) continue
      return { aum, nav: nav > 0 ? nav : aum / shares, shares }
    } catch { continue }
  }
  return null
}

async function fetchYahooQuotes(symbols: string[]): Promise<Record<string, { aum: number; nav: number; shares: number }>> {
  const results = await Promise.allSettled(symbols.map(s => fetchYahooQuote(s)))
  const out: Record<string, { aum: number; nav: number; shares: number }> = {}
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) out[symbols[i]] = r.value
  })
  return out
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

// --- Farside daily flows ---------------------------------------------------

interface FarsideRow { time: number; bhyp: number | null; thyp: number | null }

function parseFarsideHtml(html: string): FarsideRow[] {
  const dateRegex = /^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/
  const rows: FarsideRow[] = []
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch: RegExpExecArray | null
  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells: string[] = []
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let tdMatch: RegExpExecArray | null
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      cells.push(tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
    }
    if (cells.length < 3 || !dateRegex.test(cells[0])) continue
    const dm = cells[0].match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/)
    if (!dm) continue
    const time = Math.floor(new Date(`${dm[2]} ${dm[1]}, ${dm[3]} UTC`).getTime() / 1000)
    if (isNaN(time)) continue
    const parseM = (s: string): number | null => {
      const clean = s.replace(/,/g, '').trim()
      if (!clean || clean === '-') return null
      const n = parseFloat(clean)
      return isNaN(n) ? null : Math.round(n * 1_000_000)
    }
    rows.push({ time, bhyp: parseM(cells[1]), thyp: parseM(cells[2]) })
  }
  return rows.sort((a, b) => a.time - b.time)
}

async function fetchFarsideFlows(): Promise<FarsideRow[]> {
  try {
    const res = await fetch('https://farside.co.uk/hyp/', {
      headers: { ...BROWSER_HEADERS, 'Accept': 'text/html,*/*' },
      next: { revalidate: 0 },
    })
    if (!res.ok) return []
    const html = await res.text()
    if (html.length < 1000) return []
    return parseFarsideHtml(html)
  } catch { return [] }
}

// --- Yahoo daily volume bars (for ratio-based today estimate) --------------

interface YahooDailyBar { time: number; volumeUsd: number }

async function fetchYahooDailyBars(symbol: string): Promise<YahooDailyBar[]> {
  for (const host of ['query1', 'query2']) {
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=6mo`
    try {
      const res = await fetch(url, {
        headers: { ...BROWSER_HEADERS, 'Accept': 'application/json' },
        next: { revalidate: 0 },
      })
      if (!res.ok) continue
      const json = await res.json()
      const result = json?.chart?.result?.[0]
      if (!result) continue
      const timestamps: number[] = result.timestamp ?? []
      const quotes = result.indicators?.quote?.[0] ?? {}
      const closes: (number | null)[] = quotes.close ?? []
      const volumes: (number | null)[] = quotes.volume ?? []
      const bars = timestamps
        .map((t, i) => ({ time: t, volumeUsd: (closes[i] ?? 0) * (volumes[i] ?? 0) }))
        .filter(p => p.volumeUsd > 0)
      if (bars.length > 0) return bars
    } catch { continue }
  }
  return []
}

// Ratio = latest known AUM / cumulative volume since launch, clamped to [5%, 70%]
function computeImpliedRatio(latestAumUsd: number, bars: YahooDailyBar[]): number {
  const totalVol = bars.reduce((s, b) => s + b.volumeUsd, 0)
  if (totalVol <= 0 || latestAumUsd <= 0) return 0.28
  return Math.min(Math.max(latestAumUsd / totalVol, 0.05), 0.70)
}

export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.has('debug')) {
    const [bhypApi, thyp, bhypScrape, yahoo, farside, bhypBars, thypBars] = await Promise.allSettled([
      fetchValuationHistory(BHYP_API_URLS),
      fetchValuationHistory(THYP_API_URLS),
      scrapeBHYP(),
      fetchYahooQuotes(['BHYP', 'THYP']),
      fetchFarsideFlows(),
      fetchYahooDailyBars('BHYP'),
      fetchYahooDailyBars('THYP'),
    ])
    return NextResponse.json({
      bhypApi:    bhypApi.status    === 'fulfilled' ? bhypApi.value    : { error: String((bhypApi    as PromiseRejectedResult).reason) },
      thypApi:    thyp.status       === 'fulfilled' ? thyp.value       : { error: String((thyp       as PromiseRejectedResult).reason) },
      bhypScrape: bhypScrape.status === 'fulfilled' ? bhypScrape.value : { error: String((bhypScrape as PromiseRejectedResult).reason) },
      yahoo:      yahoo.status      === 'fulfilled' ? yahoo.value      : { error: String((yahoo      as PromiseRejectedResult).reason) },
      farside:    farside.status    === 'fulfilled' ? farside.value    : { error: String((farside    as PromiseRejectedResult).reason) },
      bhypBars:   bhypBars.status   === 'fulfilled' ? bhypBars.value   : { error: String((bhypBars   as PromiseRejectedResult).reason) },
      thypBars:   thypBars.status   === 'fulfilled' ? thypBars.value   : { error: String((thypBars   as PromiseRejectedResult).reason) },
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (cache && Date.now() - cache.ts < CACHE_TTL) return NextResponse.json(cache.data)

  const [bhypApiRes, thypRes, bhypScrapeRes, yahooRes, farsideRes, bhypBarsRes, thypBarsRes] =
    await Promise.allSettled([
      fetchValuationHistory(BHYP_API_URLS),
      fetchValuationHistory(THYP_API_URLS),
      scrapeBHYP(),
      fetchYahooQuotes(['BHYP', 'THYP']),
      fetchFarsideFlows(),
      fetchYahooDailyBars('BHYP'),
      fetchYahooDailyBars('THYP'),
    ])

  const bhypApi     = bhypApiRes.status    === 'fulfilled' ? bhypApiRes.value    : null
  const thyp        = thypRes.status       === 'fulfilled' ? thypRes.value       : null
  const bhypScrape  = bhypScrapeRes.status === 'fulfilled' ? bhypScrapeRes.value : { hype: 0, asOf: '' }
  const yahoo       = yahooRes.status      === 'fulfilled' ? yahooRes.value      : {}
  const farsideRows = farsideRes.status    === 'fulfilled' ? farsideRes.value    : []
  const bhypBars    = bhypBarsRes.status   === 'fulfilled' ? bhypBarsRes.value   : []
  const thypBars    = thypBarsRes.status   === 'fulfilled' ? thypBarsRes.value   : []

  const bhypCurrent = bhypApi?.current || bhypScrape.hype
  const bhypHistory = bhypApi?.history.length ? bhypApi.history : []

  const now = Date.now()

  // Inflow histories from Farside actual disclosed daily flows
  const bhypInflowHistory: ETFDailyFlow[] = farsideRows
    .filter(r => r.bhyp !== null)
    .map(r => ({ time: r.time, usd: r.bhyp! }))
  const thypInflowHistory: ETFDailyFlow[] = farsideRows
    .filter(r => r.thyp !== null)
    .map(r => ({ time: r.time, usd: r.thyp! }))

  // Yahoo Finance live AUM / NAV
  const bhypYahoo = yahoo['BHYP']
  const thypYahoo = yahoo['THYP']

  // Today's inflow estimates
  // THYP: prefer delta-shares (accurate when 21Shares API has units), fall back to volume×ratio
  const thypYestShares   = thyp?.history.at(-1)?.units ?? 0
  const thypTodayBar     = thypBars.at(-1)
  const thypRatio        = computeImpliedRatio(thypYahoo?.aum ?? 0, thypBars.slice(0, -1))
  const thypInflowEstimate: number | null =
    thypYestShares > 0 && thypYahoo
      ? (thypYahoo.shares - thypYestShares) * thypYahoo.nav
      : thypTodayBar ? thypTodayBar.volumeUsd * thypRatio : null

  // BHYP: volume×ratio (no history API available for delta-shares)
  const bhypTodayBar       = bhypBars.at(-1)
  const bhypRatio          = computeImpliedRatio(bhypYahoo?.aum ?? 0, bhypBars.slice(0, -1))
  const bhypInflowEstimate: number | null = bhypTodayBar
    ? bhypTodayBar.volumeUsd * bhypRatio
    : null

  const bhypToday: ETFTodayEstimate | null = bhypYahoo
    ? { aum: bhypYahoo.aum, nav: bhypYahoo.nav, shares: bhypYahoo.shares, inflowUsd: bhypInflowEstimate, ts: now }
    : null

  const thypToday: ETFTodayEstimate | null = thypYahoo
    ? { aum: thypYahoo.aum, nav: thypYahoo.nav, shares: thypYahoo.shares, inflowUsd: thypInflowEstimate, ts: now }
    : null

  const data: ETFFlowsData = {
    bhyp: {
      current:       bhypCurrent,
      prevClose:     bhypApi?.prevClose ?? 0,
      prevAsOf:      bhypApi?.prevAsOf  ?? bhypScrape.asOf,
      history:       bhypHistory,
      inflowHistory: bhypInflowHistory,
      today:         bhypToday,
    },
    thyp: thyp && (thyp.current > 0 || thyp.history.length > 0) ? {
      current:       thyp.current,
      prevClose:     thyp.prevClose,
      prevAsOf:      thyp.prevAsOf,
      history:       thyp.history,
      inflowHistory: thypInflowHistory,
      today:         thypToday,
    } : null,
    ts: now,
  }

  cache = { data, ts: Date.now() }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
