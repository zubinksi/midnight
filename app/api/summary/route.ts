import Anthropic from '@anthropic-ai/sdk'

interface AssetSnapshot {
  ticker: string
  coin: string
  category: string
  pct: number
  pctClose?: number
  price: number
  funding?: number
  volume24h?: number
  openInterest?: number
}

interface SummaryRequest {
  assets: AssetSnapshot[]
  sessionLabel: 'AFTER HRS' | 'PRE-MKT' | null
  anchors: AssetSnapshot[]
}

interface FinnhubNewsItem {
  headline: string
  datetime: number
}

interface FinnhubEarningsItem {
  symbol: string
  date: string
  epsActual: number | null
  epsEstimate: number | null
  surprisePercent: number | null
}

interface FinnhubEarningsResponse {
  earningsCalendar?: FinnhubEarningsItem[]
}

interface FinnhubMetricResponse {
  metric?: { '52WeekHigh'?: number; '52WeekLow'?: number }
}

const SYSTEM_PROMPT = `You are a terse, precise market analyst summarising a user's personal watchlist.

Rules:
- Cover at most 3 assets. Pick the most notable movers — leave the rest out entirely.
- Every response must end at a complete sentence. Never start a sentence about an asset if you cannot finish the thought. It is better to omit an asset than to cut off mid-sentence.
- Be selective: skip assets that are flat or unremarkable.
- Always refer to assets by their ticker symbol (e.g. MU, HIMS, BTC). Never use full company or coin names.
- Connect moves to specific data: a named headline, an earnings result, a funding rate extreme, a 52W high/low. Do not make vague references to "sentiment" or "geopolitical headlines" unless a specific headline in the provided data supports it.
- No forward-looking statements. Do not say an asset "has room to run" or similar. Report what happened, not what might happen.
- 52-week range: mention only when the asset is within 5% of its 52W high or low.
- 7-day trend: mention only when it meaningfully contrasts with today (e.g. today up strongly but 7D still negative).
- For crypto, report funding rates or open interest only when extreme.
- Use specific numbers always. No vague language.
- Plain text only. No markdown, no asterisks, no bold, no bullet points.
- No disclaimers, no hedging language, no filler phrases. No "crushed it", "rocketed", or similar hyperbole.
- Write in plain English, present tense, as if speaking to someone glancing at their phone.
- When the session is after-hours or pre-market, each asset shows two changes: "close X%" is the regular-session return, "after hrs/pre-mkt X%" is the move since the close. Treat these as distinct.`

function fmtVol(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${(v / 1e3).toFixed(0)}K`
}

function fmtOI(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  return `${(v / 1e3).toFixed(0)}K`
}

function dateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return d.toISOString().split('T')[0]
}

// Significant move threshold for selective data fetching
const MOVER_THRESHOLD = 1.5

function significantPct(a: AssetSnapshot): number {
  return Math.abs(a.pctClose !== undefined ? a.pctClose : a.pct)
}

async function fetchFinnhubNews(tickers: string[]): Promise<string[]> {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey || tickers.length === 0) return []
  const from = dateStr(-3)
  const to   = dateStr(0)
  const all: { headline: string; datetime: number }[] = []
  await Promise.all(tickers.map(async ticker => {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${apiKey}`,
        { next: { revalidate: 1800 } }  // 30 min cache, shared across users
      )
      if (!res.ok) return
      const items = (await res.json()) as FinnhubNewsItem[]
      if (Array.isArray(items))
        items.slice(0, 2).forEach(item => all.push({ headline: `[${ticker}] ${item.headline}`, datetime: item.datetime }))
    } catch {}
  }))
  return all.sort((a, b) => b.datetime - a.datetime).slice(0, 3).map(h => h.headline)
}

