import Anthropic from '@anthropic-ai/sdk'

interface AssetSnapshot {
  ticker: string
  category: string
  pct: number        // after-hours/pre-mkt change vs close, or 24hr change during regular hours
  pctClose?: number  // change at close vs prior open (only present when session is after-hours/pre-mkt)
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

const SYSTEM_PROMPT = `You are a terse, precise market analyst summarising a user's personal watchlist.

Rules:
- Be selective: only comment on moves that are material. Skip assets that are flat or unremarkable.
- Lead with the most notable move, naming the asset and the exact number.
- If a news headline clearly explains a notable move, connect them directly. Prefer facts over vague references.
- For crypto, report funding rates when they are interesting (extreme positive or negative). Explain what the rate implies (crowded longs, shorts being squeezed, etc.).
- Do not speculate about broad macro themes, sector rotations, or what asset relationships may mean for the market. Stick to what the data actually shows.
- Use specific numbers always. Never say "up sharply" when you can say "up 4.1%".
- Keep the total response brief regardless of watchlist size — 2 to 4 sentences max. More assets does not mean more sentences.
- No disclaimers, no hedging language, no filler phrases.
- Write in plain English, present tense, as if speaking to someone glancing at their phone.
- When the session is after-hours or pre-market, each asset shows two changes: "close X%" is the regular-session return, "after hrs/pre-mkt X%" is the move since the close. Treat these as distinct — a strong close with a flat after-hours is a good day, not a flat one.`

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
      const extSession = sessionLabel !== null && a.pctClose !== undefined
      const changeStr = extSession
        ? `close ${a.pctClose! >= 0 ? '+' : ''}${a.pctClose!.toFixed(2)}% | ${sessionLabel!.toLowerCase()} ${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(2)}%`
        : `${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(2)}%`
      const fundingNote = a.funding !== undefined && a.category === 'crypto'
        ? ` | funding ${a.funding >= 0 ? '+' : ''}${(a.funding * 100).toFixed(4)}%/8hr`
        : ''
      return `${a.ticker} (${a.category}): ${changeStr} @ $${a.price}${fundingNote}`
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
