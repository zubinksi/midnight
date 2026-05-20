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

export interface DailyRow {
  time: number
  totalAum: number
  bhypInflow: number | null
  thypInflow: number | null
  bhypVolume: number | null
  thypVolume: number | null
  hypePrice: number | null
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
  dailyHistory: DailyRow[]
  circulatingSupply: number
  ts: number
}

let cache: { data: ETFFlowsData; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

// Empirical inflow/volume ratio from hypeflows Farside calibration (combined 28.2%)
// Used for BHYP when Farside is unavailable — do NOT compute from AUM/vol since
// AUM is inflated by HYPE price appreciation and gives wildly high ratios
const FALLBACK_RATIO = 0.28

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
  // Try query1+query2 with both full browser headers and minimal headers (data.py style)
  const headerSets = [
    { ...BROWSER_HEADERS, 'Accept': 'application/json' },
    { 'User-Agent': 'Mozilla/5.0' },
  ]
  for (const host of ['query1', 'query2']) {
    for (const headers of headerSets) {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1mo`
      try {
        const res = await fetch(url, { headers, next: { revalidate: 0 } })
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

// --- HYPE spot price (server-side, for BHYP AUM computation) ---------------

async function fetchHypePrice(): Promise<number> {
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
      next: { revalidate: 0 },
    })
    const json = await res.json()
    return parseFloat(json['HYPE'] ?? 0)
  } catch { return 0 }
}

async function fetchHypeCirculatingSupply(): Promise<number> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/hyperliquid?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false',
      { headers: { 'Accept': 'application/json' }, next: { revalidate: 0 } }
    )
    if (!res.ok) return 0
    const json = await res.json()
    return parseFloat(json?.market_data?.circulating_supply ?? 0)
  } catch { return 0 }
}

// --- Daily volume bars: Yahoo (primary) → Stooq (fallback) -----------------

interface YahooDailyBar { time: number; close: number; volumeUsd: number }

async function fetchYahooDailyBars(symbol: string): Promise<YahooDailyBar[]> {
  // Try Yahoo Finance (query1 + query2)
  for (const host of ['query1', 'query2']) {
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1mo`
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
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
        .map((t, i) => {
          const close = closes[i] ?? 0
          return { time: t, close, volumeUsd: close * (volumes[i] ?? 0) }
        })
        .filter(p => p.close > 0)
      if (bars.length > 0) return bars
    } catch { continue }
  }

  // Fallback: Stooq (free, no auth, less likely to block Vercel IPs)
  // CSV format: Date,Open,High,Low,Close,Volume
  try {
    const url = `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}.us&i=d`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/csv,*/*' },
      next: { revalidate: 0 },
    })
    if (res.ok) {
      const text = await res.text()
      const lines = text.trim().split('\n')
      const bars = lines.slice(1).map(line => {
        const p = line.split(',')
        if (p.length < 6) return null
        const time = Math.floor(new Date(p[0] + 'T00:00:00Z').getTime() / 1000)
        const close = parseFloat(p[4])
        const volume = parseFloat(p[5])
        if (isNaN(time) || close <= 0 || isNaN(volume)) return null
        return { time, close, volumeUsd: close * volume }
      }).filter((b): b is YahooDailyBar => b !== null)
      if (bars.length > 0) return bars
    }
  } catch { /* fall through */ }

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
    const [bhypApi, thyp, bhypScrape, yahoo, farside, bhypBars, thypBars, hypePrice, circSupply] =
      await Promise.allSettled([
        fetchValuationHistory(BHYP_API_URLS),
        fetchValuationHistory(THYP_API_URLS),
        scrapeBHYP(),
        fetchYahooQuotes(['BHYP', 'THYP']),
        fetchFarsideFlows(),
        fetchYahooDailyBars('BHYP'),
        fetchYahooDailyBars('THYP'),
        fetchHypePrice(),
        fetchHypeCirculatingSupply(),
      ])
    return NextResponse.json({
      bhypApi:     bhypApi.status    === 'fulfilled' ? bhypApi.value    : { error: String((bhypApi    as PromiseRejectedResult).reason) },
      thypApi:     thyp.status       === 'fulfilled' ? thyp.value       : { error: String((thyp       as PromiseRejectedResult).reason) },
      bhypScrape:  bhypScrape.status === 'fulfilled' ? bhypScrape.value : { error: String((bhypScrape as PromiseRejectedResult).reason) },
      yahoo:       yahoo.status      === 'fulfilled' ? yahoo.value      : { error: String((yahoo      as PromiseRejectedResult).reason) },
      farside:     farside.status    === 'fulfilled' ? farside.value    : { error: String((farside    as PromiseRejectedResult).reason) },
      bhypBars:    bhypBars.status   === 'fulfilled' ? bhypBars.value.slice(-3)  : { error: String((bhypBars   as PromiseRejectedResult).reason) },
      thypBars:    thypBars.status   === 'fulfilled' ? thypBars.value.slice(-3)  : { error: String((thypBars   as PromiseRejectedResult).reason) },
      hypePrice:   hypePrice.status  === 'fulfilled' ? hypePrice.value  : { error: String((hypePrice  as PromiseRejectedResult).reason) },
      circSupply:  circSupply.status === 'fulfilled' ? circSupply.value : { error: String((circSupply  as PromiseRejectedResult).reason) },
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (cache && Date.now() - cache.ts < CACHE_TTL) return NextResponse.json(cache.data)

  const [bhypApiRes, thypRes, bhypScrapeRes, yahooRes, farsideRes, bhypBarsRes, thypBarsRes, hypePriceRes, circSupplyRes] =
    await Promise.allSettled([
      fetchValuationHistory(BHYP_API_URLS),
      fetchValuationHistory(THYP_API_URLS),
      scrapeBHYP(),
      fetchYahooQuotes(['BHYP', 'THYP']),
      fetchFarsideFlows(),
      fetchYahooDailyBars('BHYP'),
      fetchYahooDailyBars('THYP'),
      fetchHypePrice(),
      fetchHypeCirculatingSupply(),
    ])

  const bhypApi            = bhypApiRes.status    === 'fulfilled' ? bhypApiRes.value    : null
  const thyp               = thypRes.status       === 'fulfilled' ? thypRes.value       : null
  const bhypScrape         = bhypScrapeRes.status === 'fulfilled' ? bhypScrapeRes.value : { hype: 0, asOf: '' }
  const yahoo              = yahooRes.status      === 'fulfilled' ? yahooRes.value      : {}
  const farsideRows        = farsideRes.status    === 'fulfilled' ? farsideRes.value    : []
  const bhypBars           = bhypBarsRes.status   === 'fulfilled' ? bhypBarsRes.value   : []
  const thypBars           = thypBarsRes.status   === 'fulfilled' ? thypBarsRes.value   : []
  const hypePrice          = hypePriceRes.status  === 'fulfilled' ? hypePriceRes.value  : 0
  const circulatingSupply  = circSupplyRes.status === 'fulfilled' ? circSupplyRes.value : 0

  const bhypCurrent = bhypApi?.current || bhypScrape.hype

  const now = Date.now()
  const toMidnightUTC = (ts: number) => Math.floor(ts / 86400) * 86400

  // Yahoo Finance live AUM / NAV (may be null if Yahoo is blocked on Vercel)
  const bhypYahoo = yahoo['BHYP']
  const thypYahoo = yahoo['THYP']

  // BHYP AUM: Yahoo preferred, fall back to scrape × server-side HYPE price
  const bhypAum    = bhypYahoo?.aum ?? (bhypCurrent > 0 && hypePrice > 0 ? bhypCurrent * hypePrice : 0)
  const bhypNav    = bhypYahoo?.nav ?? (bhypCurrent > 0 && hypePrice > 0 ? hypePrice : 0)
  const bhypShares = bhypYahoo?.shares ?? 0

  // THYP AUM: Yahoo preferred, fall back to latest 21Shares API point
  const thypLatestPoint = thyp?.history.at(-1)
  const thypAum    = thypYahoo?.aum ?? thypLatestPoint?.usd ?? 0
  const thypNav    = thypYahoo?.nav ?? thypLatestPoint?.navPerShare ?? 0
  const thypShares = thypYahoo?.shares ?? thypLatestPoint?.units ?? 0

  // BHYP history: from 21Shares API if available; otherwise reconstruct from Yahoo bar close
  // prices — scale today's known AUM by the relative ETF price on each historical day
  const bhypHistory: ETFHistoryPoint[] = bhypApi?.history.length
    ? bhypApi.history
    : (() => {
        if (bhypBars.length === 0 || bhypAum <= 0) return []
        const latestClose = bhypBars.at(-1)!.close
        if (latestClose <= 0) return []
        return bhypBars.map(bar => {
          const scaledAum = bhypAum * (bar.close / latestClose)
          const hype      = hypePrice > 0 ? scaledAum / hypePrice : 0
          return {
            time:       toMidnightUTC(bar.time),
            usd:        scaledAum,
            hype,
            units:      0,
            navPerShare: bar.close,
          }
        })
      })()

  // Inflow histories: Farside actual flows preferred, Yahoo bars × ratio as fallback
  let bhypInflowHistory: ETFDailyFlow[]
  let thypInflowHistory: ETFDailyFlow[]

  if (farsideRows.length > 0) {
    bhypInflowHistory = farsideRows.filter(r => r.bhyp !== null).map(r => ({ time: r.time, usd: r.bhyp! }))
    thypInflowHistory = farsideRows.filter(r => r.thyp !== null).map(r => ({ time: r.time, usd: r.thyp! }))
  } else {
    // THYP: confirmed delta-shares from 21Shares API history
    const thypHist = thyp?.history ?? []
    const thypDeltaMap = new Map<number, number>()
    for (let i = 1; i < thypHist.length; i++) {
      const prev = thypHist[i - 1], curr = thypHist[i]
      thypDeltaMap.set(curr.time, (curr.units - prev.units) * curr.navPerShare)
    }
    // For days not covered by delta-shares (e.g. today), fill from Yahoo bars
    for (const bar of thypBars) {
      const day = toMidnightUTC(bar.time)
      if (!thypDeltaMap.has(day)) thypDeltaMap.set(day, bar.volumeUsd * FALLBACK_RATIO)
    }
    thypInflowHistory = [...thypDeltaMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, usd]) => ({ time, usd }))

    // BHYP: Yahoo bars × FALLBACK_RATIO — do NOT compute from AUM/vol here since
    // AUM is heavily inflated by HYPE price appreciation (~2×), giving ~94% ratio
    bhypInflowHistory = bhypBars.map(bar => ({
      time: toMidnightUTC(bar.time),
      usd:  bar.volumeUsd * FALLBACK_RATIO,
    }))
  }

  // Today's inflow estimates
  // THYP: today's Yahoo bar preferred (live volume-based), fall back to delta-shares
  // Delta-shares reflects yesterday's confirmed units change — not today's data
  const thypYestShares   = thyp?.history.at(-2)?.units ?? 0
  const thypTodayBar     = thypBars.at(-1)
  const thypInflowEstimate: number | null = thypTodayBar
    ? thypTodayBar.volumeUsd * FALLBACK_RATIO
    : (thypYestShares > 0 && thypShares > 0 ? (thypShares - thypYestShares) * thypNav : null)

  // BHYP: volume × FALLBACK_RATIO (no shares-outstanding history available)
  const bhypTodayBar       = bhypBars.at(-1)
  const bhypInflowEstimate: number | null = bhypTodayBar
    ? bhypTodayBar.volumeUsd * FALLBACK_RATIO
    : null

  const bhypToday: ETFTodayEstimate | null = bhypAum > 0
    ? { aum: bhypAum, nav: bhypNav, shares: bhypShares, inflowUsd: bhypInflowEstimate, ts: now }
    : null
  const thypToday: ETFTodayEstimate | null = thypAum > 0
    ? { aum: thypAum, nav: thypNav, shares: thypShares, inflowUsd: thypInflowEstimate, ts: now }
    : null

  // Build per-day history table: union of all known dates across all sources
  const bhypHistByTime  = Object.fromEntries(bhypHistory.map(p  => [p.time,  p]))
  const thypHistByTime  = Object.fromEntries((thyp?.history ?? []).map(p => [p.time, p]))
  const bhypInflowByDay = Object.fromEntries(bhypInflowHistory.map(p => [p.time, p.usd]))
  const thypInflowByDay = Object.fromEntries(thypInflowHistory.map(p => [p.time, p.usd]))
  const bhypVolByDay    = Object.fromEntries(bhypBars.map(b => [toMidnightUTC(b.time), b.volumeUsd]))
  const thypVolByDay    = Object.fromEntries(thypBars.map(b => [toMidnightUTC(b.time), b.volumeUsd]))

  const allDays = [...new Set([
    ...bhypHistory.map(p => p.time),
    ...(thyp?.history ?? []).map(p => p.time),
    ...bhypBars.map(b => toMidnightUTC(b.time)),
    ...thypBars.map(b => toMidnightUTC(b.time)),
  ])].sort((a, b) => a - b)

  const todayMidnight = toMidnightUTC(now / 1000)

  const dailyHistory: DailyRow[] = allDays.map(t => {
    const bh = bhypHistByTime[t]
    const th = thypHistByTime[t]
    // For today, history APIs may not have updated yet — fall back to live today estimates
    const bhypAumForDay = bh?.usd ?? (t === todayMidnight && bhypToday ? bhypToday.aum : 0)
    const thypAumForDay = th?.usd ?? (t === todayMidnight && thypToday ? thypToday.aum : 0)
    const totalAum = bhypAumForDay + thypAumForDay
    // Derive HYPE price from THYP history (usd/hype is most accurate); fall back to current
    const dayHypePrice = th && th.hype > 0 ? th.usd / th.hype : (hypePrice || null)
    return {
      time:        t,
      totalAum,
      bhypInflow:  bhypInflowByDay[t] ?? null,
      thypInflow:  thypInflowByDay[t] ?? null,
      bhypVolume:  bhypVolByDay[t]    ?? null,
      thypVolume:  thypVolByDay[t]    ?? null,
      hypePrice:   dayHypePrice,
    }
  })

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
    dailyHistory,
    circulatingSupply,
    ts: now,
  }

  cache = { data, ts: Date.now() }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
