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
- Be selective: only comment on moves that are material. Skip assets that are flat or unremarkable.
- Scale length to what actually happened: if only one asset moved meaningfully, one sentence is enough. Only use 3–4 sentences when multiple assets have genuinely notable moves.
- Lead with the most notable move, naming the asset and the exact number.
- 52-week range context: note when an asset is near a 52W high or low if it adds meaning to the move.
- 7-day trend: mention the 7D change if it tells a different story from today (e.g. today up but 7D still deep negative).
- If a news headline or earnings result clearly explains a notable move, connect them directly.
- If a macro event (CPI, FOMC, NFP) coincides with broad market moves, mention it as the likely driver.
- For crypto moves, check the crypto news section for specific catalysts before attributing moves to positioning alone.
- For crypto, report funding rates or open interest only when they are extreme or tell an interesting story.
- Volume: mention if notably elevated relative to other assets on the watchlist — signals conviction.
- Do not speculate about macro themes or cross-asset relationships. Stick to what the data shows.
- Use specific numbers always.
- Plain text only. No markdown, no asterisks, no bold, no bullet points.
- No disclaimers, no hedging language, no filler phrases.
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

async function fetchFinnhubNews(tickers: string[]): Promise<string[]> {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey || tickers.length === 0) return []
  const from = dateStr(-3)
  const to = dateStr(0)
  const all: { headline: string; datetime: number }[] = []
  await Promise.all(tickers.map(async ticker => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${apiKey}`)
      if (!res.ok) return
      const items = (await res.json()) as FinnhubNewsItem[]
      if (Array.isArray(items))
        items.slice(0, 2).forEach(item => all.push({ headline: `[${ticker}] ${item.headline}`, datetime: item.datetime }))
    } catch {}
  }))
  return all.sort((a, b) => b.datetime - a.datetime).slice(0, 8).map(h => h.headline)
}

async function fetchEarnings(tickers: string[]): Promise<string[]> {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey || tickers.length === 0) return []
  const tickerSet = new Set(tickers)
  try {
    const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${dateStr(-5)}&to=${dateStr(1)}&token=${apiKey}`)
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
      const res = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${apiKey}`)
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
      `https://finnhub.io/api/v1/calendar/economic?from=${dateStr(-2)}&to=${dateStr(1)}&token=${apiKey}`
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
      .slice(0, 6)
  } catch { return [] }
}

async function fetchCryptoNews(tickers: string[]): Promise<string[]> {
  if (tickers.length === 0) return []
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/news?per_page=20', {
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) return []
    const data = await res.json() as { data?: Array<{ title: string }> }
    const items = data.data ?? []
    // Prefer articles that mention one of our tickers, fall back to top general crypto news
    const tickerLower = tickers.map(t => t.toLowerCase())
    const relevant = items.filter(item =>
      tickerLower.some(t => item.title.toLowerCase().includes(t))
    )
    const fallback = items.filter(item =>
      !tickerLower.some(t => item.title.toLowerCase().includes(t))
    )
    return [...relevant, ...fallback].slice(0, 5).map(item => item.title)
  } catch { return [] }
}

async function fetch7DChanges(assets: AssetSnapshot[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const startTime = Date.now() - 7 * 86400 * 1000
  await Promise.all(assets.map(async a => {
    try {
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

  const equityTickers = assets.filter(a => a.category !== 'crypto').map(a => a.ticker)
  const cryptoTickers = assets.filter(a => a.category === 'crypto').map(a => a.ticker)

  const [headlines, earnings, macroEvents, cryptoNews, weekRanges, weekChanges] = await Promise.all([
    fetchFinnhubNews(equityTickers),
    fetchEarnings(equityTickers),
    fetchEconomicCalendar(),
    fetchCryptoNews(cryptoTickers),
    fetch52WeekRanges(equityTickers),
    fetch7DChanges(assets),
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

  const earningsSection = earnings.length > 0
    ? `\nRecent earnings:\n${earnings.map(e => `- ${e}`).join('\n')}`
    : ''

  const macroSection = macroEvents.length > 0
    ? `\nRecent US macro events:\n${macroEvents.map(e => `- ${e}`).join('\n')}`
    : ''

  const newsSection = headlines.length > 0
    ? `\nRecent equity news:\n${headlines.map(h => `- ${h}`).join('\n')}`
    : ''

  const cryptoNewsSection = cryptoNews.length > 0
    ? `\nRecent crypto news:\n${cryptoNews.map(h => `- ${h}`).join('\n')}`
    : ''

  const userMessage = `${session}

Watchlist:
${watchlistLines}

Broader market context: ${anchorLines}${earningsSection}${macroSection}${newsSection}${cryptoNewsSection}

Write the summary now.`

  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 220,
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
