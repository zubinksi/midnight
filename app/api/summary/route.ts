import Anthropic from '@anthropic-ai/sdk'

interface AssetSnapshot {
  ticker: string
  category: string
  pct: number
  price: number
  funding?: number
}

interface SummaryRequest {
  assets: AssetSnapshot[]
  sessionLabel: 'AFTER HRS' | 'PRE-MKT' | null
  anchors: AssetSnapshot[]
}

interface BraveNewsResult {
  title: string
  description?: string
  url: string
  age?: string
}

interface BraveNewsResponse {
  results?: BraveNewsResult[]
}

const SYSTEM_PROMPT = `You are a terse, precise market analyst giving a brief performance summary of a user's personal watchlist.

Rules:
- 2–3 sentences maximum. No more.
- Always lead with the single biggest mover by % change, naming it explicitly with the number.
- Identify one pattern or relationship across assets if one genuinely exists (e.g. broad risk-off, sector rotation, crypto diverging from equities). If no meaningful pattern exists, don't invent one.
- Reference the broader market anchors (SP500, BTC) only when they add context to what the watchlist is doing.
- Use specific numbers. Never say "up significantly" when you can say "up 3.2%".
- If funding rates are provided, use them to explain crypto price moves (high positive funding = crowded longs, extreme negative = crowded shorts). Only mention funding when it's notable (>0.05% or <-0.02% per 8hr).
- If news headlines are provided, briefly mention the most relevant catalyst driving a notable move. Prefer concrete facts over vague references.
- No disclaimers, no "it's worth noting", no "as of my knowledge", no hedging language.
- Write in plain English, present tense, as if speaking to someone glancing at their phone.
- If the market is after-hours or pre-market, frame changes relative to the prior close.`

async function fetchBraveNews(tickers: string[]): Promise<BraveNewsResult[]> {
  const apiKey = process.env.BRAVE_API_KEY
  if (!apiKey || tickers.length === 0) return []

  const query = tickers.join(' OR ') + ' stock crypto market'
  const url = `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=8&freshness=pd`

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    })
    if (!res.ok) return []
    const data: BraveNewsResponse = await res.json()
    return data.results ?? []
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

  const tickers = assets.map(a => a.ticker)
  const headlines = await fetchBraveNews(tickers)

  const client = new Anthropic({ apiKey })

  const session = sessionLabel ? `Market status: ${sessionLabel} (changes are vs prior close)` : 'Market status: regular trading hours (changes are 24hr)'

  const watchlistLines = assets
    .map(a => {
      const fundingNote = a.funding !== undefined && a.category === 'crypto'
        ? ` | funding ${a.funding >= 0 ? '+' : ''}${(a.funding * 100).toFixed(4)}%/8hr`
        : ''
      return `${a.ticker} (${a.category}): ${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(2)}% @ $${a.price}${fundingNote}`
    })
    .join('\n')

  const anchorLines = anchors
    .map(a => `${a.ticker}: ${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(2)}%`)
    .join(', ')

  const headlinesSection = headlines.length > 0
    ? `\nRecent headlines:\n${headlines.slice(0, 5).map(h => `- ${h.title}`).join('\n')}`
    : ''

  const userMessage = `${session}

Watchlist:
${watchlistLines}

Broader market context: ${anchorLines}${headlinesSection}

Write the summary now.`

  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
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