async function fetchEarnings(tickers: string[]): Promise<string[]> {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey || tickers.length === 0) return []
  const tickerSet = new Set(tickers)
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${dateStr(-5)}&to=${dateStr(1)}&token=${apiKey}`,
      { next: { revalidate: 7200 } }  // 2 hr cache
    )
    if (!res.ok) return []
    const data = (await res.json()) as FinnhubEarningsResponse
    return (data.earningsCalendar ?? [])
      .filter(e => tickerSet.has(e.symbol) && e.epsActual !== null)
      .map(e => {
        const beat = e.epsEstimate !== null ? (e.epsActual! >= e.epsEstimate ? 'beat' : 'missed') : null
        const surprise = e.surprisePercent !== null ? ` (${e.surprisePercent > 0 ? '+' : ''}${e.surprisePercent.toFixed(1)}% surprise)` : ''
        return `[${e.symbol}] earnings ${beat ?? 'reported'} EPS ${e.epsActual}${beat ? ` vs est ${e.epsEstimate}${surprise}` : ''}`
      })
  } catch { return [] }
}

async function fetch52WeekRanges(tickers: string[]): Promise<Record<string, { high: number; low: number }>> {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey || tickers.length === 0) return {}
  const out: Record<string, { high: number; low: number }> = {}
  await Promise.all(tickers.map(async ticker => {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${apiKey}`,
        { next: { revalidate: 14400 } }  // 4 hr cache — 52W range barely changes
      )
      if (!res.ok) return
      const data = (await res.json()) as FinnhubMetricResponse
      const high = data.metric?.['52WeekHigh']
      const low  = data.metric?.['52WeekLow']
      if (high && low) out[ticker] = { high, low }
    } catch {}
  }))
  return out
}

