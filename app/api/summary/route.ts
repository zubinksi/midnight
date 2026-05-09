import Anthropic from '@anthropic-ai/sdk'

interface AssetSnapshot {
  ticker: string
  category: string
  pct: number       // % change (after-hours if market closed, else 24hr)
  price: number
}

interface SummaryRequest {
  assets: AssetSnapshot[]
  sessionLabel: 'AFTER HRS' | 'PRE-MKT' | null
  anchors: AssetSnapshot[]  // SP500 + BTC always included for context
}

const SYSTEM_PROMPT = `You are a terse, precise market analyst giving a brief performance summary of a user's personal watchlist.

Rules:
- 2–3 sentences maximum. No more.
- Always lead with the single biggest mover by % change, naming it explicitly with the number.
- Identify one pattern or relationship across assets if one genuinely exists (e.g. broad risk-off, sector rotation, crypto diverging from equities). If no meaningful pattern exists, don't invent one.
- Reference the broader market anchors (SP500, BTC) only when they add context to what the watchlist is doing.
- Use specific numbers. Never say "up significantly" when you can say "up 3.2%".
- No disclaimers, no "it's worth noting", no "as of my knowledge", no hedging language.
- Write in plain English, present tense, as if speaking to someone glancing at their phone.
- If the market is after-hours or pre-market, frame changes relative to the prior close.`

export async function POST(req: Request) {
  const { assets, sessionLabel, anchors }: SummaryRequest = await req.json()

  if (!assets || assets.length === 0) {
    return new Response('No assets', { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return new Response('Missing API key', { status: 500 })

  const client = new Anthropic({ apiKey })

  const session = sessionLabel ? `Market status: ${sessionLabel} (changes are vs prior close)` : 'Market status: regular trading hours (changes are 24hr)'

  const watchlistLines = assets
    .map(a => `${a.ticker} (${a.category}): ${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(2)}% @ $${a.price}`)
    .join('\n')

  const anchorLines = anchors
    .map(a => `${a.ticker}: ${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(2)}%`)
    .join(', ')

  const userMessage = `${session}

Watchlist:
${watchlistLines}

Broader market context: ${anchorLines}

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
