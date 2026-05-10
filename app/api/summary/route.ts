import Anthropic from '@anthropic-ai/sdk'

interface AssetSnapshot {
  ticker: string
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

const SYSTEM_PROMPT = `You are a terse, precise market analyst summarising a user's personal watchlist.

Rules:
- Be selective: only comment on moves that are material. Skip assets that are flat or unremarkable.
- Lead with the most notable move, naming the asset and the exact number.
- If a news headline or earnings result clearly explains a notable move, connect them directly. Prefer facts over vague references.
- If earnings data is provided (EPS beat/miss, surprise %), lead with that for any earnings-driven move.
- For crypto, report funding rates or open interest when they are interesting (extreme positive/negative funding, large OI). Explain what it implies plainly.
- Volume: if an asset's volume is notably elevated relative to others on the watchlist, mention it as a signal of conviction behind the move.
- Do not speculate about broad macro themes or what asset relationships may mean for the market. Stick to what the data actually shows.
- Use specific numbers always. Never say "up sharply" when you can say "up 4.1%".
- Keep the total response brief regardless of watchlist size — 2 to 4 sentences max.
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
  const to   = dateStr(0)

  const allHeadlines: { headline: string; datetime: number }[] = []

  await Promise.all(
    tickers.map(async ticker => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${apiKey}`
        )
        if (!res.ok) return
        const items = (await res.json()) as FinnhubNewsItem[]
        if (Array.isArray(items)) {
          // take the 2 most recent per ticker
          items.slice(0, 2).forEach(item => allHeadlines.push({ headline: `[${ticker}] ${item.headline}`, datetime: item.datetime }))
        }
      } catch {}
    })
  )

  // sort by recency, return top 8
  return allHeadlines
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 8)
    .map(h => h.headline)
}

async function fetchEarnings(tickers: string[]): Promise<string[]> {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey || tickers.length === 0) return []

  const tickerSet = new Set(tickers)
  const from = dateStr(-5)
  const to   = dateStr(1)

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${apiKey}`
    )
    if (!res.ok) return []
    const data = (await res.json()) as FinnhubEarningsResponse
    const items = data.earningsCalendar ?? []

    return items
      .filter(e => tickerSet.has(e.symbol) && e.epsActual !== null)
      .map(e => {
        const beat = e.epsEstimate !== null && e.epsActual !== null
          ? e.epsActual >= e.epsEstimate ? 'beat' : 'missed'
          : null
        const surprise = e.surprisePercent !== null
          ? ` (${e.surprisePercent > 0 ? '+' : ''}${e.surprisePercent.toFixed(1)}% surprise)`
          : ''
        return `[${e.symbol}] earnings ${beat ?? 'reported'} EPS ${e.epsActual}${beat ? ` vs est ${e.epsEstimate}${surprise}` : ''}`
      })
  } catch {
    return []
  }
}

export async function POST(req: Request) {
  const { assets, sessionLabel, anchors }: SummaryRequest = await req.json()

  if (!assets || assets.length === 0) {
    return new Response('No assets', { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return new Response('Missing API key', { status: 500 })

  // Only fetch Finnhub data for non-crypto assets (equities, indices, commodities, FX)
  const equityTickers = assets.filter(a => a.category !== 'crypto').map(a => a.ticker)

  const [headlines, earnings] = await Promise.all([
    fetchFinnhubNews(equityTickers),
    fetchEarnings(equityTickers),
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
    if (a.volume24h)    extras.push(`vol ${fmtVol(a.volume24h)}`)
    if (a.openInterest) extras.push(`OI ${fmtOI(a.openInterest)}`)
    if (a.funding !== undefined && a.category === 'crypto')
      extras.push(`funding ${a.funding >= 0 ? '+' : ''}${(a.funding * 100).toFixed(4)}%/8hr`)

    const extrasStr = extras.length > 0 ? ` | ${extras.join(' | ')}` : ''
    return `${a.ticker} (${a.category}): ${changeStr} @ $${a.price}${extrasStr}`
  }).join('\n')

  const anchorLines = anchors
    .map(a => `${a.ticker}: ${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(2)}%`)
    .join(', ')

  const earningsSection = earnings.length > 0
    ? `\nRecent earnings:\n${earnings.map(e => `- ${e}`).join('\n')}`
    : ''

  const newsSection = headlines.length > 0
    ? `\nRecent news:\n${headlines.map(h => `- ${h}`).join('\n')}`
    : ''

  const userMessage = `${session}

Watchlist:
${watchlistLines}

Broader market context: ${anchorLines}${earningsSection}${newsSection}

Write the summary now.`

  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  return new Response(
    new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text))
          }
        }
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )
}