async function fetchEconomicCalendar(): Promise<string[]> {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) return []
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/economic?from=${dateStr(-2)}&to=${dateStr(1)}&token=${apiKey}`,
      { next: { revalidate: 7200 } }  // 2 hr cache
    )
    if (!res.ok) return []
    const data = await res.json() as { economicCalendar?: Array<{
      event: string; country: string; impact: string
      actual?: string; estimate?: string; prev?: string; unit?: string
    }> }
    return (data.economicCalendar ?? [])
      .filter(e => e.country === 'US' && (e.impact === 'high' || e.impact === 'medium'))
      .map(e => {
        const parts = [e.event]
        if (e.actual)   parts.push(`actual ${e.actual}${e.unit ?? ''}`)
        if (e.estimate) parts.push(`est ${e.estimate}${e.unit ?? ''}`)
        if (e.prev)     parts.push(`prev ${e.prev}${e.unit ?? ''}`)
        return parts.join(', ')
      })
      .slice(0, 3)
  } catch { return [] }
}

async function fetchCryptoNews(tickers: string[]): Promise<string[]> {
  if (tickers.length === 0) return []
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/news?per_page=20', {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 900 },  // 15 min cache
    })
    if (!res.ok) return []
    const data = await res.json() as { data?: Array<{ title: string }> }
    const items = data.data ?? []
    const tickerLower = tickers.map(t => t.toLowerCase())
    const relevant = items.filter(item => tickerLower.some(t => item.title.toLowerCase().includes(t)))
    const fallback  = items.filter(item => !tickerLower.some(t => item.title.toLowerCase().includes(t)))
    return [...relevant, ...fallback].slice(0, 3).map(item => item.title)
  } catch { return [] }
}

async function fetch7DChanges(assets: AssetSnapshot[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const startTime = Date.now() - 7 * 86400 * 1000
  await Promise.all(assets.map(async a => {
    try {
      // Hyperliquid uses POST so Next.js fetch cache doesn't apply — calls are fast and free
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'candleSnapshot', req: { coin: a.coin, interval: '1d', startTime, endTime: Date.now() } }),
      })
      if (!res.ok) return
      const candles = (await res.json()) as Array<{ o: string; c: string }>
      if (!Array.isArray(candles) || candles.length < 2) return
      const open  = parseFloat(candles[0].o)
      const close = parseFloat(candles[candles.length - 1].c)
      if (open > 0) out[a.ticker] = (close - open) / open * 100
    } catch {}
  }))
  return out
}

export async function POST(req: Request) {
  const { assets, sessionLabel, anchors }: SummaryRequest = await req.json()
  if (!assets || assets.length === 0) return new Response('No assets', { status: 400 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return new Response('Missing API key', { status: 500 })

  // Only fetch enrichment data for assets that actually moved materially
  const movers        = assets.filter(a => significantPct(a) >= MOVER_THRESHOLD)
  const equityMovers  = movers.filter(a => a.category !== 'crypto').map(a => a.ticker)
  const cryptoMovers  = movers.filter(a => a.category === 'crypto').map(a => a.ticker)
  const allEquity     = assets.filter(a => a.category !== 'crypto').map(a => a.ticker)

  const [headlines, earnings, macroEvents, cryptoNews, weekRanges, weekChanges] = await Promise.all([
    fetchFinnhubNews(equityMovers),          // news only for movers
    fetchEarnings(allEquity),                 // earnings for all equity (cheap, single call)
    fetchEconomicCalendar(),                  // single call, 2hr cache
    fetchCryptoNews(cryptoMovers),            // news only for crypto movers
    fetch52WeekRanges(equityMovers),          // 52W only for movers, 4hr cache
    fetch7DChanges(assets),                   // all assets — free Hyperliquid calls
  ])

  const client = new Anthropic({ apiKey })

  const session = sessionLabel
    ? `Market status: ${sessionLabel} (changes are vs prior close)`
    : 'Market status: regular trading hours (changes are 24hr)'

  const watchlistLines = assets.map(a => {
    const extSession = sessionLabel !== null && a.pctClose !== undefined
    const changeStr = extSession
      ? `close ${a.pctClose! >= 0 ? '+' : ''}${a.pctClose!.toFixed(2)}% | ${sessionLabel!.toLowerCase()} ${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(2)}%`
      : `${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(2)}%`

    const extras: string[] = []
    if (weekChanges[a.ticker] !== undefined)
      extras.push(`7d ${weekChanges[a.ticker] >= 0 ? '+' : ''}${weekChanges[a.ticker].toFixed(1)}%`)
    if (a.volume24h)    extras.push(`vol ${fmtVol(a.volume24h)}`)
    if (a.openInterest) extras.push(`OI ${fmtOI(a.openInterest)}`)
    if (a.funding !== undefined && a.category === 'crypto')
      extras.push(`funding ${a.funding >= 0 ? '+' : ''}${(a.funding * 100).toFixed(4)}%/8hr`)

    const wr = weekRanges[a.ticker]
    if (wr) {
      const pctOfRange = ((a.price - wr.low) / (wr.high - wr.low) * 100).toFixed(0)
      extras.push(`52W $${wr.low}–$${wr.high} (at ${pctOfRange}%)`)
    }

    const extrasStr = extras.length > 0 ? ` | ${extras.join(' | ')}` : ''
    return `${a.ticker} (${a.category}): ${changeStr} @ $${a.price}${extrasStr}`
  }).join('\n')

  const anchorLines = anchors
    .map(a => `${a.ticker}: ${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(2)}%`)
    .join(', ')

  const earningsSection  = earnings.length > 0  ? `\nRecent earnings:\n${earnings.map(e => `- ${e}`).join('\n')}`          : ''
  const macroSection     = macroEvents.length > 0 ? `\nRecent US macro events:\n${macroEvents.map(e => `- ${e}`).join('\n')}` : ''
  const newsSection      = headlines.length > 0  ? `\nRecent equity news:\n${headlines.map(h => `- ${h}`).join('\n')}`       : ''
  const cryptoSection    = cryptoNews.length > 0  ? `\nRecent crypto news:\n${cryptoNews.map(h => `- ${h}`).join('\n')}`     : ''

  const userMessage = `${session}

Watchlist:
${watchlistLines}

Broader market context: ${anchorLines}${earningsSection}${macroSection}${newsSection}${cryptoSection}

Write the summary now.`

  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 180,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  return new Response(
    new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta')
            controller.enqueue(new TextEncoder().encode(chunk.delta.text))
        }
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )
}
